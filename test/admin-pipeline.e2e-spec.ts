import request from 'supertest';
import { Role } from '../src/shared/domain/auth/role.js';
import { JPEG_BYTES } from './support/onboarding.fakes.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const confirmation = {
  firstName: 'Grace Brewster',
  lastName: 'Hopper',
  documentType: 'NATIONAL_ID',
  documentNumber: '87654321',
  birthDate: '2008-03-14',
};

describe('Institution hierarchy and admin pipeline (HTTP)', () => {
  let ctx: TestApp;
  let platformToken: string;
  let institutionId: string;
  let otherInstitutionId: string;

  /** A request carrying a token and, when given, the institution being acted on. */
  const as = (token: string, institution?: string) => {
    const withHeaders = (pending: request.Test) => {
      pending.set('Authorization', `Bearer ${token}`);
      return institution ? pending.set('x-institution-id', institution) : pending;
    };
    return {
      get: (path: string) => withHeaders(request(ctx.server).get(path)),
      post: (path: string) => withHeaders(request(ctx.server).post(path)),
      patch: (path: string) => withHeaders(request(ctx.server).patch(path)),
      put: (path: string) => withHeaders(request(ctx.server).put(path)),
      delete: (path: string) => withHeaders(request(ctx.server).delete(path)),
    };
  };

  const newMember = (role: Role, email: string) => ({
    email,
    firstName: 'Grace',
    lastName: 'Hopper',
    role,
  });

  beforeEach(async () => {
    ctx = await createTestApp();
    platformToken = (await ctx.signInAsPlatformAdmin()).token;
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  describe('institutions', () => {
    it('lets only a Platform Admin create, update and delete institutions', async () => {
      const admin = await ctx.signInAs(Role.ADMIN, institutionId);
      const body = { name: 'Nuevo Colegio', slug: 'nuevo-colegio', timezone: 'America/Caracas' };

      await as(admin.token, institutionId).post('/institutions').send(body).expect(403);
      await as(admin.token, institutionId).patch(`/institutions/${institutionId}`).send({ isActive: false }).expect(403);
      await as(admin.token, institutionId).delete(`/institutions/${institutionId}`).expect(403);

      const created = await as(platformToken).post('/institutions').send(body).expect(201);
      expect(created.body).toMatchObject({ ...body, isActive: true });
      await as(platformToken).patch(`/institutions/${created.body.id}`).send({ name: 'Renombrado' }).expect(200);
      await as(platformToken).delete(`/institutions/${created.body.id}`).expect(204);
    });

    it('validates input and reports conflicts with stable codes', async () => {
      await as(platformToken).post('/institutions').send({ name: 'X', slug: 'Not A Slug' }).expect(400);
      await as(platformToken).patch('/institutions/not-a-uuid').send({ name: 'X' }).expect(400);

      const invalidZone = await as(platformToken)
        .post('/institutions')
        .send({ name: 'X', slug: 'x-school', timezone: 'Mars/Olympus' });
      expect(invalidZone.body.code).toBe('INVALID_TIMEZONE');

      await as(platformToken).post('/institutions').send({ name: 'A', slug: 'same' }).expect(201);
      const duplicate = await as(platformToken).post('/institutions').send({ name: 'B', slug: 'same' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('INSTITUTION_SLUG_TAKEN');
    });

    it('lists every institution for a Platform Admin and only their own for a member', async () => {
      const admin = await ctx.signInAs(Role.ADMIN, institutionId);

      const all = await as(platformToken).get('/institutions').expect(200);
      const mine = await as(admin.token).get('/institutions').expect(200);

      expect(all.body).toHaveLength(2);
      expect(mine.body.map((row: { id: string }) => row.id)).toEqual([institutionId]);
    });
  });

  describe('subjects and pensums', () => {
    it('lets an Institution Admin manage their own subjects and pensums', async () => {
      const admin = (await ctx.signInAs(Role.ADMIN, institutionId)).token;
      const api = as(admin, institutionId);

      const subject = await api.post('/subjects').send({ code: 'mat-101', name: 'Matemática I' }).expect(201);
      expect(subject.body).toMatchObject({ code: 'MAT-101', institutionId });
      await api.patch(`/subjects/${subject.body.id}`).send({ name: 'Matemática 1' }).expect(200);

      const pensum = await api.post('/pensums').send({ code: 'bach', name: 'Bachillerato' }).expect(201);
      const placed = await api
        .put(`/pensums/${pensum.body.id}/subjects/${subject.body.id}`)
        .send({ level: 1, weeklyHours: 5 })
        .expect(200);
      expect(placed.body.subjects).toEqual([
        { subjectId: subject.body.id, code: 'MAT-101', name: 'Matemática 1', level: 1, weeklyHours: 5, credits: null },
      ]);

      const inUse = await api.delete(`/subjects/${subject.body.id}`);
      expect(inUse.status).toBe(409);
      expect(inUse.body.code).toBe('SUBJECT_IN_USE');

      await api.delete(`/pensums/${pensum.body.id}/subjects/${subject.body.id}`).expect(204);
      await api.delete(`/subjects/${subject.body.id}`).expect(204);
      await api.patch(`/pensums/${pensum.body.id}`).send({ isActive: false }).expect(200);
      await api.delete(`/pensums/${pensum.body.id}`).expect(204);
    });

    it.each([Role.TEACHER, Role.STUDENT, Role.COORDINATOR])(
      'forbids a %s from managing subjects or pensums',
      async (role) => {
        const member = await ctx.signInAs(role, institutionId);
        const api = as(member.token, institutionId);

        await api.get('/subjects').expect(403);
        await api.post('/subjects').send({ code: 'X-1', name: 'X' }).expect(403);
        await api.post('/pensums').send({ code: 'P-1', name: 'P' }).expect(403);
        expect(ctx.subjects.rows).toHaveLength(0);
      },
    );

    it("keeps one institution's admin out of another institution's data", async () => {
      const mine = (await ctx.signInAs(Role.ADMIN, institutionId, 'mine@example.com')).token;
      const theirs = (await ctx.signInAs(Role.ADMIN, otherInstitutionId, 'theirs@example.com')).token;
      const subject = await as(theirs, otherInstitutionId)
        .post('/subjects')
        .send({ code: 'BIO-1', name: 'Biología' })
        .expect(201);

      // Naming the other institution in the header is refused outright
      await as(mine, otherInstitutionId).get('/subjects').expect(403);
      // Using my own institution with their ids finds nothing
      expect((await as(mine, institutionId).get('/subjects').expect(200)).body).toEqual([]);
      await as(mine, institutionId).patch(`/subjects/${subject.body.id}`).send({ name: 'Hijacked' }).expect(404);
      await as(mine, institutionId).delete(`/subjects/${subject.body.id}`).expect(404);
      expect(ctx.subjects.rows[0].name).toBe('Biología');
    });

    it('lets a Platform Admin act on any institution, but only by naming it', async () => {
      await as(platformToken, institutionId).post('/subjects').send({ code: 'HIS-1', name: 'Historia' }).expect(201);
      await as(platformToken).get('/subjects').expect(403);
      await as(platformToken, 'not-a-uuid').get('/subjects').expect(403);
    });

    it('validates subject and pensum input', async () => {
      const api = as((await ctx.signInAs(Role.ADMIN, institutionId)).token, institutionId);

      await api.post('/subjects').send({ code: 'has spaces', name: 'X' }).expect(400);
      await api.post('/subjects').send({ code: 'OK-1', name: '' }).expect(400);
      await api.post('/subjects').send({ code: 'OK-1', name: 'X', institutionId: otherInstitutionId }).expect(400);
      await api.post('/pensums').send({ code: 'P-1', name: 'P', version: 0 }).expect(400);
    });
  });

  describe('member registration', () => {
    it('lets an Institution Admin register a Student, who starts pending with a one-time password', async () => {
      const admin = (await ctx.signInAs(Role.ADMIN, institutionId)).token;

      const registered = await as(admin, institutionId)
        .post('/members')
        .send(newMember(Role.STUDENT, 'Grace@Example.com'))
        .expect(201);

      expect(registered.body.member).toMatchObject({
        email: 'grace@example.com',
        role: 'STUDENT',
        status: 'PENDING_ONBOARDING',
        isActive: false,
      });
      expect(registered.body.temporaryPassword).toEqual(expect.any(String));

      const listed = await as(admin, institutionId).get('/members').expect(200);
      expect(listed.body).toHaveLength(1);
      expect(JSON.stringify(listed.body)).not.toContain(registered.body.temporaryPassword);
      expect(JSON.stringify(listed.body)).not.toContain('passwordHash');
    });

    it('forbids an Institution Admin from creating another admin', async () => {
      const admin = (await ctx.signInAs(Role.ADMIN, institutionId)).token;

      const response = await as(admin, institutionId)
        .post('/members')
        .send(newMember(Role.ADMIN, 'second-admin@example.com'));

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MEMBER_ROLE_NOT_ALLOWED');
    });

    it('lets a Platform Admin appoint an Institution Admin, who can then register members', async () => {
      const appointed = await as(platformToken, institutionId)
        .post('/members')
        .send(newMember(Role.ADMIN, 'director@example.com'))
        .expect(201);
      expect(appointed.body.member).toMatchObject({ status: 'ACTIVE', isActive: true });

      const directorToken = await ctx.tokenAfterPasswordChange(
        'director@example.com',
        appointed.body.temporaryPassword,
      );

      await as(directorToken, institutionId)
        .post('/members')
        .send(newMember(Role.TEACHER, 'teacher@example.com'))
        .expect(201);
    });

    it('forbids Teachers and Students from registering or listing members', async () => {
      for (const role of [Role.TEACHER, Role.STUDENT]) {
        const member = await ctx.signInAs(role, institutionId);
        await as(member.token, institutionId).get('/members').expect(403);
        await as(member.token, institutionId).post('/members').send(newMember(Role.STUDENT, 'x@example.com')).expect(403);
      }
    });

    it("cannot register into, or list, another institution's members", async () => {
      const admin = (await ctx.signInAs(Role.ADMIN, institutionId)).token;

      await as(admin, otherInstitutionId).post('/members').send(newMember(Role.STUDENT, 'x@example.com')).expect(403);
      await as(admin, otherInstitutionId).get('/members').expect(403);
    });

    it('rejects the same role twice and invalid input', async () => {
      const api = as((await ctx.signInAs(Role.ADMIN, institutionId)).token, institutionId);
      await api.post('/members').send(newMember(Role.STUDENT, 'grace@example.com')).expect(201);

      const duplicate = await api.post('/members').send(newMember(Role.STUDENT, 'GRACE@example.com'));
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.code).toBe('MEMBER_ALREADY_REGISTERED');
      await api.post('/members').send({ ...newMember(Role.STUDENT, 'a@example.com'), role: 'OWNER' }).expect(400);
      await api.post('/members').send({ ...newMember(Role.STUDENT, 'a@example.com'), isPlatformAdmin: true }).expect(400);
    });
  });

  describe('ID check at the desk', () => {
    /** Registers a pending member at the desk; `membershipId` is what the desk checks next. */
    async function registered(deskToken: string, role: Role = Role.STUDENT, email = 'grace@example.com') {
      const response = await as(deskToken, institutionId).post('/members').send(newMember(role, email)).expect(201);
      return {
        email,
        membershipId: response.body.member.membershipId as string,
        temporaryPassword: response.body.temporaryPassword as string,
      };
    }
    const photograph = (deskToken: string, membershipId: string, institution = institutionId) =>
      as(deskToken, institution)
        .post(`/onboarding/members/${membershipId}/document`)
        .field('documentType', 'NATIONAL_ID')
        .attach('file', Buffer.from(JPEG_BYTES), 'id.jpg');
    const confirm = (deskToken: string, membershipId: string, institution = institutionId) =>
      as(deskToken, institution).post(`/onboarding/members/${membershipId}/confirm`).send(confirmation);

    it('runs the whole enrolment at the desk: register, photograph the ID, confirm, active at once', async () => {
      const desk = await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com');
      const student = await registered(desk.token);

      const read = await photograph(desk.token, student.membershipId).expect(200);
      expect(read.body.application).toMatchObject({
        status: 'PENDING_CONFIRMATION',
        extracted: { firstName: 'María Fernanda', documentNumber: '12345678' },
      });

      const confirmed = await confirm(desk.token, student.membershipId).expect(200);
      expect(confirmed.body.application.status).toBe('APPROVED');
      expect(ctx.applications.checks[0].verifierMembershipId).toBe(desk.membership.id);

      // The first sign-in is already an active Student, with the name from their ID
      const token = await ctx.tokenAfterPasswordChange(student.email, student.temporaryPassword);
      const me = await as(token).get('/auth/me').expect(200);
      expect(me.body).toMatchObject({
        status: 'ACTIVE',
        firstName: 'Grace Brewster',
        memberships: [{ institutionId, role: 'STUDENT' }],
      });
    });

    it('lets a Principal enrol Students and Guardians at the desk, but not staff', async () => {
      const principal = (await ctx.signInAs(Role.COORDINATOR, institutionId, 'principal@example.com')).token;
      const student = await registered(principal);

      await photograph(principal, student.membershipId).expect(200);
      await confirm(principal, student.membershipId).expect(200);
      await registered(principal, Role.GUARDIAN, 'guardian@example.com');
      const teacher = await as(principal, institutionId).post('/members').send(newMember(Role.TEACHER, 't@example.com'));
      expect(teacher.status).toBe(403);
      expect(teacher.body.code).toBe('MEMBER_ROLE_NOT_ALLOWED');
    });

    it('keeps the ID check of Teachers and staff for Institution Admins', async () => {
      const admin = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
      const staff = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      const teacher = await registered(admin, Role.TEACHER, 'teacher@example.com');

      const refused = await photograph(staff, teacher.membershipId);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('IDENTITY_CHECK_NOT_ALLOWED');
      await photograph(admin, teacher.membershipId).expect(200);
      await confirm(admin, teacher.membershipId).expect(200);
    });

    it('lets nobody else in, and hides members of other institutions', async () => {
      const admin = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
      const student = await registered(admin);
      const own = await ctx.tokenAfterPasswordChange(student.email, student.temporaryPassword);

      const teacher = (await ctx.signInAs(Role.TEACHER, institutionId, 'teacher@example.com')).token;
      await photograph(teacher, student.membershipId).expect(403);
      await confirm(teacher, student.membershipId).expect(403);
      // Nobody verifies themselves: a pending member holds no role
      await photograph(own, student.membershipId).expect(403);
      await confirm(own, student.membershipId).expect(403);

      const outsider = (await ctx.signInAs(Role.ADMIN, otherInstitutionId, 'outsider@example.com')).token;
      const hidden = await photograph(outsider, student.membershipId, otherInstitutionId);
      expect(hidden.status).toBe(404);
      expect(hidden.body.code).toBe('MEMBER_NOT_FOUND');
      await photograph(outsider, student.membershipId).expect(403);

      expect(ctx.storage.stored).toHaveLength(0);
    });

    it('checks a person once, and only after their ID was photographed', async () => {
      const desk = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      const student = await registered(desk);

      const early = await confirm(desk, student.membershipId);
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('NOTHING_TO_CONFIRM');

      await photograph(desk, student.membershipId).expect(200);
      await confirm(desk, student.membershipId).expect(200);
      const again = await photograph(desk, student.membershipId);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('IDENTITY_ALREADY_VERIFIED');
    });

    it('validates the confirmed data and the member id', async () => {
      const desk = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      const student = await registered(desk);
      await photograph(desk, student.membershipId).expect(200);
      const path = `/onboarding/members/${student.membershipId}/confirm`;

      await as(desk, institutionId).post(path).send({ ...confirmation, birthDate: '14/03/2008' }).expect(400);
      await as(desk, institutionId).post(path).send({ ...confirmation, documentType: 'LIBRARY_CARD' }).expect(400);
      await as(desk, institutionId).post('/onboarding/members/not-a-uuid/confirm').send(confirmation).expect(400);
    });

    // The 5 MB limit is covered by the use-case tests and, over real HTTP, by the Playwright suite.
    // Doing it here crashed the test process: with client and server in one process on Windows,
    // cutting a large upload off mid-stream aborts Node (exit 0xC0000409) about one run in ten.
    it('checks uploads by their bytes, not by the name or type the client sends', async () => {
      const desk = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      const student = await registered(desk);
      const upload = (content: Uint8Array, name: string, contentType: string) =>
        as(desk, institutionId)
          .post(`/onboarding/members/${student.membershipId}/document`)
          .field('documentType', 'NATIONAL_ID')
          .attach('file', Buffer.from(content), { filename: name, contentType });

      const disguised = await upload(new TextEncoder().encode('MZ not an image'), 'id.jpg', 'image/jpeg');
      expect(disguised.status).toBe(400);
      expect(disguised.body.code).toBe('UNSUPPORTED_DOCUMENT_IMAGE');

      expect(ctx.storage.stored).toHaveLength(0);

      // A real JPEG is accepted even when mislabelled
      await upload(JPEG_BYTES, 'id.exe', 'text/plain').expect(200);
    });

    it('offers no way for members to submit their own ID', async () => {
      const desk = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      const student = await registered(desk);
      const own = await ctx.tokenAfterPasswordChange(student.email, student.temporaryPassword);

      await as(own).get('/onboarding/application').expect(404);
      await as(own)
        .post('/onboarding/document')
        .field('documentType', 'NATIONAL_ID')
        .attach('file', Buffer.from(JPEG_BYTES), 'id.jpg')
        .expect(404);
    });
  });
});
