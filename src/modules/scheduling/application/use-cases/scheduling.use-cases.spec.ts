import { createAdminFakes } from '../../../../../test/support/admin.fakes.js';
import {
  InMemoryGroupRepository,
  InMemoryMemberDirectory,
  InMemoryPeriodRepository,
} from '../../../../../test/support/group.fakes.js';
import {
  InMemoryAvailabilityRepository,
  InMemoryScheduleLock,
  InMemoryScheduleRepository,
} from '../../../../../test/support/scheduling.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  AssignCourseTeacherUseCase,
  CreateGroupUseCase,
} from '../../../academics/application/use-cases/group.use-cases.js';
import {
  CourseHasScheduleException,
  GroupNotFoundException,
  PeriodNotFoundException,
  TeacherNotFoundException,
} from '../../../academics/domain/entities/group.entities.js';
import {
  AvailabilityConflictsWithScheduleException,
  CourseHasNoTeacherException,
  DayOfWeek,
  findPlacementConflict,
  GroupScheduleConflictException,
  InvalidTimeRangeException,
  normalizeWindows,
  OutsideTeacherAvailabilityException,
  overlaps,
  ScheduleBusyException,
  ScheduleSlotNotFoundException,
  TeacherScheduleConflictException,
  type TimeRange,
} from '../../domain/schedule.js';
import {
  GetGroupScheduleUseCase,
  GetTeacherAvailabilityUseCase,
  RemoveScheduleSlotUseCase,
  ScheduleCourseUseCase,
  SetTeacherAvailabilityUseCase,
} from './scheduling.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const at = (hour: number, minute = 0) => hour * 60 + minute;
const on = (dayOfWeek: DayOfWeek, start: number, end: number): TimeRange => ({
  dayOfWeek,
  startMinute: start,
  endMinute: end,
});
const monday = (start: number, end: number) => on(DayOfWeek.MONDAY, start, end);

describe('schedule rules', () => {
  it('treats back-to-back classes as compatible and any shared minute as an overlap', () => {
    expect(overlaps(monday(at(8), at(9)), monday(at(9), at(10)))).toBe(false);
    expect(overlaps(monday(at(8), at(9)), monday(at(8, 59), at(10)))).toBe(true);
    expect(overlaps(monday(at(8), at(12)), monday(at(9), at(10)))).toBe(true);
    expect(overlaps(monday(at(8), at(9)), on(DayOfWeek.TUESDAY, at(8), at(9)))).toBe(false);
  });

  it('merges availability windows that overlap or touch, and keeps separate ones apart', () => {
    const merged = normalizeWindows([
      monday(at(10), at(12)),
      on(DayOfWeek.TUESDAY, at(8), at(9)),
      monday(at(8), at(10)),
      monday(at(11), at(13)),
      monday(at(15), at(16)),
    ]);

    expect(merged).toEqual([
      monday(at(8), at(13)),
      monday(at(15), at(16)),
      on(DayOfWeek.TUESDAY, at(8), at(9)),
    ]);
  });

  it.each([
    ['ends before it starts', monday(at(10), at(9))],
    ['has no duration', monday(at(10), at(10))],
    ['starts before midnight', monday(-1, at(9))],
    ['runs past midnight', monday(at(23), at(24) + 1)],
    ['uses fractions of a minute', monday(480.5, at(9))],
    ['names a day that does not exist', { dayOfWeek: 'FUNDAY', startMinute: 0, endMinute: 60 } as unknown as TimeRange],
  ])('rejects a range that %s', (_label, range) => {
    expect(() => normalizeWindows([range])).toThrow(InvalidTimeRangeException);
  });

  const context = {
    availability: [monday(at(8), at(12))],
    teacherSlots: [monday(at(8), at(9))],
    groupSlots: [monday(at(10), at(11))],
  };

  it('allows a slot that is free for both and inside the availability', () => {
    expect(findPlacementConflict(monday(at(9), at(10)), context)).toBeNull();
    expect(findPlacementConflict(monday(at(11), at(12)), context)).toBeNull();
  });

  it('names the rule that is broken', () => {
    expect(findPlacementConflict(monday(at(10, 30), at(11, 30)), context)).toBeInstanceOf(
      GroupScheduleConflictException,
    );
    expect(findPlacementConflict(monday(at(8, 30), at(9, 30)), context)).toBeInstanceOf(
      TeacherScheduleConflictException,
    );
    expect(findPlacementConflict(monday(at(11), at(13)), context)).toBeInstanceOf(
      OutsideTeacherAvailabilityException,
    );
    expect(findPlacementConflict(on(DayOfWeek.FRIDAY, at(9), at(10)), context)).toBeInstanceOf(
      OutsideTeacherAvailabilityException,
    );
  });

  it('treats a teacher with no availability set as never available', () => {
    expect(
      findPlacementConflict(monday(at(9), at(10)), { availability: [], teacherSlots: [], groupSlots: [] }),
    ).toBeInstanceOf(OutsideTeacherAvailabilityException);
  });
});

/** Institution A: one pensum with Matemática and Física at level 1, two groups, two teachers. */
async function setup() {
  const { subjects, pensums } = createAdminFakes();
  const periods = new InMemoryPeriodRepository();
  const directory = new InMemoryMemberDirectory();
  const groups = new InMemoryGroupRepository(pensums, periods, directory);
  const availability = new InMemoryAvailabilityRepository();
  const schedule = new InMemoryScheduleRepository(groups, directory);
  const lock = new InMemoryScheduleLock();

  const pensum = await pensums.create(A, { code: 'BACH', name: 'Bachillerato', version: 1 });
  const math = await subjects.create(A, { code: 'MAT-1', name: 'Matemática', description: null });
  const physics = await subjects.create(A, { code: 'FIS-1', name: 'Física', description: null });
  const placement = { level: 1, weeklyHours: 4, credits: null };
  await pensums.placeSubject(pensum.id, math.id, placement);
  await pensums.placeSubject(pensum.id, physics.id, placement);
  const period = await periods.create(A, { name: '2026-2027', startDate: '2026-09-15', endDate: '2027-07-15' });
  const createGroup = new CreateGroupUseCase(groups, pensums, periods);
  const base = { level: 1, pensumId: pensum.id, periodId: period.id };
  const groupA = await createGroup.execute(A, { ...base, name: '1ro A' });
  const groupB = await createGroup.execute(A, { ...base, name: '1ro B' });
  const alan = directory.add(A, Role.TEACHER, 'Alan', 'Turing');
  const emmy = directory.add(A, Role.TEACHER, 'Emmy', 'Noether');
  const assignTeacher = new AssignCourseTeacherUseCase(groups, directory);
  await assignTeacher.execute(A, groupA.id, math.id, alan.membershipId);
  await assignTeacher.execute(A, groupB.id, math.id, alan.membershipId);
  await assignTeacher.execute(A, groupA.id, physics.id, emmy.membershipId);

  const setAvailability = new SetTeacherAvailabilityUseCase(availability, schedule, directory, periods, lock);
  const weekdayMornings = [DayOfWeek.MONDAY, DayOfWeek.TUESDAY].map((day) => on(day, at(8), at(12)));
  await setAvailability.execute(A, alan.membershipId, period.id, weekdayMornings);
  await setAvailability.execute(A, emmy.membershipId, period.id, weekdayMornings);

  const scheduleCourse = new ScheduleCourseUseCase(schedule, availability, lock);
  const book = (groupId: string, subjectId: string, range: TimeRange, institutionId = A) =>
    scheduleCourse.execute({ institutionId, groupId, subjectId, ...range });
  return {
    groups, periods, directory, availability, schedule, lock, pensum, period, math, physics,
    groupA, groupB, alan, emmy, assignTeacher, setAvailability, book, createGroup,
    getAvailability: new GetTeacherAvailabilityUseCase(availability, directory, periods),
    getSchedule: new GetGroupScheduleUseCase(schedule),
    removeSlot: new RemoveScheduleSlotUseCase(schedule),
  };
}

describe('teacher availability', () => {
  it('stores merged windows and returns them', async () => {
    const { setAvailability, getAvailability, alan, period } = await setup();

    const saved = await setAvailability.execute(A, alan.membershipId, period.id, [
      monday(at(8), at(10)),
      monday(at(10), at(12)),
    ]);

    expect(saved).toEqual([monday(at(8), at(12))]);
    expect(await getAvailability.execute(A, alan.membershipId, period.id)).toEqual(saved);
  });

  it('replaces the previous availability rather than adding to it', async () => {
    const { setAvailability, getAvailability, alan, period } = await setup();

    await setAvailability.execute(A, alan.membershipId, period.id, [on(DayOfWeek.FRIDAY, at(14), at(16))]);

    expect(await getAvailability.execute(A, alan.membershipId, period.id)).toEqual([
      on(DayOfWeek.FRIDAY, at(14), at(16)),
    ]);
  });

  it('only applies to an active Teacher and a period of the same institution', async () => {
    const { setAvailability, getAvailability, directory, periods, alan, period } = await setup();
    const student = directory.add(A, Role.STUDENT);
    const outsider = directory.add(B, Role.TEACHER);
    const theirPeriod = await periods.create(B, { name: 'X', startDate: '2026-01-01', endDate: '2026-12-31' });
    const windows = [monday(at(8), at(9))];

    for (const teacherId of [student.membershipId, outsider.membershipId, 'unknown']) {
      await expect(setAvailability.execute(A, teacherId, period.id, windows)).rejects.toBeInstanceOf(
        TeacherNotFoundException,
      );
    }
    await expect(
      setAvailability.execute(A, alan.membershipId, theirPeriod.id, windows),
    ).rejects.toBeInstanceOf(PeriodNotFoundException);
    await expect(getAvailability.execute(B, alan.membershipId, period.id)).rejects.toBeInstanceOf(
      TeacherNotFoundException,
    );
  });

  it('refuses a change that would strand a class the teacher already has', async () => {
    const { setAvailability, getAvailability, book, groupA, math, alan, period } = await setup();
    await book(groupA.id, math.id, monday(at(8), at(10)));

    await expect(
      setAvailability.execute(A, alan.membershipId, period.id, [monday(at(9), at(12))]),
    ).rejects.toBeInstanceOf(AvailabilityConflictsWithScheduleException);
    expect(await getAvailability.execute(A, alan.membershipId, period.id)).toHaveLength(2);

    // Shrinking around the class is fine
    await expect(
      setAvailability.execute(A, alan.membershipId, period.id, [monday(at(8), at(10))]),
    ).resolves.toEqual([monday(at(8), at(10))]);
  });
});

describe('scheduling a course', () => {
  it('adds a class and returns the group timetable with the teacher', async () => {
    const { book, groupA, math, alan } = await setup();

    const timetable = await book(groupA.id, math.id, monday(at(8), at(10)));

    expect(timetable).toHaveLength(1);
    expect(timetable[0]).toMatchObject({
      dayOfWeek: DayOfWeek.MONDAY,
      startMinute: at(8),
      endMinute: at(10),
      groupName: '1ro A',
      teacher: { membershipId: alan.membershipId, firstName: 'Alan' },
    });
  });

  it('refuses a second class for the group at an overlapping time, even with another teacher', async () => {
    const { book, groupA, math, physics, schedule } = await setup();
    await book(groupA.id, math.id, monday(at(8), at(10)));

    await expect(book(groupA.id, physics.id, monday(at(9), at(11)))).rejects.toBeInstanceOf(
      GroupScheduleConflictException,
    );
    expect(schedule.slots).toHaveLength(1);
    // Right after the first class is fine
    await expect(book(groupA.id, physics.id, monday(at(10), at(11)))).resolves.toHaveLength(2);
  });

  it('refuses to put a teacher in two groups at once', async () => {
    const { book, groupA, groupB, math, schedule } = await setup();
    await book(groupA.id, math.id, monday(at(8), at(10)));

    await expect(book(groupB.id, math.id, monday(at(9, 30), at(11)))).rejects.toBeInstanceOf(
      TeacherScheduleConflictException,
    );
    expect(schedule.slots).toHaveLength(1);
    await expect(book(groupB.id, math.id, monday(at(10), at(11)))).resolves.toHaveLength(1);
  });

  it('refuses a time outside the teacher availability, in whole or in part', async () => {
    const { book, groupA, math, schedule } = await setup();

    for (const range of [
      monday(at(14), at(15)),
      monday(at(11), at(13)),
      monday(at(7), at(9)),
      on(DayOfWeek.FRIDAY, at(8), at(9)),
    ]) {
      await expect(book(groupA.id, math.id, range)).rejects.toBeInstanceOf(
        OutsideTeacherAvailabilityException,
      );
    }
    expect(schedule.slots).toHaveLength(0);
  });

  it('needs a teacher assigned to the subject first', async () => {
    const { book, groupB, physics } = await setup();

    await expect(book(groupB.id, physics.id, monday(at(8), at(9)))).rejects.toBeInstanceOf(
      CourseHasNoTeacherException,
    );
  });

  it('validates the time range and keeps institutions apart', async () => {
    const { book, groupA, math } = await setup();

    await expect(book(groupA.id, math.id, monday(at(10), at(9)))).rejects.toBeInstanceOf(
      InvalidTimeRangeException,
    );
    await expect(book(groupA.id, math.id, monday(at(8), at(9)), B)).rejects.toBeInstanceOf(
      GroupNotFoundException,
    );
  });

  it('checks and saves under a lock on the teacher and the group', async () => {
    const { book, lock, groupA, math, alan, schedule } = await setup();

    await book(groupA.id, math.id, monday(at(8), at(9)));
    expect(lock.acquired.at(-1)).toEqual([`group:${groupA.id}`, `teacher:${alan.membershipId}`].sort());

    // A booking for the same teacher that arrives while another is in flight is turned away
    const colliding = lock.runExclusive([`teacher:${alan.membershipId}`], () =>
      book(groupA.id, math.id, monday(at(9), at(10))),
    );
    await expect(colliding).rejects.toBeInstanceOf(ScheduleBusyException);
    expect(schedule.slots).toHaveLength(1);
  });

  it('removes a class, but only through its own group and institution', async () => {
    const { book, removeSlot, getSchedule, groupA, groupB, math } = await setup();
    const [slot] = await book(groupA.id, math.id, monday(at(8), at(9)));

    await expect(removeSlot.execute(A, groupB.id, slot.id)).rejects.toBeInstanceOf(
      ScheduleSlotNotFoundException,
    );
    await expect(removeSlot.execute(B, groupA.id, slot.id)).rejects.toBeInstanceOf(
      GroupNotFoundException,
    );
    expect(await getSchedule.execute(A, groupA.id)).toHaveLength(1);

    expect(await removeSlot.execute(A, groupA.id, slot.id)).toEqual([]);
  });

  it('frees the time once a class is removed', async () => {
    const { book, removeSlot, groupA, groupB, math } = await setup();
    const [slot] = await book(groupA.id, math.id, monday(at(8), at(10)));
    await removeSlot.execute(A, groupA.id, slot.id);

    await expect(book(groupB.id, math.id, monday(at(8), at(10)))).resolves.toHaveLength(1);
  });

  it('does not let the teacher of a scheduled subject be changed or cleared', async () => {
    const { book, removeSlot, assignTeacher, groupA, math, alan, emmy } = await setup();
    const [slot] = await book(groupA.id, math.id, monday(at(8), at(9)));

    await expect(assignTeacher.execute(A, groupA.id, math.id, emmy.membershipId)).rejects.toBeInstanceOf(
      CourseHasScheduleException,
    );
    await expect(assignTeacher.execute(A, groupA.id, math.id, null)).rejects.toBeInstanceOf(
      CourseHasScheduleException,
    );
    // Re-assigning the same teacher changes nothing, so it is allowed
    await expect(assignTeacher.execute(A, groupA.id, math.id, alan.membershipId)).resolves.toBeDefined();

    await removeSlot.execute(A, groupA.id, slot.id);
    await expect(assignTeacher.execute(A, groupA.id, math.id, emmy.membershipId)).resolves.toBeDefined();
  });
});
