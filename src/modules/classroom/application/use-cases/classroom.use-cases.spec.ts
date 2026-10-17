import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { createAdminFakes } from '../../../../../test/support/admin.fakes.js';
import {
  FakeVideoTokenIssuer,
  InMemoryClassroomRepository,
} from '../../../../../test/support/classroom.fakes.js';
import { RecordingNotifier } from '../../../../../test/support/communication.fakes.js';
import {
  InMemoryGroupRepository,
  InMemoryMemberDirectory,
  InMemoryPeriodRepository,
} from '../../../../../test/support/group.fakes.js';
import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  ClassNotHeldYetException,
  ClassSessionClosedException,
  ClassSessionNotFoundException,
  CourseNotFoundException,
  InvalidSessionEventException,
  NotClassParticipantException,
  NotCourseTeacherException,
  secondsConnected,
  StudentNotInClassException,
  SessionStatus,
  VideoUnavailableException,
} from '../../domain/classroom.js';
import { LiveKitTokenIssuer } from '../../infrastructure/livekit-token-issuer.js';
import { GetSessionAttendanceUseCase, RecordAttendanceByHandUseCase } from './attendance.use-cases.js';
import {
  IssueClassroomTokenUseCase,
  ListCourseSessionsUseCase,
  ListMyCoursesUseCase,
  RecordHeldClassUseCase,
  StartClassSessionUseCase,
} from './classroom.use-cases.js';
import {
  RecordChatMessageUseCase,
  RemoveChatMessageUseCase,
  RecordParticipationUseCase,
  RecordRoomLifecycleUseCase,
  RecordTranscriptSegmentUseCase,
} from './session-recording.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const MATH = 'subject-math';
const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 8, minute));

/** One group of institution A taking maths with Alan, with Grace enrolled; Emmy and Linus are outsiders. */
function setup() {
  const directory = new InMemoryMemberDirectory();
  const groups = new InMemoryGroupRepository(
    createAdminFakes().pensums,
    new InMemoryPeriodRepository(),
    directory,
  );
  const classroom = new InMemoryClassroomRepository(groups, directory);
  const tokens = new FakeVideoTokenIssuer();
  // Institution A may use two labs; the Teacher's token lists them, a Student's none
  const labs = { keysFor: (institutionId: string) => Promise.resolve(institutionId === A ? ['gravity', 'completions'] : []) };
  const notifier = new RecordingNotifier();
  const claim = (institutionId: string, role: Role, firstName: string): MembershipClaim => ({
    id: directory.add(institutionId, role, firstName, 'Prueba').membershipId,
    institutionId,
    role,
  });
  const alan = claim(A, Role.TEACHER, 'Alan');
  const emmy = claim(A, Role.TEACHER, 'Emmy');
  const grace = claim(A, Role.STUDENT, 'Grace');
  const linus = claim(A, Role.STUDENT, 'Linus');
  const groupId = randomUUID();
  groups.rows.push({
    id: groupId,
    institutionId: A,
    name: '1ro A',
    level: 1,
    capacity: null,
    pensumId: 'pensum',
    periodId: 'period',
    teachers: new Map([[MATH, alan.id]]),
    studentIds: [grace.id],
  });
  const start = new StartClassSessionUseCase(classroom);
  const open = async () =>
    (await start.execute({ institutionId: A, memberships: [alan], groupId, subjectId: MATH })).sessionId;
  return {
    classroom,
    tokens,
    notifier,
    groupId,
    alan,
    emmy,
    grace,
    linus,
    start,
    open,
    list: new ListMyCoursesUseCase(classroom),
    sessions: new ListCourseSessionsUseCase(classroom),
    held: new RecordHeldClassUseCase(classroom),
    issue: new IssueClassroomTokenUseCase(classroom, tokens, labs),
    lifecycle: new RecordRoomLifecycleUseCase(classroom, notifier),
    sheet: new GetSessionAttendanceUseCase(classroom),
    byHand: new RecordAttendanceByHandUseCase(classroom, notifier),
    participation: new RecordParticipationUseCase(classroom),
    chat: new RecordChatMessageUseCase(classroom),
    chatRemoval: new RemoveChatMessageUseCase(classroom),
    transcript: new RecordTranscriptSegmentUseCase(classroom),
  };
}

describe('starting a class', () => {
  it('lets the assigned Teacher open a session, and returns the same one while it is open', async () => {
    const ctx = setup();
    const input = { institutionId: A, memberships: [ctx.alan], groupId: ctx.groupId, subjectId: MATH };

    const first = await ctx.start.execute(input, at(0));
    const again = await ctx.start.execute(input, at(5));

    expect(again).toEqual(first);
    expect(ctx.classroom.sessions).toHaveLength(1);
    expect(ctx.classroom.sessions[0]).toMatchObject({
      status: SessionStatus.SCHEDULED,
      startsAt: at(0),
      endsAt: at(60),
    });
  });

  it('opens a new session once the previous class has ended', async () => {
    const ctx = setup();
    const first = await ctx.open();
    await ctx.lifecycle.finished(first, at(50));

    expect(await ctx.open()).not.toBe(first);
  });

  it('refuses another Teacher, a Student, and a Teacher role held in another institution', async () => {
    const ctx = setup();
    const attempt = (memberships: MembershipClaim[]) =>
      ctx.start.execute({ institutionId: A, memberships, groupId: ctx.groupId, subjectId: MATH });

    await expect(attempt([ctx.emmy])).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(attempt([ctx.grace])).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(attempt([{ ...ctx.alan, institutionId: B }])).rejects.toBeInstanceOf(
      NotCourseTeacherException,
    );
    expect(ctx.classroom.sessions).toHaveLength(0);
  });

  it('reports a group of another institution, or a subject with no Teacher, as not found', async () => {
    const ctx = setup();
    const attempt = (institutionId: string, subjectId: string) =>
      ctx.start.execute({ institutionId, memberships: [ctx.alan], groupId: ctx.groupId, subjectId });

    await expect(attempt(B, MATH)).rejects.toBeInstanceOf(CourseNotFoundException);
    await expect(attempt(A, 'subject-physics')).rejects.toBeInstanceOf(CourseNotFoundException);
  });
});

describe('listing my courses', () => {
  it('shows a Teacher what they teach and a Student what they attend, with the open session', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    const teaching = await ctx.list.execute(A, [ctx.alan]);
    const attending = await ctx.list.execute(A, [ctx.grace]);

    expect(teaching).toEqual([
      expect.objectContaining({ groupId: ctx.groupId, role: 'TEACHER', openSessionId: sessionId }),
    ]);
    expect(attending).toEqual([
      expect.objectContaining({ groupId: ctx.groupId, role: 'STUDENT', openSessionId: sessionId }),
    ]);
    expect(attending[0].teacher).toMatchObject({ membershipId: ctx.alan.id, firstName: 'Alan' });
  });

  it('shows nothing to members with no part in the group, or acting in another institution', async () => {
    const ctx = setup();

    expect(await ctx.list.execute(A, [ctx.emmy, ctx.linus])).toEqual([]);
    expect(await ctx.list.execute(B, [ctx.alan])).toEqual([]);
  });
});

describe('entering a class', () => {
  it('gives the assigned Teacher a moderator token whose identity is their Membership id', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    const access = await ctx.issue.execute(A, [ctx.alan], sessionId);

    expect(access).toMatchObject({
      token: `token-for-${ctx.alan.id}`,
      roomName: `class-${sessionId}`,
      identity: ctx.alan.id,
      role: 'TEACHER',
      groupName: '1ro A',
    });
    expect(ctx.tokens.grants).toEqual([
      {
        roomName: `class-${sessionId}`,
        identity: ctx.alan.id,
        displayName: 'Alan Prueba',
        canModerate: true,
        shareableLabs: ['gravity', 'completions'],
      },
    ]);
  });

  it('gives an enrolled Student a token without moderation rights', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    const access = await ctx.issue.execute(A, [ctx.grace], sessionId);

    expect(access).toMatchObject({ identity: ctx.grace.id, role: 'STUDENT' });
    expect(ctx.tokens.grants[0]).toMatchObject({ identity: ctx.grace.id, canModerate: false, shareableLabs: [] });
  });

  it('picks the membership that takes part when the person holds several', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    const access = await ctx.issue.execute(A, [ctx.linus, ctx.emmy, ctx.grace], sessionId);

    expect(access.identity).toBe(ctx.grace.id);
  });

  it('refuses a Student who is not enrolled and a Teacher who is not assigned', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    for (const outsider of [ctx.linus, ctx.emmy]) {
      await expect(ctx.issue.execute(A, [outsider], sessionId)).rejects.toBeInstanceOf(
        NotClassParticipantException,
      );
    }
    expect(ctx.tokens.grants).toHaveLength(0);
  });

  it('refuses a membership id that is right but belongs to another institution', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    await expect(
      ctx.issue.execute(A, [{ ...ctx.alan, institutionId: B }], sessionId),
    ).rejects.toBeInstanceOf(NotClassParticipantException);
  });

  it('reports a session of another institution as not found', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    await expect(ctx.issue.execute(B, [ctx.alan], sessionId)).rejects.toBeInstanceOf(
      ClassSessionNotFoundException,
    );
    await expect(ctx.issue.execute(A, [ctx.alan], randomUUID())).rejects.toBeInstanceOf(
      ClassSessionNotFoundException,
    );
  });

  it('refuses everyone once the class has ended, without revealing that to outsiders', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    await ctx.lifecycle.finished(sessionId, at(45));

    await expect(ctx.issue.execute(A, [ctx.grace], sessionId)).rejects.toBeInstanceOf(
      ClassSessionClosedException,
    );
    await expect(ctx.issue.execute(A, [ctx.linus], sessionId)).rejects.toBeInstanceOf(
      NotClassParticipantException,
    );
  });
});

describe('recording a live class', () => {
  it('moves the session to live and then to completed, ignoring repeated reports', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    await ctx.lifecycle.started(sessionId, at(1));
    await ctx.lifecycle.started(sessionId, at(9));
    expect(ctx.classroom.sessions[0]).toMatchObject({ status: 'LIVE', actualStartedAt: at(1) });

    await ctx.lifecycle.finished(sessionId, at(50));
    await ctx.lifecycle.finished(sessionId, at(59));
    await ctx.lifecycle.started(sessionId, at(60));
    expect(ctx.classroom.sessions[0]).toMatchObject({ status: 'COMPLETED', actualEndedAt: at(50) });
  });

  it('stores each connection once', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const teacher = { sessionId, membershipId: ctx.alan.id, participantSid: 'PA_teacher', joinedAt: at(0) };
    const student = { sessionId, membershipId: ctx.grace.id, participantSid: 'PA_student', joinedAt: at(2) };

    await ctx.participation.joined(teacher);
    await ctx.participation.joined(student);
    await ctx.participation.joined(student);

    expect(ctx.classroom.participations).toHaveLength(2);
    expect(ctx.classroom.sessions[0].peakParticipants).toBe(2);
  });

  it('keeps a reconnection as its own row and the peak as the most people connected at once', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const first = { sessionId, membershipId: ctx.grace.id, participantSid: 'PA_1', joinedAt: at(0) };
    const second = { ...first, participantSid: 'PA_2', joinedAt: at(10) };

    await ctx.participation.joined(first);
    await ctx.participation.left(first, at(5));
    await ctx.participation.joined(second);

    expect(ctx.classroom.participations).toEqual([
      { ...first, leftAt: at(5) },
      { ...second, leftAt: null },
    ]);
    expect(ctx.classroom.sessions[0].peakParticipants).toBe(1);
  });

  it('records a departure whose arrival was never reported, and refuses one before the arrival', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const stay = { sessionId, membershipId: ctx.grace.id, participantSid: 'PA_1', joinedAt: at(10) };

    await ctx.participation.left(stay, at(40));
    expect(ctx.classroom.participations).toEqual([{ ...stay, leftAt: at(40) }]);

    await expect(ctx.participation.left(stay, at(9))).rejects.toBeInstanceOf(
      InvalidSessionEventException,
    );
  });

  /** Runs a class from minute 0 to minute 100 in which Grace is connected during the given minutes. */
  async function attendanceAfter(...stays: [from: number, to: number][]) {
    const ctx = setup();
    const sessionId = await ctx.open();
    await ctx.lifecycle.started(sessionId, at(0));
    for (const [index, [from, to]] of stays.entries()) {
      const stay = { sessionId, membershipId: ctx.grace.id, participantSid: `PA_${index}`, joinedAt: at(from) };
      await ctx.participation.joined(stay);
      await ctx.participation.left(stay, at(to));
    }
    await ctx.lifecycle.finished(sessionId, at(100));
    return { ctx, sessionId, status: ctx.classroom.attendance.get(`${sessionId}:${ctx.grace.id}`) };
  }

  it('marks a Student present above half of the class, late above 15% of it, and absent otherwise', async () => {
    expect((await attendanceAfter([0, 51])).status).toBe('PRESENT');
    expect((await attendanceAfter([0, 50])).status).toBe('LATE');
    expect((await attendanceAfter([60, 76])).status).toBe('LATE');
    expect((await attendanceAfter([0, 15])).status).toBe('ABSENT');
    expect((await attendanceAfter()).status).toBe('ABSENT');
  });

  it('adds up reconnections, counts overlapping connections once, and ignores time outside the class', async () => {
    expect((await attendanceAfter([0, 20], [40, 60], [80, 95])).status).toBe('PRESENT');
    expect((await attendanceAfter([0, 40], [10, 40], [20, 40])).status).toBe('LATE');
    expect(secondsConnected([{ from: at(-30), to: at(10) }], { from: at(0), to: at(100) })).toBe(600);
  });

  it('counts a Student still connected when the room closes up to the end of the class', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    await ctx.lifecycle.started(sessionId, at(0));
    await ctx.participation.joined({ sessionId, membershipId: ctx.grace.id, participantSid: 'PA_1', joinedAt: at(40) });

    await ctx.lifecycle.finished(sessionId, at(100));

    expect(ctx.classroom.attendance.get(`${sessionId}:${ctx.grace.id}`)).toBe('PRESENT');
  });

  it('takes attendance of Students only, and keeps a record taken by hand', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    ctx.classroom.manualAttendance.add(`${sessionId}:${ctx.grace.id}`);
    await ctx.participation.joined({ sessionId, membershipId: ctx.alan.id, participantSid: 'PA_1', joinedAt: at(0) });

    await ctx.lifecycle.finished(sessionId, at(100));
    await ctx.lifecycle.finished(sessionId, at(100));

    expect(ctx.classroom.attendance.size).toBe(0);
  });

  it('tells the Guardians of a Student marked absent or late, and of nobody who attended', async () => {
    const absent = await attendanceAfter();
    expect(absent.ctx.notifier.requests).toEqual([
      {
        recipient: { guardiansOf: absent.ctx.grace.id },
        institutionId: A,
        type: 'WARD_ATTENDANCE',
        data: {
          studentId: absent.ctx.grace.id,
          studentName: 'Grace Prueba',
          subjectName: MATH,
          groupName: '1ro A',
          status: 'ABSENT',
          date: at(0).toISOString(),
        },
        dedupeKey: `attendance:${absent.sessionId}:${absent.ctx.grace.id}:ABSENT`,
      },
    ]);

    const late = await attendanceAfter([0, 50]);
    expect(late.ctx.notifier.requests.map((request) => request.data.status)).toEqual(['LATE']);

    expect((await attendanceAfter([0, 90])).ctx.notifier.requests).toEqual([]);
  });

  it('does not announce an absence a person already settled by hand', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    ctx.classroom.manualAttendance.add(`${sessionId}:${ctx.grace.id}`);

    await ctx.lifecycle.finished(sessionId, at(100));

    expect(ctx.notifier.requests).toEqual([]);
  });

  it('closes the connections still open when the room finishes', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    await ctx.participation.joined({
      sessionId,
      membershipId: ctx.grace.id,
      participantSid: 'PA_1',
      joinedAt: at(0),
    });

    await ctx.lifecycle.finished(sessionId, at(45));

    expect(ctx.classroom.participations[0].leftAt).toEqual(at(45));
  });

  it('stores chat messages trimmed and only once per id', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const message = { id: randomUUID(), sessionId, senderId: ctx.grace.id, content: '  Hola  ', sentAt: at(3) };

    await ctx.chat.execute(message);
    await ctx.chat.execute(message);

    expect(ctx.classroom.chatMessages).toEqual([{ ...message, content: 'Hola' }]);
    await expect(ctx.chat.execute({ ...message, id: randomUUID(), content: '   ' })).rejects.toBeInstanceOf(
      InvalidSessionEventException,
    );
    await expect(
      ctx.chat.execute({ ...message, id: randomUUID(), content: 'x'.repeat(2001) }),
    ).rejects.toBeInstanceOf(InvalidSessionEventException);
  });

  it('marks a message taken down once, and leaves alone one it never stored', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const message = { id: randomUUID(), sessionId, senderId: ctx.grace.id, content: 'Hola', sentAt: at(3) };
    const removal = { id: message.id, sessionId, deletedById: ctx.grace.id, deletedAt: at(4) };
    await ctx.chat.execute(message);

    await ctx.chatRemoval.execute(removal);
    await ctx.chatRemoval.execute({ ...removal, deletedAt: at(9) });
    await ctx.chatRemoval.execute({ ...removal, id: randomUUID() });

    expect(ctx.classroom.removedChatMessages).toEqual([removal]);
    // The message stays as history
    expect(ctx.classroom.chatMessages).toHaveLength(1);
    await expect(ctx.chatRemoval.execute({ ...removal, sessionId: randomUUID() })).rejects.toBeInstanceOf(
      ClassSessionNotFoundException,
    );
  });

  it('stores transcript segments, with or without a speaker, and refuses one that ends before it starts', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const segment = {
      id: randomUUID(),
      sessionId,
      speakerId: ctx.alan.id,
      text: 'Buenos días',
      language: 'es',
      startedAt: at(1),
      endedAt: at(2),
    };

    await ctx.transcript.execute(segment);
    await ctx.transcript.execute({ ...segment, id: randomUUID(), speakerId: null });

    expect(ctx.classroom.transcriptSegments).toHaveLength(2);
    await expect(
      ctx.transcript.execute({ ...segment, id: randomUUID(), endedAt: at(0) }),
    ).rejects.toBeInstanceOf(InvalidSessionEventException);
  });

  it('reports events about an unknown session or member as not found', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const stay = { sessionId, membershipId: ctx.grace.id, participantSid: 'PA_1', joinedAt: at(0) };

    await expect(ctx.lifecycle.started(randomUUID(), at(0))).rejects.toBeInstanceOf(
      ClassSessionNotFoundException,
    );
    await expect(
      ctx.participation.joined({ ...stay, sessionId: randomUUID() }),
    ).rejects.toBeInstanceOf(ClassSessionNotFoundException);
    await expect(
      ctx.participation.joined({ ...stay, membershipId: randomUUID() }),
    ).rejects.toBeInstanceOf(ClassSessionNotFoundException);
  });
});

describe('LiveKit access tokens', () => {
  const config = { apiKey: 'devkey', apiSecret: 's'.repeat(32) };
  const jwt = new JwtService({});
  const grant = {
    roomName: 'class-1',
    identity: 'membership-1',
    displayName: 'Alan Prueba',
    canModerate: true,
    shareableLabs: ['gravity', 'function-grapher'],
  };

  it('signs a token LiveKit accepts: issued by the API key, for one room and one identity', async () => {
    const token = await new LiveKitTokenIssuer(jwt, config).issue(grant);

    const claims = await jwt.verifyAsync<Record<string, unknown>>(token, {
      secret: config.apiSecret,
      algorithms: ['HS256'],
    });
    expect(claims).toMatchObject({
      iss: 'devkey',
      sub: 'membership-1',
      name: 'Alan Prueba',
      video: {
        room: 'class-1',
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      },
      attributes: { role: 'TEACHER', labs: 'gravity,function-grapher' },
    });
    // Moderation goes through the video-server: no browser holds LiveKit's room administration
    expect(claims.video).not.toHaveProperty('roomAdmin');
    expect(Number(claims.exp) - Number(claims.iat)).toBe(4 * 60 * 60);
  });

  it('signs a Student in as a Student, who moderates nothing', async () => {
    const token = await new LiveKitTokenIssuer(jwt, config).issue({ ...grant, canModerate: false, shareableLabs: [] });

    const claims = jwt.decode<{ video: object; attributes: { role: string } }>(token);
    expect(claims.attributes).toEqual({ role: 'STUDENT', labs: '' });
    expect(claims.video).not.toHaveProperty('roomAdmin');
  });

  it('is unavailable when no video server is configured', async () => {
    await expect(new LiveKitTokenIssuer(jwt, null).issue(grant)).rejects.toBeInstanceOf(
      VideoUnavailableException,
    );
  });
});

describe('attendance taken by hand', () => {
  const actor = (claim: MembershipClaim, institutionId = A) => ({ institutionId, memberships: [claim] });
  const mark = (enrollmentId: string, status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED', note: string | null = null) => ({
    enrollmentId,
    status,
    note,
  });

  it('lets the Teacher of the class mark its Students, and shows the marks back', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    expect(await ctx.sheet.execute(actor(ctx.alan), sessionId)).toEqual([
      expect.objectContaining({ enrollmentId: ctx.grace.id, firstName: 'Grace', status: null, takenByHand: false }),
    ]);

    const sheet = await ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'EXCUSED', '  Cita médica ')]);

    expect(sheet).toEqual([expect.objectContaining({ enrollmentId: ctx.grace.id, status: 'EXCUSED', takenByHand: true })]);
  });

  it('tells the Guardians of an absence or a late arrival recorded by hand, exactly as the automatic one', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    await ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'ABSENT')]);

    expect(ctx.notifier.requests).toEqual([
      {
        recipient: { guardiansOf: ctx.grace.id },
        institutionId: A,
        type: 'WARD_ATTENDANCE',
        data: expect.objectContaining({ studentId: ctx.grace.id, studentName: 'Grace Prueba', groupName: '1ro A', status: 'ABSENT' }),
        dedupeKey: `attendance:${sessionId}:${ctx.grace.id}:ABSENT`,
      },
    ]);

    // Saving the same mark again is not news; a different one is
    await ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'ABSENT')]);
    expect(ctx.notifier.requests).toHaveLength(1);
    await ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'LATE')]);
    expect(ctx.notifier.requests.map((request) => request.data.status)).toEqual(['ABSENT', 'LATE']);
  });

  it('tells nobody about a Student who attended or was excused', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    await ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'PRESENT')]);
    await ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'EXCUSED')]);

    expect(ctx.notifier.requests).toEqual([]);
  });

  it('stands over automatic attendance: the room closing afterwards changes and announces nothing', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    await ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'PRESENT')]);

    await ctx.lifecycle.finished(sessionId, at(100));

    expect(ctx.classroom.attendance.get(`${sessionId}:${ctx.grace.id}`)).toBe('PRESENT');
    expect(ctx.notifier.requests).toEqual([]);
  });

  it('is closed to every other Teacher, to Students and to other institutions', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();
    const marks = [mark(ctx.grace.id, 'ABSENT')];

    await expect(ctx.byHand.execute(actor(ctx.emmy), sessionId, marks)).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(ctx.byHand.execute(actor(ctx.grace), sessionId, marks)).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(ctx.sheet.execute(actor(ctx.emmy), sessionId)).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(ctx.byHand.execute(actor(ctx.alan, B), sessionId, marks)).rejects.toBeInstanceOf(
      ClassSessionNotFoundException,
    );
    expect(ctx.classroom.attendance.size).toBe(0);
    expect(ctx.notifier.requests).toEqual([]);
  });

  it('refuses a mark for someone who is not enrolled in the class, and stores none of the list', async () => {
    const ctx = setup();
    const sessionId = await ctx.open();

    await expect(
      ctx.byHand.execute(actor(ctx.alan), sessionId, [mark(ctx.grace.id, 'ABSENT'), mark(ctx.linus.id, 'ABSENT')]),
    ).rejects.toBeInstanceOf(StudentNotInClassException);

    expect(ctx.classroom.attendance.size).toBe(0);
    expect(ctx.notifier.requests).toEqual([]);
  });
});

describe('the classes of a course', () => {
  const course = (ctx: ReturnType<typeof setup>, claim: MembershipClaim, institutionId = A) => ({
    institutionId,
    memberships: [claim],
    groupId: ctx.groupId,
    subjectId: MATH,
  });

  it('records a class given without video as already over, so nobody can enter it', async () => {
    const ctx = setup();

    const { sessionId } = await ctx.held.execute(course(ctx, ctx.alan), at(0), at(30));

    expect(ctx.classroom.sessions).toEqual([
      expect.objectContaining({ id: sessionId, status: SessionStatus.COMPLETED, startsAt: at(0), endsAt: at(60) }),
    ]);
    await expect(ctx.issue.execute(A, [ctx.alan], sessionId)).rejects.toBeInstanceOf(ClassSessionClosedException);
    // It does not stand in the way of a live class
    expect(await ctx.open()).not.toBe(sessionId);
  });

  it('refuses a class that has not been held yet', async () => {
    const ctx = setup();

    await expect(ctx.held.execute(course(ctx, ctx.alan), at(31), at(30))).rejects.toBeInstanceOf(
      ClassNotHeldYetException,
    );
    expect(ctx.classroom.sessions).toEqual([]);
  });

  it('lists the classes most recent first, with how many Students each has marked', async () => {
    const ctx = setup();
    const first = (await ctx.held.execute(course(ctx, ctx.alan), at(0), at(50))).sessionId;
    const second = (await ctx.held.execute(course(ctx, ctx.alan), at(20), at(50))).sessionId;
    await ctx.byHand.execute({ institutionId: A, memberships: [ctx.alan] }, first, [
      { enrollmentId: ctx.grace.id, status: 'LATE', note: null },
    ]);

    expect(await ctx.sessions.execute(course(ctx, ctx.alan))).toEqual({
      subjectName: MATH,
      groupName: '1ro A',
      sessions: [
        { id: second, startsAt: at(20), status: SessionStatus.COMPLETED, marked: 0 },
        { id: first, startsAt: at(0), status: SessionStatus.COMPLETED, marked: 1 },
      ],
    });
  });

  it('is only for the Teacher assigned to the course, in its own institution', async () => {
    const ctx = setup();

    for (const useCase of [
      () => ctx.sessions.execute(course(ctx, ctx.emmy)),
      () => ctx.held.execute(course(ctx, ctx.emmy), at(0), at(30)),
      () => ctx.sessions.execute(course(ctx, ctx.grace)),
    ]) {
      await expect(useCase()).rejects.toBeInstanceOf(NotCourseTeacherException);
    }
    await expect(ctx.sessions.execute(course(ctx, ctx.alan, B))).rejects.toBeInstanceOf(CourseNotFoundException);
    await expect(ctx.held.execute(course(ctx, ctx.alan, B), at(0), at(30))).rejects.toBeInstanceOf(
      CourseNotFoundException,
    );
  });
});
