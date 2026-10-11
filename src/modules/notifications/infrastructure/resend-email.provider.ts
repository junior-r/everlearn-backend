import { Resend } from 'resend';
import type { Email, EmailProvider } from '../../../shared/domain/email/email-provider.js';

/** What Resend is asked to send: our email, plus who it comes from. */
export interface ResendMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** The one call of the SDK this adapter needs, so a test can stand in for the network. */
export type ResendSend = (
  message: ResendMessage,
) => Promise<{ data: { id: string } | null; error: { name: string; message: string } | null }>;

/** Builds the call from the SDK's client. */
export function resendSend(apiKey: string): ResendSend {
  const client = new Resend(apiKey);
  return (message) => client.emails.send(message);
}

/**
 * Resend as an `EmailProvider`. The SDK reports a refusal in its answer instead
 * of throwing, so it is turned into a rejection here: callers decide what a
 * failed email means, and they can only do that if they hear about it.
 */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly sendWithResend: ResendSend,
    /** The sender, on a domain verified with Resend: `Everlearn <no-reply@example.com>`. */
    private readonly from: string,
  ) {}

  async send(email: Email): Promise<void> {
    const { error } = await this.sendWithResend({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
    if (error) {
      // The name says what kind of refusal it was; the message may quote the address
      throw new Error(`Resend refused the email (${error.name})`);
    }
  }
}
