import type { NewNotification, Notification } from '../notification.js';
import type { LocalClock } from '../reminders.js';

export const NOTIFICATION_REPOSITORY = Symbol('NotificationRepository');
export const REMINDER_QUERIES = Symbol('ReminderQueries');

export interface Addressee {
  email: string;
  firstName: string;
}

export interface NotificationRepository {
  /** The account behind each membership; unknown memberships are left out. */
  usersOf(membershipIds: string[]): Promise<Map<string, string>>;
  /**
   * Stores the notices and returns only those really added: one whose dedupe
   * key the user already has, or whose collapse key they have unread, is skipped.
   */
  create(notifications: NewNotification[]): Promise<Notification[]>;
  addresseesOf(userIds: string[]): Promise<Map<string, Addressee>>;
  /** The latest notices of a user, newest first. */
  list(userId: string, limit: number): Promise<Notification[]>;
  countUnread(userId: string): Promise<number>;
  /** Marks the user's own notices as read: the given ones, or all of them when `ids` is null. */
  markRead(userId: string, ids: string[] | null): Promise<void>;
  markCollapsedRead(userId: string, collapseKey: string): Promise<void>;
}

/** A published evaluation about to be due, with the Students who must hand it in. */
export interface DueEvaluation {
  evaluationId: string;
  institutionId: string;
  title: string;
  subjectName: string;
  groupName: string;
  dueAt: Date;
  studentMembershipIds: string[];
}

/** A class of the timetable about to start, with everyone who takes part in it. */
export interface StartingClass {
  slotId: string;
  institutionId: string;
  subjectName: string;
  groupName: string;
  startMinute: number;
  /** The Teacher and the enrolled Students. */
  membershipIds: string[];
}

export interface ReminderQueries {
  /** Published evaluations due after `from` and up to `until`. */
  evaluationsDue(from: Date, until: Date): Promise<DueEvaluation[]>;
  /** The time zones of the active institutions. */
  timezones(): Promise<string[]>;
  /**
   * Classes of institutions in `timezone` that the timetable starts today after
   * `clock.minute` and up to `untilMinute`, in periods that include today.
   */
  classesStarting(timezone: string, clock: LocalClock, untilMinute: number): Promise<StartingClass[]>;
}
