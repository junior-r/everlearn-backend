export const EMAIL_PROVIDER = Symbol('EmailProvider');

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** Sends an email. An adapter rejects when it could not hand the message over. */
export interface EmailProvider {
  send(email: Email): Promise<void>;
}
