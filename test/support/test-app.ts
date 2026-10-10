import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG, loadAppConfig } from '../../src/config/app-config.js';
import {
  PENSUM_REPOSITORY,
  SUBJECT_REPOSITORY,
} from '../../src/modules/academics/domain/ports/academic.repositories.js';
import { UserStatus } from '../../src/modules/identity/domain/entities/user.entity.js';
import { GOOGLE_OAUTH_GATEWAY } from '../../src/modules/identity/domain/ports/google-oauth.gateway.js';
import { MEMBER_REPOSITORY } from '../../src/modules/identity/domain/ports/member.repository.js';
import { PASSWORD_HASHER } from '../../src/modules/identity/domain/ports/password-hasher.js';
import { REFRESH_TOKEN_REVOCATIONS } from '../../src/modules/identity/domain/ports/refresh-token-revocations.js';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/ports/user.repository.js';
import { INSTITUTION_REPOSITORY } from '../../src/modules/institutions/domain/ports/institution.repository.js';
import {
  DOCUMENT_STORAGE,
  OCR_PROVIDER,
  ONBOARDING_REPOSITORY,
} from '../../src/modules/onboarding/domain/ports/onboarding.ports.js';
import type { Role } from '../../src/shared/domain/auth/role.js';
import { RATE_LIMITER } from '../../src/shared/domain/rate-limit/rate-limiter.js';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../src/shared/infrastructure/redis/redis.tokens.js';
import { createAdminFakes } from './admin.fakes.js';
import {
  FakeGoogleGateway,
  FakePasswordHasher,
  InMemoryMemberRepository,
  InMemoryRateLimiter,
  InMemoryRefreshTokenRevocations,
  InMemoryUserRepository,
  TEST_PASSWORD,
} from './identity.fakes.js';
import { createOnboardingFakes } from './onboarding.fakes.js';

export const TEST_FRONTEND_URL = 'http://frontend.test';
export const TEST_RATE_LIMIT = 5;

/**
 * Boots the real AppModule (guards, pipes, filters, controllers, use cases)
 * with every outbound adapter replaced by an in-memory fake.
 */
export async function createTestApp(extraControllers: Type[] = []) {
  const users = new InMemoryUserRepository();
  const members = new InMemoryMemberRepository(users);
  const onboarding = createOnboardingFakes();
  // Stand in for the joins the Prisma adapter does across module tables
  onboarding.applications.lookupEnrollment = (userId) => members.pendingEnrollment(userId);
  onboarding.applications.lookupApplicant = (userId) => {
    const user = users.users.get(userId);
    return {
      userId,
      email: user?.email ?? '',
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
    };
  };
  onboarding.applications.onApproved = (application) =>
    members.activate(application.userId, application.confirmed ?? undefined);

  const fakes = {
    users,
    members,
    google: new FakeGoogleGateway(),
    revocations: new InMemoryRefreshTokenRevocations(),
    rateLimiter: new InMemoryRateLimiter(),
    ...onboarding,
    ...createAdminFakes(),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  })
    .overrideProvider(APP_CONFIG)
    .useValue(
      loadAppConfig({
        DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        FRONTEND_URL: TEST_FRONTEND_URL,
        RATE_LIMIT_AUTH_MAX_ATTEMPTS: String(TEST_RATE_LIMIT),
      }),
    )
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(REDIS_CLIENT)
    .useValue({ disconnect: () => undefined })
    .overrideProvider(RATE_LIMITER)
    .useValue(fakes.rateLimiter)
    .overrideProvider(PASSWORD_HASHER)
    .useValue(new FakePasswordHasher())
    .overrideProvider(USER_REPOSITORY)
    .useValue(fakes.users)
    .overrideProvider(MEMBER_REPOSITORY)
    .useValue(fakes.members)
    .overrideProvider(GOOGLE_OAUTH_GATEWAY)
    .useValue(fakes.google)
    .overrideProvider(REFRESH_TOKEN_REVOCATIONS)
    .useValue(fakes.revocations)
    .overrideProvider(ONBOARDING_REPOSITORY)
    .useValue(fakes.applications)
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(fakes.storage)
    .overrideProvider(OCR_PROVIDER)
    .useValue(fakes.ocr)
    .overrideProvider(INSTITUTION_REPOSITORY)
    .useValue(fakes.institutions)
    .overrideProvider(SUBJECT_REPOSITORY)
    .useValue(fakes.subjects)
    .overrideProvider(PENSUM_REPOSITORY)
    .useValue(fakes.pensums)
    .compile();

  const app: INestApplication<App> = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  const server = app.getHttpServer();

  /** Signs in through the real endpoint and returns the access token. */
  async function tokenFor(email: string, password = TEST_PASSWORD): Promise<string> {
    const response = await request(server).post('/auth/login').send({ email, password });
    if (response.status !== 200) {
      throw new Error(`Login failed for ${email}: ${response.status}`);
    }
    return (response.body as { accessToken: string }).accessToken;
  }

  /** Seeds an active account holding `role` in the institution and signs it in. */
  async function signInAs(role: Role, institutionId: string, email = `${role}@example.com`) {
    const user = users.seed({ email: email.toLowerCase(), status: UserStatus.ACTIVE });
    const membership = { id: `membership-${user.id}`, institutionId, role };
    users.memberships.set(user.id, [membership]);
    return { user, membership, token: await tokenFor(user.email) };
  }

  async function signInAsPlatformAdmin() {
    const user = users.seed({ email: 'platform@example.com', isPlatformAdmin: true });
    return { user, token: await tokenFor(user.email) };
  }

  return { app, server, tokenFor, signInAs, signInAsPlatformAdmin, ...fakes };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
