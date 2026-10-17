import request from 'supertest';
import { BUILT_IN_EXERCISES } from '../src/modules/labs/domain/built-in-exercises.js';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const TEMPORARY_PASSWORD = 'temporary-password';
const completions = BUILT_IN_EXERCISES.filter((exercise) => exercise.labKey === 'completions');

describe('Labs (HTTP)', () => {
  let ctx: TestApp;
  let institutionId: string;
  let otherInstitutionId: string;
  let adminToken: string;
  let platformToken: string;

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

  /** A group taking Spanish with Alan, with Grace enrolled; Linus is a Student of no group. */
  async function seedCourse() {
    const api = as(adminToken, institutionId);
    const spanish = await api.post('/subjects').send({ code: 'LEN-1', name: 'Lengua' }).expect(201);
    const pensum = await api.post('/pensums').send({ code: 'BACH', name: 'Bachillerato' }).expect(201);
    await api
      .put(`/pensums/${pensum.body.id}/subjects/${spanish.body.id}`)
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
    const linus = await member(Role.STUDENT, 'Linus');
    await api
      .put(`/groups/${group.body.id}/courses/${spanish.body.id}`)
      .send({ teacherMembershipId: alan.membershipId })
      .expect(200);
    await api.post(`/groups/${group.body.id}/students`).send({ membershipId: grace.membershipId }).expect(200);
    return { alan, grace, linus, coursePath: `/groups/${group.body.id}/courses/${spanish.body.id}` };
  }

  const grant = (labKey: string, granted = true, institution = institutionId) =>
    as(platformToken).put(`/institutions/${institution}/labs/${labKey}`).send({ granted });

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
    platformToken = (await ctx.signInAsPlatformAdmin()).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('writes the built-in exercise bank on start', () => {
    expect(ctx.languageExercises.rows.filter((row) => row.authorId === null)).toHaveLength(
      BUILT_IN_EXERCISES.length,
    );
  });

  it('lets the Platform Admin grant labs and the Institution Admin switch only those', async () => {
    const admin = as(adminToken, institutionId);

    await grant('gravity').expect(204);
    await grant('completions').expect(204);
    const grants = await as(platformToken).get(`/institutions/${institutionId}/labs`).expect(200);
    expect(grants.body.filter((lab: { granted: boolean }) => lab.granted).map((lab: { key: string }) => lab.key)).toEqual([
      'gravity',
      'completions',
    ]);

    expect((await admin.get('/labs/settings').expect(200)).body).toEqual([
      { key: 'gravity', category: 'PHYSICS', enabled: true },
      { key: 'completions', category: 'LANGUAGE', enabled: true },
    ]);
    await admin.put('/labs/gravity/enabled').send({ enabled: false }).expect(204);
    // A lab the platform did not grant cannot be switched on: it is not found
    const refused = await admin.put('/labs/forces/enabled').send({ enabled: true }).expect(404);
    expect(refused.body.code).toBe('LAB_NOT_FOUND');

    // Only the Platform Admin grants, and another institution's grants are untouched
    await as(adminToken, institutionId).put(`/institutions/${institutionId}/labs/forces`).send({ granted: true }).expect(403);
    expect((await as(platformToken).get(`/institutions/${otherInstitutionId}/labs`).expect(200)).body.every(
      (lab: { granted: boolean }) => !lab.granted,
    )).toBe(true);
    await grant('alchemy').expect(404);
  });

  it('shows members only the labs granted and switched on', async () => {
    const { alan, grace } = await seedCourse();
    await grant('gravity').expect(204);
    await grant('function-grapher').expect(204);
    await as(adminToken, institutionId).put('/labs/gravity/enabled').send({ enabled: false }).expect(204);

    for (const token of [alan.token, grace.token]) {
      const labs = await as(token, institutionId).get('/labs').expect(200);
      expect(labs.body).toEqual([{ key: 'function-grapher', category: 'MATHS' }]);
    }
    // An Institution Admin manages labs but does not use them
    await as(adminToken, institutionId).get('/labs').expect(403);
  });

  it('takes a language activity from the Teacher to the Student and back to the Teacher', async () => {
    const { alan, grace, linus, coursePath } = await seedCourse();
    await grant('completions').expect(204);
    const teacher = as(alan.token, institutionId);
    const student = as(grace.token, institutionId);

    const own = await teacher
      .post('/labs/completions/exercises')
      .send({ prompt: 'Nosotros ___ temprano.', answers: ['llegamos'], hint: 'Verbo llegar' })
      .expect(201);
    const bank = await teacher.get('/labs/completions/exercises').expect(200);
    expect(bank.body.own).toEqual([expect.objectContaining({ id: own.body.id, answers: ['llegamos'] })]);

    const exerciseIds = [completions[0].id, own.body.id];
    const created = await teacher
      .post(`${coursePath}/lab-assignments`)
      .send({ labKey: 'completions', title: 'Pasado simple', dueAt: '2099-11-10T12:00:00.000Z', exerciseIds })
      .expect(201);
    const notices = await student.get('/notifications').expect(200);
    expect(notices.body.items[0]).toMatchObject({ type: 'LAB_ASSIGNED', data: { title: 'Pasado simple' } });

    const mine = await student.get('/lab-assignments/mine').expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ id: created.body.id, attempt: null, late: false })]);
    const detail = await student.get(`/lab-assignments/${created.body.id}`).expect(200);
    expect(detail.body.questions.map((question: { id: string }) => question.id)).toEqual(exerciseIds);
    expect(JSON.stringify(detail.body.questions)).not.toContain('llegamos');
    expect(detail.body.solutions).toBeNull();

    const attempt = await student
      .post(`/lab-assignments/${created.body.id}/attempt`)
      .send({
        answers: [
          { exerciseId: completions[0].id, answer: completions[0].answers[0] },
          { exerciseId: own.body.id, answer: 'llegámos' },
        ],
      })
      .expect(201);
    expect(attempt.body).toMatchObject({ score: 1, total: 2 });
    expect(attempt.body.answers.map((answer: { verdict: string }) => answer.verdict)).toEqual(['CORRECT', 'ACCENTS']);
    await student.post(`/lab-assignments/${created.body.id}/attempt`).send({ answers: [] }).expect(409);

    // A Student of another group sees nothing of it
    await as(linus.token, institutionId).get(`/lab-assignments/${created.body.id}`).expect(404);

    const results = await teacher.get(`/lab-assignments/${created.body.id}/results`).expect(200);
    expect(results.body.rows).toEqual([
      expect.objectContaining({ student: expect.objectContaining({ firstName: 'Grace' }), late: false }),
    ]);
    expect(results.body.rows[0].attempt).toMatchObject({ score: 1, total: 2 });
    const list = await teacher.get(`${coursePath}/lab-assignments`).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ submittedCount: 1, studentCount: 1 })]);

    // Students cannot read the results, nor another institution the activity
    await student.get(`/lab-assignments/${created.body.id}/results`).expect(403);
    await as(alan.token, otherInstitutionId).get(`/lab-assignments/${created.body.id}/results`).expect(403);

    await teacher.delete(`/lab-assignments/${created.body.id}`).expect(204);
    expect((await student.get('/lab-assignments/mine').expect(200)).body).toEqual([]);
  });

  it('lets anyone practise with the bank without handing out its answers', async () => {
    const { grace } = await seedCourse();
    await grant('definitions').expect(204);
    const student = as(grace.token, institutionId);

    const questions = await student.get('/labs/definitions/practice').expect(200);
    expect(questions.body[0]).not.toHaveProperty('answers');
    const [first] = BUILT_IN_EXERCISES.filter((exercise) => exercise.labKey === 'definitions');

    const marked = await student
      .post('/labs/definitions/practice')
      .send({ answers: [{ exerciseId: first.id, answer: 'nada' }] })
      .expect(200);
    expect(marked.body).toEqual([{ exerciseId: first.id, answer: 'nada', verdict: 'INCORRECT' }]);

    await student.get('/labs/completions/practice').expect(404);
    await student.post('/labs/definitions/exercises').send({ prompt: 'x', answers: ['y'] }).expect(403);
  });

  it('validates what it is sent', async () => {
    const { alan, coursePath } = await seedCourse();
    await grant('gravity').expect(204);
    const teacher = as(alan.token, institutionId);

    await teacher.post(`${coursePath}/lab-assignments`).send({ labKey: 'alchemy', title: 'X' }).expect(400);
    await teacher.post(`${coursePath}/lab-assignments`).send({ labKey: 'gravity', title: '' }).expect(400);
    await as(platformToken).put(`/institutions/${institutionId}/labs/gravity`).send({ granted: 'yes' }).expect(400);
    const created = await teacher
      .post(`${coursePath}/lab-assignments`)
      .send({ labKey: 'gravity', title: 'Caída libre en Marte', instructions: 'Anota el tiempo de caída.' })
      .expect(201);
    expect(created.body).toMatchObject({ exerciseIds: [], dueAt: null });
  });
});
