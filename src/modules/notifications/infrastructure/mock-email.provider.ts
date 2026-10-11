import { Logger } from '@nestjs/common';
import type { Email } from '../domain/notification.js';
import type { EmailProvider } from '../domain/ports/notification.ports.js';

/**
 * Stands in for an email service while none is configured: it writes to the
 * log who would have been emailed and about what. The body stays out of the
 * log, since it can name people and grades.
 */
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger('MockEmailProvider');

  send(email: Email): Promise<void> {
    this.logger.log(`Email to ${email.to}: ${email.subject}`);
    return Promise.resolve();
  }
}
