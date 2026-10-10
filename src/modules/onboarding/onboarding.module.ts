import { Module } from '@nestjs/common';
import { ConfirmOnboardingDataUseCase } from './application/use-cases/confirm-onboarding-data.use-case.js';
import { GetOnboardingApplicationUseCase } from './application/use-cases/get-onboarding-application.use-case.js';
import { SubmitIdentityDocumentUseCase } from './application/use-cases/submit-identity-document.use-case.js';
import {
  DOCUMENT_STORAGE,
  OCR_PROVIDER,
  ONBOARDING_REPOSITORY,
  type DocumentStorage,
  type OcrProvider,
  type OnboardingRepository,
} from './domain/ports/onboarding.ports.js';
import { MockOcrProvider } from './infrastructure/ocr/mock-ocr.provider.js';
import { PrismaOnboardingRepository } from './infrastructure/repositories/prisma-onboarding.repository.js';
import { LocalDiskDocumentStorage } from './infrastructure/storage/local-disk-document-storage.js';
import { OnboardingController } from './presentation/controllers/onboarding.controller.js';

/** Composition root of the onboarding module. Replace MockOcrProvider here to use a real OCR service. */
@Module({
  controllers: [OnboardingController],
  providers: [
    { provide: ONBOARDING_REPOSITORY, useClass: PrismaOnboardingRepository },
    { provide: DOCUMENT_STORAGE, useClass: LocalDiskDocumentStorage },
    { provide: OCR_PROVIDER, useFactory: () => new MockOcrProvider() },
    {
      provide: GetOnboardingApplicationUseCase,
      useFactory: (applications: OnboardingRepository) =>
        new GetOnboardingApplicationUseCase(applications),
      inject: [ONBOARDING_REPOSITORY],
    },
    {
      provide: SubmitIdentityDocumentUseCase,
      useFactory: (
        applications: OnboardingRepository,
        storage: DocumentStorage,
        ocr: OcrProvider,
      ) => new SubmitIdentityDocumentUseCase(applications, storage, ocr),
      inject: [ONBOARDING_REPOSITORY, DOCUMENT_STORAGE, OCR_PROVIDER],
    },
    {
      provide: ConfirmOnboardingDataUseCase,
      useFactory: (applications: OnboardingRepository) =>
        new ConfirmOnboardingDataUseCase(applications),
      inject: [ONBOARDING_REPOSITORY],
    },
  ],
})
export class OnboardingModule {}
