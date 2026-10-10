import { randomUUID } from 'node:crypto';
import type { ConfirmedIdentity } from '../../src/modules/onboarding/domain/confirmed-identity.js';
import type { DocumentImage } from '../../src/modules/onboarding/domain/document-image.js';
import {
  OnboardingApplication,
  OnboardingStatus,
  type DocumentType,
  type ExtractedIdentity,
  type OnboardingApplicationProps,
} from '../../src/modules/onboarding/domain/entities/onboarding-application.entity.js';
import type {
  DocumentStorage,
  OcrProvider,
  OnboardingRepository,
} from '../../src/modules/onboarding/domain/ports/onboarding.ports.js';

// Smallest byte sequences that pass the format sniffing
export const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
export const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

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
    status: application.status,
    documentType: application.documentType,
    documentKey: application.documentKey,
    extracted: application.extracted,
  };
}

export class InMemoryOnboardingRepository implements OnboardingRepository {
  // Insertion order doubles as creation order
  readonly rows: OnboardingApplicationProps[] = [];
  readonly profiles = new Map<string, ConfirmedIdentity>();
  readonly savedStatuses: OnboardingStatus[] = [];

  seed(props: Partial<OnboardingApplicationProps> & { userId: string }): OnboardingApplication {
    const row: OnboardingApplicationProps = {
      id: randomUUID(),
      status: OnboardingStatus.PENDING_UPLOAD,
      documentType: null,
      documentKey: null,
      extracted: null,
      ...props,
    };
    this.rows.push(row);
    return new OnboardingApplication({ ...row });
  }

  findLatestByUserId(userId: string): Promise<OnboardingApplication | null> {
    const row = this.rows.findLast((candidate) => candidate.userId === userId);
    return Promise.resolve(row ? new OnboardingApplication({ ...row }) : null);
  }

  create(userId: string): Promise<OnboardingApplication> {
    return Promise.resolve(this.seed({ userId }));
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
