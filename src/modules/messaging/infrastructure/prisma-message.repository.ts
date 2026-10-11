import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import { PrismaErrorCode, runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import {
  ContactNotFoundException,
  type Contact,
  type ConversationSummary,
  type DirectMessage,
} from '../domain/direct-message.js';
import type { MessageRepository } from '../domain/ports/messaging.ports.js';

/** How far back the list of conversations looks; older ones reappear when someone writes again. */
const RECENT_MESSAGES = 500;

const memberSelect = {
  role: true,
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.MembershipSelect;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

/** One contact per person, with every role they hold. */
function toContacts(rows: MemberRow[]): Contact[] {
  const contacts = new Map<string, Contact>();
  for (const { role, user } of rows) {
    const contact = contacts.get(user.id) ?? {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: [],
    };
    contact.roles.push(role);
    contacts.set(user.id, contact);
  }
  return [...contacts.values()];
}

const activeMemberOf = (institutionId: string): Prisma.MembershipWhereInput => ({
  institutionId,
  isActive: true,
  user: { status: 'ACTIVE' },
});

@Injectable()
export class PrismaMessageRepository implements MessageRepository {
  private readonly logger = new Logger(PrismaMessageRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findContact(institutionId: string, userId: string): Promise<Contact | null> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.membership.findMany({
        where: { ...activeMemberOf(institutionId), userId },
        select: memberSelect,
      });
      return toContacts(rows)[0] ?? null;
    });
  }

  searchContacts(institutionId: string, exceptUserId: string, query: string, limit: number): Promise<Contact[]> {
    const words = query.split(/\s+/).filter(Boolean);
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.membership.findMany({
        where: {
          institutionId,
          isActive: true,
          userId: { not: exceptUserId },
          user: {
            status: 'ACTIVE',
            // Every word must appear in the first or the last name, so "ada love" finds Ada Lovelace
            AND: words.map((word) => ({
              OR: [
                { firstName: { contains: word, mode: 'insensitive' as const } },
                { lastName: { contains: word, mode: 'insensitive' as const } },
              ],
            })),
          },
        },
        select: memberSelect,
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        // A person may hold several roles; fetch a few rows more than people wanted
        take: limit * 3,
      });
      return toContacts(rows).slice(0, limit);
    });
  }

  save(message: Omit<DirectMessage, 'id' | 'readAt' | 'createdAt'>): Promise<DirectMessage> {
    return runQuery(this.logger, () => this.prisma.directMessage.create({ data: message }), {
      // An account deleted between the check and the write
      [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new ContactNotFoundException(),
    });
  }

  conversation(
    institutionId: string,
    userId: string,
    peerId: string,
    limit: number,
    before: Date | null,
  ): Promise<DirectMessage[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.directMessage.findMany({
        where: {
          institutionId,
          OR: [
            { senderId: userId, recipientId: peerId },
            { senderId: peerId, recipientId: userId },
          ],
          ...(before && { createdAt: { lt: before } }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.reverse();
    });
  }

  listConversations(institutionId: string, userId: string): Promise<ConversationSummary[]> {
    return runQuery(this.logger, async () => {
      const [recent, unread] = await Promise.all([
        this.prisma.directMessage.findMany({
          where: { institutionId, OR: [{ senderId: userId }, { recipientId: userId }] },
          orderBy: { createdAt: 'desc' },
          take: RECENT_MESSAGES,
        }),
        this.prisma.directMessage.groupBy({
          by: ['senderId'],
          where: { institutionId, recipientId: userId, readAt: null },
          _count: { _all: true },
        }),
      ]);
      // Newest first, so the first message seen for a peer is the last one exchanged
      const lastByPeer = new Map<string, DirectMessage>();
      for (const message of recent) {
        const peerId = message.senderId === userId ? message.recipientId : message.senderId;
        if (!lastByPeer.has(peerId)) {
          lastByPeer.set(peerId, message);
        }
      }
      const peers = toContacts(
        await this.prisma.membership.findMany({
          where: { ...activeMemberOf(institutionId), userId: { in: [...lastByPeer.keys()] } },
          select: memberSelect,
        }),
      );
      // Someone who left the institution drops out of the list with their conversation
      return [...lastByPeer].flatMap(([peerId, lastMessage]) => {
        const peer = peers.find((contact) => contact.userId === peerId);
        return peer
          ? [{ peer, lastMessage, unread: unread.find((row) => row.senderId === peerId)?._count._all ?? 0 }]
          : [];
      });
    });
  }

  markRead(institutionId: string, userId: string, peerId: string): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.directMessage.updateMany({
        where: { institutionId, senderId: peerId, recipientId: userId, readAt: null },
        data: { readAt: new Date() },
      });
    });
  }
}
