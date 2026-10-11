import type { ScheduledSlot, TimeRange } from '../schedule.js';

export const AVAILABILITY_REPOSITORY = Symbol('AvailabilityRepository');
export const SCHEDULE_REPOSITORY = Symbol('ScheduleRepository');
export const SCHEDULE_LOCK = Symbol('ScheduleLock');

export interface AvailabilityRepository {
  list(teacherMembershipId: string, periodId: string): Promise<TimeRange[]>;
  /** Replaces all of the teacher's windows for the period in one step. */
  replace(teacherMembershipId: string, periodId: string, windows: TimeRange[]): Promise<void>;
}

export interface SchedulableGroup {
  id: string;
  periodId: string;
}

/** The pairing of a group and a subject, once a teacher has been assigned to it. */
export interface SchedulableCourse {
  courseId: string;
  teacherMembershipId: string | null;
}

export interface ScheduleRepository {
  /** Resolves to null unless the group belongs to the institution. */
  findGroup(institutionId: string, groupId: string): Promise<SchedulableGroup | null>;
  findCourse(groupId: string, subjectId: string): Promise<SchedulableCourse | null>;
  listGroupSlots(groupId: string): Promise<ScheduledSlot[]>;
  /** Every class the teacher gives during the period, across all their groups. */
  listTeacherSlots(teacherMembershipId: string, periodId: string): Promise<ScheduledSlot[]>;
  create(courseId: string, range: TimeRange, room: string | null): Promise<void>;
  delete(groupId: string, slotId: string): Promise<boolean>;
}

export interface ScheduleLock {
  /**
   * Runs `work` while holding every key, so two requests that touch the same
   * teacher or group cannot both pass the conflict checks and then both save.
   * Rejects with ScheduleBusyException when a key is already held.
   */
  runExclusive<T>(keys: string[], work: () => Promise<T>): Promise<T>;
}

export const teacherLock = (membershipId: string) => `teacher:${membershipId}`;
export const groupLock = (groupId: string) => `group:${groupId}`;
