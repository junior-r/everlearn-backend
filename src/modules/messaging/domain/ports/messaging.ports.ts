import type { Contact, ConversationSummary, DirectMessage } from '../direct-message.js';
import type { Reach } from '../messaging-reach.js';

export const MESSAGE_REPOSITORY = Symbol('MessageRepository');

export interface MessageRepository {
  /** Resolves to null unless the user is an active member of the institution. */
  findContact(institutionId: string, userId: string): Promise<Contact | null>;
  /** The active members of the institution within `reach` of `userId` whose name contains `query`. */
  searchContacts(institutionId: string, userId: string, reach: Reach, query: string, limit: number): Promise<Contact[]>;
  /** Whether `toUserId` is an active member of the institution within `reach` of `fromUserId`. */
  canReach(institutionId: string, fromUserId: string, reach: Reach, toUserId: string): Promise<boolean>;
  /** Whether `fromUserId` has ever written to `toUserId` in the institution. */
  hasWritten(institutionId: string, fromUserId: string, toUserId: string): Promise<boolean>;
  save(message: Omit<DirectMessage, 'id' | 'readAt' | 'createdAt'>): Promise<DirectMessage>;
  /** The latest messages between two members in the institution, oldest first; older ones with `before`. */
  conversation(
    institutionId: string,
    userId: string,
    peerId: string,
    limit: number,
    before: Date | null,
  ): Promise<DirectMessage[]>;
  /** Everyone the user has exchanged messages with in the institution, most recent first. */
  listConversations(institutionId: string, userId: string): Promise<ConversationSummary[]>;
  /** Marks as read what `peerId` sent to `userId` in the institution. */
  markRead(institutionId: string, userId: string, peerId: string): Promise<void>;
}
