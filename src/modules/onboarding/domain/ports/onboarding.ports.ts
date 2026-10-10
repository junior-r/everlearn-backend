import type { ConfirmedIdentity } from '../confirmed-identity.js';
import type { DocumentImage } from '../document-image.js';
import type {
  DocumentType,
  Enrollment,
  ExtractedIdentity,
  OnboardingApplication,
} from '../entities/onboarding-application.entity.js';

export const ONBOARDING_REPOSITORY = Symbol('OnboardingRepository');
export const OCR_PROVIDER = Symbol('OcrProvider');
export const DOCUMENT_STORAGE = Symbol('DocumentStorage');

/** The account as the Institution Admin registered it, to compare against the ID. */
export interface Applicant {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface ApplicationUnderReview {
  application: OnboardingApplication;
  applicant: Applicant;
}

export interface OnboardingRepository {
  findById(id: string): Promise<OnboardingApplication | null>;
  findLatestByUserId(userId: string): Promise<OnboardingApplication | null>;
  /** The institution and role a pending member was registered for; null if they are not pending anywhere. */
  findPendingEnrollment(userId: string): Promise<Enrollment | null>;
  create(userId: string, enrollment: Enrollment): Promise<OnboardingApplication>;
  save(application: OnboardingApplication): Promise<void>;
  /** Atomically saves the submitted application and writes the confirmed document data to the profile. */
  submitForReview(application: OnboardingApplication, identity: ConfirmedIdentity): Promise<void>;
  listAwaitingReview(institutionId: string): Promise<ApplicationUnderReview[]>;
  /**
   * Atomically records the review. An approval also activates the account and
   * its membership, and adopts the names the applicant confirmed from their ID.
   */
  completeReview(application: OnboardingApplication, reviewerMembershipId: string | null): Promise<void>;
}

export interface OcrProvider {
  /** Reads the identity fields from a document photo. Rejects if the document is unreadable. */
  extract(image: DocumentImage, documentType: DocumentType): Promise<ExtractedIdentity>;
}

export interface DocumentStorage {
  /** Stores the photo privately and returns an opaque key for it, never a public URL. */
  store(ownerId: string, image: DocumentImage): Promise<string>;
  /** Resolves to null when nothing is stored under the key. */
  read(key: string): Promise<DocumentImage | null>;
}
