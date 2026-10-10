import { createAdminFakes } from '../../../../../test/support/admin.fakes.js';
import {
  InMemoryGroupRepository,
  InMemoryMemberDirectory,
  InMemoryPeriodRepository,
} from '../../../../../test/support/group.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  GroupFullException,
  GroupInUseException,
  GroupNameTakenException,
  GroupNotFoundException,
  InvalidPeriodDatesException,
  PeriodNameTakenException,
  PeriodNotFoundException,
  StudentAlreadyEnrolledException,
  StudentNotFoundException,
  SubjectNotInGroupException,
  TeacherNotFoundException,
} from '../../domain/entities/group.entities.js';
import { PensumNotFoundException } from '../../domain/exceptions/academic.exceptions.js';
import {
  AssignCourseTeacherUseCase,
  CreateGroupUseCase,
  CreatePeriodUseCase,
  DeleteGroupUseCase,
  EnrollStudentUseCase,
  GetGroupUseCase,
  ListGroupsUseCase,
  ListPeriodsUseCase,
  UnenrollStudentUseCase,
} from './group.use-cases.js';
import { CreatePensumUseCase, PlaceSubjectInPensumUseCase } from './pensum.use-cases.js';
import { CreateSubjectUseCase } from './subject.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const year = { name: '2026-2027', startDate: '2026-09-15', endDate: '2027-07-15' };

/** Institution A with a pensum (Matemática and Física at level 1, Química at level 2) and one period. */
async function setup() {
  const { subjects, pensums } = createAdminFakes();
  const periods = new InMemoryPeriodRepository();
  const directory = new InMemoryMemberDirectory();
  const groups = new InMemoryGroupRepository(pensums, periods, directory);
  const useCases = {
    listPeriods: new ListPeriodsUseCase(periods),
    createPeriod: new CreatePeriodUseCase(periods),
    listGroups: new ListGroupsUseCase(groups),
    getGroup: new GetGroupUseCase(groups),
    createGroup: new CreateGroupUseCase(groups, pensums, periods),
    deleteGroup: new DeleteGroupUseCase(groups),
    assignTeacher: new AssignCourseTeacherUseCase(groups, directory),
    enroll: new EnrollStudentUseCase(groups, directory),
    unenroll: new UnenrollStudentUseCase(groups),
  };
  const createSubject = new CreateSubjectUseCase(subjects);
  const place = new PlaceSubjectInPensumUseCase(pensums, subjects);
  const pensum = await new CreatePensumUseCase(pensums).execute(A, { code: 'BACH', name: 'Bachillerato' });
  const math = await createSubject.execute(A, { code: 'MAT-1', name: 'Matemática' });
  const physics = await createSubject.execute(A, { code: 'FIS-1', name: 'Física' });
  const chemistry = await createSubject.execute(A, { code: 'QUI-2', name: 'Química' });
  await place.execute(A, pensum.id, math.id, { level: 1, weeklyHours: 5, credits: null });
  await place.execute(A, pensum.id, physics.id, { level: 1, weeklyHours: 4, credits: null });
  await place.execute(A, pensum.id, chemistry.id, { level: 2, weeklyHours: 4, credits: null });
  const period = await useCases.createPeriod.execute(A, year);
  const newGroup = { name: '1ro A', level: 1, pensumId: pensum.id, periodId: period.id };
  return { ...useCases, groups, periods, pensums, directory, pensum, period, math, physics, chemistry, newGroup };
}

describe('academic periods', () => {
  it('creates and lists periods per institution', async () => {
    const { createPeriod, listPeriods } = await setup();
    await createPeriod.execute(B, year);

    expect((await listPeriods.execute(A)).map((period) => period.name)).toEqual(['2026-2027']);
  });

  it.each([
    ['ends before it starts', { startDate: '2027-01-01', endDate: '2026-01-01' }],
    ['starts and ends the same day', { startDate: '2026-09-15', endDate: '2026-09-15' }],
    ['has a date that does not exist', { startDate: '2026-02-30', endDate: '2026-07-15' }],
    ['has a malformed date', { startDate: '15/09/2026', endDate: '2027-07-15' }],
  ])('rejects a period that %s', async (_label, dates) => {
    const { createPeriod } = await setup();

    await expect(createPeriod.execute(A, { name: 'Otro', ...dates })).rejects.toBeInstanceOf(
      InvalidPeriodDatesException,
    );
  });

  it('rejects a duplicate name within an institution', async () => {
    const { createPeriod } = await setup();

    await expect(createPeriod.execute(A, year)).rejects.toBeInstanceOf(PeriodNameTakenException);
  });
});

describe('groups', () => {
  it('creates a group whose courses are the subjects its pensum places at its level', async () => {
    const { createGroup, newGroup, pensum, period } = await setup();

    const group = await createGroup.execute(A, { ...newGroup, name: ' 1ro A ', capacity: 30 });

    expect(group).toMatchObject({
      name: '1ro A',
      level: 1,
      capacity: 30,
      pensum: { id: pensum.id, code: 'BACH' },
      period: { id: period.id, name: '2026-2027' },
      studentCount: 0,
      students: [],
    });
    // Química is a level 2 subject, so a level 1 group does not take it
    expect(group.courses.map((course) => course.code).sort()).toEqual(['FIS-1', 'MAT-1']);
    expect(group.courses.every((course) => course.teacher === null)).toBe(true);
  });

  it("refuses a pensum or period from another institution", async () => {
    const { createGroup, createPeriod, newGroup, pensums, groups } = await setup();
    const theirPeriod = await createPeriod.execute(B, year);
    const theirPensum = await pensums.create(B, { code: 'BACH', name: 'Theirs', version: 1 });

    await expect(createGroup.execute(A, { ...newGroup, periodId: theirPeriod.id })).rejects.toBeInstanceOf(
      PeriodNotFoundException,
    );
    await expect(createGroup.execute(A, { ...newGroup, pensumId: theirPensum.id })).rejects.toBeInstanceOf(
      PensumNotFoundException,
    );
    expect(groups.rows).toHaveLength(0);
  });

  it('rejects a duplicate group name within the same period', async () => {
    const { createGroup, newGroup } = await setup();
    await createGroup.execute(A, newGroup);

    await expect(createGroup.execute(A, newGroup)).rejects.toBeInstanceOf(GroupNameTakenException);
  });

  it("never lists, reads or deletes another institution's group", async () => {
    const { createGroup, listGroups, getGroup, deleteGroup, newGroup, groups } = await setup();
    const group = await createGroup.execute(A, newGroup);

    expect(await listGroups.execute(B)).toEqual([]);
    await expect(getGroup.execute(B, group.id)).rejects.toBeInstanceOf(GroupNotFoundException);
    await expect(deleteGroup.execute(B, group.id)).rejects.toBeInstanceOf(GroupNotFoundException);
    expect(groups.rows).toHaveLength(1);
  });
});

describe('assigning a Teacher to a course', () => {
  it('assigns, reassigns and clears the teacher of one subject without touching the others', async () => {
    const { createGroup, assignTeacher, newGroup, directory, math } = await setup();
    const group = await createGroup.execute(A, newGroup);
    const alan = directory.add(A, Role.TEACHER, 'Alan', 'Turing');
    const emmy = directory.add(A, Role.TEACHER, 'Emmy', 'Noether');
    const teacherOf = (courses: typeof group.courses, code: string) =>
      courses.find((course) => course.code === code)?.teacher ?? null;

    const assigned = await assignTeacher.execute(A, group.id, math.id, alan.membershipId);
    expect(teacherOf(assigned.courses, 'MAT-1')).toEqual({
      membershipId: alan.membershipId,
      firstName: 'Alan',
      lastName: 'Turing',
    });
    expect(teacherOf(assigned.courses, 'FIS-1')).toBeNull();

    const reassigned = await assignTeacher.execute(A, group.id, math.id, emmy.membershipId);
    expect(teacherOf(reassigned.courses, 'MAT-1')?.firstName).toBe('Emmy');

    const cleared = await assignTeacher.execute(A, group.id, math.id, null);
    expect(teacherOf(cleared.courses, 'MAT-1')).toBeNull();
  });

  it('only accepts an active Teacher of the same institution', async () => {
    const { createGroup, assignTeacher, newGroup, directory, math, groups } = await setup();
    const group = await createGroup.execute(A, newGroup);
    const student = directory.add(A, Role.STUDENT);
    const admin = directory.add(A, Role.ADMIN);
    const outsider = directory.add(B, Role.TEACHER);

    for (const membershipId of [student.membershipId, admin.membershipId, outsider.membershipId, 'unknown']) {
      await expect(assignTeacher.execute(A, group.id, math.id, membershipId)).rejects.toBeInstanceOf(
        TeacherNotFoundException,
      );
    }
    expect(groups.rows[0].teachers.size).toBe(0);
  });

  it("refuses a subject outside the group's pensum level, and another institution's group", async () => {
    const { createGroup, assignTeacher, newGroup, directory, chemistry, math } = await setup();
    const group = await createGroup.execute(A, newGroup);
    const teacher = directory.add(A, Role.TEACHER);

    await expect(
      assignTeacher.execute(A, group.id, chemistry.id, teacher.membershipId),
    ).rejects.toBeInstanceOf(SubjectNotInGroupException);
    await expect(
      assignTeacher.execute(B, group.id, math.id, teacher.membershipId),
    ).rejects.toBeInstanceOf(GroupNotFoundException);
  });
});

describe('enrolling Students', () => {
  it('enrolls and unenrolls, keeping the student count in step', async () => {
    const { createGroup, enroll, unenroll, listGroups, newGroup, directory } = await setup();
    const group = await createGroup.execute(A, newGroup);
    const grace = directory.add(A, Role.STUDENT, 'Grace', 'Hopper');

    const enrolled = await enroll.execute(A, group.id, grace.membershipId);
    expect(enrolled.students).toEqual([
      { membershipId: grace.membershipId, firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
    ]);
    expect((await listGroups.execute(A))[0].studentCount).toBe(1);

    const emptied = await unenroll.execute(A, group.id, grace.membershipId);
    expect(emptied.students).toEqual([]);
    await expect(unenroll.execute(A, group.id, grace.membershipId)).rejects.toBeInstanceOf(
      StudentNotFoundException,
    );
  });

  it('only accepts an active Student of the same institution', async () => {
    const { createGroup, enroll, newGroup, directory, groups } = await setup();
    const group = await createGroup.execute(A, newGroup);
    const teacher = directory.add(A, Role.TEACHER);
    const outsider = directory.add(B, Role.STUDENT);

    for (const membershipId of [teacher.membershipId, outsider.membershipId, 'unknown']) {
      await expect(enroll.execute(A, group.id, membershipId)).rejects.toBeInstanceOf(
        StudentNotFoundException,
      );
    }
    expect(groups.rows[0].studentIds).toEqual([]);
  });

  it('refuses a duplicate enrollment and stops at the capacity', async () => {
    const { createGroup, enroll, newGroup, directory } = await setup();
    const group = await createGroup.execute(A, { ...newGroup, capacity: 2 });
    const [first, second, third] = ['Uno', 'Dos', 'Tres'].map((name) =>
      directory.add(A, Role.STUDENT, name),
    );
    await enroll.execute(A, group.id, first.membershipId);

    await expect(enroll.execute(A, group.id, first.membershipId)).rejects.toBeInstanceOf(
      StudentAlreadyEnrolledException,
    );
    await enroll.execute(A, group.id, second.membershipId);
    await expect(enroll.execute(A, group.id, third.membershipId)).rejects.toBeInstanceOf(
      GroupFullException,
    );
  });

  it('has no limit when the group has no capacity', async () => {
    const { createGroup, enroll, newGroup, directory } = await setup();
    const group = await createGroup.execute(A, newGroup);

    for (const name of ['Uno', 'Dos', 'Tres']) {
      await enroll.execute(A, group.id, directory.add(A, Role.STUDENT, name).membershipId);
    }

    expect((await enroll.execute(A, group.id, directory.add(A, Role.STUDENT, 'Cuatro').membershipId)).students).toHaveLength(4);
  });

  it('refuses to delete a group that still has students', async () => {
    const { createGroup, enroll, unenroll, deleteGroup, newGroup, directory, groups } = await setup();
    const group = await createGroup.execute(A, newGroup);
    const student = directory.add(A, Role.STUDENT);
    await enroll.execute(A, group.id, student.membershipId);

    await expect(deleteGroup.execute(A, group.id)).rejects.toBeInstanceOf(GroupInUseException);

    await unenroll.execute(A, group.id, student.membershipId);
    await deleteGroup.execute(A, group.id);
    expect(groups.rows).toHaveLength(0);
  });
});
