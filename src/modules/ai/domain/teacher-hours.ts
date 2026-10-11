/** A calendar month, `month` from 1 to 12. */
export interface YearMonth {
  year: number;
  month: number;
}

export interface WeeklySlot {
  /** 0 is Sunday, as in `Date.getUTCDay`. */
  weekday: number;
  /** Minutes from midnight, exclusive end. */
  startMinute: number;
  endMinute: number;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

/** One subject taught to one group, with what its timetable says and what was really held. */
export interface TaughtCourse {
  groupName: string;
  teacher: { membershipId: string; firstName: string; lastName: string } | null;
  /** First and last day of the group's academic period, as UTC dates. */
  period: TimeRange;
  slots: WeeklySlot[];
  /** Classes completed in the month, by their real start and end. */
  heldClasses: TimeRange[];
}

export interface TeacherHours {
  membershipId: string;
  name: string;
  groups: string[];
  /** Hours the timetable gives the Teacher in the month, inside the academic period. */
  scheduledHours: number;
  /** Hours of classes that were held and finished in the month. */
  taughtHours: number;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const roundHours = (hours: number) => Math.round(hours * 100) / 100;

/** Reads `YYYY-MM`; null for anything else. */
export function parseMonth(text: string): YearMonth | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

/** The month from its first instant to the first instant of the next, in UTC. */
export function monthRange({ year, month }: YearMonth): TimeRange {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

/** Minutes the timetable schedules in the month, counting only the days inside the academic period. */
export function scheduledMinutes(slots: ReadonlyArray<WeeklySlot>, month: YearMonth, period: TimeRange): number {
  const { start, end } = monthRange(month);
  const from = Math.max(start.getTime(), period.start.getTime());
  // The period's last day counts in full
  const until = Math.min(end.getTime(), period.end.getTime() + MS_PER_DAY);
  let minutes = 0;
  for (let day = from; day < until; day += MS_PER_DAY) {
    const weekday = new Date(day).getUTCDay();
    for (const slot of slots) {
      if (slot.weekday === weekday) {
        minutes += slot.endMinute - slot.startMinute;
      }
    }
  }
  return minutes;
}

/** Adds up, per Teacher, the hours of every group they teach the subject to. Courses without a Teacher are left out. */
export function teacherHours(courses: ReadonlyArray<TaughtCourse>, month: YearMonth): TeacherHours[] {
  const byTeacher = new Map<string, TeacherHours & { scheduledMinutes: number; taughtMs: number }>();
  for (const course of courses) {
    if (!course.teacher) {
      continue;
    }
    const { membershipId, firstName, lastName } = course.teacher;
    const entry = byTeacher.get(membershipId) ?? {
      membershipId,
      name: `${firstName} ${lastName}`,
      groups: [],
      scheduledHours: 0,
      taughtHours: 0,
      scheduledMinutes: 0,
      taughtMs: 0,
    };
    entry.groups.push(course.groupName);
    entry.scheduledMinutes += scheduledMinutes(course.slots, month, course.period);
    entry.taughtMs += course.heldClasses.reduce(
      (total, held) => total + Math.max(0, held.end.getTime() - held.start.getTime()),
      0,
    );
    byTeacher.set(membershipId, entry);
  }
  return [...byTeacher.values()]
    .map(({ scheduledMinutes: minutes, taughtMs, ...teacher }) => ({
      ...teacher,
      scheduledHours: roundHours(minutes / 60),
      taughtHours: roundHours(taughtMs / MS_PER_HOUR),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
