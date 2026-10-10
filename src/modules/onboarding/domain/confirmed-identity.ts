import type { DocumentType } from './entities/onboarding-application.entity.js';
import { InvalidBirthDateException } from './exceptions/onboarding.exceptions.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AGE_YEARS = 120;

/** The identity data the applicant reviewed and confirmed. `birthDate` is YYYY-MM-DD. */
export interface ConfirmedIdentity {
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  documentNumber: string;
  birthDate: string;
}

/** Rejects dates that are malformed, not real calendar days, in the future or implausibly old. */
export function assertValidBirthDate(birthDate: string, today: Date): void {
  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  const isRealDate =
    ISO_DATE.test(birthDate) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === birthDate;
  const oldest = new Date(today);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - MAX_AGE_YEARS);
  // ISO calendar dates sort as strings, which keeps the time of day out of the comparison
  const day = (date: Date) => date.toISOString().slice(0, 10);
  if (!isRealDate || birthDate >= day(today) || birthDate < day(oldest)) {
    throw new InvalidBirthDateException();
  }
}
