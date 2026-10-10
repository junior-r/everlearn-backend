import type {
  DocumentType,
  OnboardingApplication,
  OnboardingStatus,
} from '../domain/entities/onboarding-application.entity.js';

export interface ExtractedIdentityView {
  firstName: string;
  lastName: string;
  documentNumber: string;
  birthDate: string | null;
  confidence: number;
}

export interface OnboardingApplicationView {
  id: string;
  status: OnboardingStatus;
  documentType: DocumentType | null;
  extracted: ExtractedIdentityView | null;
}

/** What the applicant may see of their application; storage keys and provider names stay internal. */
export function toApplicationView(application: OnboardingApplication): OnboardingApplicationView {
  const extracted = application.extracted;
  return {
    id: application.id,
    status: application.status,
    documentType: application.documentType,
    extracted: extracted && {
      firstName: extracted.firstName,
      lastName: extracted.lastName,
      documentNumber: extracted.documentNumber,
      birthDate: extracted.birthDate,
      confidence: extracted.confidence,
    },
  };
}
