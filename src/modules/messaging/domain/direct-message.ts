import type { Role } from '../../../shared/domain/auth/role.js';
import { DomainException } from '../../../shared/domain/domain.exception.js';

export const MAX_MESSAGE_LENGTH = 2000;
/** How many messages of a conversation one request returns. */
export const CONVERSATION_PAGE_SIZE = 50;
export const CONTACT_SEARCH_LIMIT = 20;
export const MIN_SEARCH_LENGTH = 2;

/** Someone a member can write to: an active member of the same institution. */
export interface Contact {
  userId: string;
  firstName: string;
  lastName: string;
  /** The roles they hold in the institution. */
  roles: Role[];
}

export interface DirectMessage {
  id: string;
  institutionId: string;
  senderId: string;
  recipientId: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface ConversationSummary {
  peer: Contact;
  lastMessage: DirectMessage;
  /** Messages from the peer the member has not opened. */
  unread: number;
}

/** Who is writing or reading, and in which institution. */
export interface MessagingActor {
  userId: string;
  institutionId: string;
}

/** What a browser reports it is showing while a conversation is open; see `Realtime.isViewing`. */
export const conversationKey = (institutionId: string, peerUserId: string) => `dm:${institutionId}:${peerUserId}`;

export class ContactNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'CONTACT_NOT_FOUND', 'That person is not a member of this institution');
  }
}

export class InvalidMessageException extends DomainException {
  constructor() {
    super('VALIDATION', 'INVALID_MESSAGE', `A message has between 1 and ${MAX_MESSAGE_LENGTH} characters`);
  }
}

export class MessagesTooFastException extends DomainException {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'MESSAGES_TOO_FAST', 'Too many messages in a short time. Try again in a moment');
  }
}
