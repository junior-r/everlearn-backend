import request from 'supertest';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const TEMPORARY_PASSWORD = 'temporary-password';

describe('Guardians (HTTP)', () => {
  let ctx: TestApp;
  let institutionId: string;
  let otherInstitutionId: string;
  let adminToken: string;

  const as = (token: string, institution: string | null = institutionId) => {
    const withHeaders = (pending: request.Test) => {
      pending.set('Authorization', `Bearer ${token}`);
      return institution ? pending.set('x-institution-id', institution) : pending;
    };
    return {
      get: (path: string) => withHeaders(request(ctx.server).get(path)),
      post: (path: string) => withHeaders(request(ctx.server).post(path)),
      put: (path: string) => withHeaders(request(ctx.server).put(path)),
      delete: (path: string) => withHeaders(request(ctx.server).delete(path)),
    };
  };

  /** Registers an active member; signs them in only when the test needs to act as them. */
  async function member(role: Role, firstName: string, signIn = true) {
    const email = `${firstName.toLowerCase()}@example.com`;
    const { membershipId, userId } = await ctx.members.register({
      institutionId,
      email,
      firstName,
      lastName: 'Prueba',
      passwordHash: `hashed:${TEMPORARY_PASSWORD}`,
      role,
      activate: true,
    });
    return { membershipId, userId, token: signIn ? await ctx.tokenAfterPasswordChange(email, TEMPORARY_PASSWORD) : '' };
  }

  /** 1ro A takes maths with Alan; Grace is enrolled, has 15/20 in an exam worth 60% and a project due in five days. */
  async function seed() {
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
    const grace = await member(Role.STUDENT, 'Grace', false);
    const linus = await member(Role.STUDENT, 'Linus', false);
    const gina = await member(Role.GUARDIAN, 'Gina');
    const coursePath = `/groups/${group.body.id}/courses/${math.body.id}`;
    await admin.put(coursePath).send({ teacherMembershipId: alan.membershipId }).expect(200);
    await admin.post(`/groups/${group.body.id}/students`).send({ membershipId: grace.membershipId }).expect(200);
    const teacher = as(alan.token);
    const exam = await teacher
      .post(`${coursePath}/evaluations`)
      .send({ title: 'Examen parcial', type: 'EXAM', weight: 60, maxScore: 20 })
      .expect(201);
    await teacher.post(`/evaluations/${exam.body.id}/publish`).expect(200);
    await teacher
      .put(`/evaluations/${exam.body.id}/grades`)
      .send({ grades: [{ enrollmentId: grace.membershipId, score: 15 }] })
      .expect(204);
    const project = await teacher
      .post(`${coursePath}/evaluations`)
      .send({
        title: 'Proyecto',
        type: 'PROJECT',
        weight: 20,
        maxScore: 20,
        dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      })
      .expect(201);
    await teacher.post(`/evaluations/${project.body.id}/publish`).expect(200);
    return { alan, grace, linus, gina };
  }

  const link = (studentMembershipId: string, guardianMembershipId: string, relationship = 'MOTHER') =>
    as(adminToken).put('/guardian-links').send({ studentMembershipId, guardianMembershipId, relationship });

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('lets the office link a Guardian to a Student, and the Guardian then see that Student', async () => {
    const { grace, gina } = await seed();
    expect((await as(gina.token).get('/guardian/wards').expect(200)).body).toEqual([]);

    const linked = await link(grace.membershipId, gina.membershipId).expect(200);
    expect(linked.body).toMatchObject({
      student: { membershipId: grace.membershipId, firstName: 'Grace' },
      guardian: { membershipId: gina.membershipId, firstName: 'Gina' },
      relationship: 'MOTHER',
    });

    const wards = await as(gina.token).get('/guardian/wards').expect(200);
    expect(wards.body).toEqual([
      expect.objectContaining({ membershipId: grace.membershipId, firstName: 'Grace', relationship: 'MOTHER', groups: [expect.objectContaining({ name: '1ro A' })] }),
    ]);

    const overview = await as(gina.token).get(`/guardian/wards/${grace.membershipId}`).expect(200);
    // The same figures the Student sees: 15/20 in the only graded evaluation
    expect(overview.body.courses).toEqual([
      expect.objectContaining({ groupName: '1ro A', average: 75, gradedWeight: 60, gradedEvaluations: 1, publishedEvaluations: 2 }),
    ]);
    expect(overview.body.upcoming.map((evaluation: { title: string }) => evaluation.title)).toEqual(['Proyecto']);
    expect(overview.body.schedule).toEqual([]);
    expect(overview.body.attendance).toMatchObject({ rate: null, counts: { present: 0, absent: 0 }, recent: [] });
  });

  it('shows a Guardian nothing of a Student who is not linked to them', async () => {
    const { grace, linus, gina } = await seed();
    const omar = await member(Role.GUARDIAN, 'Omar');
    await link(grace.membershipId, gina.membershipId).expect(200);

    const refused = await as(gina.token).get(`/guardian/wards/${linus.membershipId}`).expect(404);
    expect(refused.body.code).toBe('WARD_NOT_FOUND');
    await as(omar.token).get(`/guardian/wards/${grace.membershipId}`).expect(404);
    expect((await as(omar.token).get('/guardian/wards').expect(200)).body).toEqual([]);
    // Acting in an institution she does not belong to opens nothing either
    await as(gina.token, otherInstitutionId).get('/guardian/wards').expect(403);
    await as(gina.token).get('/guardian/wards/not-an-id').expect(400);

    // Once unlinked, the ward is gone for her too
    const [stored] = (await as(adminToken).get('/guardian-links').expect(200)).body as Array<{ id: string }>;
    await as(adminToken).delete(`/guardian-links/${stored.id}`).expect(204);
    await as(gina.token).get(`/guardian/wards/${grace.membershipId}`).expect(404);
    await as(adminToken).delete(`/guardian-links/${stored.id}`).expect(404);
  });

  it('keeps links for the office, and wards for Guardians', async () => {
    const { alan, grace, gina } = await seed();
    const staff = await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com');
    const body = { studentMembershipId: grace.membershipId, guardianMembershipId: gina.membershipId, relationship: 'FATHER' };

    await as(staff.token).put('/guardian-links').send(body).expect(200);
    for (const token of [gina.token, alan.token]) {
      await as(token).put('/guardian-links').send(body).expect(403);
      await as(token).get('/guardian-links').expect(403);
    }
    await as(alan.token).get('/guardian/wards').expect(403);
    await as(adminToken).get('/guardian/wards').expect(403);
    await request(ctx.server).get('/guardian/wards').expect(401);
  });

  it('refuses a link that does not join a Student and a Guardian of the institution', async () => {
    const { alan, grace, gina } = await seed();

    const wrongRole = await link(grace.membershipId, alan.membershipId).expect(400);
    expect(wrongRole.body.code).toBe('INVALID_GUARDIAN_LINK');
    await link(gina.membershipId, grace.membershipId).expect(400);
    await link(grace.membershipId, gina.membershipId, 'FRIEND').expect(400);
    await as(adminToken).put('/guardian-links').send({ studentMembershipId: 'x', guardianMembershipId: 'y', relationship: 'MOTHER' }).expect(400);
    expect((await as(adminToken).get('/guardian-links').expect(200)).body).toEqual([]);
  });

  it('opens direct messages between a Guardian and the Teachers of their ward', async () => {
    const { alan, grace, gina } = await seed();
    const emmy = await member(Role.TEACHER, 'Emmy', false);

    // Before the link there is nobody for her but the office
    expect((await as(gina.token).get('/messages/contacts?query=alan').expect(200)).body).toEqual([]);
    await link(grace.membershipId, gina.membershipId).expect(200);

    expect((await as(gina.token).get('/messages/contacts?query=alan').expect(200)).body).toHaveLength(1);
    await as(gina.token).post(`/messages/conversations/${alan.userId}`).send({ body: '¿Cómo va Grace?' }).expect(201);
    await as(alan.token).post(`/messages/conversations/${gina.userId}`).send({ body: 'Muy bien.' }).expect(201);
    // A Teacher who does not teach her ward, and the ward herself, stay out of reach
    await as(gina.token).post(`/messages/conversations/${emmy.userId}`).send({ body: 'Hola' }).expect(404);
    await as(gina.token).post(`/messages/conversations/${grace.userId}`).send({ body: 'Hola' }).expect(404);
  });

  it('lets the office register Guardians', async () => {
    const staff = await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com');
    const guardian = { firstName: 'Nora', lastName: 'Prueba', role: 'GUARDIAN' };

    await as(adminToken).post('/members').send({ ...guardian, email: 'nora@example.com' }).expect(201);
    await as(staff.token).post('/members').send({ ...guardian, email: 'otra@example.com' }).expect(201);
  });
});
