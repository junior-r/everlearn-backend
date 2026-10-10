import request from 'supertest';
import { Role } from '../src/shared/domain/auth/role.js';
import { TEST_PASSWORD } from './support/identity.fakes.js';
import { JPEG_BYTES } from './support/onboarding.fakes.js';
import { createTestApp, TEST_FRONTEND_URL, type TestApp } from './support/test-app.js';

describe('Account security, multi-institution membership and groups (HTTP)', () => {
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
      delete: (path: string) => withHeaders(request(ctx.server).delete(path)),
    };
  };

  const register = (token: string, institution: string, role: Role, email: string) =>
    as(token, institution).post('/members').send({ email, firstName: 'Grace', lastName: 'Hopper', role });

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('forced password change', () => {
    it('locks a temporary-password session out of everything except changing the password', async () => {
      const registered = await register(adminToken, institutionId, Role.STUDENT, 'grace@example.com').expect(201);
      const temporaryPassword = registered.body.temporaryPassword as string;
      const login = await request(ctx.server)
        .post('/auth/login')
        .send({ email: 'grace@example.com', password: temporaryPassword })
        .expect(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      const restricted = as(login.body.accessToken as string);

      // Onboarding, institutions and the Google link are all closed
      // Built one at a time: supertest starts the server per request and stops it afterwards
      for (const attempt of [
        () => restricted.get('/onboarding/application'),
        () =>
          restricted
            .post('/onboarding/document')
            .field('documentType', 'NATIONAL_ID')
            .attach('file', Buffer.from(JPEG_BYTES), 'id.jpg'),
        () => restricted.get('/institutions'),
        () => restricted.post('/auth/google/link'),
      ]) {
        const response = await attempt();
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      }
      // They can still see who they are, which the frontend needs to show the form
      await restricted.get('/auth/me').expect(200);

      const changed = await restricted
        .post('/auth/change-password')
        .send({ currentPassword: temporaryPassword, newPassword: 'my-own-password' })
        .expect(200);
      expect(changed.body.user.mustChangePassword).toBe(false);

      // The new token is unrestricted; the old one stays locked until it expires
      await as(changed.body.accessToken as string).get('/onboarding/application').expect(200);
      await restricted.get('/onboarding/application').expect(403);

      await request(ctx.server)
        .post('/auth/login')
        .send({ email: 'grace@example.com', password: temporaryPassword })
        .expect(401);
      const relogin = await request(ctx.server)
        .post('/auth/login')
        .send({ email: 'grace@example.com', password: 'my-own-password' })
        .expect(200);
      expect(relogin.body.user.mustChangePassword).toBe(false);
    });

    it('validates the new password and re-checks the current one', async () => {
      const api = as(adminToken);
      const change = (body: object) => api.post('/auth/change-password').send(body);

      await change({ currentPassword: TEST_PASSWORD, newPassword: 'short' }).expect(400);
      const wrong = await change({ currentPassword: 'not-my-password', newPassword: 'another-password' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');
      const same = await change({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
      expect(same.body.code).toBe('PASSWORD_UNCHANGED');
      await request(ctx.server)
        .post('/auth/change-password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'another-password' })
        .expect(401);
    });
  });

  describe('linking a Google account', () => {
    it('links from an authenticated session, after which Google sign-in works', async () => {
      const agent = request.agent(ctx.server);
      const start = await agent
        .post('/auth/google/link')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const state = new URL(start.body.url as string).searchParams.get('state');
      const cookies = start.headers['set-cookie'] as unknown as string[];
      expect(cookies.find((cookie) => cookie.startsWith('everlearn_google_link='))).toContain('HttpOnly');

      const callback = await agent.get(`/auth/google/callback?code=auth-code&state=${state}`).expect(302);
      expect(callback.headers.location).toBe(`${TEST_FRONTEND_URL}/settings?google=linked`);
      const me = await as(adminToken).get('/auth/me').expect(200);
      expect(me.body.googleLinked).toBe(true);

      // A later, ordinary Google sign-in now finds the account
      const visitor = request.agent(ctx.server);
      const signIn = await visitor.get('/auth/google').expect(302);
      const signInState = new URL(signIn.headers.location).searchParams.get('state');
      const signedIn = await visitor
        .get(`/auth/google/callback?code=auth-code&state=${signInState}`)
        .expect(302);
      expect(signedIn.headers.location).toBe(`${TEST_FRONTEND_URL}/auth/callback`);
      const session = await visitor.post('/auth/refresh').expect(200);
      expect(session.body.user.email).toBe('admin@example.com');
    });

    it('requires a session to start, and cannot be completed with a forged ticket cookie', async () => {
      await request(ctx.server).post('/auth/google/link').expect(401);
      const victim = await ctx.users.findByEmail('admin@example.com');

      // An attacker crafts the cookie by hand, naming the victim's account
      const forged = await request(ctx.server)
        .get('/auth/google/callback?code=auth-code&state=attacker-state')
        .set('Cookie', `everlearn_google_link=link:${victim?.id}:attacker-state`)
        .expect(302);

      expect(forged.headers.location).toBe(`${TEST_FRONTEND_URL}/settings?error=INVALID_OAUTH_STATE`);
      expect(ctx.users.identities.size).toBe(0);
      expect(ctx.google.exchangedCodes).toHaveLength(0);
    });

    it('reports a Google account that is already linked to someone else', async () => {
      const other = ctx.users.seed({ email: 'other@example.com' });
      ctx.users.identities.set('GOOGLE:google-sub-1', other.id);
      const agent = request.agent(ctx.server);
      const start = await agent.post('/auth/google/link').set('Authorization', `Bearer ${adminToken}`);
      const state = new URL(start.body.url as string).searchParams.get('state');

      const callback = await agent.get(`/auth/google/callback?code=auth-code&state=${state}`).expect(302);

      expect(callback.headers.location).toBe(
        `${TEST_FRONTEND_URL}/settings?error=GOOGLE_ACCOUNT_ALREADY_LINKED`,
      );
    });
  });

  describe('one person in several institutions', () => {
    it('adds a membership to an existing account and carries both in the next token', async () => {
      const otherAdmin = (await ctx.signInAs(Role.ADMIN, otherInstitutionId, 'other-admin@example.com')).token;
      const first = await register(adminToken, institutionId, Role.TEACHER, 'grace@example.com').expect(201);
      await ctx.tokenAfterPasswordChange('grace@example.com', first.body.temporaryPassword as string);
      ctx.members.activate(first.body.member.userId as string);

      const second = await register(otherAdmin, otherInstitutionId, Role.STUDENT, 'Grace@Example.com').expect(201);

      expect(second.body.temporaryPassword).toBeNull();
      expect(second.body.member).toMatchObject({
        userId: first.body.member.userId,
        role: 'STUDENT',
        isActive: true,
      });
      expect(ctx.users.users.size).toBe(3);
      const login = await request(ctx.server)
        .post('/auth/login')
        .send({ email: 'grace@example.com', password: TEST_PASSWORD })
        .expect(200);
      expect(login.body.user.memberships).toEqual([
        expect.objectContaining({ institutionId, role: 'TEACHER' }),
        expect.objectContaining({ institutionId: otherInstitutionId, role: 'STUDENT' }),
      ]);

      // Each role works only in its own institution
      const grace = login.body.accessToken as string;
      await as(grace, institutionId).get('/members').expect(403);
      const institutions = await as(grace).get('/institutions').expect(200);
      expect(institutions.body).toHaveLength(2);
    });
  });

  describe('groups', () => {
    async function seedCurriculum() {
      const api = as(adminToken, institutionId);
      const subject = await api.post('/subjects').send({ code: 'MAT-1', name: 'Matemática' }).expect(201);
      const pensum = await api.post('/pensums').send({ code: 'BACH', name: 'Bachillerato' }).expect(201);
      await api
        .put(`/pensums/${pensum.body.id}/subjects/${subject.body.id}`)
        .send({ level: 1, weeklyHours: 5 })
        .expect(200);
      const period = await api
        .post('/periods')
        .send({ name: '2026-2027', startDate: '2026-09-15', endDate: '2027-07-15' })
        .expect(201);
      return {
        api,
        subjectId: subject.body.id as string,
        pensumId: pensum.body.id as string,
        periodId: period.body.id as string,
      };
    }

    /** An active member, registered and approved the way the pipeline would leave them. */
    async function activeMember(role: Role, email: string, firstName: string) {
      const member = await ctx.members.register({
        institutionId,
        email,
        firstName,
        lastName: 'Prueba',
        passwordHash: 'unused',
        role,
        activate: true,
      });
      return member.membershipId;
    }

    it('creates a group, assigns a Teacher to a course and enrolls a Student', async () => {
      const { api, subjectId, pensumId, periodId } = await seedCurriculum();
      const teacherId = await activeMember(Role.TEACHER, 'alan@example.com', 'Alan');
      const studentId = await activeMember(Role.STUDENT, 'linus@example.com', 'Linus');

      const group = await api
        .post('/groups')
        .send({ name: '1ro A', level: 1, capacity: 30, pensumId, periodId })
        .expect(201);
      expect(group.body.courses).toEqual([
        { subjectId, code: 'MAT-1', name: 'Matemática', weeklyHours: 5, teacher: null },
      ]);

      const withTeacher = await api
        .put(`/groups/${group.body.id}/courses/${subjectId}`)
        .send({ teacherMembershipId: teacherId })
        .expect(200);
      expect(withTeacher.body.courses[0].teacher).toEqual({
        membershipId: teacherId,
        firstName: 'Alan',
        lastName: 'Prueba',
      });

      const withStudent = await api
        .post(`/groups/${group.body.id}/students`)
        .send({ membershipId: studentId })
        .expect(200);
      expect(withStudent.body.students).toEqual([
        { membershipId: studentId, firstName: 'Linus', lastName: 'Prueba', email: 'linus@example.com' },
      ]);
      const listed = await api.get('/groups').expect(200);
      expect(listed.body[0]).toMatchObject({ name: '1ro A', studentCount: 1 });

      const again = await api.post(`/groups/${group.body.id}/students`).send({ membershipId: studentId });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('STUDENT_ALREADY_ENROLLED');
      const inUse = await api.delete(`/groups/${group.body.id}`);
      expect(inUse.body.code).toBe('GROUP_IN_USE');

      await api.put(`/groups/${group.body.id}/courses/${subjectId}`).send({ teacherMembershipId: null }).expect(200);
      await api.delete(`/groups/${group.body.id}/students/${studentId}`).expect(200);
      await api.delete(`/groups/${group.body.id}`).expect(204);
    });

    it('refuses the wrong kind of member, and a pending one', async () => {
      const { api, subjectId, pensumId, periodId } = await seedCurriculum();
      const group = await api.post('/groups').send({ name: '1ro A', level: 1, pensumId, periodId }).expect(201);
      const teacherId = await activeMember(Role.TEACHER, 'alan@example.com', 'Alan');
      const studentId = await activeMember(Role.STUDENT, 'linus@example.com', 'Linus');
      const pending = await register(adminToken, institutionId, Role.STUDENT, 'pending@example.com');

      const studentAsTeacher = await api
        .put(`/groups/${group.body.id}/courses/${subjectId}`)
        .send({ teacherMembershipId: studentId });
      expect(studentAsTeacher.status).toBe(404);
      expect(studentAsTeacher.body.code).toBe('TEACHER_NOT_FOUND');

      const teacherAsStudent = await api.post(`/groups/${group.body.id}/students`).send({ membershipId: teacherId });
      expect(teacherAsStudent.body.code).toBe('STUDENT_NOT_FOUND');

      const notYetApproved = await api
        .post(`/groups/${group.body.id}/students`)
        .send({ membershipId: pending.body.member.membershipId });
      expect(notYetApproved.body.code).toBe('STUDENT_NOT_FOUND');
    });

    it('is closed to Teachers, Students and other institutions', async () => {
      const { api, pensumId, periodId } = await seedCurriculum();
      const group = await api.post('/groups').send({ name: '1ro A', level: 1, pensumId, periodId }).expect(201);

      for (const role of [Role.TEACHER, Role.STUDENT]) {
        const member = await ctx.signInAs(role, institutionId, `${role}@example.com`);
        await as(member.token, institutionId).get('/groups').expect(403);
        await as(member.token, institutionId).get('/periods').expect(403);
        await as(member.token, institutionId).post('/groups').send({ name: 'X', level: 1, pensumId, periodId }).expect(403);
      }

      const outsider = (await ctx.signInAs(Role.ADMIN, otherInstitutionId, 'outsider@example.com')).token;
      expect((await as(outsider, otherInstitutionId).get('/groups').expect(200)).body).toEqual([]);
      await as(outsider, otherInstitutionId).get(`/groups/${group.body.id}`).expect(404);
      await as(outsider, otherInstitutionId).delete(`/groups/${group.body.id}`).expect(404);
      // Their own institution cannot borrow this one's pensum or period
      const borrowed = await as(outsider, otherInstitutionId)
        .post('/groups')
        .send({ name: 'Stolen', level: 1, pensumId, periodId });
      expect(borrowed.status).toBe(404);
      expect(ctx.groups.rows).toHaveLength(1);
    });

    it('validates group and period input', async () => {
      const { api, pensumId, periodId } = await seedCurriculum();

      await api.post('/groups').send({ name: '', level: 1, pensumId, periodId }).expect(400);
      await api.post('/groups').send({ name: 'X', level: 0, pensumId, periodId }).expect(400);
      await api.post('/groups').send({ name: 'X', level: 1, pensumId: 'nope', periodId }).expect(400);
      await api.post('/periods').send({ name: 'P', startDate: '2026/09/15', endDate: '2027-07-15' }).expect(400);
      const backwards = await api
        .post('/periods')
        .send({ name: 'P', startDate: '2027-07-15', endDate: '2026-09-15' });
      expect(backwards.body.code).toBe('INVALID_PERIOD_DATES');
    });
  });
});
