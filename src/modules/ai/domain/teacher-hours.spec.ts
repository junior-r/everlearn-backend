import {
  monthRange,
  parseMonth,
  scheduledMinutes,
  teacherHours,
  type TaughtCourse,
  type TimeRange,
} from './teacher-hours.js';

const utc = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));
const schoolYear: TimeRange = { start: utc(2026, 9, 1), end: utc(2027, 6, 30) };
const OCTOBER = { year: 2026, month: 10 };
/** Mondays and Wednesdays, 08:00 to 09:30. */
const slots = [
  { weekday: 1, startMinute: 480, endMinute: 570 },
  { weekday: 3, startMinute: 480, endMinute: 570 },
];

const course = (overrides: Partial<TaughtCourse> = {}): TaughtCourse => ({
  groupName: '1ro A',
  teacher: { membershipId: 'alan', firstName: 'Alan', lastName: 'Turing' },
  period: schoolYear,
  slots,
  heldClasses: [],
  ...overrides,
});

describe('parseMonth', () => {
  it('reads YYYY-MM and nothing else', () => {
    expect(parseMonth('2026-10')).toEqual(OCTOBER);
    expect(parseMonth('2026-01')).toEqual({ year: 2026, month: 1 });
    for (const text of ['2026-13', '2026-00', '2026-1', '10-2026', 'octubre', '2026-10-01', '']) {
      expect(parseMonth(text)).toBeNull();
    }
  });

  it('spans a month up to the first instant of the next, across the year', () => {
    expect(monthRange({ year: 2026, month: 12 })).toEqual({ start: utc(2026, 12, 1), end: utc(2027, 1, 1) });
  });
});

describe('scheduledMinutes', () => {
  it('counts every occurrence of each weekday in the month', () => {
    // October 2026 has four Mondays and four Wednesdays
    expect(scheduledMinutes(slots, OCTOBER, schoolYear)).toBe(8 * 90);
    // Thursdays: 1, 8, 15, 22 and 29
    expect(scheduledMinutes([{ weekday: 4, startMinute: 0, endMinute: 60 }], OCTOBER, schoolYear)).toBe(300);
  });

  it('counts only the days inside the academic period, its last day included', () => {
    const startsMidMonth = { start: utc(2026, 10, 14), end: utc(2027, 6, 30) };
    const endsOnAMonday = { start: utc(2026, 9, 1), end: utc(2026, 10, 12) };

    // From Wednesday 14: Mondays 19 and 26, Wednesdays 14, 21 and 28
    expect(scheduledMinutes(slots, OCTOBER, startsMidMonth)).toBe(5 * 90);
    // Up to Monday 12: Mondays 5 and 12, Wednesday 7
    expect(scheduledMinutes(slots, OCTOBER, endsOnAMonday)).toBe(3 * 90);
    expect(scheduledMinutes(slots, { year: 2026, month: 8 }, schoolYear)).toBe(0);
  });
});

describe('teacherHours', () => {
  it('adds up the groups of each Teacher, in hours', () => {
    const hours = teacherHours(
      [
        course({
          heldClasses: [
            { start: utc(2026, 10, 5, 8), end: utc(2026, 10, 5, 9, 30) },
            { start: utc(2026, 10, 7, 8), end: utc(2026, 10, 7, 9, 15) },
          ],
        }),
        course({ groupName: '1ro B', slots: [slots[0]] }),
        course({
          groupName: '2do A',
          teacher: { membershipId: 'emmy', firstName: 'Emmy', lastName: 'Noether' },
          slots: [],
        }),
      ],
      OCTOBER,
    );

    expect(hours).toEqual([
      { membershipId: 'alan', name: 'Alan Turing', groups: ['1ro A', '1ro B'], scheduledHours: 18, taughtHours: 2.75 },
      { membershipId: 'emmy', name: 'Emmy Noether', groups: ['2do A'], scheduledHours: 0, taughtHours: 0 },
    ]);
  });

  it('leaves out courses without a Teacher, and never counts a class backwards', () => {
    const hours = teacherHours(
      [
        course({ teacher: null }),
        course({ heldClasses: [{ start: utc(2026, 10, 5, 9), end: utc(2026, 10, 5, 8) }] }),
      ],
      OCTOBER,
    );

    expect(hours).toHaveLength(1);
    expect(hours[0].taughtHours).toBe(0);
  });
});
