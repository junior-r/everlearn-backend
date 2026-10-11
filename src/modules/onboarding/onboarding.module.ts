import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import { ConfirmOnboardingDataUseCase } from './application/use-cases/confirm-onboarding-data.use-case.js';
import { GetOnboardingApplicationUseCase } from './application/use-cases/get-onboarding-application.use-case.js';
import {
  GetApplicationDocumentUseCase,
  ListPendingReviewsUseCase,
  ReviewApplicationUseCase,
} from './application/use-cases/review.use-cases.js';
import { SubmitIdentityDocumentUseCase } from './application/use-cases/submit-identity-document.use-case.js';
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
    useCaseProvider(GetOnboardingApplicationUseCase, [ONBOARDING_REPOSITORY]),
    useCaseProvider(SubmitIdentityDocumentUseCase, [
      ONBOARDING_REPOSITORY,
      DOCUMENT_STORAGE,
      OCR_PROVIDER,
    ]),
    useCaseProvider(ListPendingReviewsUseCase, [ONBOARDING_REPOSITORY]),
    useCaseProvider(ReviewApplicationUseCase, [ONBOARDING_REPOSITORY]),
    useCaseProvider(GetApplicationDocumentUseCase, [ONBOARDING_REPOSITORY, DOCUMENT_STORAGE]),
    {
      // Built by hand because its last constructor argument (the clock) keeps its default
      provide: ConfirmOnboardingDataUseCase,
      useFactory: (applications: OnboardingRepository) =>
        new ConfirmOnboardingDataUseCase(applications),
      inject: [ONBOARDING_REPOSITORY],
    },
  ],
})
export class OnboardingModule {}
