import type { Role } from '../../../../shared/domain/auth/role.js';
import type { ConfirmedIdentity } from '../confirmed-identity.js';
import {
  IdentityAlreadyVerifiedException,
  NothingToConfirmException,
} from '../exceptions/onboarding.exceptions.js';

export const OnboardingStatus = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  PROCESSING: 'PROCESSING',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  APPROVED: 'APPROVED',
} as const;
export type OnboardingStatus = (typeof OnboardingStatus)[keyof typeof OnboardingStatus];

export const DocumentType = {
  NATIONAL_ID: 'NATIONAL_ID',
  PASSPORT: 'PASSPORT',
  OTHER: 'OTHER',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

/** What the OCR read from the document. `birthDate` is an ISO calendar date (YYYY-MM-DD). */
export interface ExtractedIdentity {
  firstName: string;
  lastName: string;
  documentNumber: string;
  birthDate: string | null;
  confidence: number;
  provider: string;
  extractedAt: Date;
}

/** The institution and role a pending member was registered for. */
export interface Enrollment {
  institutionId: string;
  requestedRole: Role;
}

export interface OnboardingApplicationProps {
  id: string;
  userId: string;
  institutionId: string | null;
  requestedRole: Role | null;
  status: OnboardingStatus;
  documentType: DocumentType | null;
  documentKey: string | null;
  extracted: ExtractedIdentity | null;
  confirmed: ConfirmedIdentity | null;
}

/**
 * One member's identity check, done in person at the institution's desk. Moves
 * PENDING_UPLOAD → PROCESSING → PENDING_CONFIRMATION → APPROVED, the last step
 * taken by whoever saw the ID and confirmed what was read from it.
 */
export class OnboardingApplication {
  constructor(private props: OnboardingApplicationProps) {}

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get institutionId(): string | null {
    return this.props.institutionId;
  }
  get requestedRole(): Role | null {
    return this.props.requestedRole;
  }
  get status(): OnboardingStatus {
    return this.props.status;
  }
  get documentType(): DocumentType | null {
    return this.props.documentType;
  }
  get documentKey(): string | null {
    return this.props.documentKey;
  }
  get extracted(): ExtractedIdentity | null {
    return this.props.extracted;
  }
  get confirmed(): ConfirmedIdentity | null {
    return this.props.confirmed;
  }

  belongsTo(institutionId: string): boolean {
    return this.props.institutionId === institutionId;
  }

  /** Throws once the ID was checked; until then the photo can be retaken. */
  assertAcceptsDocument(): void {
    if (this.props.status === OnboardingStatus.APPROVED) {
      throw new IdentityAlreadyVerifiedException();
    }
  }

  attachDocument(documentType: DocumentType, documentKey: string): void {
    this.assertAcceptsDocument();
    this.props = {
      ...this.props,
      status: OnboardingStatus.PROCESSING,
      documentType,
      documentKey,
      extracted: null,
      confirmed: null,
    };
  }

  recordExtraction(extracted: ExtractedIdentity): void {
    this.props = { ...this.props, status: OnboardingStatus.PENDING_CONFIRMATION, extracted };
  }

  /** Returns to the upload step after the OCR could not read the document. */
  failProcessing(): void {
    this.props = { ...this.props, status: OnboardingStatus.PENDING_UPLOAD, extracted: null };
  }

  /** Records the data confirmed against the ID in person; the member is then verified. */
  approve(confirmed: ConfirmedIdentity): void {
    if (this.props.status !== OnboardingStatus.PENDING_CONFIRMATION) {
      throw this.props.status === OnboardingStatus.APPROVED
        ? new IdentityAlreadyVerifiedException()
        : new NothingToConfirmException();
    }
    this.props = {
      ...this.props,
      status: OnboardingStatus.APPROVED,
      documentType: confirmed.documentType,
      confirmed,
    };
  }
}
