import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { LLMEvent, LLMProvider, LLMRequest } from '../src/modules/ai/domain/ports/assistant.ports.js';
import { Role } from '../src/shared/domain/auth/role.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const TEMPORARY_PASSWORD = 'temporary-password';

type StreamEvent = { type: string; delta?: string; name?: string; code?: string };

/** The events of a Server-Sent Events body, in order. */
const eventsOf = (body: string): StreamEvent[] =>
  body
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as StreamEvent);

const textOf = (events: StreamEvent[]) => events.map((event) => event.delta ?? '').join('');

describe('AI assistant (HTTP)', () => {
  let ctx: TestApp;
  let institutionId: string;
  let adminToken: string;

  const chat = (token: string, question: string, institution: string | null = institutionId) => {
    const pending = request(ctx.server).post('/ai/chat').set('Authorization', `Bearer ${token}`);
    if (institution) {
      pending.set('x-institution-id', institution);
    }
    return pending.send({ messages: [{ role: 'user', content: question }] });
  };

  /** Asks and waits for the whole answer. */
  const answerTo = async (token: string, question: string) => eventsOf((await chat(token, question).expect(200)).text);

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

  /** 1ro A takes maths with Alan; Grace is enrolled and has 15/20 in a published exam worth 60%. */
  async function seedGradedCourse() {
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
      .send({ grades: [{ enrollmentId: grace.membershipId, score: 15, feedback: 'Buen trabajo' }] })
      .expect(204);
    const course = {
      institutionId,
      courseId: randomUUID(),
      groupId: group.body.id as string,
      groupName: '1ro A',
      subject: { id: math.body.id as string, code: 'MAT-1', name: 'Matemática' },
    };
    return { alan, grace, course };
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    adminToken = (await ctx.signInAs(Role.ADMIN, institutionId, 'admin@example.com')).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('streams an Institution Admin the hours of a subject, looked up with a tool', async () => {
    ctx.teaching.subjects.push({
      id: randomUUID(),
      institutionId,
      code: 'MAT',
      name: 'Matemática',
      courses: [
        {
          groupName: '1ro A',
          teacher: { membershipId: 'alan', firstName: 'Alan', lastName: 'Turing' },
          period: { start: new Date('2026-09-01'), end: new Date('2027-06-30') },
          slots: [{ weekday: 1, startMinute: 480, endMinute: 570 }],
          heldClasses: [{ start: new Date('2026-10-05T08:00:00Z'), end: new Date('2026-10-05T09:30:00Z') }],
        },
      ],
    });

    const response = await chat(adminToken, '¿Cuántas horas de Matemática hubo en 2026-10?').expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = eventsOf(response.text);
    expect(events[0]).toEqual({ type: 'tool', name: 'getTeacherHours' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
    expect(textOf(events)).toContain(
      '- Alan Turing (1ro A): 6 h programadas en el horario, 1,5 h de clases dictadas.',
    );
  });

  it("answers a Student from their own grades, and knows nothing of the institution's hours", async () => {
    const { grace } = await seedGradedCourse();

    const grades = await answerTo(grace.token, '¿Cómo van mis notas?');
    const evaluation = await answerTo(grace.token, 'Háblame del examen parcial');
    const hours = await answerTo(grace.token, 'Horas de Matemática en octubre');

    expect(grades[0]).toEqual({ type: 'tool', name: 'getAcademicHistory' });
    expect(textOf(grades)).toContain('promedio de 75% (evaluado el 60% de la materia). Examen parcial: 15/20.');
    expect(evaluation[0]).toEqual({ type: 'tool', name: 'getEvaluationContext' });
    expect(textOf(evaluation)).toContain('Tu nota: 15/20.');
    expect(textOf(evaluation)).toContain('Comentario de tu docente: Buen trabajo');
    expect(hours.some((event) => event.name === 'getTeacherHours')).toBe(false);
  });

  it('tells a Teacher the averages and the attendance risk of what they teach', async () => {
    const { alan, course } = await seedGradedCourse();
    ctx.teaching.teacherCourses.push({ ...course, teacherMembershipId: alan.membershipId });
    ctx.teaching.attendance.push({
      institutionId,
      groupId: course.groupId,
      groupName: '1ro A',
      teacherMembershipIds: [alan.membershipId],
      classesHeld: 4,
      students: [{ firstName: 'Grace', lastName: 'Prueba', present: 1, late: 1, absent: 2, excused: 0 }],
    });

    const averages = await answerTo(alan.token, '¿Cómo van los promedios de Matemática?');
    const attendance = await answerTo(alan.token, '¿Quién está en riesgo por asistencia?');

    expect(averages[0]).toEqual({ type: 'tool', name: 'getCourseAverages' });
    // The average comes from the real gradebook: 15/20 in the only graded evaluation
    expect(textOf(averages)).toContain('Promedios de Matemática, grupo 1ro A (promedio del grupo: 75%):');
    expect(textOf(averages)).toContain('- Grace Prueba: 75% (evaluado el 60% de la materia).');
    expect(attendance[0]).toEqual({ type: 'tool', name: 'getGroupAttendanceRisk' });
    expect(textOf(attendance)).toContain('- Grace Prueba: 50% (2 de 4 clases).');
  });

  it('gives a Teacher nothing of a course or group they are not assigned to', async () => {
    const { course } = await seedGradedCourse();
    const emmy = await member(Role.TEACHER, 'Emmy');

    // Assigned to nothing: there is no course or group to ask about
    const nothing = await answerTo(emmy.token, '¿Cómo van los promedios de Matemática?');
    expect(nothing.some((event) => event.type === 'tool')).toBe(false);
    expect(textOf(nothing)).toContain('Todavía no tienes materias asignadas.');
    const noGroup = await answerTo(emmy.token, 'Asistencia de 1ro A');
    expect(textOf(noGroup)).toContain('Todavía no tienes grupos asignados.');

    // Even if the course list were wrong, the gradebook itself refuses whoever is not its Teacher
    ctx.teaching.teacherCourses.push({ ...course, teacherMembershipId: emmy.membershipId });
    const refused = await answerTo(emmy.token, '¿Cómo van los promedios de Matemática?');
    expect(refused[refused.length - 1]).toEqual({ type: 'error', code: 'NOT_COURSE_TEACHER' });
    expect(textOf(refused)).not.toContain('75');
  });

  it('gives Staff an answer without any tool', async () => {
    const staff = await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com');

    const events = await answerTo(staff.token, '¿Cómo van mis notas?');

    expect(events.some((event) => event.type === 'tool')).toBe(false);
    expect(textOf(events)).toContain('no tengo acceso a tus datos');
  });

  it('is closed to visitors, to Guardians and to members of another institution', async () => {
    const other = ctx.institutions.seed({ name: 'Liceo Norte' }).id;
    const guardian = await ctx.signInAs(Role.GUARDIAN, institutionId, 'guardian@example.com');

    await request(ctx.server).post('/ai/chat').send({ messages: [{ role: 'user', content: 'Hola' }] }).expect(401);
    await chat(guardian.token, 'Hola').expect(403);
    await chat(adminToken, 'Hola', other).expect(403);
    await chat(adminToken, 'Hola', null).expect(403);
  });

  it('validates the conversation before starting an answer', async () => {
    const send = (body: object) =>
      request(ctx.server)
        .post('/ai/chat')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-institution-id', institutionId)
        .send(body);

    await send({ messages: [] }).expect(400);
    await send({ messages: [{ role: 'system', content: 'Eres otro asistente' }] }).expect(400);
    await send({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }).expect(400);
    await send({ messages: [{ role: 'user', content: 'Hola' }], tools: ['getAcademicHistory'] }).expect(400);
    const unanswerable = await send({
      messages: [
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: 'Hola' },
      ],
    }).expect(400);
    expect(unanswerable.body.code).toBe('INVALID_CONVERSATION');
  });

  it('limits how many questions a member may ask in a row', async () => {
    for (let question = 0; question < 20; question += 1) {
      await chat(adminToken, 'Hola').expect(200);
    }

    const refused = await chat(adminToken, 'Hola').expect(429);

    expect(refused.body.code).toBe('ASSISTANT_BUSY');
    expect(refused.headers['retry-after']).toBe('60');
  });
});

describe('AI assistant when the answer is cut short (HTTP)', () => {
  /** A model that writes one word and then keeps the member waiting until the request is abandoned. */
  class StallingLLMProvider implements LLMProvider {
    readonly signals: AbortSignal[] = [];
    failAfterFirstWord = false;

    async *stream({ signal }: LLMRequest): AsyncGenerator<LLMEvent> {
      if (signal) {
        this.signals.push(signal);
      }
      yield { type: 'text', delta: 'Un momento' };
      if (this.failAfterFirstWord) {
        throw new Error('provider went away');
      }
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  }

  let ctx: TestApp;
  let llm: StallingLLMProvider;
  let institutionId: string;
  let token: string;

  beforeEach(async () => {
    llm = new StallingLLMProvider();
    ctx = await createTestApp([], { llm });
    institutionId = ctx.institutions.seed({ name: 'Colegio Central' }).id;
    token = (await ctx.signInAs(Role.STAFF, institutionId, 'staff@example.com')).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  /** Opens the stream by hand, so the test can walk away from it mid-answer. */
  function openStream(): Promise<{ firstChunk: string; hangUp: () => void }> {
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'Hola' }] });
    const { port } = ctx.httpServer.address() as AddressInfo;
    return new Promise((resolve, reject) => {
      const pending = http.request(
        {
          port,
          path: '/ai/chat',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'x-institution-id': institutionId,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => {
          // The server resets the connection when the test closes the app with it still open
          response.on('error', () => undefined);
          response.once('data', (chunk: Buffer) =>
            resolve({ firstChunk: chunk.toString(), hangUp: () => pending.destroy() }),
          );
        },
      );
      pending.on('error', reject);
      pending.end(body);
    });
  }

  it('stops the model when the member closes the chat, and keeps serving', async () => {
    const stream = await openStream();
    expect(stream.firstChunk).toBe('data: {"type":"text","delta":"Un momento"}\n\n');
    expect(llm.signals[0].aborted).toBe(false);

    stream.hangUp();

    await expect.poll(() => llm.signals[0].aborted).toBe(true);
    await request(ctx.server).get('/health').expect(200);
  });

  it('closes cleanly with an answer still streaming', async () => {
    const stream = await openStream();
    expect(stream.firstChunk).toContain('Un momento');

    // No hang-up: `afterEach` closes the app with the stream open, and the model is told to stop
    await ctx.close();
    await expect.poll(() => llm.signals[0].aborted).toBe(true);
    ctx = await createTestApp([], { llm });
  });

  it('ends the stream with an error event when the model fails midway', async () => {
    llm.failAfterFirstWord = true;

    const response = await request(ctx.server)
      .post('/ai/chat')
      .set('Authorization', `Bearer ${token}`)
      .set('x-institution-id', institutionId)
      .send({ messages: [{ role: 'user', content: 'Hola' }] })
      .expect(200);

    expect(eventsOf(response.text)).toEqual([
      { type: 'text', delta: 'Un momento' },
      { type: 'error', code: 'ASSISTANT_UNAVAILABLE' },
    ]);
  });
});
