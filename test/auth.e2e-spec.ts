import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MembershipClaim } from '../src/shared/domain/auth/authenticated-user.js';
import { Role } from '../src/shared/domain/auth/role.js';
import {
  CurrentMembership,
  Roles,
} from '../src/shared/presentation/decorators/auth.decorators.js';
import type {
  FakeGoogleGateway,
  InMemoryRateLimiter,
  InMemoryUserRepository,
} from './support/identity.fakes.js';
import {
  createTestApp,
  TEST_FRONTEND_URL as FRONTEND_URL,
  TEST_RATE_LIMIT,
} from './support/test-app.js';

@Controller('probe')
class ProbeController {
  @Get('teachers')
  @Roles(Role.TEACHER)
  teachersOnly(@CurrentMembership() membership: MembershipClaim | undefined) {
    return { membershipId: membership?.id ?? null };
  }
}

const ada = {
  email: 'ada@example.com',
  password: 'correct-password',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

function cookieNamed(response: request.Response, name: string): string | undefined {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((cookie) => cookie.startsWith(`${name}=`));
}

describe('Auth HTTP flow', () => {
  let app: INestApplication<App>;
  let users: InMemoryUserRepository;
  let google: FakeGoogleGateway;
  let rateLimiter: InMemoryRateLimiter;

  beforeEach(async () => {
    ({ app, users, google, rateLimiter } = await createTestApp([ProbeController]));
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes the health check publicly', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('protects every route by default', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).get('/probe/teachers').expect(401);
  });

  it('registers, then serves /auth/me with the returned access token', async () => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send(ada)
      .expect(201);

    expect(registered.body.user).toMatchObject({ email: ada.email, status: 'PENDING_ONBOARDING' });
    expect(JSON.stringify(registered.body)).not.toContain('passwordHash');
    expect(registered.body).not.toHaveProperty('refreshToken');

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(ada.email);
  });

  it('sets the refresh token only as an httpOnly cookie scoped to /auth', async () => {
    const response = await request(app.getHttpServer()).post('/auth/register').send(ada);

    const cookie = cookieNamed(response, 'everlearn_refresh');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects malformed input before it reaches the use case', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/auth/register')
      .send({ ...ada, email: 'not-an-email' })
      .expect(400);
    await request(server)
      .post('/auth/register')
      .send({ ...ada, password: 'short' })
      .expect(400);
    await request(server)
      .post('/auth/register')
      .send({ ...ada, isPlatformAdmin: true })
      .expect(400);
    expect(users.users.size).toBe(0);
  });

  it('maps domain errors to HTTP status codes with a stable error code', async () => {
    const server = app.getHttpServer();
    await request(server).post('/auth/register').send(ada).expect(201);

    const conflict = await request(server).post('/auth/register').send(ada).expect(409);
    expect(conflict.body.code).toBe('EMAIL_ALREADY_REGISTERED');

    const denied = await request(server)
      .post('/auth/login')
      .send({ email: ada.email, password: 'wrong-password' })
      .expect(401);
    expect(denied.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in, refreshes with the cookie and logs out', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/register').send(ada).expect(201);
    await agent.post('/auth/logout').expect(204);
    await agent.post('/auth/refresh').expect(401);

    await agent.post('/auth/login').send({ email: ada.email, password: ada.password }).expect(200);
    const refreshed = await agent.post('/auth/refresh').expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);
  });

  it('revokes the refresh token on logout, so a stolen copy of the cookie stops working', async () => {
    const server = app.getHttpServer();
    const registered = await request(server).post('/auth/register').send(ada).expect(201);
    const stolenCookie = cookieNamed(registered, 'everlearn_refresh')?.split(';')[0] ?? '';
    await request(server).post('/auth/refresh').set('Cookie', stolenCookie).expect(200);

    await request(server).post('/auth/logout').set('Cookie', stolenCookie).expect(204);

    const replay = await request(server).post('/auth/refresh').set('Cookie', stolenCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('keeps other sessions of the same user alive after one logs out', async () => {
    const server = app.getHttpServer();
    const laptop = request.agent(server);
    const phone = request.agent(server);
    await laptop.post('/auth/register').send(ada).expect(201);
    await phone.post('/auth/login').send({ email: ada.email, password: ada.password }).expect(200);

    await laptop.post('/auth/logout').expect(204);

    await phone.post('/auth/refresh').expect(200);
  });

  it('does not rotate the refresh cookie on refresh', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/register').send(ada).expect(201);

    const refreshed = await agent.post('/auth/refresh').expect(200);

    expect(cookieNamed(refreshed, 'everlearn_refresh')).toBeUndefined();
  });

  it('rate-limits login attempts with 429 and a Retry-After header', async () => {
    const server = app.getHttpServer();
    const attempt = () =>
      request(server).post('/auth/login').send({ email: ada.email, password: 'wrong-password' });
    for (let i = 0; i < TEST_RATE_LIMIT; i += 1) {
      expect((await attempt()).status).toBe(401);
    }

    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rate-limits registration per client and leaves other endpoints unaffected', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < TEST_RATE_LIMIT; i += 1) {
      await request(server)
        .post('/auth/register')
        .send({ ...ada, email: `user${i}@example.com` })
        .expect(201);
    }

    await request(server)
      .post('/auth/register')
      .send({ ...ada, email: 'one-too-many@example.com' })
      .expect(429);
    expect(users.users.size).toBe(TEST_RATE_LIMIT);
    await request(server).post('/auth/refresh').expect(401);
    await request(server).get('/health').expect(200);
  });

  it('still allows sign-in when the rate limiter backend is down', async () => {
    rateLimiter.failWith = new Error('redis unavailable');

    await request(app.getHttpServer()).post('/auth/register').send(ada).expect(201);
  });

  it('refuses a refresh token used as an access token', async () => {
    const response = await request(app.getHttpServer()).post('/auth/register').send(ada);
    const refreshToken = cookieNamed(response, 'everlearn_refresh')?.split(';')[0].split('=')[1];

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
  });

  it('enforces @Roles against the institution in the request header', async () => {
    const server = app.getHttpServer();
    const registered = await request(server).post('/auth/register').send(ada);
    const membership = { id: 'm-1', institutionId: 'inst-1', role: Role.TEACHER };
    users.memberships.set(registered.body.user.id, [membership]);

    // The first token predates the membership, so it carries no roles
    await request(server)
      .get('/probe/teachers')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .set('x-institution-id', 'inst-1')
      .expect(403);

    const login = await request(server)
      .post('/auth/login')
      .send({ email: ada.email, password: ada.password });
    const authorized = () =>
      request(server).get('/probe/teachers').set('Authorization', `Bearer ${login.body.accessToken}`);

    await authorized().set('x-institution-id', 'inst-1').expect(200, { membershipId: 'm-1' });
    await authorized().set('x-institution-id', 'inst-2').expect(403);
    await authorized().expect(403);
  });

  it('completes the Google redirect flow and leaves only a refresh cookie behind', async () => {
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/auth/google').expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    expect(cookieNamed(start, 'everlearn_oauth_state')).toContain('HttpOnly');

    const callback = await agent.get(`/auth/google/callback?code=auth-code&state=${state}`).expect(302);

    expect(callback.headers.location).toBe(`${FRONTEND_URL}/auth/callback`);
    expect(callback.headers.location).not.toContain('token');
    const refreshed = await agent.post('/auth/refresh').expect(200);
    expect(refreshed.body.user.email).toBe('ada@example.com');
  });

  it('sends a forged Google callback back to the login page without a session', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.get('/auth/google').expect(302);

    const callback = await agent.get('/auth/google/callback?code=auth-code&state=forged').expect(302);

    expect(callback.headers.location).toBe(`${FRONTEND_URL}/login?error=INVALID_OAUTH_STATE`);
    expect(google.exchangedCodes).toHaveLength(0);
    await agent.post('/auth/refresh').expect(401);
  });
});
