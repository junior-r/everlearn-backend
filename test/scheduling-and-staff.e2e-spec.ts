import request from 'supertest';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const at = (hour: number, minute = 0) => hour * 60 + minute;
const monday = (start: number, end: number) => ({ dayOfWeek: 'MONDAY', startMinute: start, endMinute: end });

describe('Staff permissions and scheduling (HTTP)', () => {
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

  const newMember = (role: Role, email: string) => ({ email, firstName: 'Grace', lastName: 'Hopper', role });

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('the registration hierarchy', () => {
    it('lets an Institution Admin register Directivos, Teachers, Staff and Students, but not Admins', async () => {
      const api = as(adminToken, institutionId);

      for (const role of [Role.COORDINATOR, Role.TEACHER, Role.STAFF, Role.STUDENT]) {
        const response = await api.post('/members').send(newMember(role, `${role}@example.com`));
        expect(response.status, role).toBe(201);
        expect(response.body.member).toMatchObject({ role, status: 'PENDING_ONBOARDING' });
      }
      const admin = await api.post('/members').send(newMember(Role.ADMIN, 'second@example.com'));
      expect(admin.status).toBe(403);
      expect(admin.body.code).toBe('MEMBER_ROLE_NOT_ALLOWED');
    });

    it('lets Staff list members and register Students only', async () => {
      const staff = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      const api = as(staff, institutionId);

      await api.get('/members').expect(200);
      await api.post('/members').send(newMember(Role.STUDENT, 'student@example.com')).expect(201);

      for (const role of [Role.TEACHER, Role.STAFF, Role.COORDINATOR, Role.ADMIN]) {
        const response = await api.post('/members').send(newMember(role, `${role}@example.com`));
        expect(response.status, role).toBe(403);
        expect(response.body.code).toBe('MEMBER_ROLE_NOT_ALLOWED');
      }
      expect(ctx.members.members).toHaveLength(1);
    });

    it('keeps Staff out of everything else in the admin API, and out of other institutions', async () => {
      const staff = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      const api = as(staff, institutionId);

      for (const path of ['/subjects', '/pensums', '/periods', '/groups', '/onboarding/applications/pending']) {
        await api.get(path).expect(403);
      }
      await api.post('/institutions').send({ name: 'X', slug: 'x-school' }).expect(403);
      await as(staff, otherInstitutionId).get('/members').expect(403);
      await as(staff, otherInstitutionId)
        .post('/members')
        .send(newMember(Role.STUDENT, 'x@example.com'))
        .expect(403);
    });

    it.each([Role.TEACHER, Role.STUDENT, Role.COORDINATOR])('gives a %s no access to member management', async (role) => {
      const member = (await ctx.signInAs(role, institutionId, `${role}@example.com`)).token;

      await as(member, institutionId).get('/members').expect(403);
      await as(member, institutionId).post('/members').send(newMember(Role.STUDENT, 'x@example.com')).expect(403);
    });

    it('lets a Platform Admin appoint the first Institution Admin of any institution', async () => {
      const platform = (await ctx.signInAsPlatformAdmin()).token;

      const appointed = await as(platform, otherInstitutionId)
        .post('/members')
        .send(newMember(Role.ADMIN, 'director@example.com'))
        .expect(201);

      expect(appointed.body.member).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', isActive: true });
    });
  });

  describe('scheduling', () => {
    async function seedTimetable() {
      const api = as(adminToken, institutionId);
      const math = await api.post('/subjects').send({ code: 'MAT-1', name: 'Matemática' }).expect(201);
      const physics = await api.post('/subjects').send({ code: 'FIS-1', name: 'Física' }).expect(201);
      const pensum = await api.post('/pensums').send({ code: 'BACH', name: 'Bachillerato' }).expect(201);
      for (const subject of [math, physics]) {
        await api
          .put(`/pensums/${pensum.body.id}/subjects/${subject.body.id}`)
          .send({ level: 1, weeklyHours: 4 })
          .expect(200);
      }
      const period = await api
        .post('/periods')
        .send({ name: '2026-2027', startDate: '2026-09-15', endDate: '2027-07-15' })
        .expect(201);
      const group = (name: string) =>
        api.post('/groups').send({ name, level: 1, pensumId: pensum.body.id, periodId: period.body.id }).expect(201);
      const groupA = await group('1ro A');
      const groupB = await group('1ro B');
      const teacher = async (email: string, firstName: string) =>
        (
          await ctx.members.register({
            institutionId,
            email,
            firstName,
            lastName: 'Prueba',
            passwordHash: 'unused',
            role: Role.TEACHER,
            activate: true,
          })
        ).membershipId;
      const alan = await teacher('alan@example.com', 'Alan');
      const emmy = await teacher('emmy@example.com', 'Emmy');
      const assign = (groupId: string, subjectId: string, teacherMembershipId: string) =>
        api.put(`/groups/${groupId}/courses/${subjectId}`).send({ teacherMembershipId }).expect(200);
      await assign(groupA.body.id, math.body.id, alan);
      await assign(groupB.body.id, math.body.id, alan);
      await assign(groupA.body.id, physics.body.id, emmy);
      const ids = {
        periodId: period.body.id as string,
        groupA: groupA.body.id as string,
        groupB: groupB.body.id as string,
        math: math.body.id as string,
        physics: physics.body.id as string,
        alan,
        emmy,
      };
      const setAvailability = (teacherId: string, windows: object[]) =>
        api.put(`/teachers/${teacherId}/availability`).send({ periodId: ids.periodId, windows });
      const book = (groupId: string, subjectId: string, range: object) =>
        api.post(`/groups/${groupId}/schedule`).send({ subjectId, ...range });
      return { api, ...ids, setAvailability, book };
    }

    it('stores a teacher availability, merging touching windows', async () => {
      const { api, alan, periodId, setAvailability } = await seedTimetable();

      const saved = await setAvailability(alan, [monday(at(8), at(10)), monday(at(10), at(12))]).expect(200);

      expect(saved.body).toEqual([monday(at(8), at(12))]);
      const read = await api.get(`/teachers/${alan}/availability?periodId=${periodId}`).expect(200);
      expect(read.body).toEqual(saved.body);
    });

    it('enforces the three scheduling rules with distinct error codes', async () => {
      const { alan, emmy, groupA, groupB, math, physics, setAvailability, book } = await seedTimetable();
      await setAvailability(alan, [monday(at(8), at(12))]).expect(200);
      await setAvailability(emmy, [monday(at(8), at(12))]).expect(200);

      const first = await book(groupA, math, { ...monday(at(8), at(10)), room: 'Aula 3' }).expect(201);
      expect(first.body).toHaveLength(1);
      expect(first.body[0]).toMatchObject({
        startMinute: at(8),
        endMinute: at(10),
        room: 'Aula 3',
        teacher: { membershipId: alan, firstName: 'Alan' },
      });

      const groupBusy = await book(groupA, physics, monday(at(9), at(11)));
      expect(groupBusy.status).toBe(409);
      expect(groupBusy.body.code).toBe('GROUP_SCHEDULE_CONFLICT');

      const teacherBusy = await book(groupB, math, monday(at(9), at(11)));
      expect(teacherBusy.status).toBe(409);
      expect(teacherBusy.body.code).toBe('TEACHER_SCHEDULE_CONFLICT');

      const unavailable = await book(groupB, math, monday(at(11), at(13)));
      expect(unavailable.status).toBe(409);
      expect(unavailable.body.code).toBe('OUTSIDE_TEACHER_AVAILABILITY');

      // Back-to-back with the first class is allowed for both the group and the teacher
      await book(groupA, physics, monday(at(10), at(11))).expect(201);
      await book(groupB, math, monday(at(10), at(12))).expect(201);
      expect(ctx.schedule.slots).toHaveLength(3);
    });

    it('requires a teacher on the subject, and an availability before anything can be booked', async () => {
      const { groupA, groupB, math, physics, book } = await seedTimetable();

      const noTeacher = await book(groupB, physics, monday(at(8), at(9)));
      expect(noTeacher.status).toBe(409);
      expect(noTeacher.body.code).toBe('COURSE_HAS_NO_TEACHER');

      const noAvailability = await book(groupA, math, monday(at(8), at(9)));
      expect(noAvailability.body.code).toBe('OUTSIDE_TEACHER_AVAILABILITY');
    });

    it('protects existing classes when availability or the teacher changes', async () => {
      const { api, alan, emmy, groupA, math, setAvailability, book } = await seedTimetable();
      await setAvailability(alan, [monday(at(8), at(12))]).expect(200);
      const booked = await book(groupA, math, monday(at(8), at(10))).expect(201);

      const shrink = await setAvailability(alan, [monday(at(9), at(12))]);
      expect(shrink.status).toBe(409);
      expect(shrink.body.code).toBe('AVAILABILITY_CONFLICTS_WITH_SCHEDULE');

      const swap = await api.put(`/groups/${groupA}/courses/${math}`).send({ teacherMembershipId: emmy });
      expect(swap.status).toBe(409);
      expect(swap.body.code).toBe('COURSE_HAS_SCHEDULE');

      const removed = await api.delete(`/groups/${groupA}/schedule/${booked.body[0].id}`).expect(200);
      expect(removed.body).toEqual([]);
      await api.put(`/groups/${groupA}/courses/${math}`).send({ teacherMembershipId: emmy }).expect(200);
    });

    it('validates input', async () => {
      const { api, alan, groupA, math, periodId, setAvailability, book } = await seedTimetable();

      await book(groupA, math, { dayOfWeek: 'FUNDAY', startMinute: 0, endMinute: 60 }).expect(400);
      await book(groupA, math, { ...monday(0, 60), startMinute: 1.5 }).expect(400);
      await book(groupA, 'not-a-uuid', monday(0, 60)).expect(400);
      const backwards = await book(groupA, math, monday(at(10), at(9)));
      expect(backwards.status).toBe(400);
      expect(backwards.body.code).toBe('INVALID_TIME_RANGE');
      await setAvailability(alan, [{ dayOfWeek: 'MONDAY', startMinute: -5, endMinute: 60 }]).expect(400);
      await api.get(`/teachers/${alan}/availability`).expect(400);
      await api.get(`/teachers/${alan}/availability?periodId=${periodId}`).expect(200);
    });

    it('is closed to everyone but Institution Admins of that institution', async () => {
      const { alan, groupA, math, periodId, setAvailability } = await seedTimetable();
      await setAvailability(alan, [monday(at(8), at(12))]).expect(200);
      const attempts = (token: string, institution: string) => [
        () => as(token, institution).get(`/groups/${groupA}/schedule`),
        () => as(token, institution).post(`/groups/${groupA}/schedule`).send({ subjectId: math, ...monday(at(8), at(9)) }),
        () => as(token, institution).get(`/teachers/${alan}/availability?periodId=${periodId}`),
        () => as(token, institution).put(`/teachers/${alan}/availability`).send({ periodId, windows: [] }),
      ];

      for (const role of [Role.TEACHER, Role.STAFF, Role.STUDENT]) {
        const member = (await ctx.signInAs(role, institutionId, `${role}@example.com`)).token;
        for (const attempt of attempts(member, institutionId)) {
          expect((await attempt()).status, role).toBe(403);
        }
      }

      // Another institution's admin sees none of it as theirs
      const outsider = (await ctx.signInAs(Role.ADMIN, otherInstitutionId, 'outsider@example.com')).token;
      for (const attempt of attempts(outsider, otherInstitutionId)) {
        expect((await attempt()).status).toBe(404);
      }
      expect(ctx.schedule.slots).toHaveLength(0);
      expect(ctx.availability.windows.get(`${alan}:${periodId}`)).toEqual([monday(at(8), at(12))]);
    });
  });
});
