import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ArchiveNextRecordingUseCase } from '../src/modules/classroom/application/use-cases/recording.use-cases.js';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, TEST_INTERNAL_SECRET, TEST_PUBLIC_API_URL, type TestApp } from './support/test-app.js';

const TEMPORARY_PASSWORD = 'temporary-password';

describe('Virtual classroom (HTTP)', () => {
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
    };
  };

  /** An active member with a real Membership id, signed in with their own password. */
  async function member(role: Role, firstName: string, institution = institutionId) {
    const email = `${firstName.toLowerCase()}@example.com`;
    const { membershipId } = await ctx.members.register({
      institutionId: institution,
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
  async function seedClass() {
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
    const sessionsPath = `/groups/${group.body.id}/courses/${math.body.id}/sessions`;
    const started = await as(alan.token, institutionId).post(sessionsPath).expect(201);
    return { alan, grace, sessionsPath, sessionId: started.body.sessionId as string };
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

  describe('access tokens', () => {
    it('gives the assigned Teacher and an enrolled Student a token for the session room', async () => {
      const { alan, grace, sessionId } = await seedClass();

      const teacher = await as(alan.token, institutionId).post(`/class-sessions/${sessionId}/token`).expect(200);
      const student = await as(grace.token, institutionId).post(`/class-sessions/${sessionId}/token`).expect(200);

      expect(teacher.body).toMatchObject({
        token: `token-for-${alan.membershipId}`,
        roomName: `class-${sessionId}`,
        identity: alan.membershipId,
        role: 'TEACHER',
        groupName: '1ro A',
      });
      expect(student.body).toMatchObject({ identity: grace.membershipId, role: 'STUDENT' });
      expect(ctx.videoTokens.grants.map((grant) => grant.canModerate)).toEqual([true, false]);
    });

    it('refuses a Student of another group and a Teacher of another subject', async () => {
      const { sessionId } = await seedClass();
      const linus = await member(Role.STUDENT, 'Linus');
      const emmy = await member(Role.TEACHER, 'Emmy');

      for (const outsider of [linus, emmy]) {
        const response = await as(outsider.token, institutionId).post(`/class-sessions/${sessionId}/token`);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('NOT_CLASS_PARTICIPANT');
      }
      expect(ctx.videoTokens.grants).toHaveLength(0);
    });

    it('refuses roles that neither teach nor study, and a Platform Admin', async () => {
      const { sessionId } = await seedClass();
      const path = `/class-sessions/${sessionId}/token`;

      await request(ctx.server).post(path).expect(401);
      await as(adminToken, institutionId).post(path).expect(403);
      // One more role only: the test app allows five sign-ins per client
      const staff = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
      await as(staff, institutionId).post(path).expect(403);
      const platform = (await ctx.signInAsPlatformAdmin()).token;
      await as(platform, institutionId).post(path).expect(403);
      expect(ctx.videoTokens.grants).toHaveLength(0);
    });

    it('hides a session from the members of another institution', async () => {
      const { alan, sessionId } = await seedClass();
      const outsider = await member(Role.TEACHER, 'Katherine', otherInstitutionId);

      const response = await as(outsider.token, otherInstitutionId).post(`/class-sessions/${sessionId}/token`);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('CLASS_SESSION_NOT_FOUND');
      // Naming an institution the Teacher does not belong to gets no further than the guard
      await as(alan.token, otherInstitutionId).post(`/class-sessions/${sessionId}/token`).expect(403);
      await as(alan.token, institutionId).post('/class-sessions/not-a-uuid/token').expect(400);
    });

    it('lets only the assigned Teacher start the class, and lists it for those who take part', async () => {
      const { alan, grace, sessionsPath, sessionId } = await seedClass();
      const emmy = await member(Role.TEACHER, 'Emmy');

      await as(grace.token, institutionId).post(sessionsPath).expect(403);
      const refused = await as(emmy.token, institutionId).post(sessionsPath).expect(403);
      expect(refused.body.code).toBe('NOT_COURSE_TEACHER');
      // Starting again while it is open is the same class
      const again = await as(alan.token, institutionId).post(sessionsPath).expect(201);
      expect(again.body.sessionId).toBe(sessionId);

      const attending = await as(grace.token, institutionId).get('/classroom/courses').expect(200);
      expect(attending.body).toEqual([
        expect.objectContaining({ groupName: '1ro A', role: 'STUDENT', openSessionId: sessionId }),
      ]);
      const unrelated = await as(emmy.token, institutionId).get('/classroom/courses').expect(200);
      expect(unrelated.body).toEqual([]);
      await as(adminToken, institutionId).get('/classroom/courses').expect(403);
    });
  });

  describe('internal API for the video-server', () => {
    const internal = (path: string, secret: string | null = TEST_INTERNAL_SECRET) => {
      const pending = request(ctx.server).post(`/internal/classroom/sessions/${path}`);
      return secret === null ? pending : pending.set('X-Internal-Secret', secret);
    };

    it('admits only the shared service secret, never a user session', async () => {
      const { alan, sessionId } = await seedClass();
      const body = { startedAt: '2026-10-12T08:00:00.000Z' };

      await internal(`${sessionId}/started`, null).send(body).expect(401);
      await internal(`${sessionId}/started`, 'wrong-secret').send(body).expect(401);
      await internal(`${sessionId}/started`, null)
        .set('Authorization', `Bearer ${alan.token}`)
        .send(body)
        .expect(401);
      await internal(`${sessionId}/started`, null)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-institution-id', institutionId)
        .send(body)
        .expect(401);
      expect(ctx.classroom.sessions[0].status).toBe('SCHEDULED');

      await internal(`${sessionId}/started`).send(body).expect(204);
      expect(ctx.classroom.sessions[0].status).toBe('LIVE');
    });

    it('stores attendance, chat and transcripts, and closes the class when the room finishes', async () => {
      const { alan, grace, sessionId } = await seedClass();
      const stay = {
        membershipId: grace.membershipId,
        participantSid: 'PA_grace',
        joinedAt: '2026-10-12T08:02:00.000Z',
      };
      const chatId = randomUUID();

      await internal(`${sessionId}/started`).send({ startedAt: '2026-10-12T08:00:00.000Z' }).expect(204);
      await internal(`${sessionId}/participants/joined`).send(stay).expect(204);
      await internal(`${sessionId}/chat-messages`)
        .send({ id: chatId, senderId: grace.membershipId, content: 'Hola', sentAt: '2026-10-12T08:03:00.000Z' })
        .expect(204);
      await internal(`${sessionId}/transcript-segments`)
        .send({
          id: randomUUID(),
          speakerId: alan.membershipId,
          text: 'Buenos días',
          language: 'es',
          startedAt: '2026-10-12T08:03:00.000Z',
          endedAt: '2026-10-12T08:03:04.000Z',
        })
        .expect(204);
      await internal(`${sessionId}/participants/left`)
        .send({ ...stay, leftAt: '2026-10-12T08:40:00.000Z' })
        .expect(204);
      await internal(`${sessionId}/finished`).send({ endedAt: '2026-10-12T08:45:00.000Z' }).expect(204);

      expect(ctx.classroom.participations).toEqual([
        {
          sessionId,
          membershipId: grace.membershipId,
          participantSid: 'PA_grace',
          joinedAt: new Date('2026-10-12T08:02:00.000Z'),
          leftAt: new Date('2026-10-12T08:40:00.000Z'),
        },
      ]);
      // 38 of the 45 minutes: more than half the class
      expect([...ctx.classroom.attendance]).toEqual([[`${sessionId}:${grace.membershipId}`, 'PRESENT']]);
      expect(ctx.classroom.chatMessages).toEqual([expect.objectContaining({ id: chatId, content: 'Hola' })]);
      expect(ctx.classroom.transcriptSegments).toEqual([
        expect.objectContaining({ speakerId: alan.membershipId, text: 'Buenos días' }),
      ]);
      expect(ctx.classroom.sessions[0].status).toBe('COMPLETED');
      // A message taken down is reported once more, and a retried report changes nothing
      const removal = { id: chatId, deletedById: alan.membershipId, deletedAt: '2026-10-12T08:04:00.000Z' };
      await internal(`${sessionId}/chat-messages/deleted`).send(removal).expect(204);
      await internal(`${sessionId}/chat-messages/deleted`).send(removal).expect(204);
      await internal(`${sessionId}/chat-messages/deleted`).send({ ...removal, id: 'nope' }).expect(400);
      expect(ctx.classroom.removedChatMessages).toEqual([
        expect.objectContaining({ id: chatId, deletedById: alan.membershipId }),
      ]);
      // The class is over, so nobody gets in any more
      const late = await as(grace.token, institutionId).post(`/class-sessions/${sessionId}/token`);
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('CLASS_SESSION_CLOSED');
    });

    it('rejects malformed reports and reports about a session that does not exist', async () => {
      const { grace, sessionId } = await seedClass();

      await internal(`${sessionId}/participants/joined`)
        .send({ membershipId: 'not-a-uuid', participantSid: 'PA_1', joinedAt: '2026-10-12T08:00:00.000Z' })
        .expect(400);
      await internal(`${sessionId}/chat-messages`)
        .send({ id: randomUUID(), senderId: grace.membershipId, content: '', sentAt: '2026-10-12T08:00:00.000Z' })
        .expect(400);
      await internal(`${sessionId}/started`).send({ startedAt: 'yesterday' }).expect(400);
      await internal(`${sessionId}/started`).send({ startedAt: '2026-10-12T08:00:00.000Z', extra: 1 }).expect(400);

      const unknown = await internal(`${randomUUID()}/finished`).send({ endedAt: '2026-10-12T08:00:00.000Z' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('CLASS_SESSION_NOT_FOUND');
      expect(ctx.classroom.participations).toHaveLength(0);
    });
  });

  describe('transcripts of past classes', () => {
    /** Alan's class, with one line said and the room finished. */
    async function givenClass() {
      const seeded = await seedClass();
      const report = (path: string) =>
        request(ctx.server)
          .post(`/internal/classroom/sessions/${seeded.sessionId}/${path}`)
          .set('X-Internal-Secret', TEST_INTERNAL_SECRET);
      await report('started').send({ startedAt: '2026-10-12T08:00:00.000Z' }).expect(204);
      await report('transcript-segments')
        .send({
          id: randomUUID(),
          speakerId: seeded.alan.membershipId,
          text: 'Buenos días',
          language: 'es',
          startedAt: '2026-10-12T08:03:00.000Z',
          endedAt: '2026-10-12T08:03:04.000Z',
        })
        .expect(204);
      await report('finished').send({ endedAt: '2026-10-12T08:45:00.000Z' }).expect(204);
      return { ...seeded, transcriptsPath: seeded.sessionsPath.replace(/sessions$/, 'transcripts') };
    }

    it('lets the Teacher and the Students of the group list and read what was said', async () => {
      const { alan, grace, sessionId, transcriptsPath } = await givenClass();

      for (const reader of [alan, grace]) {
        const list = await as(reader.token, institutionId).get(transcriptsPath).expect(200);
        expect(list.body).toMatchObject({
          groupName: '1ro A',
          sessions: [{ sessionId, startsAt: '2026-10-12T08:00:00.000Z', lines: 1 }],
        });
        const transcript = await as(reader.token, institutionId).get(`/class-sessions/${sessionId}/transcript`).expect(200);
        expect(transcript.body.lines).toEqual([
          expect.objectContaining({ speakerName: 'Alan Prueba', text: 'Buenos días', startedAt: '2026-10-12T08:03:00.000Z' }),
        ]);
      }
    });

    it('is not found for a Student of another group or another institution, and closed to other roles', async () => {
      const { sessionId, transcriptsPath } = await givenClass();
      const linus = await member(Role.STUDENT, 'Linus');
      const outsider = await member(Role.TEACHER, 'Katherine', otherInstitutionId);

      const listed = await as(linus.token, institutionId).get(transcriptsPath).expect(404);
      expect(listed.body.code).toBe('COURSE_NOT_FOUND');
      const read = await as(linus.token, institutionId).get(`/class-sessions/${sessionId}/transcript`).expect(404);
      expect(read.body.code).toBe('CLASS_SESSION_NOT_FOUND');
      await as(outsider.token, otherInstitutionId).get(`/class-sessions/${sessionId}/transcript`).expect(404);
      await as(adminToken, institutionId).get(`/class-sessions/${sessionId}/transcript`).expect(403);
      await request(ctx.server).get(`/class-sessions/${sessionId}/transcript`).expect(401);
    });
  });

  describe('recordings of past classes', () => {
    const CLASS = Buffer.from('0123456789'.repeat(100));

    /** Alan's class, recorded by Egress into a file the spool holds, and stored. */
    async function givenRecordedClass() {
      const seeded = await seedClass();
      const file = `${seeded.sessionId}/${randomUUID()}.mp4`;
      ctx.recordingSpool.files.set(file, CLASS);
      const report = {
        egressId: 'EG_recorded',
        file,
        startedAt: '2026-10-12T08:01:00.000Z',
        endedAt: '2026-10-12T08:44:00.000Z',
        sizeBytes: CLASS.length,
      };
      const internal = () =>
        request(ctx.server)
          .post(`/internal/classroom/sessions/${seeded.sessionId}/recordings`)
          .set('X-Internal-Secret', TEST_INTERNAL_SECRET);
      await internal().send(report).expect(204);
      // Delivered twice by the outbox: still one recording
      await internal().send(report).expect(204);
      expect(await ctx.app.get(ArchiveNextRecordingUseCase).execute()).toBe('STORED');
      return { ...seeded, report, recordingsPath: seeded.sessionsPath.replace(/sessions$/, 'recordings') };
    }

    it('lets only the Teacher of the class record it', async () => {
      const { alan, grace, sessionId } = await seedClass();

      const teacher = await as(alan.token, institutionId).post(`/class-sessions/${sessionId}/token`).expect(200);
      const student = await as(grace.token, institutionId).post(`/class-sessions/${sessionId}/token`).expect(200);

      expect(teacher.body.canRecord).toBe(true);
      expect(student.body.canRecord).toBe(false);
      expect(ctx.videoTokens.grants.map((grant) => grant.canRecord)).toEqual([true, false]);
    });

    it('stores a finished recording once, and lists it for the Teacher and the Students of the group', async () => {
      const { alan, grace, sessionId, recordingsPath } = await givenRecordedClass();

      expect(ctx.recordings.rows).toHaveLength(1);
      expect(ctx.recordingSpool.files.size).toBe(0);
      for (const viewer of [alan, grace]) {
        const list = await as(viewer.token, institutionId).get(recordingsPath).expect(200);
        expect(list.body).toMatchObject({
          groupName: '1ro A',
          recordings: [
            {
              sessionId,
              startedAt: '2026-10-12T08:01:00.000Z',
              endedAt: '2026-10-12T08:44:00.000Z',
              sizeBytes: CLASS.length,
            },
          ],
        });
      }
      const notices = ctx.notifications.rows.filter((notice) => notice.type === 'RECORDING_READY');
      expect(notices).toHaveLength(2);
    });

    it('plays the file through a signed link that serves byte ranges, and downloads it when asked', async () => {
      const { grace, recordingsPath } = await givenRecordedClass();
      const [recording] = (await as(grace.token, institutionId).get(recordingsPath).expect(200)).body.recordings;
      const linkOf = async (query: string) => {
        const link = await as(grace.token, institutionId).get(`/class-recordings/${recording.id}/link${query}`).expect(200);
        expect(link.body.url.startsWith(`${TEST_PUBLIC_API_URL}/recordings/media/`)).toBe(true);
        return (link.body.url as string).slice(TEST_PUBLIC_API_URL.length);
      };

      const play = await linkOf('');
      const whole = await request(ctx.server).get(play).expect(200);
      expect(whole.headers['content-type']).toBe('video/mp4');
      expect(whole.headers['content-disposition']).toMatch(/^inline; filename=".*1ro-A-2026-10-12\.mp4"$/);
      expect(Buffer.from(whole.body as Buffer).equals(CLASS)).toBe(true);
      const part = await request(ctx.server).get(play).set('Range', 'bytes=10-19').expect(206);
      expect(part.headers['content-range']).toBe(`bytes 10-19/${CLASS.length}`);

      const save = await request(ctx.server).get(await linkOf('?download=true')).expect(200);
      expect(save.headers['content-disposition']).toMatch(/^attachment; /);
      await request(ctx.server).get(`${play}x`).expect(404);
    });

    it('is not found for a Student of another group or another institution, and closed to other roles', async () => {
      const { recordingsPath } = await givenRecordedClass();
      const [recording] = ctx.recordings.rows;
      const linus = await member(Role.STUDENT, 'Linus');
      const outsider = await member(Role.TEACHER, 'Katherine', otherInstitutionId);

      const listed = await as(linus.token, institutionId).get(recordingsPath).expect(404);
      expect(listed.body.code).toBe('COURSE_NOT_FOUND');
      const link = await as(linus.token, institutionId).get(`/class-recordings/${recording.id}/link`).expect(404);
      expect(link.body.code).toBe('RECORDING_NOT_FOUND');
      await as(outsider.token, otherInstitutionId).get(`/class-recordings/${recording.id}/link`).expect(404);
      await as(adminToken, institutionId).get(`/class-recordings/${recording.id}/link`).expect(403);
      await request(ctx.server).get(`/class-recordings/${recording.id}/link`).expect(401);
    });

    it('refuses a report of a file the video-server did not name for that session', async () => {
      const { sessionId } = await seedClass();

      const refused = await request(ctx.server)
        .post(`/internal/classroom/sessions/${sessionId}/recordings`)
        .set('X-Internal-Secret', TEST_INTERNAL_SECRET)
        .send({
          egressId: 'EG_other',
          file: `${randomUUID()}/${randomUUID()}.mp4`,
          startedAt: '2026-10-12T08:01:00.000Z',
          endedAt: '2026-10-12T08:44:00.000Z',
          sizeBytes: 10,
        })
        .expect(400);
      expect(refused.body.code).toBe('INVALID_SESSION_EVENT');
      await request(ctx.server)
        .post(`/internal/classroom/sessions/${sessionId}/recordings`)
        .send({})
        .expect(401);
    });
  });
});
