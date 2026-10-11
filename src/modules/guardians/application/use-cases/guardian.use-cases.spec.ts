import { InMemoryGuardianRepository, InMemoryWardAcademics } from '../../../../../test/support/guardian.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  GuardianLinkNotFoundException,
  InvalidGuardianLinkException,
  WardNotFoundException,
} from '../../domain/guardian.js';
import {
  GetWardOverviewUseCase,
  LinkGuardianUseCase,
  ListGuardianLinksUseCase,
  ListMyWardsUseCase,
  UnlinkGuardianUseCase,
  type GuardianActor,
} from './guardian.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const NOW = new Date('2026-10-11T12:00:00Z');

const guardian = (membershipId: string, institutionId = A, actingIn = institutionId): GuardianActor => ({
  institutionId: actingIn,
  memberships: [{ id: membershipId, institutionId, role: Role.GUARDIAN }],
});
const gina = guardian('gina');

/** Institution A: Gina answers for Grace and Linus; Omar answers for Ada. Institution B has its own members. */
function setup() {
  const guardians = new InMemoryGuardianRepository();
  const academics = new InMemoryWardAcademics();
  const member = (membershipId: string, firstName: string, role: string, institutionId = A) =>
    guardians.members.push({ membershipId, firstName, lastName: 'Prueba', role, institutionId });
  member('gina', 'Gina', 'GUARDIAN');
  member('omar', 'Omar', 'GUARDIAN');
  member('grace', 'Grace', 'STUDENT');
  member('linus', 'Linus', 'STUDENT');
  member('ada', 'Ada', 'STUDENT');
  member('alan', 'Alan', 'TEACHER');
  member('guardian-b', 'Berta', 'GUARDIAN', B);
  member('student-b', 'Bruno', 'STUDENT', B);
  guardians.groups.set('grace', [{ id: 'g1', name: '1ro A' }]);
  guardians.groups.set('linus', [{ id: 'g2', name: '2do B' }]);
  const link = new LinkGuardianUseCase(guardians);
  return {
    guardians,
    academics,
    link,
    unlink: new UnlinkGuardianUseCase(guardians),
    list: new ListGuardianLinksUseCase(guardians),
    wards: new ListMyWardsUseCase(guardians),
    overview: new GetWardOverviewUseCase(guardians, academics, () => NOW),
    linked: async () => {
      await link.execute({ institutionId: A, studentMembershipId: 'grace', guardianMembershipId: 'gina', relationship: 'MOTHER' });
      await link.execute({ institutionId: A, studentMembershipId: 'linus', guardianMembershipId: 'gina', relationship: 'LEGAL_GUARDIAN' });
      await link.execute({ institutionId: A, studentMembershipId: 'ada', guardianMembershipId: 'omar', relationship: 'FATHER' });
    },
  };
}

describe('linking a Guardian to a Student', () => {
  it('records who answers for whom, and how they are related', async () => {
    const ctx = setup();

    const link = await ctx.link.execute({
      institutionId: A,
      studentMembershipId: 'grace',
      guardianMembershipId: 'gina',
      relationship: 'MOTHER',
    });

    expect(link).toMatchObject({
      student: { membershipId: 'grace', firstName: 'Grace' },
      guardian: { membershipId: 'gina', firstName: 'Gina' },
      relationship: 'MOTHER',
    });
    expect(await ctx.list.execute(A)).toHaveLength(1);
    expect(await ctx.list.execute(B)).toEqual([]);
  });

  it('only updates the relationship when the same two are linked again', async () => {
    const ctx = setup();
    const input = { institutionId: A, studentMembershipId: 'grace', guardianMembershipId: 'gina' };

    const first = await ctx.link.execute({ ...input, relationship: 'MOTHER' });
    const second = await ctx.link.execute({ ...input, relationship: 'LEGAL_GUARDIAN' });

    expect(second.id).toBe(first.id);
    expect(await ctx.list.execute(A)).toEqual([expect.objectContaining({ relationship: 'LEGAL_GUARDIAN' })]);
  });

  it('refuses ends that are not a Student and a Guardian of that institution', async () => {
    const ctx = setup();
    const refused = [
      // The roles the wrong way round, and a Teacher in place of a Guardian
      { studentMembershipId: 'gina', guardianMembershipId: 'grace' },
      { studentMembershipId: 'grace', guardianMembershipId: 'alan' },
      { studentMembershipId: 'grace', guardianMembershipId: 'grace' },
      // Members of another institution, and nobody at all
      { studentMembershipId: 'student-b', guardianMembershipId: 'gina' },
      { studentMembershipId: 'grace', guardianMembershipId: 'guardian-b' },
      { studentMembershipId: 'grace', guardianMembershipId: 'missing' },
    ];

    for (const ends of refused) {
      await expect(ctx.link.execute({ institutionId: A, relationship: 'OTHER', ...ends })).rejects.toBeInstanceOf(
        InvalidGuardianLinkException,
      );
    }
    expect(ctx.guardians.links).toEqual([]);
  });

  it('removes a link of the institution, and reports any other as missing', async () => {
    const ctx = setup();
    await ctx.linked();
    const [first] = await ctx.list.execute(A);

    await expect(ctx.unlink.execute(B, first.id)).rejects.toBeInstanceOf(GuardianLinkNotFoundException);
    await ctx.unlink.execute(A, first.id);
    await expect(ctx.unlink.execute(A, first.id)).rejects.toBeInstanceOf(GuardianLinkNotFoundException);

    expect(await ctx.list.execute(A)).toHaveLength(2);
  });
});

describe('what a Guardian sees', () => {
  it('lists only the Students linked to them, with their groups', async () => {
    const ctx = setup();
    await ctx.linked();

    expect(await ctx.wards.execute(gina)).toEqual([
      { membershipId: 'grace', firstName: 'Grace', lastName: 'Prueba', relationship: 'MOTHER', groups: [{ id: 'g1', name: '1ro A' }] },
      { membershipId: 'linus', firstName: 'Linus', lastName: 'Prueba', relationship: 'LEGAL_GUARDIAN', groups: [{ id: 'g2', name: '2do B' }] },
    ]);
    expect((await ctx.wards.execute(guardian('omar'))).map((ward) => ward.membershipId)).toEqual(['ada']);
  });

  it('has no wards through a role held in another institution, or through another role', async () => {
    const ctx = setup();
    await ctx.linked();

    expect(await ctx.wards.execute(guardian('gina', A, B))).toEqual([]);
    expect(await ctx.wards.execute(guardian('gina', B, A))).toEqual([]);
    expect(
      await ctx.wards.execute({ institutionId: A, memberships: [{ id: 'gina', institutionId: A, role: Role.TEACHER }] }),
    ).toEqual([]);
  });

  it('puts together a ward\'s schedule, averages, upcoming evaluations and attendance', async () => {
    const ctx = setup();
    await ctx.linked();
    ctx.academics.schedules.set('g1', [
      { dayOfWeek: 'MONDAY', startMinute: 480, endMinute: 570, groupName: '1ro A', subjectName: 'Matemática', teacherName: 'Alan Turing', room: 'A-1' },
    ]);
    ctx.academics.courses.set('grace', [
      { groupName: '1ro A', subjectName: 'Matemática', subjectCode: 'MAT', teacherName: 'Alan Turing', average: 77.5, gradedWeight: 60, gradedEvaluations: 1, publishedEvaluations: 2 },
    ]);
    ctx.academics.upcoming.set('grace', [
      { id: 'e1', title: 'Proyecto', type: 'PROJECT', dueAt: new Date('2026-10-20T12:00:00Z'), subjectName: 'Matemática', groupName: '1ro A' },
    ]);
    ctx.guardians.attendance.set('grace', {
      counts: { present: 7, late: 1, absent: 2, excused: 4 },
      recent: [{ date: new Date('2026-10-09T13:00:00Z'), subjectName: 'Matemática', status: 'ABSENT' }],
    });

    const overview = await ctx.overview.execute(gina, 'grace');

    expect(overview.ward).toMatchObject({ membershipId: 'grace', relationship: 'MOTHER' });
    expect(overview.schedule).toHaveLength(1);
    expect(overview.courses[0]).toMatchObject({ subjectName: 'Matemática', average: 77.5 });
    expect(overview.upcoming.map((evaluation) => evaluation.title)).toEqual(['Proyecto']);
    // Late is attended and excused absences are left out: 8 of 10
    expect(overview.attendance).toMatchObject({ rate: 80, counts: { present: 7, late: 1, absent: 2, excused: 4 } });
    expect(overview.attendance.recent).toHaveLength(1);
    // Upcoming means the next thirty days
    expect(ctx.academics.asked.find((asked) => asked.what === 'upcoming')).toMatchObject({
      id: 'grace',
      from: NOW,
      to: new Date('2026-11-10T12:00:00Z'),
    });
  });

  it('hides a Student who is not their ward exactly like one who does not exist', async () => {
    const ctx = setup();
    await ctx.linked();

    for (const [who, studentId] of [
      [gina, 'ada'],
      [gina, 'missing'],
      [gina, 'student-b'],
      [guardian('omar'), 'grace'],
      // Gina acting in an institution where she is not a Guardian
      [guardian('gina', A, B), 'grace'],
    ] as const) {
      await expect(ctx.overview.execute(who, studentId)).rejects.toBeInstanceOf(WardNotFoundException);
    }
    // Nothing of those Students was even read
    expect(ctx.academics.asked).toEqual([]);
  });

  it('stops showing a ward once the link is removed', async () => {
    const ctx = setup();
    await ctx.linked();
    await expect(ctx.overview.execute(gina, 'grace')).resolves.toBeDefined();
    const link = (await ctx.list.execute(A)).find((candidate) => candidate.student.membershipId === 'grace');

    await ctx.unlink.execute(A, link?.id ?? '');

    await expect(ctx.overview.execute(gina, 'grace')).rejects.toBeInstanceOf(WardNotFoundException);
  });
});
