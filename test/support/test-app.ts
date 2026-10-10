import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG, loadAppConfig } from '../../src/config/app-config.js';
import { GOOGLE_OAUTH_GATEWAY } from '../../src/modules/identity/domain/ports/google-oauth.gateway.js';
import { REFRESH_TOKEN_REVOCATIONS } from '../../src/modules/identity/domain/ports/refresh-token-revocations.js';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/ports/user.repository.js';
import {
  DOCUMENT_STORAGE,
  OCR_PROVIDER,
  ONBOARDING_REPOSITORY,
} from '../../src/modules/onboarding/domain/ports/onboarding.ports.js';
import { RATE_LIMITER } from '../../src/shared/domain/rate-limit/rate-limiter.js';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../src/shared/infrastructure/redis/redis.tokens.js';
import {
  FakeGoogleGateway,
  InMemoryRateLimiter,
  InMemoryRefreshTokenRevocations,
  InMemoryUserRepository,
} from './identity.fakes.js';
import { createOnboardingFakes } from './onboarding.fakes.js';

export const TEST_FRONTEND_URL = 'http://frontend.test';
export const TEST_RATE_LIMIT = 5;

/**
 * Boots the real AppModule (guards, pipes, filters, controllers, use cases)
 * with every outbound adapter replaced by an in-memory fake.
 */
export async function createTestApp(extraControllers: Type[] = []) {
  const fakes = {
    users: new InMemoryUserRepository(),
    google: new FakeGoogleGateway(),
    revocations: new InMemoryRefreshTokenRevocations(),
    rateLimiter: new InMemoryRateLimiter(),
    ...createOnboardingFakes(),
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
    .overrideProvider(USER_REPOSITORY)
    .useValue(fakes.users)
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
    .compile();

  const app: INestApplication<App> = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  return { app, ...fakes };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
