import { NotificationType, type Notifier } from '../../../../shared/domain/notifications/notifier.js';
import type { RateLimiter } from '../../../../shared/domain/rate-limit/rate-limiter.js';
import { RealtimeEvent, type Realtime } from '../../../../shared/domain/realtime/realtime.js';
import {
  CONTACT_SEARCH_LIMIT,
  ContactNotFoundException,
  CONVERSATION_PAGE_SIZE,
  conversationKey,
  InvalidMessageException,
  MAX_MESSAGE_LENGTH,
  MessageNotAllowedException,
  MessagesTooFastException,
  MIN_SEARCH_LENGTH,
  type Contact,
  type ConversationSummary,
  type DirectMessage,
  type MessagingActor,
} from '../../domain/direct-message.js';
import { reachOf } from '../../domain/messaging-reach.js';
import type { MessageRepository } from '../../domain/ports/messaging.ports.js';

export interface MessageLimits {
  /** Messages one member may send per window. */
  maxMessages: number;
  windowSeconds: number;
}

/** The two ends of a conversation, both checked to be active members of the institution. */
async function requirePair(messages: MessageRepository, actor: MessagingActor, peerId: string) {
  // Writing to yourself, to a stranger and to a member of another institution all look the same
  if (peerId === actor.userId) {
    throw new ContactNotFoundException();
  }
  const [self, peer] = await Promise.all([
    messages.findContact(actor.institutionId, actor.userId),
    messages.findContact(actor.institutionId, peerId),
  ]);
  if (!self || !peer) {
    throw new ContactNotFoundException();
  }
  const { institutionId, userId } = actor;
  // Either the member may start this conversation, or the other person could and did: a
  // Student may answer the office that wrote to them, but may not be the one to begin
  const canWrite =
    (await messages.canReach(institutionId, userId, reachOf(self.roles), peerId)) ||
    ((await messages.canReach(institutionId, peerId, reachOf(peer.roles), userId)) &&
      (await messages.hasWritten(institutionId, peerId, userId)));
  return { self, peer, canWrite };
}

export class SearchContactsUseCase {
  constructor(private readonly messages: MessageRepository) {}

  /** The members the actor may start a conversation with, by name. A query too short finds nobody. */
  async execute(actor: MessagingActor, query: string): Promise<Contact[]> {
    const text = query.trim();
    const self = text.length >= MIN_SEARCH_LENGTH ? await this.messages.findContact(actor.institutionId, actor.userId) : null;
    if (!self) {
      return [];
    }
    return this.messages.searchContacts(
      actor.institutionId,
      actor.userId,
      reachOf(self.roles),
      text,
      CONTACT_SEARCH_LIMIT,
    );
  }
}

export class ListConversationsUseCase {
  constructor(private readonly messages: MessageRepository) {}

  /** The member's conversations in the institution, the most recent first. */
  execute(actor: MessagingActor): Promise<ConversationSummary[]> {
    return this.messages.listConversations(actor.institutionId, actor.userId);
  }
}

export interface Conversation {
  peer: Contact;
  messages: DirectMessage[];
  /** False for a conversation that can still be read but no longer continued. */
  canWrite: boolean;
}

export class OpenConversationUseCase {
  constructor(
    private readonly messages: MessageRepository,
    private readonly notifier: Notifier,
  ) {}

  /** A conversation's latest messages. Opening it reads what the peer sent, and clears the notice about it. */
  async execute(actor: MessagingActor, peerId: string, before: Date | null = null): Promise<Conversation> {
    const { peer, canWrite } = await requirePair(this.messages, actor, peerId);
    const messages = await this.messages.conversation(
      actor.institutionId,
      actor.userId,
      peerId,
      CONVERSATION_PAGE_SIZE,
      before,
    );
    // Someone out of reach, with nothing ever said between them, is not to be found at all
    if (!canWrite && messages.length === 0) {
      throw new ContactNotFoundException();
    }
    await this.messages.markRead(actor.institutionId, actor.userId, peerId);
    await this.notifier.dismiss(actor.userId, conversationKey(actor.institutionId, peerId));
    return { peer, messages, canWrite };
  }
}

export class SendDirectMessageUseCase {
  constructor(
    private readonly messages: MessageRepository,
    private readonly realtime: Realtime,
    private readonly notifier: Notifier,
    private readonly limiter: RateLimiter,
    private readonly limits: MessageLimits,
  ) {}

  /**
   * Sends a message to a member of the same institution the sender is allowed
   * to write to (see `reachOf`). It reaches the
   * browsers both have open at once; a recipient who is not looking at the
   * conversation gets a notice, and an email too if they are not connected at all.
   */
  async execute(actor: MessagingActor, recipientId: string, text: string): Promise<DirectMessage> {
    const body = text.trim();
    if (!body || body.length > MAX_MESSAGE_LENGTH) {
      throw new InvalidMessageException();
    }
    const { self, canWrite } = await requirePair(this.messages, actor, recipientId);
    if (!canWrite) {
      const { institutionId, userId } = actor;
      const [earlier] = await this.messages.conversation(institutionId, userId, recipientId, 1, null);
      // They know each other if they have talked before; otherwise the person does not exist for them
      throw earlier ? new MessageNotAllowedException() : new ContactNotFoundException();
    }
    await this.countMessage(actor);
    const message = await this.messages.save({
      institutionId: actor.institutionId,
      senderId: actor.userId,
      recipientId,
      body,
    });
    this.realtime.publish(recipientId, RealtimeEvent.MESSAGE, message);
    // The sender's other tabs and devices show it too
    this.realtime.publish(actor.userId, RealtimeEvent.MESSAGE, message);
    if (!(await this.realtime.isViewing(recipientId, conversationKey(actor.institutionId, actor.userId)))) {
      await this.notifier.notify([
        {
          recipient: { userId: recipientId },
          institutionId: actor.institutionId,
          type: NotificationType.DIRECT_MESSAGE,
          data: { senderId: actor.userId, senderName: `${self.firstName} ${self.lastName}` },
          // One unread notice per sender, however many messages they write
          collapseKey: conversationKey(actor.institutionId, actor.userId),
          email: !(await this.realtime.isOnline(recipientId)),
        },
      ]);
    }
    return message;
  }

  private async countMessage(actor: MessagingActor): Promise<void> {
    const { maxMessages, windowSeconds } = this.limits;
    const decision = await this.limiter
      .consume(`direct-messages:user:${actor.userId}`, maxMessages, windowSeconds)
      // Fail open: without Redis, messages keep flowing
      .catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
    if (!decision.allowed) {
      throw new MessagesTooFastException(decision.retryAfterSeconds);
    }
  }
}
