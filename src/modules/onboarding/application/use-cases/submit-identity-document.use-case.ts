import { DomainException } from '../../../../shared/domain/domain.exception.js';
import { inspectDocumentImage } from '../../domain/document-image.js';
import type {
  DocumentType,
  OnboardingApplication,
} from '../../domain/entities/onboarding-application.entity.js';
import {
  OcrProcessingFailedException,
  OnboardingNotAvailableException,
} from '../../domain/exceptions/onboarding.exceptions.js';
import type {
  DocumentStorage,
  OcrProvider,
  OnboardingRepository,
} from '../../domain/ports/onboarding.ports.js';
import { toApplicationView, type OnboardingApplicationView } from '../onboarding-application.view.js';

export interface SubmitIdentityDocumentInput {
  userId: string;
  documentType: DocumentType;
  content: Uint8Array | undefined;
}

export class SubmitIdentityDocumentUseCase {
  constructor(
    private readonly applications: OnboardingRepository,
    private readonly storage: DocumentStorage,
    private readonly ocr: OcrProvider,
  ) {}

  /** Stores the ID photo, runs OCR on it and returns the data for the applicant to confirm. */
  async execute(input: SubmitIdentityDocumentInput): Promise<OnboardingApplicationView> {
    const image = inspectDocumentImage(input.content);
    const application = await this.currentOrNew(input.userId);
    // Checked before storing, so a rejected upload leaves no file behind
    application.assertAcceptsDocument();

    const documentKey = await this.storage.store(input.userId, image);
    application.attachDocument(input.documentType, documentKey);
    await this.applications.save(application);

    try {
      application.recordExtraction(await this.ocr.extract(image, input.documentType));
    } catch (error) {
      application.failProcessing();
      await this.applications.save(application);
      throw error instanceof DomainException ? error : new OcrProcessingFailedException();
    }
    await this.applications.save(application);
    return toApplicationView(application);
  }

  /**
   * Only people an institution registered can onboard. A rejected application
   * stays closed as history; the retry is a new one for the same enrollment.
   */
  private async currentOrNew(userId: string): Promise<OnboardingApplication> {
    const latest = await this.applications.findLatestByUserId(userId);
    if (latest && !latest.isRejected()) {
      return latest;
    }
    const enrollment =
      latest?.enrollment() ?? (await this.applications.findPendingEnrollment(userId));
    if (!enrollment) {
      throw new OnboardingNotAvailableException();
    }
    return this.applications.create(userId, enrollment);
  }
}
