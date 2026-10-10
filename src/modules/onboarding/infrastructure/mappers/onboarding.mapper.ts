import {
  Prisma,
  type OnboardingApplication as ApplicationRow,
} from '../../../../shared/infrastructure/prisma/generated/client.js';
import {
  OnboardingApplication,
  type ExtractedIdentity,
} from '../../domain/entities/onboarding-application.entity.js';

// The typed columns hold what staff query on; the split name only exists in the JSON payload
function nameParts(data: Prisma.JsonValue | null): { firstName: string; lastName: string } {
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return { firstName: text(record.firstName), lastName: text(record.lastName) };
}

function toExtracted(row: ApplicationRow): ExtractedIdentity | null {
  if (row.processedAt === null) {
    return null;
  }
  return {
    ...nameParts(row.extractedData),
    documentNumber: row.extractedDocumentNumber ?? '',
    birthDate: row.extractedBirthDate?.toISOString().slice(0, 10) ?? null,
    confidence: row.ocrConfidence ?? 0,
    provider: row.ocrProvider ?? 'unknown',
    extractedAt: row.processedAt,
  };
}

export function toDomainApplication(row: ApplicationRow): OnboardingApplication {
  return new OnboardingApplication({
    id: row.id,
    userId: row.userId,
    status: row.status,
    documentType: row.documentType,
    documentKey: row.idFrontUrl,
    extracted: toExtracted(row),
  });
}

export function toPersistence(
  application: OnboardingApplication,
): Prisma.OnboardingApplicationUncheckedUpdateInput {
  const extracted = application.extracted;
  return {
    status: application.status,
    documentType: application.documentType,
    idFrontUrl: application.documentKey,
    extractedFullName: extracted ? `${extracted.firstName} ${extracted.lastName}`.trim() : null,
    extractedDocumentNumber: extracted?.documentNumber ?? null,
    extractedBirthDate: extracted?.birthDate
      ? new Date(`${extracted.birthDate}T00:00:00.000Z`)
      : null,
    extractedData: extracted
      ? { firstName: extracted.firstName, lastName: extracted.lastName }
      : Prisma.DbNull,
    ocrConfidence: extracted?.confidence ?? null,
    ocrProvider: extracted?.provider ?? null,
    processedAt: extracted?.extractedAt ?? null,
  };
}
