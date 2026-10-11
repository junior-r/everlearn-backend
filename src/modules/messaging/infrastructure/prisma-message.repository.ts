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
import type { Reach } from '../domain/messaging-reach.js';
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

const ACTIVE = 'ACTIVE' as const;

/**
 * The memberships within `reach` of a user, as a filter. Null when the reach
 * is empty, so the caller does not run a query that can match nobody.
 */
function withinReach(institutionId: string, userId: string, reach: Reach): Prisma.MembershipWhereInput | null {
  if (reach.anyone) {
    return {};
  }
  const self = { userId, isActive: true };
  const enrolledWith = (group: Prisma.GroupWhereInput): Prisma.MembershipWhereInput => ({
    role: 'STUDENT',
    enrollments: { some: { status: ACTIVE, group: { institutionId, ...group } } },
  });
  const any: Prisma.MembershipWhereInput[] = [];
  if (reach.roles.length > 0) {
    any.push({ role: { in: reach.roles } });
  }
  if (reach.ownStudents) {
    any.push(enrolledWith({ courses: { some: { teacher: self } } }));
  }
  if (reach.groupMates) {
    any.push(enrolledWith({ enrollments: { some: { status: ACTIVE, student: self } } }));
  }
  if (reach.ownTeachers) {
    any.push({
      role: 'TEACHER',
      coursesTaught: {
        some: { group: { institutionId, enrollments: { some: { status: ACTIVE, student: self } } } },
      },
    });
  }
  if (reach.wardsTeachers) {
    // Teachers of a group where one of the member's wards is enrolled now
    const ward = { guardians: { some: { guardian: self } } };
    any.push({
      role: 'TEACHER',
      coursesTaught: {
        some: { group: { institutionId, enrollments: { some: { status: ACTIVE, student: ward } } } },
      },
    });
  }
  if (reach.studentsGuardians) {
    // Guardians of a Student enrolled now in a group the member teaches
    any.push({
      role: 'GUARDIAN',
      wards: {
        some: {
          student: {
            enrollments: {
              some: { status: ACTIVE, group: { institutionId, courses: { some: { teacher: self } } } },
            },
          },
        },
      },
    });
  }
  return any.length > 0 ? { OR: any } : null;
}

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

  searchContacts(
    institutionId: string,
    userId: string,
    reach: Reach,
    query: string,
    limit: number,
  ): Promise<Contact[]> {
    const words = query.split(/\s+/).filter(Boolean);
    const reachable = withinReach(institutionId, userId, reach);
    if (!reachable) {
      return Promise.resolve([]);
    }
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.membership.findMany({
        where: {
          ...reachable,
          institutionId,
          isActive: true,
          userId: { not: userId },
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

  canReach(institutionId: string, fromUserId: string, reach: Reach, toUserId: string): Promise<boolean> {
    const reachable = withinReach(institutionId, fromUserId, reach);
    if (!reachable) {
      return Promise.resolve(false);
    }
    return runQuery(
      this.logger,
      async () =>
        (await this.prisma.membership.count({
          where: { ...reachable, ...activeMemberOf(institutionId), userId: toUserId },
        })) > 0,
    );
  }

  hasWritten(institutionId: string, fromUserId: string, toUserId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () =>
        (await this.prisma.directMessage.findFirst({
          where: { institutionId, senderId: fromUserId, recipientId: toUserId },
          select: { id: true },
        })) !== null,
    );
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
