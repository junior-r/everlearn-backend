import { DomainException } from '../../../shared/domain/domain.exception.js';

export const DayOfWeek = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY',
} as const;
export type DayOfWeek = (typeof DayOfWeek)[keyof typeof DayOfWeek];

const DAY_ORDER = Object.values(DayOfWeek);
const MINUTES_PER_DAY = 24 * 60;

/** A weekly recurring span. Minutes count from midnight in the institution's time zone; the end is exclusive. */
export interface TimeRange {
  dayOfWeek: DayOfWeek;
  startMinute: number;
  endMinute: number;
}

export interface ScheduledSlot extends TimeRange {
  id: string;
  groupId: string;
  groupName: string;
  subject: { id: string; code: string; name: string };
  teacher: { membershipId: string; firstName: string; lastName: string } | null;
  room: string | null;
}

export function assertValidRange(range: TimeRange): void {
  const { startMinute, endMinute } = range;
  const valid =
    DAY_ORDER.includes(range.dayOfWeek) &&
    Number.isInteger(startMinute) &&
    Number.isInteger(endMinute) &&
    startMinute >= 0 &&
    endMinute <= MINUTES_PER_DAY &&
    startMinute < endMinute;
  if (!valid) {
    throw new InvalidTimeRangeException();
  }
}

/** Two ranges overlap when they share any minute. Back-to-back classes (one ends as the next starts) do not. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.dayOfWeek === b.dayOfWeek && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

const contains = (window: TimeRange, range: TimeRange) =>
  window.dayOfWeek === range.dayOfWeek &&
  window.startMinute <= range.startMinute &&
  range.endMinute <= window.endMinute;

/**
 * Sorts availability windows and merges those that overlap or touch, so
 * "08:00–10:00" plus "10:00–12:00" allows a class from 09:00 to 11:00.
 */
export function normalizeWindows(windows: TimeRange[]): TimeRange[] {
  windows.forEach(assertValidRange);
  const sorted = [...windows].sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) || a.startMinute - b.startMinute,
  );
  const merged: TimeRange[] = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (last && last.dayOfWeek === window.dayOfWeek && window.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, window.endMinute);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

export function isWithinAvailability(availability: TimeRange[], range: TimeRange): boolean {
  return normalizeWindows(availability).some((window) => contains(window, range));
}

export interface PlacementContext {
  /** When the teacher can teach in the group's period. */
  availability: TimeRange[];
  /** Everything the teacher already teaches in that period, in any group. */
  teacherSlots: TimeRange[];
  /** Everything the group already has. */
  groupSlots: TimeRange[];
}

/**
 * The scheduling rules, in the order a user can act on them: the group must be
 * free, the teacher must be free, and the teacher must be available then.
 * Resolves to the first rule broken, or null when the slot can be placed.
 */
export function findPlacementConflict(slot: TimeRange, context: PlacementContext): DomainException | null {
  assertValidRange(slot);
  if (context.groupSlots.some((existing) => overlaps(existing, slot))) {
    return new GroupScheduleConflictException();
  }
  if (context.teacherSlots.some((existing) => overlaps(existing, slot))) {
    return new TeacherScheduleConflictException();
  }
  if (!isWithinAvailability(context.availability, slot)) {
    return new OutsideTeacherAvailabilityException();
  }
  return null;
}

export class InvalidTimeRangeException extends DomainException {
  constructor() {
    super('VALIDATION', 'INVALID_TIME_RANGE', 'The time range is not valid');
  }
}

export class GroupScheduleConflictException extends DomainException {
  constructor() {
    super('CONFLICT', 'GROUP_SCHEDULE_CONFLICT', 'The group already has a class at that time');
  }
}

export class TeacherScheduleConflictException extends DomainException {
  constructor() {
    super('CONFLICT', 'TEACHER_SCHEDULE_CONFLICT', 'The teacher already has a class at that time');
  }
}

export class OutsideTeacherAvailabilityException extends DomainException {
  constructor() {
    super('CONFLICT', 'OUTSIDE_TEACHER_AVAILABILITY', 'The teacher is not available at that time');
  }
}

export class AvailabilityConflictsWithScheduleException extends DomainException {
  constructor() {
    super(
      'CONFLICT',
      'AVAILABILITY_CONFLICTS_WITH_SCHEDULE',
      'The teacher already has classes outside the new availability',
    );
  }
}

export class CourseHasNoTeacherException extends DomainException {
  constructor() {
    super('CONFLICT', 'COURSE_HAS_NO_TEACHER', 'Assign a teacher to this subject before scheduling it');
  }
}

export class ScheduleSlotNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'SCHEDULE_SLOT_NOT_FOUND', 'Schedule slot not found');
  }
}

export class ScheduleBusyException extends DomainException {
  constructor() {
    super('CONFLICT', 'SCHEDULE_BUSY', 'This schedule is being changed by someone else. Try again');
  }
}
