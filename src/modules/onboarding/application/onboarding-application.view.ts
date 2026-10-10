import type { Role } from '../../../shared/domain/auth/role.js';
import type { ConfirmedIdentity } from '../domain/confirmed-identity.js';
import type {
  DocumentType,
  OnboardingApplication,
  OnboardingStatus,
} from '../domain/entities/onboarding-application.entity.js';
import type { Applicant, ApplicationUnderReview } from '../domain/ports/onboarding.ports.js';

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
  rejectionReason: string | null;
}

/** What an Institution Admin sees: the registered account, the OCR reading and what the applicant confirmed. */
export interface ApplicationReviewView extends OnboardingApplicationView {
  requestedRole: Role | null;
  applicant: Applicant;
  confirmed: ConfirmedIdentity | null;
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
    rejectionReason: application.rejectionReason,
  };
}

export function toReviewView({
  application,
  applicant,
}: ApplicationUnderReview): ApplicationReviewView {
  return {
    ...toApplicationView(application),
    requestedRole: application.requestedRole,
    applicant,
    confirmed: application.confirmed,
  };
}
