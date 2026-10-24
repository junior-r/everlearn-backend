import { Module } from '@nestjs/common';
import { NOTIFIER, type Notifier } from '../../shared/domain/notifications/notifier.js';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  CaptureIdentityDocumentUseCase,
  ConfirmIdentityUseCase,
} from './application/use-cases/identity-check.use-cases.js';
import {
  DOCUMENT_STORAGE,
  OCR_PROVIDER,
  ONBOARDING_REPOSITORY,
  type OnboardingRepository,
} from './domain/ports/onboarding.ports.js';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { HttpOcrProvider } from './infrastructure/ocr/http-ocr.provider.js';
import { MockOcrProvider } from './infrastructure/ocr/mock-ocr.provider.js';
import { PrismaOnboardingRepository } from './infrastructure/repositories/prisma-onboarding.repository.js';
import { LocalDiskDocumentStorage } from './infrastructure/storage/local-disk-document-storage.js';
import { OnboardingController } from './presentation/controllers/onboarding.controller.js';

/** Composition root of the onboarding module. The OCR adapter is chosen here from configuration. */
@Module({
  controllers: [OnboardingController],
  providers: [
    { provide: ONBOARDING_REPOSITORY, useClass: PrismaOnboardingRepository },
    { provide: DOCUMENT_STORAGE, useClass: LocalDiskDocumentStorage },
    {
      provide: OCR_PROVIDER,
      // The real service whenever its URL is configured; the mock only for running without it
      useFactory: (config: AppConfig) =>
        config.ocr
          ? new HttpOcrProvider({ baseUrl: config.ocr.url, internalSecret: config.ocr.internalSecret })
          : new MockOcrProvider(),
      inject: [APP_CONFIG],
    },
    useCaseProvider(CaptureIdentityDocumentUseCase, [
      ONBOARDING_REPOSITORY,
      DOCUMENT_STORAGE,
      OCR_PROVIDER,
    ]),
    {
      // Built by hand because its last constructor argument (the clock) keeps its default
      provide: ConfirmIdentityUseCase,
      useFactory: (applications: OnboardingRepository, notifier: Notifier) =>
        new ConfirmIdentityUseCase(applications, notifier),
      inject: [ONBOARDING_REPOSITORY, NOTIFIER],
    },
  ],
})
export class OnboardingModule {}
