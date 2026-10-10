import type { Role } from '../../../../shared/domain/auth/role.js';
import type { ConfirmedIdentity } from '../confirmed-identity.js';
import {
  ApplicationAlreadySubmittedException,
  ApplicationNotAwaitingReviewException,
  NothingToConfirmException,
  RejectionReasonRequiredException,
} from '../exceptions/onboarding.exceptions.js';

export const OnboardingStatus = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  PROCESSING: 'PROCESSING',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
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
  rejectionReason: string | null;
}

/**
 * One member's identity check. Moves PENDING_UPLOAD → PROCESSING →
 * PENDING_CONFIRMATION → NEEDS_REVIEW; an Institution Admin then approves or rejects it.
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
  get rejectionReason(): string | null {
    return this.props.rejectionReason;
  }

  isRejected(): boolean {
    return this.props.status === OnboardingStatus.REJECTED;
  }

  belongsTo(institutionId: string): boolean {
    return this.props.institutionId === institutionId;
  }

  /** The enrollment a replacement application should carry over after a rejection. */
  enrollment(): Enrollment | null {
    const { institutionId, requestedRole } = this.props;
    return institutionId && requestedRole ? { institutionId, requestedRole } : null;
  }

  /** Throws once the applicant has submitted; until then the photo can be retaken. */
  assertAcceptsDocument(): void {
    const editable: OnboardingStatus[] = [
      OnboardingStatus.PENDING_UPLOAD,
      OnboardingStatus.PROCESSING,
      OnboardingStatus.PENDING_CONFIRMATION,
    ];
    if (!editable.includes(this.props.status)) {
      throw new ApplicationAlreadySubmittedException();
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

  submitForReview(confirmed: ConfirmedIdentity): void {
    if (this.props.status !== OnboardingStatus.PENDING_CONFIRMATION) {
      throw this.props.status === OnboardingStatus.NEEDS_REVIEW ||
        this.props.status === OnboardingStatus.APPROVED
        ? new ApplicationAlreadySubmittedException()
        : new NothingToConfirmException();
    }
    this.props = {
      ...this.props,
      status: OnboardingStatus.NEEDS_REVIEW,
      documentType: confirmed.documentType,
      confirmed,
    };
  }

  approve(): void {
    this.assertAwaitingReview();
    this.props = { ...this.props, status: OnboardingStatus.APPROVED, rejectionReason: null };
  }

  /** The reason is shown to the applicant, so they know what to fix. */
  reject(reason: string | undefined): void {
    this.assertAwaitingReview();
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new RejectionReasonRequiredException();
    }
    this.props = { ...this.props, status: OnboardingStatus.REJECTED, rejectionReason: trimmed };
  }

  private assertAwaitingReview(): void {
    if (this.props.status !== OnboardingStatus.NEEDS_REVIEW) {
      throw new ApplicationNotAwaitingReviewException();
    }
  }
}
