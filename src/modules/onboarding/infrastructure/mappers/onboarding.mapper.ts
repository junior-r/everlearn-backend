import {
  Prisma,
  type OnboardingApplication as ApplicationRow,
} from '../../../../shared/infrastructure/prisma/generated/client.js';
import type { ConfirmedIdentity } from '../../domain/confirmed-identity.js';
import {
  DocumentType,
  OnboardingApplication,
  type ExtractedIdentity,
} from '../../domain/entities/onboarding-application.entity.js';

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');

function toExtracted(row: ApplicationRow): ExtractedIdentity | null {
  if (row.processedAt === null) {
    return null;
  }
  // The typed columns hold what staff query on; the split name only exists in the JSON payload
  const data = asRecord(row.extractedData);
  return {
    firstName: text(data.firstName),
    lastName: text(data.lastName),
    documentNumber: row.extractedDocumentNumber ?? '',
    birthDate: row.extractedBirthDate?.toISOString().slice(0, 10) ?? null,
    confidence: row.ocrConfidence ?? 0,
    provider: row.ocrProvider ?? 'unknown',
    extractedAt: row.processedAt,
  };
}

function toConfirmed(row: ApplicationRow): ConfirmedIdentity | null {
  const confirmed = asRecord(asRecord(row.extractedData).confirmed);
  const documentType = Object.values(DocumentType).find((type) => type === confirmed.documentType);
  if (!documentType) {
    return null;
  }
  return {
    firstName: text(confirmed.firstName),
    lastName: text(confirmed.lastName),
    documentType,
    documentNumber: text(confirmed.documentNumber),
    birthDate: text(confirmed.birthDate),
  };
}

export function toDomainApplication(row: ApplicationRow): OnboardingApplication {
  return new OnboardingApplication({
    id: row.id,
    userId: row.userId,
    institutionId: row.institutionId,
    requestedRole: row.requestedRole,
    status: row.status,
    documentType: row.documentType,
    documentKey: row.idFrontUrl,
    extracted: toExtracted(row),
    confirmed: toConfirmed(row),
    rejectionReason: row.rejectionReason,
  });
}

export function toPersistence(
  application: OnboardingApplication,
): Prisma.OnboardingApplicationUncheckedUpdateInput {
  const { extracted, confirmed } = application;
  return {
    status: application.status,
    documentType: application.documentType,
    idFrontUrl: application.documentKey,
    rejectionReason: application.rejectionReason,
    extractedFullName: extracted ? `${extracted.firstName} ${extracted.lastName}`.trim() : null,
    extractedDocumentNumber: extracted?.documentNumber ?? null,
    extractedBirthDate: extracted?.birthDate
      ? new Date(`${extracted.birthDate}T00:00:00.000Z`)
      : null,
    extractedData: extracted
      ? {
          firstName: extracted.firstName,
          lastName: extracted.lastName,
          ...(confirmed ? { confirmed: { ...confirmed } } : {}),
        }
      : Prisma.DbNull,
    ocrConfidence: extracted?.confidence ?? null,
    ocrProvider: extracted?.provider ?? null,
    processedAt: extracted?.extractedAt ?? null,
  };
}
