import type { Contact, ConversationSummary, DirectMessage } from '../direct-message.js';

export const MESSAGE_REPOSITORY = Symbol('MessageRepository');

export interface MessageRepository {
  /** Resolves to null unless the user is an active member of the institution. */
  findContact(institutionId: string, userId: string): Promise<Contact | null>;
  /** Active members of the institution whose name contains `query`, other than `exceptUserId`. */
  searchContacts(institutionId: string, exceptUserId: string, query: string, limit: number): Promise<Contact[]>;
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
