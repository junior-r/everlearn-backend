import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const TEMPORARY_PASSWORD = 'temporary-password';

describe('Evaluations and grades (HTTP)', () => {
  let ctx: TestApp;
  let institutionId: string;
  let otherInstitutionId: string;
  let adminToken: string;

  const as = (token: string, institution?: string) => {
    const withHeaders = (pending: request.Test) => {
      pending.set('Authorization', `Bearer ${token}`);
      return institution ? pending.set('x-institution-id', institution) : pending;
    };
    return {
      get: (path: string) => withHeaders(request(ctx.server).get(path)),
      post: (path: string) => withHeaders(request(ctx.server).post(path)),
      put: (path: string) => withHeaders(request(ctx.server).put(path)),
      patch: (path: string) => withHeaders(request(ctx.server).patch(path)),
      delete: (path: string) => withHeaders(request(ctx.server).delete(path)),
    };
  };

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

  /** A group taking maths with Alan, with Grace enrolled. */
  async function seedCourse() {
    const api = as(adminToken, institutionId);
    const math = await api.post('/subjects').send({ code: 'MAT-1', name: 'Matemática' }).expect(201);
    const pensum = await api.post('/pensums').send({ code: 'BACH', name: 'Bachillerato' }).expect(201);
    await api
      .put(`/pensums/${pensum.body.id}/subjects/${math.body.id}`)
      .send({ level: 1, weeklyHours: 4 })
      .expect(200);
    const period = await api
      .post('/periods')
      .send({ name: '2026-2027', startDate: '2026-09-15', endDate: '2027-07-15' })
      .expect(201);
    const group = await api
      .post('/groups')
      .send({ name: '1ro A', level: 1, pensumId: pensum.body.id, periodId: period.body.id })
      .expect(201);
    const alan = await member(Role.TEACHER, 'Alan');
    const grace = await member(Role.STUDENT, 'Grace');
    await api
      .put(`/groups/${group.body.id}/courses/${math.body.id}`)
      .send({ teacherMembershipId: alan.membershipId })
      .expect(200);
    await api.post(`/groups/${group.body.id}/students`).send({ membershipId: grace.membershipId }).expect(200);
    return { alan, grace, coursePath: `/groups/${group.body.id}/courses/${math.body.id}` };
  }

  const exam = { title: 'Examen parcial', type: 'EXAM', weight: 60, maxScore: 20, dueAt: '2099-11-10T12:00:00.000Z' };

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('takes an evaluation from draft to graded, and shows it to the Teacher and the Student', async () => {
    const { alan, grace, coursePath } = await seedCourse();
    const teacher = as(alan.token, institutionId);
    const student = as(grace.token, institutionId);

    const created = await teacher.post(`${coursePath}/evaluations`).send(exam).expect(201);
    expect(created.body).toMatchObject({ title: 'Examen parcial', weight: 60, isPublished: false });
    // A draft is invisible to Students
    expect((await student.get('/evaluations/progress').expect(200)).body[0].evaluations).toEqual([]);

    const renamed = await teacher.patch(`/evaluations/${created.body.id}`).send({ title: 'Examen I' }).expect(200);
    expect(renamed.body).toMatchObject({ title: 'Examen I', weight: 60 });
    await teacher.post(`/evaluations/${created.body.id}/publish`).expect(200);
    await teacher
      .put(`/evaluations/${created.body.id}/grades`)
      .send({ grades: [{ enrollmentId: grace.membershipId, score: 15, feedback: 'Bien' }] })
      .expect(204);

    const book = await teacher.get(`${coursePath}/gradebook`).expect(200);
    expect(book.body).toMatchObject({ groupName: '1ro A', totalWeight: 60 });
    expect(book.body.students).toEqual([
      expect.objectContaining({
        firstName: 'Grace',
        average: 75,
        gradedWeight: 60,
        grades: [{ evaluationId: created.body.id, score: 15, feedback: 'Bien' }],
      }),
    ]);

    const progress = await student.get('/evaluations/progress').expect(200);
    expect(progress.body).toHaveLength(1);
    expect(progress.body[0]).toMatchObject({ groupName: '1ro A', average: 75, gradedWeight: 60 });
    expect(progress.body[0].evaluations[0]).toMatchObject({ title: 'Examen I', grade: { score: 15, feedback: 'Bien' } });

    for (const api of [teacher, student]) {
      const calendar = await api.get('/evaluations/calendar').expect(200);
      expect(calendar.body).toEqual([expect.objectContaining({ title: 'Examen I', dueAt: exam.dueAt })]);
    }
    const before = await student.get('/evaluations/calendar?from=2099-01-01&to=2099-06-01').expect(200);
    expect(before.body).toEqual([]);
  });

  it('deletes a draft, and refuses to delete a published evaluation', async () => {
    const { alan, coursePath } = await seedCourse();
    const teacher = as(alan.token, institutionId);
    const draft = await teacher.post(`${coursePath}/evaluations`).send({ ...exam, weight: 40 }).expect(201);
    const published = await teacher.post(`${coursePath}/evaluations`).send(exam).expect(201);
    await teacher.post(`/evaluations/${published.body.id}/publish`).expect(200);

    await teacher.delete(`/evaluations/${draft.body.id}`).expect(204);
    const refused = await teacher.delete(`/evaluations/${published.body.id}`).expect(409);
    expect(refused.body.code).toBe('EVALUATION_ALREADY_PUBLISHED');

    const book = await teacher.get(`${coursePath}/gradebook`).expect(200);
    expect(book.body.evaluations.map((evaluation: { id: string }) => evaluation.id)).toEqual([published.body.id]);
  });

  it('refuses weights above 100%, with a code the client can show', async () => {
    const { alan, coursePath } = await seedCourse();
    const teacher = as(alan.token, institutionId);
    await teacher.post(`${coursePath}/evaluations`).send(exam).expect(201);

    const response = await teacher.post(`${coursePath}/evaluations`).send({ ...exam, weight: 40.01 });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EVALUATION_WEIGHT_EXCEEDED');
    await teacher.post(`${coursePath}/evaluations`).send({ ...exam, weight: 40 }).expect(201);
  });

  it('validates what it is sent', async () => {
    const { alan, grace, coursePath } = await seedCourse();
    const teacher = as(alan.token, institutionId);
    const { body } = await teacher.post(`${coursePath}/evaluations`).send(exam).expect(201);

    for (const invalid of [{ weight: 0 }, { weight: 101 }, { maxScore: -1 }, { type: 'ESSAY' }, { title: '' }, { dueAt: 'soon' }]) {
      await teacher.post(`${coursePath}/evaluations`).send({ ...exam, ...invalid }).expect(400);
    }
    const grades = `/evaluations/${body.id}/grades`;
    const draft = await teacher.put(grades).send({ grades: [{ enrollmentId: grace.membershipId, score: 10 }] });
    expect(draft.status).toBe(409);
    expect(draft.body.code).toBe('EVALUATION_NOT_PUBLISHED');

    await teacher.post(`/evaluations/${body.id}/publish`).expect(200);
    await teacher.put(grades).send({ grades: [] }).expect(400);
    await teacher.put(grades).send({ grades: [{ enrollmentId: 'not-a-uuid', score: 10 }] }).expect(400);
    await teacher.put(grades).send({ grades: [{ enrollmentId: grace.membershipId, score: 'ten' }] }).expect(400);
    const tooHigh = await teacher.put(grades).send({ grades: [{ enrollmentId: grace.membershipId, score: 21 }] });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.code).toBe('SCORE_OUT_OF_RANGE');
    const stranger = await teacher.put(grades).send({ grades: [{ enrollmentId: randomUUID(), score: 10 }] });
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe('STUDENT_NOT_ENROLLED');
    await teacher.put(grades).send({ grades: [{ enrollmentId: grace.membershipId, score: null }] }).expect(204);
  });

  it('keeps Students and other Teachers out of the gradebook and its writes', async () => {
    const { alan, grace, coursePath } = await seedCourse();
    const emmy = await member(Role.TEACHER, 'Emmy');
    const { body } = await as(alan.token, institutionId).post(`${coursePath}/evaluations`).send(exam).expect(201);

    // A Student lacks the role; another Teacher has it but not the course
    await as(grace.token, institutionId).get(`${coursePath}/gradebook`).expect(403);
    await as(grace.token, institutionId).post(`${coursePath}/evaluations`).send(exam).expect(403);
    const other = as(emmy.token, institutionId);
    for (const response of [
      await other.get(`${coursePath}/gradebook`),
      await other.post(`${coursePath}/evaluations`).send({ ...exam, weight: 1 }),
      await other.patch(`/evaluations/${body.id}`).send({ weight: 1 }),
      await other.post(`/evaluations/${body.id}/publish`),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('NOT_COURSE_TEACHER');
    }
    await as(alan.token, institutionId).get('/evaluations/progress').expect(403);
    await request(ctx.server).get('/evaluations/calendar').expect(401);
  });

  it('reports another institution\'s course and evaluation as not found', async () => {
    const { alan, coursePath } = await seedCourse();
    const { body } = await as(alan.token, institutionId).post(`${coursePath}/evaluations`).send(exam).expect(201);
    const outsider = await ctx.signInAs(Role.TEACHER, otherInstitutionId, 'outsider@example.com');
    const api = as(outsider.token, otherInstitutionId);

    const book = await api.get(`${coursePath}/gradebook`);
    expect(book.status).toBe(404);
    expect(book.body.code).toBe('COURSE_NOT_FOUND');
    const publish = await api.post(`/evaluations/${body.id}/publish`);
    expect(publish.status).toBe(404);
    expect(publish.body.code).toBe('EVALUATION_NOT_FOUND');
  });
});
