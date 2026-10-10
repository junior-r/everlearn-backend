import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadAppConfig } from '../src/config/app-config.js';
import { GOOGLE_OAUTH_GATEWAY } from '../src/modules/identity/domain/ports/google-oauth.gateway.js';
import { USER_REPOSITORY } from '../src/modules/identity/domain/ports/user.repository.js';
import type { MembershipClaim } from '../src/shared/domain/auth/authenticated-user.js';
import { Role } from '../src/shared/domain/auth/role.js';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service.js';
import {
  CurrentMembership,
  Roles,
} from '../src/shared/presentation/decorators/auth.decorators.js';
import { FakeGoogleGateway, InMemoryUserRepository } from './support/identity.fakes.js';

const FRONTEND_URL = 'http://frontend.test';

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

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    google = new FakeGoogleGateway();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadAppConfig({
          DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
          JWT_ACCESS_SECRET: 'a'.repeat(32),
          JWT_REFRESH_SECRET: 'b'.repeat(32),
          FRONTEND_URL,
        }),
      )
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(USER_REPOSITORY)
      .useValue(users)
      .overrideProvider(GOOGLE_OAUTH_GATEWAY)
      .useValue(google)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
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
