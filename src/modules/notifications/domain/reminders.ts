/** A reminder goes out when an evaluation is due within this many hours. */
export const EVALUATION_REMINDER_HOURS = 24;
/** A reminder goes out when a class starts within this many minutes. */
export const CLASS_REMINDER_MINUTES = 15;

export const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** What the clocks on the wall of an institution show at some instant. */
export interface LocalClock {
  weekday: Weekday;
  /** The local date, `YYYY-MM-DD`. */
  date: string;
  /** Minutes from local midnight. */
  minute: number;
}

/**
 * Reads an instant as the local time of an IANA time zone, which is how the
 * timetable is written. Resolves to null for a zone the runtime does not know.
 */
export function localClock(instant: Date, timezone: string): LocalClock | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
  } catch {
    return null;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  const weekday = WEEKDAYS.find((day) => day === part('weekday').toUpperCase());
  if (!weekday) {
    return null;
  }
  return {
    weekday,
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

/** The instant a class starting at `startMinute` local time begins, given the local clock at `now`. */
export function startInstant(now: Date, clock: LocalClock, startMinute: number): Date {
  const wholeMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(wholeMinute + (startMinute - clock.minute) * 60_000);
}
