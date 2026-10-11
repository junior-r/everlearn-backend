import { NotificationType, type Notifier } from '../../../../shared/domain/notifications/notifier.js';
import type { DocumentImage } from '../../domain/document-image.js';
import type { OnboardingApplication } from '../../domain/entities/onboarding-application.entity.js';
import { ApplicationNotFoundException } from '../../domain/exceptions/onboarding.exceptions.js';
import type { DocumentStorage, OnboardingRepository } from '../../domain/ports/onboarding.ports.js';
import {
  toApplicationView,
  toReviewView,
  type ApplicationReviewView,
  type OnboardingApplicationView,
} from '../onboarding-application.view.js';

export const ReviewDecision = { APPROVE: 'APPROVE', REJECT: 'REJECT' } as const;
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];

/**
 * Loads an application only if it belongs to the acting institution. Another
 * institution's application is reported as missing, so its existence is not revealed.
 */
async function findInInstitution(
  applications: OnboardingRepository,
  applicationId: string,
  institutionId: string,
): Promise<OnboardingApplication> {
  const application = await applications.findById(applicationId);
  if (!application?.belongsTo(institutionId)) {
    throw new ApplicationNotFoundException();
  }
  return application;
}

export class ListPendingReviewsUseCase {
  constructor(private readonly applications: OnboardingRepository) {}

  async execute(institutionId: string): Promise<ApplicationReviewView[]> {
    return (await this.applications.listAwaitingReview(institutionId)).map(toReviewView);
  }
}

export interface ReviewApplicationInput {
  applicationId: string;
  institutionId: string;
  /** Null when a Platform Admin reviews without holding a membership. */
  reviewerMembershipId: string | null;
  decision: ReviewDecision;
  reason?: string;
}

export class ReviewApplicationUseCase {
  constructor(
    private readonly applications: OnboardingRepository,
    private readonly notifier: Notifier,
  ) {}

  /** Approving activates the member and welcomes them; rejecting sends them back to retake their ID photo. */
  async execute(input: ReviewApplicationInput): Promise<OnboardingApplicationView> {
    const application = await findInInstitution(
      this.applications,
      input.applicationId,
      input.institutionId,
    );
    if (input.decision === ReviewDecision.APPROVE) {
      application.approve();
    } else {
      application.reject(input.reason);
    }
    await this.applications.completeReview(application, input.reviewerMembershipId);
    if (input.decision === ReviewDecision.APPROVE) {
      await this.notifier.notify([
        {
          recipient: { userId: application.userId },
          institutionId: input.institutionId,
          type: NotificationType.WELCOME,
          data: {},
        },
      ]);
    }
    return toApplicationView(application);
  }
}

export class GetApplicationDocumentUseCase {
  constructor(
    private readonly applications: OnboardingRepository,
    private readonly storage: DocumentStorage,
  ) {}

  /** The ID photo, for a reviewer of the application's own institution only. */
  async execute(applicationId: string, institutionId: string): Promise<DocumentImage> {
    const application = await findInInstitution(this.applications, applicationId, institutionId);
    const image = application.documentKey ? await this.storage.read(application.documentKey) : null;
    if (!image) {
      throw new ApplicationNotFoundException();
    }
    return image;
  }
}
