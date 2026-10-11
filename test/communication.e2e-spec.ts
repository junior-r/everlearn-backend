import type { AddressInfo } from 'node:net';
import { SchedulerRegistry } from '@nestjs/schedule';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { ReminderScheduler } from '../src/modules/notifications/infrastructure/reminder.scheduler.js';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const TEMPORARY_PASSWORD = 'temporary-password';

describe('Notifications, messages and export (HTTP)', () => {
  let ctx: TestApp;
  let institutionId: string;
  let otherInstitutionId: string;
  let adminToken: string;
  const sockets: Socket[] = [];

  const as = (token: string, institution: string | null = institutionId) => {
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

  async function member(role: Role, firstName: string, lastName = 'Prueba', institution = institutionId) {
    const email = `${firstName.toLowerCase()}.${institution.slice(0, 4)}@example.com`;
    const { membershipId, userId } = await ctx.members.register({
      institutionId: institution,
      email,
      firstName,
      lastName,
      passwordHash: `hashed:${TEMPORARY_PASSWORD}`,
      role,
      activate: true,
    });
    return { membershipId, userId, email, token: await ctx.tokenAfterPasswordChange(email, TEMPORARY_PASSWORD) };
  }

  /** 1ro A takes maths with Alan; Grace and Linus are enrolled; one draft evaluation exists. */
  async function seedCourse() {
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
    const alan = await member(Role.TEACHER, 'Alan', 'Turing');
    const grace = await member(Role.STUDENT, 'Grace', 'Hopper');
    const linus = await member(Role.STUDENT, 'Linus', 'Pauling');
    const coursePath = `/groups/${group.body.id}/courses/${math.body.id}`;
    await admin.put(coursePath).send({ teacherMembershipId: alan.membershipId }).expect(200);
    for (const student of [grace, linus]) {
      await admin.post(`/groups/${group.body.id}/students`).send({ membershipId: student.membershipId }).expect(200);
    }
    const exam = await as(alan.token)
      .post(`${coursePath}/evaluations`)
      .send({ title: 'Examen parcial', type: 'EXAM', weight: 60, maxScore: 20, dueAt: '2099-11-10T12:00:00.000Z' })
      .expect(201);
    return { alan, grace, linus, coursePath, examId: exam.body.id as string };
  }

  /** Opens the realtime connection a browser keeps, and waits until the server accepted or dropped it. */
  function connect(token: string | null): Promise<Socket> {
    const { port } = ctx.httpServer.address() as AddressInfo;
    const socket = io(`http://localhost:${port}/realtime`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => {
      socket.once(event, (payload: T) => resolve(payload));
    });

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    otherInstitutionId = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    await ctx.close();
  });

  describe('notifications', () => {
    it('tells enrolled Students, in the app and by email, when an evaluation is published', async () => {
      const { alan, grace, linus, examId } = await seedCourse();
      expect((await as(grace.token, null).get('/notifications').expect(200)).body).toEqual({ items: [], unread: 0 });

      await as(alan.token).post(`/evaluations/${examId}/publish`).expect(200);

      const mine = await as(grace.token, null).get('/notifications').expect(200);
      expect(mine.body.unread).toBe(1);
      expect(mine.body.items).toEqual([
        expect.objectContaining({
          type: 'EVALUATION_PUBLISHED',
          institutionId,
          read: false,
          data: {
            evaluationId: examId,
            evaluationTitle: 'Examen parcial',
            // The in-memory courses of the tests carry no subject name
            subjectName: '',
            groupName: '1ro A',
            dueAt: '2099-11-10T12:00:00.000Z',
          },
        }),
      ]);
      expect(mine.body.items[0]).not.toHaveProperty('userId');
      expect(ctx.emails.sent.map((email) => email.to).sort()).toEqual([grace.email, linus.email].sort());
      // The Teacher who published it is not told
      expect((await as(alan.token, null).get('/notifications').expect(200)).body.unread).toBe(0);
    });

    it('marks notices as read, one\'s own only', async () => {
      const { alan, grace, linus, examId } = await seedCourse();
      await as(alan.token).post(`/evaluations/${examId}/publish`).expect(200);
      const [linusNotice] = (await as(linus.token, null).get('/notifications')).body.items as Array<{ id: string }>;

      // Grace names Linus's notice: nothing of his changes
      await as(grace.token, null).post('/notifications/read').send({ ids: [linusNotice.id] }).expect(204);
      expect((await as(linus.token, null).get('/notifications')).body.unread).toBe(1);
      expect((await as(grace.token, null).get('/notifications')).body.unread).toBe(1);

      await as(grace.token, null).post('/notifications/read').send({}).expect(204);
      expect((await as(grace.token, null).get('/notifications')).body).toMatchObject({ unread: 0, items: [{ read: true }] });
      await as(grace.token, null).post('/notifications/read').send({ ids: ['not-an-id'] }).expect(400);
      await request(ctx.server).get('/notifications').expect(401);
    });

    it('pushes a nudge to the browsers a user has open', async () => {
      const { alan, grace, examId } = await seedCourse();
      const socket = await connect(grace.token);
      const nudge = nextEvent<null>(socket, 'notification');

      await as(alan.token).post(`/evaluations/${examId}/publish`).expect(200);

      await expect(nudge).resolves.toBeNull();
    });

    it('sends reminders once when the job runs, and does not schedule itself in tests', async () => {
      const { grace, linus, examId } = await seedCourse();
      ctx.reminders.evaluations = [
        {
          evaluationId: examId,
          institutionId,
          title: 'Examen parcial',
          subjectName: 'Matemática',
          groupName: '1ro A',
          dueAt: new Date(Date.now() + 3 * 3_600_000),
          studentMembershipIds: [grace.membershipId, linus.membershipId],
        },
      ];
      const scheduler = ctx.app.get(ReminderScheduler);

      await scheduler.run();
      await scheduler.run();

      const mine = await as(grace.token, null).get('/notifications').expect(200);
      expect(mine.body.items.map((notice: { type: string }) => notice.type)).toEqual(['EVALUATION_DUE']);
      expect(ctx.emails.sent.filter((email) => email.subject.startsWith('Mañana vence'))).toHaveLength(2);
      expect(ctx.app.get(SchedulerRegistry).getCronJobs().size).toBe(0);
    });
  });

  describe('direct messages', () => {
    it('lets two members of an institution find each other and talk', async () => {
      const { alan, grace } = await seedCourse();

      const found = await as(grace.token).get('/messages/contacts?query=tur').expect(200);
      expect(found.body).toEqual([{ userId: alan.userId, firstName: 'Alan', lastName: 'Turing', roles: ['TEACHER'] }]);

      const sent = await as(grace.token)
        .post(`/messages/conversations/${alan.userId}`)
        .send({ body: '  Profesor, tengo una duda.  ' })
        .expect(201);
      expect(sent.body).toMatchObject({ senderId: grace.userId, recipientId: alan.userId, body: 'Profesor, tengo una duda.' });

      // Alan was away: a notice and an email, which never carries the text
      const notices = await as(alan.token, null).get('/notifications').expect(200);
      expect(notices.body.items).toEqual([
        expect.objectContaining({ type: 'DIRECT_MESSAGE', data: { senderId: grace.userId, senderName: 'Grace Hopper' } }),
      ]);
      const email = ctx.emails.sent.find((candidate) => candidate.to === alan.email);
      expect(email?.subject).toBe('Nuevo mensaje de Grace Hopper');
      expect(email?.text).not.toContain('duda');

      const inbox = await as(alan.token).get('/messages/conversations').expect(200);
      expect(inbox.body).toEqual([
        expect.objectContaining({ peer: expect.objectContaining({ userId: grace.userId }), unread: 1 }),
      ]);

      // Opening the conversation reads it and clears the notice
      const opened = await as(alan.token).get(`/messages/conversations/${grace.userId}`).expect(200);
      expect(opened.body.messages.map((message: { body: string }) => message.body)).toEqual(['Profesor, tengo una duda.']);
      expect((await as(alan.token).get('/messages/conversations')).body[0].unread).toBe(0);
      expect((await as(alan.token, null).get('/notifications')).body.unread).toBe(0);
    });

    it('delivers a message live, and sends no notice to someone looking at the conversation', async () => {
      const { alan, grace } = await seedCourse();
      const alanSocket = await connect(alan.token);
      const graceSocket = await connect(grace.token);
      alanSocket.emit('viewing', `dm:${institutionId}:${grace.userId}`);
      // The server takes the event in order; a round trip makes sure it has
      await as(alan.token, null).get('/notifications').expect(200);
      const received = nextEvent<{ body: string; senderId: string }>(alanSocket, 'message');
      const echoed = nextEvent<{ body: string }>(graceSocket, 'message');

      await as(grace.token).post(`/messages/conversations/${alan.userId}`).send({ body: 'Hola' }).expect(201);

      await expect(received).resolves.toMatchObject({ body: 'Hola', senderId: grace.userId });
      await expect(echoed).resolves.toMatchObject({ body: 'Hola' });
      expect((await as(alan.token, null).get('/notifications')).body.items).toEqual([]);
      expect(ctx.emails.sent).toEqual([]);

      // Looking elsewhere, Alan gets a notice, but no email while he is connected
      alanSocket.emit('viewing', null);
      await as(alan.token, null).get('/notifications').expect(200);
      await as(grace.token).post(`/messages/conversations/${alan.userId}`).send({ body: '¿Sigue ahí?' }).expect(201);
      expect((await as(alan.token, null).get('/notifications')).body.unread).toBe(1);
      expect(ctx.emails.sent).toEqual([]);
    });

    it('refuses a realtime connection without a valid token', async () => {
      const dropped = (token: string | null) =>
        new Promise<string>((resolve) => {
          const { port } = ctx.httpServer.address() as AddressInfo;
          const socket = io(`http://localhost:${port}/realtime`, {
            auth: token ? { token } : {},
            transports: ['websocket'],
            reconnection: false,
          });
          sockets.push(socket);
          socket.once('disconnect', resolve);
          socket.once('connect_error', (error) => resolve(error.message));
        });

      await expect(dropped(null)).resolves.toBeDefined();
      await expect(dropped('not-a-token')).resolves.toBeDefined();
      expect(sockets.every((socket) => !socket.connected)).toBe(true);
    });

    it('keeps institutions apart: no contacts, no messages and no conversations across them', async () => {
      const { alan, grace } = await seedCourse();
      const emmy = await member(Role.TEACHER, 'Emmy', 'Noether', otherInstitutionId);

      expect((await as(grace.token).get('/messages/contacts?query=emmy').expect(200)).body).toEqual([]);
      const refused = await as(grace.token).post(`/messages/conversations/${emmy.userId}`).send({ body: 'Hola' }).expect(404);
      expect(refused.body.code).toBe('CONTACT_NOT_FOUND');
      await as(grace.token).get(`/messages/conversations/${emmy.userId}`).expect(404);
      // Naming an institution she does not belong to opens nothing
      await as(grace.token, otherInstitutionId).get('/messages/conversations').expect(403);
      await as(grace.token, otherInstitutionId).post(`/messages/conversations/${emmy.userId}`).send({ body: 'Hola' }).expect(403);
      // Writing to oneself, or without a body, is refused too
      await as(grace.token).post(`/messages/conversations/${grace.userId}`).send({ body: 'Hola' }).expect(404);
      await as(grace.token).post(`/messages/conversations/${alan.userId}`).send({ body: '' }).expect(400);
      await as(grace.token).post(`/messages/conversations/${alan.userId}`).send({ body: 'x'.repeat(2001) }).expect(400);
      await request(ctx.server).get('/messages/conversations').expect(401);
      expect(ctx.messages.messages).toEqual([]);
    });

    it('limits how fast a member may write', async () => {
      const { alan, grace } = await seedCourse();
      for (let sent = 0; sent < 30; sent += 1) {
        await as(grace.token).post(`/messages/conversations/${alan.userId}`).send({ body: `Mensaje ${sent}` }).expect(201);
      }

      const refused = await as(grace.token).post(`/messages/conversations/${alan.userId}`).send({ body: 'Uno más' }).expect(429);

      expect(refused.body.code).toBe('MESSAGES_TOO_FAST');
      expect(refused.headers['retry-after']).toBe('60');
      // However many arrived, Alan has a single unread notice from Grace
      expect((await as(alan.token, null).get('/notifications')).body.unread).toBe(1);
    });
  });

  describe('gradebook export', () => {
    it('downloads the gradebook as a CSV file in the language asked for', async () => {
      const { alan, grace, coursePath, examId } = await seedCourse();
      await as(alan.token).post(`/evaluations/${examId}/publish`).expect(200);
      await as(alan.token)
        .put(`/evaluations/${examId}/grades`)
        .send({ grades: [{ enrollmentId: grace.membershipId, score: 15.5 }] })
        .expect(204);

      const spanish = await as(alan.token).get(`${coursePath}/gradebook/export`).expect(200);
      const english = await as(alan.token).get(`${coursePath}/gradebook/export?lang=en`).expect(200);

      expect(spanish.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(spanish.headers['content-disposition']).toMatch(/^attachment; filename=".*1ro A\.csv"; filename\*=UTF-8''.*\.csv$/);
      expect(spanish.headers['cache-control']).toBe('no-store');
      expect(spanish.text.replace('﻿', '').split('\r\n')).toEqual([
        'Apellidos;Nombres;Examen parcial (60%, sobre 20);Promedio (%);Evaluado (% de la materia)',
        'Hopper;Grace;15,5;77,5;60',
        'Pauling;Linus;;;0',
        '',
      ]);
      expect(english.text).toContain('Last name,First name,"Examen parcial (60%, out of 20)",Average (%)');
      expect(english.text).toContain('Hopper,Grace,15.5,77.5,60');
    });

    it('is only for the Teacher of the course', async () => {
      const { grace, coursePath } = await seedCourse();
      const emmy = await member(Role.TEACHER, 'Emmy', 'Noether');

      await as(grace.token).get(`${coursePath}/gradebook/export`).expect(403);
      const refused = await as(emmy.token).get(`${coursePath}/gradebook/export`).expect(403);
      expect(refused.body.code).toBe('NOT_COURSE_TEACHER');
      await as(adminToken).get(`${coursePath}/gradebook/export`).expect(403);
      await as(emmy.token).get(`${coursePath}/gradebook/export?lang=fr`).expect(400);
    });
  });
});
