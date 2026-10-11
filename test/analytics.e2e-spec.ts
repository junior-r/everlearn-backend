import request from 'supertest';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const TEMPORARY_PASSWORD = 'temporary-password';

describe('Dashboards (HTTP)', () => {
  let ctx: TestApp;
  let institutionId: string;
  let otherInstitutionId: string;
  let adminToken: string;

  const get = (path: string, token?: string, institution: string | null = institutionId) => {
    const pending = request(ctx.server).get(path);
    if (token) {
      pending.set('Authorization', `Bearer ${token}`);
    }
    return institution ? pending.set('x-institution-id', institution) : pending;
  };

  const as = (token: string) => ({
    post: (path: string) =>
      request(ctx.server).post(path).set('Authorization', `Bearer ${token}`).set('x-institution-id', institutionId),
    put: (path: string) =>
      request(ctx.server).put(path).set('Authorization', `Bearer ${token}`).set('x-institution-id', institutionId),
  });

  async function member(role: Role, firstName: string) {
    const email = `${firstName.toLowerCase()}@example.com`;
    const { membershipId } = await ctx.members.register({
      institutionId,
      email,
      firstName,
      lastName: 'Prueba',
      passwordHash: `hashed:${TEMPORARY_PASSWORD}`,
      role,
      activate: true,
    });
    return { membershipId, token: await ctx.tokenAfterPasswordChange(email, TEMPORARY_PASSWORD) };
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('gives the platform figures to Platform Admins only', async () => {
    ctx.dashboards.platformFigures = {
      activeInstitutions: 2,
      inactiveInstitutions: 1,
      totalUsers: 340,
      pendingReviews: 6,
      usersByStatus: { active: 300, pendingOnboarding: 38, suspended: 2 },
      largestInstitutions: [{ id: institutionId, name: 'Colegio Central', members: 210 }],
    };
    const platform = await ctx.signInAsPlatformAdmin();

    const response = await get('/analytics/platform', platform.token, null).expect(200);

    expect(response.body).toEqual(ctx.dashboards.platformFigures);
    await get('/analytics/platform', undefined, null).expect(401);
    await get('/analytics/platform', adminToken).expect(403);
  });

  it("gives an Institution Admin their institution's figures, and nobody else's", async () => {
    ctx.dashboards.institutions.set(institutionId, {
      activeStudents: 240,
      teachers: 18,
      activeGroups: 9,
      pendingReviews: 4,
      attendance: { present: 70, late: 10, absent: 20, excused: 5 },
    });
    ctx.dashboards.institutions.set(otherInstitutionId, {
      activeStudents: 999,
      teachers: 99,
      activeGroups: 99,
      pendingReviews: 99,
      attendance: { present: 1, late: 0, absent: 0, excused: 0 },
    });
    const teacher = await ctx.signInAs(Role.TEACHER, institutionId, 'teacher@example.com');
    const staff = await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com');

    const response = await get('/analytics/institution', adminToken).expect(200);

    expect(response.body).toMatchObject({ activeStudents: 240, teachers: 18, activeGroups: 9, attendanceRate: 80 });
    // Naming another institution in the header does not open its figures
    await get('/analytics/institution', adminToken, otherInstitutionId).expect(403);
    await get('/analytics/institution', adminToken, null).expect(403);
    await get('/analytics/institution', teacher.token).expect(403);
    await get('/analytics/institution', staff.token).expect(403);
  });

  it('builds a Teacher dashboard from their own courses, with averages from the real gradebook', async () => {
    const admin = as(adminToken);
    const math = await admin.post('/subjects').send({ code: 'MAT-1', name: 'Matemática' }).expect(201);
    const pensum = await admin.post('/pensums').send({ code: 'BACH', name: 'Bachillerato' }).expect(201);
    await admin.put(`/pensums/${pensum.body.id}/subjects/${math.body.id}`).send({ level: 1, weeklyHours: 4 }).expect(200);
    const period = await admin
      .post('/periods')
      .send({ name: '2026-2027', startDate: '2026-09-15', endDate: '2027-07-15' })
      .expect(201);
    const group = await admin
      .post('/groups')
      .send({ name: '1ro A', level: 1, pensumId: pensum.body.id, periodId: period.body.id })
      .expect(201);
    const alan = await member(Role.TEACHER, 'Alan');
    const emmy = await member(Role.TEACHER, 'Emmy');
    const grace = await member(Role.STUDENT, 'Grace');
    const coursePath = `/groups/${group.body.id}/courses/${math.body.id}`;
    await admin.put(coursePath).send({ teacherMembershipId: alan.membershipId }).expect(200);
    await admin.post(`/groups/${group.body.id}/students`).send({ membershipId: grace.membershipId }).expect(200);
    const exam = await as(alan.token)
      .post(`${coursePath}/evaluations`)
      .send({ title: 'Examen parcial', type: 'EXAM', weight: 60, maxScore: 20 })
      .expect(201);
    await as(alan.token).post(`/evaluations/${exam.body.id}/publish`).expect(200);
    await as(alan.token)
      .put(`/evaluations/${exam.body.id}/grades`)
      .send({ grades: [{ enrollmentId: grace.membershipId, score: 17 }] })
      .expect(204);
    const course = { groupId: group.body.id as string, subjectId: math.body.id as string };
    ctx.dashboards.teachers.push({
      institutionId,
      teacherMembershipId: alan.membershipId,
      courses: [course],
      draftEvaluations: 2,
      attendance: [
        {
          groupName: '1ro A',
          students: [{ firstName: 'Grace', lastName: 'Prueba', present: 1, late: 0, absent: 3, excused: 0 }],
        },
      ],
    });

    const own = await get('/analytics/teacher', alan.token).expect(200);

    expect(own.body).toMatchObject({
      activeCourses: 1,
      draftEvaluations: 2,
      studentsAtRisk: [{ name: 'Grace Prueba', group: '1ro A', attendancePercent: 25 }],
      gradedAverages: 1,
    });
    // 17/20 is 85%, read from the gradebook
    expect(own.body.gradeDistribution).toContainEqual({ from: 80, to: 89, students: 1 });

    // A colleague sees nothing of it, and Students and admins have no such dashboard
    const colleague = await get('/analytics/teacher', emmy.token).expect(200);
    expect(colleague.body).toMatchObject({ activeCourses: 0, draftEvaluations: 0, studentsAtRisk: [] });
    await get('/analytics/teacher', grace.token).expect(403);
    await get('/analytics/teacher', adminToken).expect(403);

    // Even a wrong course list cannot open a gradebook: it refuses whoever is not the course's Teacher
    ctx.dashboards.teachers.push({
      institutionId,
      teacherMembershipId: emmy.membershipId,
      courses: [course],
      draftEvaluations: 0,
      attendance: [],
    });
    const refused = await get('/analytics/teacher', emmy.token).expect(403);
    expect(refused.body.code).toBe('NOT_COURSE_TEACHER');
  });
});
