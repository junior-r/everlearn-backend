import type { OnboardingRepository } from '../../domain/ports/onboarding.ports.js';
import { toApplicationView, type OnboardingApplicationView } from '../onboarding-application.view.js';

export class GetOnboardingApplicationUseCase {
  constructor(private readonly applications: OnboardingRepository) {}

  /** Resolves to the applicant's current application, or null if they have not started. */
  async execute(userId: string): Promise<OnboardingApplicationView | null> {
    const application = await this.applications.findLatestByUserId(userId);
    return application ? toApplicationView(application) : null;
  }
}
