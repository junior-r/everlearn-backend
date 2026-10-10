import { assertValidBirthDate, type ConfirmedIdentity } from '../../domain/confirmed-identity.js';
import { NothingToConfirmException } from '../../domain/exceptions/onboarding.exceptions.js';
import type { OnboardingRepository } from '../../domain/ports/onboarding.ports.js';
import { toApplicationView, type OnboardingApplicationView } from '../onboarding-application.view.js';

export interface ConfirmOnboardingDataInput extends ConfirmedIdentity {
  userId: string;
}

export class ConfirmOnboardingDataUseCase {
  constructor(
    private readonly applications: OnboardingRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Saves the identity the applicant confirmed to their profile and sends the application to review. */
  async execute(input: ConfirmOnboardingDataInput): Promise<OnboardingApplicationView> {
    const application = await this.applications.findLatestByUserId(input.userId);
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
    application.submitForReview(identity.documentType);
    await this.applications.submitForReview(application, identity);
    return toApplicationView(application);
  }
}
