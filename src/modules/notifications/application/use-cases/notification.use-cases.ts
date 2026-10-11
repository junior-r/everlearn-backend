import type { EmailProvider } from '../../../../shared/domain/email/email-provider.js';
import type { NotificationRequest } from '../../../../shared/domain/notifications/notifier.js';
import { RealtimeEvent, type Realtime } from '../../../../shared/domain/realtime/realtime.js';
import {
  emailFor,
  NOTIFICATION_LIST_LIMIT,
  NotificationType,
  type NewNotification,
  type Notification,
} from '../../domain/notification.js';
import type { NotificationRepository, ReminderQueries } from '../../domain/ports/notification.ports.js';
import {
  CLASS_REMINDER_MINUTES,
  EVALUATION_REMINDER_HOURS,
  localClock,
  startInstant,
} from '../../domain/reminders.js';

const MS_PER_HOUR = 3_600_000;

export class SendNotificationsUseCase {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly emails: EmailProvider,
    private readonly realtime: Realtime,
    private readonly newId: () => string,
    private readonly onEmailFailure: (error: unknown) => void = () => undefined,
  ) {}

  /**
   * Stores a notice for each recipient, nudges their open browsers and emails
   * them. Only notices really added are announced, so asking twice for a
   * reminder sends it once. Resolves to how many were added.
   */
  async execute(requests: NotificationRequest[]): Promise<number> {
    const membershipIds = requests.flatMap(({ recipient }) => ('membershipId' in recipient ? [recipient.membershipId] : []));
    const users = membershipIds.length > 0 ? await this.notifications.usersOf(membershipIds) : new Map<string, string>();
    const asked: NewNotification[] = [];
    const withoutEmail = new Set<string>();
    for (const { recipient, email, ...notice } of requests) {
      const userId = 'userId' in recipient ? recipient.userId : users.get(recipient.membershipId);
      if (userId) {
        const id = this.newId();
        asked.push({ ...notice, id, userId });
        if (email === false) {
          withoutEmail.add(id);
        }
      }
    }
    if (asked.length === 0) {
      return 0;
    }
    const added = await this.notifications.create(asked);
    for (const userId of new Set(added.map((notice) => notice.userId))) {
      this.realtime.publish(userId, RealtimeEvent.NOTIFICATION, null);
    }
    const toEmail = added.filter((notice) => !withoutEmail.has(notice.id));
    if (toEmail.length > 0) {
      const addressees = await this.notifications.addresseesOf([...new Set(toEmail.map((notice) => notice.userId))]);
      // One after another, and each on its own: a refused email must not hold back the rest
      for (const notice of toEmail) {
        const addressee = addressees.get(notice.userId);
        if (addressee) {
          await this.emails
            .send({ to: addressee.email, ...emailFor(notice.type, notice.data, addressee.firstName) })
            .catch(this.onEmailFailure);
        }
      }
    }
    return added.length;
  }
}

export interface NotificationList {
  items: Array<Omit<Notification, 'userId'>>;
  unread: number;
}

export class ListNotificationsUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  /** The user's latest notices and how many they have not read. */
  async execute(userId: string): Promise<NotificationList> {
    const [items, unread] = await Promise.all([
      this.notifications.list(userId, NOTIFICATION_LIST_LIMIT),
      this.notifications.countUnread(userId),
    ]);
    return { items: items.map(({ userId: _userId, ...notice }) => notice), unread };
  }
}

export class MarkNotificationsReadUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  /** Marks the user's own notices as read; another user's ids change nothing. */
  execute(userId: string, ids: string[] | null): Promise<void> {
    return this.notifications.markRead(userId, ids);
  }
}

export class SendRemindersUseCase {
  constructor(
    private readonly queries: ReminderQueries,
    private readonly send: SendNotificationsUseCase,
  ) {}

  /**
   * Reminds Students of evaluations due within a day, and everyone in a class
   * the timetable starts within a quarter of an hour. Safe to run as often as
   * wanted, and on several servers at once: each reminder carries a key that
   * lets it through once per person. Resolves to how many notices went out.
   */
  async execute(now: Date): Promise<number> {
    const requests: NotificationRequest[] = [];
    const dueBy = new Date(now.getTime() + EVALUATION_REMINDER_HOURS * MS_PER_HOUR);
    for (const evaluation of await this.queries.evaluationsDue(now, dueBy)) {
      for (const membershipId of evaluation.studentMembershipIds) {
        requests.push({
          recipient: { membershipId },
          institutionId: evaluation.institutionId,
          type: NotificationType.EVALUATION_DUE,
          data: {
            evaluationId: evaluation.evaluationId,
            evaluationTitle: evaluation.title,
            subjectName: evaluation.subjectName,
            groupName: evaluation.groupName,
            dueAt: evaluation.dueAt.toISOString(),
          },
          dedupeKey: `evaluation-due:${evaluation.evaluationId}`,
        });
      }
    }
    for (const timezone of await this.queries.timezones()) {
      const clock = localClock(now, timezone);
      if (!clock) {
        continue;
      }
      for (const starting of await this.queries.classesStarting(timezone, clock, clock.minute + CLASS_REMINDER_MINUTES)) {
        for (const membershipId of starting.membershipIds) {
          requests.push({
            recipient: { membershipId },
            institutionId: starting.institutionId,
            type: NotificationType.CLASS_STARTING,
            data: {
              subjectName: starting.subjectName,
              groupName: starting.groupName,
              startsAt: startInstant(now, clock, starting.startMinute).toISOString(),
            },
            // One per class and day: the timetable repeats every week
            dedupeKey: `class-starting:${starting.slotId}:${clock.date}`,
          });
        }
      }
    }
    return requests.length > 0 ? this.send.execute(requests) : 0;
  }
}
