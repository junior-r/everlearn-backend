import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type { NewNotification, Notification, NotificationData } from '../domain/notification.js';
import type { Addressee, NotificationRepository } from '../domain/ports/notification.ports.js';

type Row = Prisma.NotificationGetPayload<object>;

const toNotification = (row: Row): Notification => ({
  id: row.id,
  userId: row.userId,
  institutionId: row.institutionId,
  type: row.type,
  data: row.data as NotificationData,
  read: row.read,
  createdAt: row.createdAt,
});

@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  private readonly logger = new Logger(PrismaNotificationRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  usersOf(membershipIds: string[]): Promise<Map<string, string>> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.membership.findMany({
        where: { id: { in: membershipIds } },
        select: { id: true, userId: true },
      });
      return new Map(rows.map((row) => [row.id, row.userId]));
    });
  }

  create(notifications: NewNotification[]): Promise<Notification[]> {
    return runQuery(this.logger, async () => {
      const collapsing = notifications.filter((notice) => notice.collapseKey);
      const unread =
        collapsing.length > 0
          ? await this.prisma.notification.findMany({
              where: {
                read: false,
                OR: collapsing.map(({ userId, collapseKey }) => ({ userId, collapseKey })),
              },
              select: { userId: true, collapseKey: true },
            })
          : [];
      const piledUp = new Set(unread.map((row) => `${row.userId}:${row.collapseKey}`));
      const toStore = notifications.filter(
        (notice) => !notice.collapseKey || !piledUp.has(`${notice.userId}:${notice.collapseKey}`),
      );
      if (toStore.length === 0) {
        return [];
      }
      // The unique (userId, dedupeKey) drops the ones a user already has, on this server or another
      const rows = await this.prisma.notification.createManyAndReturn({
        data: toStore.map((notice) => ({
          id: notice.id,
          userId: notice.userId,
          institutionId: notice.institutionId,
          type: notice.type,
          data: notice.data,
          dedupeKey: notice.dedupeKey ?? null,
          collapseKey: notice.collapseKey ?? null,
        })),
        skipDuplicates: true,
      });
      return rows.map(toNotification);
    });
  }

  addresseesOf(userIds: string[]): Promise<Map<string, Addressee>> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, firstName: true },
      });
      return new Map(rows.map(({ id, email, firstName }) => [id, { email, firstName }]));
    });
  }

  list(userId: string, limit: number): Promise<Notification[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit })
      ).map(toNotification),
    );
  }

  countUnread(userId: string): Promise<number> {
    return runQuery(this.logger, () => this.prisma.notification.count({ where: { userId, read: false } }));
  }

  markRead(userId: string, ids: string[] | null): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.notification.updateMany({
        where: { userId, read: false, ...(ids && { id: { in: ids } }) },
        data: { read: true },
      });
    });
  }

  markCollapsedRead(userId: string, collapseKey: string): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.notification.updateMany({ where: { userId, collapseKey, read: false }, data: { read: true } });
    });
  }
}
