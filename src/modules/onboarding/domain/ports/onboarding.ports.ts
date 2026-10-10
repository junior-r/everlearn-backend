import type { ConfirmedIdentity } from '../confirmed-identity.js';
import type { DocumentImage } from '../document-image.js';
import type {
  DocumentType,
  ExtractedIdentity,
  OnboardingApplication,
} from '../entities/onboarding-application.entity.js';

export const ONBOARDING_REPOSITORY = Symbol('OnboardingRepository');
export const OCR_PROVIDER = Symbol('OcrProvider');
export const DOCUMENT_STORAGE = Symbol('DocumentStorage');

export interface OnboardingRepository {
  findLatestByUserId(userId: string): Promise<OnboardingApplication | null>;
  create(userId: string): Promise<OnboardingApplication>;
  save(application: OnboardingApplication): Promise<void>;
  /**
   * Atomically saves the submitted application and writes the confirmed
   * identity to the applicant's profile and name.
   */
  submitForReview(application: OnboardingApplication, identity: ConfirmedIdentity): Promise<void>;
}

export interface OcrProvider {
  /** Reads the identity fields from a document photo. Rejects if the document is unreadable. */
  extract(image: DocumentImage, documentType: DocumentType): Promise<ExtractedIdentity>;
}

export interface DocumentStorage {
  /** Stores the photo privately and returns an opaque key for it, never a public URL. */
  store(ownerId: string, image: DocumentImage): Promise<string>;
}
