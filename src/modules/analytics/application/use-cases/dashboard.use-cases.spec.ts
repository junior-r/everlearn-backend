import {
  InMemoryCourseAverages,
  InMemoryDashboardCache,
  InMemoryDashboardQueries,
} from '../../../../../test/support/analytics.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { gradeDistribution, TeachingGroupNotFoundException, today } from '../../domain/dashboards.js';
import {
  GetGroupTeachingUseCase,
  GetInstitutionDashboardUseCase,
  GetPlatformDashboardUseCase,
  GetTeacherDashboardUseCase,
  type TeacherActor,
} from './dashboard.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const NOW = new Date('2026-10-11T22:30:00Z');
const marks = (firstName: string, present: number, absent: number) => ({
  firstName,
  lastName: 'Prueba',
  present,
  late: 0,
  absent,
  excused: 0,
});

function setup(cacheSeconds = 30) {
  const queries = new InMemoryDashboardQueries();
  const cache = new InMemoryDashboardCache();
  const averages = new InMemoryCourseAverages();
  return {
    queries,
    cache,
    averages,
    platform: new GetPlatformDashboardUseCase(queries, cache, cacheSeconds),
    institution: new GetInstitutionDashboardUseCase(queries, cache, cacheSeconds, () => NOW),
    teacher: new GetTeacherDashboardUseCase(queries, averages, () => NOW),
  };
}

const teacherIn = (institutionId: string, id: string, actingIn = institutionId): TeacherActor => ({
  institutionId: actingIn,
  memberships: [{ id, institutionId, role: Role.TEACHER }],
});

describe('gradeDistribution', () => {
  it('sorts averages into five bands, each edge in the band it starts', () => {
    const bands = gradeDistribution([0, 59.99, 60, 69.5, 70, 85, 90, 100, null]);

    expect(bands).toEqual([
      { from: 0, to: 59, students: 2 },
      { from: 60, to: 69, students: 2 },
      { from: 70, to: 79, students: 1 },
      { from: 80, to: 89, students: 1 },
      { from: 90, to: 100, students: 2 },
    ]);
  });

  it('keeps every band when nobody is graded', () => {
    expect(gradeDistribution([null]).map((band) => band.students)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('today', () => {
  it('is the UTC date, without the time', () => {
    expect(today(NOW)).toEqual(new Date('2026-10-11T00:00:00Z'));
  });
});

describe('the platform dashboard', () => {
  it('returns the figures and counts them once while they are cached', async () => {
    const ctx = setup();
    ctx.queries.platformFigures = { ...ctx.queries.platformFigures, activeInstitutions: 3, totalUsers: 120 };

    const first = await ctx.platform.execute();
    ctx.queries.platformFigures = { ...ctx.queries.platformFigures, totalUsers: 121 };
    const second = await ctx.platform.execute();

    expect(first).toMatchObject({ activeInstitutions: 3, totalUsers: 120 });
    expect(second.totalUsers).toBe(120);
    expect(ctx.queries.counted.platform).toBe(1);
    expect(ctx.cache.ttls.get('platform')).toBe(30);
  });

  it('counts on every request when the cache is switched off', async () => {
    const ctx = setup(0);

    await ctx.platform.execute();
    await ctx.platform.execute();

    expect(ctx.queries.counted.platform).toBe(2);
  });
});

describe('an institution\'s dashboard', () => {
  it('adds the attendance rate to the counts, by the rule late is attended and excused is left out', async () => {
    const ctx = setup();
    ctx.queries.institutions.set(A, {
      activeStudents: 240,
      teachers: 18,
      activeGroups: 9,
      pendingReviews: 4,
      attendance: { present: 70, late: 10, absent: 20, excused: 50 },
    });

    const dashboard = await ctx.institution.execute(A);

    expect(dashboard).toEqual({
      activeStudents: 240,
      teachers: 18,
      activeGroups: 9,
      pendingReviews: 4,
      attendance: { present: 70, late: 10, absent: 20, excused: 50 },
      attendanceRate: 80,
    });
    expect(ctx.queries.askedDays).toEqual([new Date('2026-10-11T00:00:00Z')]);
  });

  it('has no attendance rate while nothing was recorded', async () => {
    const ctx = setup();

    expect((await ctx.institution.execute(A)).attendanceRate).toBeNull();
  });

  it('caches each institution apart, so one never sees the figures of another', async () => {
    const ctx = setup();
    ctx.queries.institutions.set(A, {
      activeStudents: 240,
      teachers: 18,
      activeGroups: 9,
      pendingReviews: 0,
      attendance: { present: 0, late: 0, absent: 0, excused: 0 },
    });

    await ctx.institution.execute(A);
    const other = await ctx.institution.execute(B);
    await ctx.institution.execute(A);

    expect(other.activeStudents).toBe(0);
    expect(ctx.queries.counted.institution).toBe(2);
    expect([...ctx.cache.stored.keys()]).toEqual([`institution:${A}`, `institution:${B}`]);
  });
});

describe('a Teacher\'s dashboard', () => {
  function seeded() {
    const ctx = setup();
    ctx.queries.teachers.push(
      {
        institutionId: A,
        teacherMembershipId: 'alan',
        courses: [
          { groupId: 'g1', subjectId: 'math' },
          { groupId: 'g2', subjectId: 'math' },
        ],
        draftEvaluations: 3,
        attendance: [
          { groupName: '1ro A', students: [marks('Grace', 9, 1), marks('Linus', 6, 4)] },
          { groupName: '2do B', students: [marks('Ada', 1, 3), marks('Tim', 0, 0)] },
        ],
      },
      {
        institutionId: A,
        teacherMembershipId: 'emmy',
        courses: [{ groupId: 'g1', subjectId: 'history' }],
        draftEvaluations: 5,
        attendance: [{ groupName: '1ro A', students: [marks('Grace', 0, 10)] }],
      },
    );
    ctx.averages.averages.set('g1:math', [95, 72, null]);
    ctx.averages.averages.set('g2:math', [40, 88]);
    ctx.averages.averages.set('g1:history', [10]);
    return ctx;
  }

  it('summarises only the courses assigned to the Teacher', async () => {
    const ctx = seeded();

    const dashboard = await ctx.teacher.execute(teacherIn(A, 'alan'));

    expect(dashboard).toEqual({
      activeCourses: 2,
      draftEvaluations: 3,
      // Lowest first across groups; Grace's absences in Emmy's classes are not Alan's to see
      studentsAtRisk: [
        { name: 'Ada Prueba', group: '2do B', attendedClasses: 1, countedClasses: 4, attendancePercent: 25 },
        { name: 'Linus Prueba', group: '1ro A', attendedClasses: 6, countedClasses: 10, attendancePercent: 60 },
      ],
      gradeDistribution: [
        { from: 0, to: 59, students: 1 },
        { from: 60, to: 69, students: 0 },
        { from: 70, to: 79, students: 1 },
        { from: 80, to: 89, students: 1 },
        { from: 90, to: 100, students: 1 },
      ],
      gradedAverages: 4,
    });
    // Each gradebook is asked as the membership assigned to that course
    expect(ctx.averages.asked).toEqual([
      { groupId: 'g1', subjectId: 'math', teacherMembershipId: 'alan' },
      { groupId: 'g2', subjectId: 'math', teacherMembershipId: 'alan' },
    ]);
  });

  it('is empty for a Teacher without courses, and for a Teacher role held in another institution', async () => {
    const ctx = seeded();

    for (const actor of [teacherIn(A, 'nobody'), teacherIn(B, 'alan', A), teacherIn(A, 'alan', B)]) {
      const dashboard = await ctx.teacher.execute(actor);

      expect(dashboard).toMatchObject({ activeCourses: 0, draftEvaluations: 0, studentsAtRisk: [], gradedAverages: 0 });
    }
    expect(ctx.averages.asked).toEqual([]);
  });

  it('ignores the other roles the member holds', async () => {
    const ctx = seeded();

    const dashboard = await ctx.teacher.execute({
      institutionId: A,
      memberships: [
        { id: 'alan', institutionId: A, role: Role.STUDENT },
        { id: 'emmy', institutionId: A, role: Role.ADMIN },
      ],
    });

    expect(dashboard.activeCourses).toBe(0);
  });
});

describe('a group for whoever oversees the teaching', () => {
  const group = {
    id: 'group-1',
    name: '1ro A',
    level: 1,
    periodName: '2026-2027',
    pensumName: 'Bachillerato',
    students: 28,
    courses: [],
    schedule: [],
  };

  it("returns the institution's own group, and treats any other as one that does not exist", async () => {
    const queries = new InMemoryDashboardQueries();
    queries.groups.set('institution-a:group-1', group);
    const teaching = new GetGroupTeachingUseCase(queries);

    await expect(teaching.execute('institution-a', 'group-1')).resolves.toEqual(group);
    await expect(teaching.execute('institution-b', 'group-1')).rejects.toBeInstanceOf(TeachingGroupNotFoundException);
    await expect(teaching.execute('institution-a', 'group-2')).rejects.toBeInstanceOf(TeachingGroupNotFoundException);
  });
});
