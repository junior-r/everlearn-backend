import type { Role } from '../../../../shared/domain/auth/role.js';
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

/** A member of the acting institution, as the desk needs them to check their ID. */
export interface Applicant {
  userId: string;
  membershipId: string;
  role: Role;
  /** True once the person's ID was checked, in this institution or another. */
  isVerified: boolean;
}

export interface OnboardingRepository {
  /** Null when the membership does not exist or belongs to another institution. */
  findApplicant(membershipId: string, institutionId: string): Promise<Applicant | null>;
  /** The person's latest identity check in the institution that is not finished yet. */
  findOpen(userId: string, institutionId: string): Promise<OnboardingApplication | null>;
  create(userId: string, enrollment: Enrollment): Promise<OnboardingApplication>;
  save(application: OnboardingApplication): Promise<void>;
  /**
   * Atomically records the approved check and who made it, writes the confirmed
   * document data to the profile and the names to the account, and activates the
   * account with every membership it was registered for.
   */
  completeCheck(
    application: OnboardingApplication,
    identity: ConfirmedIdentity,
    verifierMembershipId: string | null,
  ): Promise<void>;
}

export interface OcrProvider {
  /** Reads the identity fields from a document photo. Rejects if the document is unreadable. */
  extract(image: DocumentImage, documentType: DocumentType): Promise<ExtractedIdentity>;
}

export interface DocumentStorage {
  /** Stores the photo privately and returns an opaque key for it, never a public URL. */
  store(ownerId: string, image: DocumentImage): Promise<string>;
}
