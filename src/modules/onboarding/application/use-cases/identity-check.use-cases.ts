import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { canRegister } from '../../../../shared/domain/auth/registration.js';
import { DomainException } from '../../../../shared/domain/domain.exception.js';
import { NotificationType, type Notifier } from '../../../../shared/domain/notifications/notifier.js';
import { assertValidBirthDate, type ConfirmedIdentity } from '../../domain/confirmed-identity.js';
import { inspectDocumentImage } from '../../domain/document-image.js';
import type {
  DocumentType,
  OnboardingApplication,
} from '../../domain/entities/onboarding-application.entity.js';
import {
  ApplicantNotFoundException,
  IdentityAlreadyVerifiedException,
  IdentityCheckNotAllowedException,
  NothingToConfirmException,
  OcrProcessingFailedException,
} from '../../domain/exceptions/onboarding.exceptions.js';
import type {
  Applicant,
  DocumentStorage,
  OcrProvider,
  OnboardingRepository,
} from '../../domain/ports/onboarding.ports.js';
import { toApplicationView, type OnboardingApplicationView } from '../onboarding-application.view.js';

/** Who is at the desk, for which institution, checking whose ID. */
export interface DeskContext {
  actor: AuthenticatedUser;
  institutionId: string;
  membershipId: string;
}

/**
 * The member whose ID is being checked. Whoever may register a role may check
 * its ID, and a person is checked only once, whichever institution does it.
 */
async function findApplicant(applications: OnboardingRepository, desk: DeskContext): Promise<Applicant> {
  const applicant = await applications.findApplicant(desk.membershipId, desk.institutionId);
  if (!applicant) {
    throw new ApplicantNotFoundException();
  }
  if (!canRegister(desk.actor, desk.institutionId, applicant.role)) {
    throw new IdentityCheckNotAllowedException();
  }
  if (applicant.isVerified) {
    throw new IdentityAlreadyVerifiedException();
  }
  return applicant;
}

export interface CaptureIdentityDocumentInput extends DeskContext {
  documentType: DocumentType;
  content: Uint8Array | undefined;
}

export class CaptureIdentityDocumentUseCase {
  constructor(
    private readonly applications: OnboardingRepository,
    private readonly storage: DocumentStorage,
    private readonly ocr: OcrProvider,
  ) {}

  /** Stores the photo of the member's ID, taken at the desk, and returns what the OCR read from it. */
  async execute(input: CaptureIdentityDocumentInput): Promise<OnboardingApplicationView> {
    const image = inspectDocumentImage(input.content);
    const applicant = await findApplicant(this.applications, input);
    const application = await this.openCheck(applicant, input.institutionId);

    const documentKey = await this.storage.store(applicant.userId, image);
    application.attachDocument(input.documentType, documentKey);
    await this.applications.save(application);

    try {
      application.recordExtraction(await this.ocr.extract(image, input.documentType));
    } catch (error) {
      application.failProcessing();
      await this.applications.save(application);
      throw error instanceof DomainException ? error : new OcrProcessingFailedException();
    }
    await this.applications.save(application);
    return toApplicationView(application);
  }

  private async openCheck(applicant: Applicant, institutionId: string): Promise<OnboardingApplication> {
    return (
      (await this.applications.findOpen(applicant.userId, institutionId)) ??
      this.applications.create(applicant.userId, { institutionId, requestedRole: applicant.role })
    );
  }
}

export interface ConfirmIdentityInput extends DeskContext, ConfirmedIdentity {
  /** The desk's own membership; null for a Platform Admin acting without one. */
  verifierMembershipId: string | null;
}

export class ConfirmIdentityUseCase {
  constructor(
    private readonly applications: OnboardingRepository,
    private readonly notifier: Notifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Saves the data checked against the ID in person, corrected where the OCR
   * misread it, and activates the member at once. There is no later review:
   * the person at the desk saw the document.
   */
  async execute(input: ConfirmIdentityInput): Promise<OnboardingApplicationView> {
    const applicant = await findApplicant(this.applications, input);
    const application = await this.applications.findOpen(applicant.userId, input.institutionId);
    if (!application) {
      throw new NothingToConfirmException();
    }
    assertValidBirthDate(input.birthDate, this.now());
    const identity: ConfirmedIdentity = {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      documentType: input.documentType,
      documentNumber: input.documentNumber.trim(),
      birthDate: input.birthDate,
    };
    application.approve(identity);
    await this.applications.completeCheck(application, identity, input.verifierMembershipId);
    await this.notifier.notify([
      {
        recipient: { userId: applicant.userId },
        institutionId: input.institutionId,
        type: NotificationType.WELCOME,
        data: {},
      },
    ]);
    return toApplicationView(application);
  }
}
