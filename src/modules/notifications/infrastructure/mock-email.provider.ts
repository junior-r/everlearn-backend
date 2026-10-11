import { Logger } from '@nestjs/common';
import type { Email, EmailProvider } from '../../../shared/domain/email/email-provider.js';

/**
 * Stands in for an email service while none is configured: it writes to the
 * log who would have been emailed and about what. The body stays out of the
 * log, since it can name people and carry reset links, unless a developer
 * asks for it on their own machine.
 */
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger('MockEmailProvider');

  constructor(private readonly logBodies = false) {}

  send(email: Email): Promise<void> {
    this.logger.log(`Email to ${email.to}: ${email.subject}`);
    if (this.logBodies) {
      this.logger.log(`Body of the email to ${email.to}:\n${email.text}`);
    }
    return Promise.resolve();
  }
}
