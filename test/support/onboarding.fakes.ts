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
  };
}

export interface RecordedCheck {
  applicationId: string;
  verifierMembershipId: string | null;
}

export class InMemoryOnboardingRepository implements OnboardingRepository {
  // Insertion order doubles as creation order
  readonly rows: OnboardingApplicationProps[] = [];
  readonly profiles = new Map<string, ConfirmedIdentity>();
  readonly savedStatuses: OnboardingStatus[] = [];
  readonly checks: RecordedCheck[] = [];
  /** Membership id → the member and the institution they belong to. */
  readonly applicants = new Map<string, Applicant & { institutionId: string }>();
  /** Hooks that let another module's fake stand in for the tables this repository reads or writes. */
  lookupApplicant: (membershipId: string, institutionId: string) => Applicant | null = (
    membershipId,
    institutionId,
  ) => {
    const applicant = this.applicants.get(membershipId);
    return applicant?.institutionId === institutionId ? applicant : null;
  };
  onVerified: (application: OnboardingApplication, identity: ConfirmedIdentity) => void = () => undefined;

  /** A pending member of the institution, whose ID the desk can check. */
  addApplicant(applicant: Partial<Applicant> & { institutionId?: string } = {}): Applicant {
    const stored = {
      userId: randomUUID(),
      membershipId: randomUUID(),
      role: Role.STUDENT,
      isVerified: false,
      institutionId: INSTITUTION_ID,
      ...applicant,
    };
    this.applicants.set(stored.membershipId, stored);
    return stored;
  }

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
      ...props,
    };
    this.rows.push(row);
    return new OnboardingApplication({ ...row });
  }

  findApplicant(membershipId: string, institutionId: string): Promise<Applicant | null> {
    return Promise.resolve(this.lookupApplicant(membershipId, institutionId));
  }

  findOpen(userId: string, institutionId: string): Promise<OnboardingApplication | null> {
    const row = this.rows.findLast(
      (candidate) =>
        candidate.userId === userId &&
        candidate.institutionId === institutionId &&
        candidate.status !== OnboardingStatus.APPROVED,
    );
    return Promise.resolve(row ? new OnboardingApplication({ ...row }) : null);
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

  async completeCheck(
    application: OnboardingApplication,
    identity: ConfirmedIdentity,
    verifierMembershipId: string | null,
  ): Promise<void> {
    await this.save(application);
    this.profiles.set(application.userId, identity);
    this.checks.push({ applicationId: application.id, verifierMembershipId });
    this.onVerified(application, identity);
  }
}

export class InMemoryDocumentStorage implements DocumentStorage {
  readonly stored: Array<{ ownerId: string; image: DocumentImage; key: string }> = [];

  store(ownerId: string, image: DocumentImage): Promise<string> {
    const key = `onboarding/${ownerId}/${this.stored.length + 1}.${image.format}`;
    this.stored.push({ ownerId, image, key });
    return Promise.resolve(key);
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
