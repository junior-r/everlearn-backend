import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { UserStatus } from '../src/modules/identity/domain/entities/user.entity.js';
import type { MembershipClaim } from '../src/shared/domain/auth/authenticated-user.js';
import { Role } from '../src/shared/domain/auth/role.js';
import {
  CurrentMembership,
  Roles,
} from '../src/shared/presentation/decorators/auth.decorators.js';
import { TEST_PASSWORD } from './support/identity.fakes.js';
import { INSTITUTION_ID, OTHER_INSTITUTION_ID } from './support/onboarding.fakes.js';
import {
  createTestApp,
  TEST_FRONTEND_URL as FRONTEND_URL,
  TEST_RATE_LIMIT,
  type TestApp,
} from './support/test-app.js';

@Controller('probe')
class ProbeController {
  @Get('teachers')
  @Roles(Role.TEACHER)
  teachersOnly(@CurrentMembership() membership: MembershipClaim | undefined) {
    return { membershipId: membership?.id ?? null };
  }
}

const EMAIL = 'ada@example.com';
const credentials = { email: EMAIL, password: TEST_PASSWORD };

function cookieNamed(response: request.Response, name: string): string | undefined {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((cookie) => cookie.startsWith(`${name}=`));
}

describe('Auth HTTP flow', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp([ProbeController]);
    ctx.users.seed({ email: EMAIL, status: UserStatus.ACTIVE });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('exposes the health check publicly', async () => {
    await request(ctx.server).get('/health').expect(200, { status: 'ok' });
  });

  it('protects every route by default', async () => {
    for (const path of ['/auth/me', '/probe/teachers', '/institutions', '/members', '/subjects']) {
      await request(ctx.server).get(path).expect(401);
    }
  });

  it('no longer offers public self-registration', async () => {
    await request(ctx.server)
      .post('/auth/register')
      .send({ ...credentials, email: 'new@example.com', firstName: 'New', lastName: 'User' })
      .expect(404);
    expect(ctx.users.users.size).toBe(1);
  });

  it('logs in, then serves /auth/me with the returned access token', async () => {
    const login = await request(ctx.server).post('/auth/login').send(credentials).expect(200);

    expect(login.body.user).toMatchObject({ email: EMAIL, status: 'ACTIVE' });
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');
    expect(login.body).not.toHaveProperty('refreshToken');

    const me = await request(ctx.server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(EMAIL);
  });

  it('sets the refresh token only as an httpOnly cookie scoped to /auth', async () => {
    const response = await request(ctx.server).post('/auth/login').send(credentials);

    const cookie = cookieNamed(response, 'everlearn_refresh');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects malformed input and maps domain errors to stable codes', async () => {
    await request(ctx.server).post('/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
    await request(ctx.server)
      .post('/auth/login')
      .send({ ...credentials, isPlatformAdmin: true })
      .expect(400);

    const denied = await request(ctx.server)
      .post('/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' })
      .expect(401);
    expect(denied.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('refreshes with the cookie and logs out', async () => {
    const agent = request.agent(ctx.server);
    await agent.post('/auth/login').send(credentials).expect(200);

    const refreshed = await agent.post('/auth/refresh').expect(200);
    await request(ctx.server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);

    await agent.post('/auth/logout').expect(204);
    await agent.post('/auth/refresh').expect(401);
  });

  it('revokes the refresh token on logout, so a stolen copy of the cookie stops working', async () => {
    const login = await request(ctx.server).post('/auth/login').send(credentials).expect(200);
    const stolenCookie = cookieNamed(login, 'everlearn_refresh')?.split(';')[0] ?? '';
    await request(ctx.server).post('/auth/refresh').set('Cookie', stolenCookie).expect(200);

    await request(ctx.server).post('/auth/logout').set('Cookie', stolenCookie).expect(204);

    const replay = await request(ctx.server).post('/auth/refresh').set('Cookie', stolenCookie);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('keeps other sessions of the same user alive after one logs out', async () => {
    const laptop = request.agent(ctx.server);
    const phone = request.agent(ctx.server);
    await laptop.post('/auth/login').send(credentials).expect(200);
    await phone.post('/auth/login').send(credentials).expect(200);

    await laptop.post('/auth/logout').expect(204);

    await phone.post('/auth/refresh').expect(200);
  });

  it('does not rotate the refresh cookie on refresh', async () => {
    const agent = request.agent(ctx.server);
    await agent.post('/auth/login').send(credentials).expect(200);

    const refreshed = await agent.post('/auth/refresh').expect(200);

    expect(cookieNamed(refreshed, 'everlearn_refresh')).toBeUndefined();
  });

  it('rate-limits login attempts with 429 and a Retry-After header', async () => {
    const attempt = () =>
      request(ctx.server).post('/auth/login').send({ email: EMAIL, password: 'wrong-password' });
    for (let i = 0; i < TEST_RATE_LIMIT; i += 1) {
      expect((await attempt()).status).toBe(401);
    }

    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    await request(ctx.server).get('/health').expect(200);
  });

  it('still allows sign-in when the rate limiter backend is down', async () => {
    ctx.rateLimiter.failWith = new Error('redis unavailable');

    await request(ctx.server).post('/auth/login').send(credentials).expect(200);
  });

  it('refuses a refresh token used as an access token', async () => {
    const response = await request(ctx.server).post('/auth/login').send(credentials);
    const refreshToken = cookieNamed(response, 'everlearn_refresh')?.split(';')[0].split('=')[1];

    await request(ctx.server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
  });

  it('enforces @Roles against the institution in the request header', async () => {
    const teacher = await ctx.signInAs(Role.TEACHER, INSTITUTION_ID);
    const authorized = () =>
      request(ctx.server).get('/probe/teachers').set('Authorization', `Bearer ${teacher.token}`);

    await authorized()
      .set('x-institution-id', INSTITUTION_ID)
      .expect(200, { membershipId: teacher.membership.id });
    await authorized().set('x-institution-id', OTHER_INSTITUTION_ID).expect(403);
    await authorized().expect(403);
  });

  it('gives a role only from the next token after it is granted', async () => {
    const before = await ctx.tokenFor(EMAIL);
    const user = await ctx.users.findByEmail(EMAIL);
    ctx.users.memberships.set(user?.id ?? '', [
      { id: 'm-1', institutionId: INSTITUTION_ID, role: Role.TEACHER },
    ]);
    const probe = (token: string) =>
      request(ctx.server)
        .get('/probe/teachers')
        .set('Authorization', `Bearer ${token}`)
        .set('x-institution-id', INSTITUTION_ID);

    await probe(before).expect(403);
    await probe(await ctx.tokenFor(EMAIL)).expect(200);
  });

  it('completes the Google redirect flow for a linked account, leaving only a refresh cookie', async () => {
    const user = await ctx.users.findByEmail(EMAIL);
    ctx.users.identities.set('GOOGLE:google-sub-1', user?.id ?? '');
    const agent = request.agent(ctx.server);
    const start = await agent.get('/auth/google').expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    expect(cookieNamed(start, 'everlearn_oauth_state')).toContain('HttpOnly');

    const callback = await agent.get(`/auth/google/callback?code=auth-code&state=${state}`).expect(302);

    expect(callback.headers.location).toBe(`${FRONTEND_URL}/auth/callback`);
    expect(callback.headers.location).not.toContain('token');
    const refreshed = await agent.post('/auth/refresh').expect(200);
    expect(refreshed.body.user.email).toBe(EMAIL);
  });

  it('turns away a Google account nobody linked, even when its email matches an account', async () => {
    const agent = request.agent(ctx.server);
    const start = await agent.get('/auth/google').expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');

    const callback = await agent.get(`/auth/google/callback?code=auth-code&state=${state}`).expect(302);

    expect(callback.headers.location).toBe(`${FRONTEND_URL}/login?error=GOOGLE_ACCOUNT_NOT_LINKED`);
    expect(ctx.users.users.size).toBe(1);
    expect(ctx.users.identities.size).toBe(0);
    await agent.post('/auth/refresh').expect(401);
  });

  it('sends a forged Google callback back to the login page without a session', async () => {
    const agent = request.agent(ctx.server);
    await agent.get('/auth/google').expect(302);

    const callback = await agent.get('/auth/google/callback?code=auth-code&state=forged').expect(302);

    expect(callback.headers.location).toBe(`${FRONTEND_URL}/login?error=INVALID_OAUTH_STATE`);
    expect(ctx.google.exchangedCodes).toHaveLength(0);
    await agent.post('/auth/refresh').expect(401);
  });
});
