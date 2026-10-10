import { randomUUID } from 'node:crypto';
import type { ConfirmedIdentity } from '../../src/modules/onboarding/domain/confirmed-identity.js';
import type { DocumentImage } from '../../src/modules/onboarding/domain/document-image.js';
import {
  OnboardingApplication,
  OnboardingStatus,
  type DocumentType,
  type Enrollment,
  type ExtractedIdentity,
  type OnboardingApplicationProps,
} from '../../src/modules/onboarding/domain/entities/onboarding-application.entity.js';
import type {
  Applicant,
  ApplicationUnderReview,
  DocumentStorage,
  OcrProvider,
  OnboardingRepository,
} from '../../src/modules/onboarding/domain/ports/onboarding.ports.js';
import { Role } from '../../src/shared/domain/auth/role.js';

// Smallest byte sequences that pass the format sniffing
export const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
export const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

export const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_INSTITUTION_ID = '22222222-2222-4222-8222-222222222222';
export const STUDENT_ENROLLMENT: Enrollment = {
  institutionId: INSTITUTION_ID,
  requestedRole: Role.STUDENT,
};

export const SAMPLE_EXTRACTION: ExtractedIdentity = {
  firstName: 'María Fernanda',
  lastName: 'González Pérez',
  documentNumber: '12345678',
  birthDate: '2008-03-14',
  confidence: 0.93,
  provider: 'fake',
  extractedAt: new Date('2026-10-10T12:00:00.000Z'),
};

function snapshot(application: OnboardingApplication): OnboardingApplicationProps {
  return {
    id: application.id,
    userId: application.userId,
    institutionId: application.institutionId,
    requestedRole: application.requestedRole,
    status: application.status,
    documentType: application.documentType,
    documentKey: application.documentKey,
    extracted: application.extracted,
    confirmed: application.confirmed,
    rejectionReason: application.rejectionReason,
  };
}

export interface RecordedReview {
  applicationId: string;
  status: OnboardingStatus;
  reviewerMembershipId: string | null;
}

export class InMemoryOnboardingRepository implements OnboardingRepository {
  // Insertion order doubles as creation order
  readonly rows: OnboardingApplicationProps[] = [];
  readonly profiles = new Map<string, ConfirmedIdentity>();
  readonly savedStatuses: OnboardingStatus[] = [];
  readonly reviews: RecordedReview[] = [];
  readonly enrollments = new Map<string, Enrollment>();
  /** Hooks that let another module's fake stand in for the tables this repository reads or writes. */
  lookupEnrollment: (userId: string) => Enrollment | null = (userId) =>
    this.enrollments.get(userId) ?? null;
  lookupApplicant: (userId: string) => Applicant = (userId) => ({
    userId,
    email: `${userId}@example.com`,
    firstName: 'Registered',
    lastName: 'Name',
  });
  onApproved: (application: OnboardingApplication) => void = () => undefined;

  seed(props: Partial<OnboardingApplicationProps> & { userId: string }): OnboardingApplication {
    const row: OnboardingApplicationProps = {
      id: randomUUID(),
      institutionId: INSTITUTION_ID,
      requestedRole: Role.STUDENT,
      status: OnboardingStatus.PENDING_UPLOAD,
      documentType: null,
      documentKey: null,
      extracted: null,
      confirmed: null,
      rejectionReason: null,
      ...props,
    };
    this.rows.push(row);
    return new OnboardingApplication({ ...row });
  }

  findById(id: string): Promise<OnboardingApplication | null> {
    const row = this.rows.find((candidate) => candidate.id === id);
    return Promise.resolve(row ? new OnboardingApplication({ ...row }) : null);
  }

  findLatestByUserId(userId: string): Promise<OnboardingApplication | null> {
    const row = this.rows.findLast((candidate) => candidate.userId === userId);
    return Promise.resolve(row ? new OnboardingApplication({ ...row }) : null);
  }

  findPendingEnrollment(userId: string): Promise<Enrollment | null> {
    return Promise.resolve(this.lookupEnrollment(userId));
  }

  create(userId: string, enrollment: Enrollment): Promise<OnboardingApplication> {
    return Promise.resolve(this.seed({ userId, ...enrollment }));
  }

  save(application: OnboardingApplication): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === application.id);
    this.rows[index] = snapshot(application);
    this.savedStatuses.push(application.status);
    return Promise.resolve();
  }

  async submitForReview(
    application: OnboardingApplication,
    identity: ConfirmedIdentity,
  ): Promise<void> {
    await this.save(application);
    this.profiles.set(application.userId, identity);
  }

  listAwaitingReview(institutionId: string): Promise<ApplicationUnderReview[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.institutionId === institutionId && row.status === OnboardingStatus.NEEDS_REVIEW,
        )
        .map((row) => ({
          application: new OnboardingApplication({ ...row }),
          applicant: this.lookupApplicant(row.userId),
        })),
    );
  }

  async completeReview(
    application: OnboardingApplication,
    reviewerMembershipId: string | null,
  ): Promise<void> {
    await this.save(application);
    this.reviews.push({
      applicationId: application.id,
      status: application.status,
      reviewerMembershipId,
    });
    if (application.status === OnboardingStatus.APPROVED) {
      this.onApproved(application);
    }
  }
}

export class InMemoryDocumentStorage implements DocumentStorage {
  readonly stored: Array<{ ownerId: string; image: DocumentImage; key: string }> = [];

  store(ownerId: string, image: DocumentImage): Promise<string> {
    const key = `onboarding/${ownerId}/${this.stored.length + 1}.${image.format}`;
    this.stored.push({ ownerId, image, key });
    return Promise.resolve(key);
  }

  read(key: string): Promise<DocumentImage | null> {
    return Promise.resolve(this.stored.find((entry) => entry.key === key)?.image ?? null);
  }
}

export class FakeOcrProvider implements OcrProvider {
  failWith: Error | null = null;
  readonly calls: Array<{ image: DocumentImage; documentType: DocumentType }> = [];

  extract(image: DocumentImage, documentType: DocumentType): Promise<ExtractedIdentity> {
    this.calls.push({ image, documentType });
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(SAMPLE_EXTRACTION);
  }
}

export function createOnboardingFakes() {
  return {
    applications: new InMemoryOnboardingRepository(),
    storage: new InMemoryDocumentStorage(),
    ocr: new FakeOcrProvider(),
  };
}
