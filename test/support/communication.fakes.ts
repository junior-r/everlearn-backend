import { randomUUID } from 'node:crypto';
import type {
  Contact,
  ConversationSummary,
  DirectMessage,
} from '../../src/modules/messaging/domain/direct-message.js';
import type { MessageRepository } from '../../src/modules/messaging/domain/ports/messaging.ports.js';
import type { Reach } from '../../src/modules/messaging/domain/messaging-reach.js';
import type { NewNotification, Notification } from '../../src/modules/notifications/domain/notification.js';
import type {
  Addressee,
  DueEvaluation,
  NotificationRepository,
  ReminderQueries,
  StartingClass,
} from '../../src/modules/notifications/domain/ports/notification.ports.js';
import type { LocalClock } from '../../src/modules/notifications/domain/reminders.js';
import type { Email, EmailProvider } from '../../src/shared/domain/email/email-provider.js';
import type { NotificationRequest, Notifier } from '../../src/shared/domain/notifications/notifier.js';
import type { Realtime, RealtimeEvent } from '../../src/shared/domain/realtime/realtime.js';

/** Records what a use case asked to announce, without delivering anything. */
export class RecordingNotifier implements Notifier {
  readonly requests: NotificationRequest[] = [];
  readonly dismissed: Array<{ userId: string; collapseKey: string }> = [];

  notify(requests: NotificationRequest[]): Promise<void> {
    this.requests.push(...requests);
    return Promise.resolve();
  }

  dismiss(userId: string, collapseKey: string): Promise<void> {
    this.dismissed.push({ userId, collapseKey });
    return Promise.resolve();
  }
}

/** Browsers the test declares open, and a record of what was pushed to them. */
export class FakeRealtime implements Realtime {
  readonly published: Array<{ userId: string; event: RealtimeEvent; payload: unknown }> = [];
  readonly online = new Set<string>();
  /** `userId|key` of what each user is looking at. */
  readonly viewing = new Set<string>();

  publish(userId: string, event: RealtimeEvent, payload: unknown): void {
    this.published.push({ userId, event, payload });
  }

  isOnline(userId: string): Promise<boolean> {
    return Promise.resolve(this.online.has(userId));
  }

  isViewing(userId: string, key: string): Promise<boolean> {
    return Promise.resolve(this.viewing.has(`${userId}|${key}`));
  }
}

export class RecordingEmailProvider implements EmailProvider {
  readonly sent: Email[] = [];
  /** Addresses the provider refuses, as a real one does for a mailbox that bounces. */
  readonly refused = new Set<string>();

  send(email: Email): Promise<void> {
    if (this.refused.has(email.to)) {
      return Promise.reject(new Error(`Mailbox ${email.to} refused`));
    }
    this.sent.push(email);
    return Promise.resolve();
  }
}

type Stored = Notification & { dedupeKey: string | null; collapseKey: string | null };

export class InMemoryNotificationRepository implements NotificationRepository {
  readonly rows: Stored[] = [];
  /** Membership id → user id. */
  readonly memberships = new Map<string, string>();
  readonly addressees = new Map<string, Addressee>();
  /** Stand in for the lookups the Prisma adapter does in other tables. */
  lookupUser: (membershipId: string) => string | undefined = (id) => this.memberships.get(id);
  lookupAddressee: (userId: string) => Addressee | undefined = (id) => this.addressees.get(id);
  private clock = 0;

  usersOf(membershipIds: string[]): Promise<Map<string, string>> {
    const found = membershipIds.flatMap((id): Array<[string, string]> => {
      const userId = this.lookupUser(id);
      return userId ? [[id, userId]] : [];
    });
    return Promise.resolve(new Map(found));
  }

  create(notifications: NewNotification[]): Promise<Notification[]> {
    const added: Stored[] = [];
    for (const notice of notifications) {
      const all = [...this.rows, ...added];
      const isDuplicate = notice.dedupeKey && all.some((row) => row.userId === notice.userId && row.dedupeKey === notice.dedupeKey);
      const isPiledUp =
        notice.collapseKey &&
        this.rows.some((row) => row.userId === notice.userId && row.collapseKey === notice.collapseKey && !row.read);
      if (!isDuplicate && !isPiledUp) {
        this.clock += 1;
        added.push({
          id: notice.id,
          userId: notice.userId,
          institutionId: notice.institutionId,
          type: notice.type,
          data: notice.data,
          read: false,
          createdAt: new Date(Date.UTC(2026, 9, 11, 12, 0, this.clock)),
          dedupeKey: notice.dedupeKey ?? null,
          collapseKey: notice.collapseKey ?? null,
        });
      }
    }
    this.rows.push(...added);
    return Promise.resolve(added.map(({ dedupeKey: _dedupeKey, collapseKey: _collapseKey, ...notice }) => notice));
  }

  addresseesOf(userIds: string[]): Promise<Map<string, Addressee>> {
    const found = userIds.flatMap((id): Array<[string, Addressee]> => {
      const addressee = this.lookupAddressee(id);
      return addressee ? [[id, addressee]] : [];
    });
    return Promise.resolve(new Map(found));
  }

  list(userId: string, limit: number): Promise<Notification[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map(({ dedupeKey: _dedupeKey, collapseKey: _collapseKey, ...notice }) => notice),
    );
  }

  countUnread(userId: string): Promise<number> {
    return Promise.resolve(this.rows.filter((row) => row.userId === userId && !row.read).length);
  }

  markRead(userId: string, ids: string[] | null): Promise<void> {
    for (const row of this.rows) {
      if (row.userId === userId && (!ids || ids.includes(row.id))) {
        row.read = true;
      }
    }
    return Promise.resolve();
  }

  markCollapsedRead(userId: string, collapseKey: string): Promise<void> {
    for (const row of this.rows) {
      if (row.userId === userId && row.collapseKey === collapseKey) {
        row.read = true;
      }
    }
    return Promise.resolve();
  }
}

export class InMemoryReminderQueries implements ReminderQueries {
  evaluations: DueEvaluation[] = [];
  /** Classes of the timetable, by the time zone of their institution. */
  readonly classes = new Map<string, Array<StartingClass & { weekday: string }>>();
  readonly asked: Array<{ timezone: string; clock: LocalClock; untilMinute: number }> = [];

  evaluationsDue(from: Date, until: Date): Promise<DueEvaluation[]> {
    return Promise.resolve(this.evaluations.filter(({ dueAt }) => dueAt > from && dueAt <= until));
  }

  timezones(): Promise<string[]> {
    return Promise.resolve([...this.classes.keys()]);
  }

  classesStarting(timezone: string, clock: LocalClock, untilMinute: number): Promise<StartingClass[]> {
    this.asked.push({ timezone, clock, untilMinute });
    return Promise.resolve(
      (this.classes.get(timezone) ?? [])
        .filter((slot) => slot.weekday === clock.weekday && slot.startMinute > clock.minute && slot.startMinute <= untilMinute)
        .map(({ weekday: _weekday, ...slot }) => slot),
    );
  }
}

/** A group as messaging sees it: who teaches it and who is enrolled, by account. */
export interface TaughtGroup {
  teacherUserIds: string[];
  studentUserIds: string[];
}

export class InMemoryMessageRepository implements MessageRepository {
  readonly messages: DirectMessage[] = [];
  /** The active members of each institution. */
  readonly members = new Map<string, Contact[]>();
  /** The groups of each institution. */
  readonly groups = new Map<string, TaughtGroup[]>();
  /** Who answers for whom, in each institution. */
  readonly guardianLinks = new Map<string, Array<{ guardianUserId: string; studentUserId: string }>>();
  /** Stand in for the membership and enrollment lookups of the Prisma adapter. */
  lookupMembers: (institutionId: string) => Contact[] = (id) => this.members.get(id) ?? [];
  lookupGroups: (institutionId: string) => TaughtGroup[] = (id) => this.groups.get(id) ?? [];
  lookupLinks: (institutionId: string) => Array<{ guardianUserId: string; studentUserId: string }> = (id) =>
    this.guardianLinks.get(id) ?? [];
  private clock = 0;

  private within(institutionId: string, fromUserId: string, reach: Reach, to: Contact): boolean {
    if (reach.anyone || to.roles.some((role) => reach.roles.includes(role))) {
      return true;
    }
    const groups = this.lookupGroups(institutionId);
    const isStudent = to.roles.includes('STUDENT');
    const teaches = (teacher: string, student: string) =>
      groups.some((group) => group.teacherUserIds.includes(teacher) && group.studentUserIds.includes(student));
    const links = this.lookupLinks(institutionId);
    /** Whether `teacher` teaches a ward of `guardian` now. */
    const teachesWardOf = (teacher: string, guardian: string) =>
      links.some((link) => link.guardianUserId === guardian && teaches(teacher, link.studentUserId));
    return (
      (reach.wardsTeachers && to.roles.includes('TEACHER') && teachesWardOf(to.userId, fromUserId)) ||
      (reach.studentsGuardians && to.roles.includes('GUARDIAN') && teachesWardOf(fromUserId, to.userId)) ||
      (reach.ownStudents && isStudent && teaches(fromUserId, to.userId)) ||
      (reach.ownTeachers && to.roles.includes('TEACHER') && teaches(to.userId, fromUserId)) ||
      (reach.groupMates &&
        isStudent &&
        groups.some((group) => group.studentUserIds.includes(fromUserId) && group.studentUserIds.includes(to.userId)))
    );
  }

  canReach(institutionId: string, fromUserId: string, reach: Reach, toUserId: string): Promise<boolean> {
    const to = this.lookupMembers(institutionId).find((contact) => contact.userId === toUserId);
    return Promise.resolve(to !== undefined && this.within(institutionId, fromUserId, reach, to));
  }

  hasWritten(institutionId: string, fromUserId: string, toUserId: string): Promise<boolean> {
    return Promise.resolve(
      this.messages.some(
        (message) =>
          message.institutionId === institutionId && message.senderId === fromUserId && message.recipientId === toUserId,
      ),
    );
  }

  findContact(institutionId: string, userId: string): Promise<Contact | null> {
    return Promise.resolve(this.lookupMembers(institutionId).find((contact) => contact.userId === userId) ?? null);
  }

  searchContacts(
    institutionId: string,
    userId: string,
    reach: Reach,
    query: string,
    limit: number,
  ): Promise<Contact[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return Promise.resolve(
      this.lookupMembers(institutionId)
        .filter((contact) => contact.userId !== userId && this.within(institutionId, userId, reach, contact))
        .filter((contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.toLowerCase();
          return words.every((word) => name.includes(word));
        })
        .slice(0, limit),
    );
  }

  save(message: Omit<DirectMessage, 'id' | 'readAt' | 'createdAt'>): Promise<DirectMessage> {
    this.clock += 1;
    const stored: DirectMessage = {
      ...message,
      id: randomUUID(),
      readAt: null,
      createdAt: new Date(Date.UTC(2026, 9, 11, 12, 0, this.clock)),
    };
    this.messages.push(stored);
    return Promise.resolve(stored);
  }

  private between(institutionId: string, userId: string, peerId: string): DirectMessage[] {
    return this.messages.filter(
      (message) =>
        message.institutionId === institutionId &&
        ((message.senderId === userId && message.recipientId === peerId) ||
          (message.senderId === peerId && message.recipientId === userId)),
    );
  }

  conversation(
    institutionId: string,
    userId: string,
    peerId: string,
    limit: number,
    before: Date | null,
  ): Promise<DirectMessage[]> {
    return Promise.resolve(
      this.between(institutionId, userId, peerId)
        .filter((message) => !before || message.createdAt < before)
        .slice(-limit)
        .map((message) => ({ ...message })),
    );
  }

  listConversations(institutionId: string, userId: string): Promise<ConversationSummary[]> {
    const mine = this.messages.filter(
      (message) => message.institutionId === institutionId && [message.senderId, message.recipientId].includes(userId),
    );
    const peerIds = [...new Set(mine.map((message) => (message.senderId === userId ? message.recipientId : message.senderId)))];
    const summaries = peerIds.flatMap((peerId): ConversationSummary[] => {
      const peer = this.lookupMembers(institutionId).find((contact) => contact.userId === peerId);
      const exchanged = this.between(institutionId, userId, peerId);
      return peer
        ? [
            {
              peer,
              lastMessage: exchanged[exchanged.length - 1],
              unread: exchanged.filter((message) => message.recipientId === userId && !message.readAt).length,
            },
          ]
        : [];
    });
    return Promise.resolve(
      summaries.sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime()),
    );
  }

  markRead(institutionId: string, userId: string, peerId: string): Promise<void> {
    for (const message of this.between(institutionId, userId, peerId)) {
      if (message.recipientId === userId && !message.readAt) {
        message.readAt = new Date();
      }
    }
    return Promise.resolve();
  }
}
