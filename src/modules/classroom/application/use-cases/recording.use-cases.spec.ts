import { randomUUID } from 'node:crypto';
import { createAdminFakes } from '../../../../../test/support/admin.fakes.js';
import {
  InMemoryClassroomRepository,
  InMemoryRecordingRepository,
  InMemoryRecordingSpool,
  InMemoryRecordingStorage,
} from '../../../../../test/support/classroom.fakes.js';
import { RecordingNotifier } from '../../../../../test/support/communication.fakes.js';
import {
  InMemoryGroupRepository,
  InMemoryMemberDirectory,
  InMemoryPeriodRepository,
} from '../../../../../test/support/group.fakes.js';
import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { ClassSessionNotFoundException, CourseNotFoundException, InvalidSessionEventException } from '../../domain/classroom.js';
import {
  ABANDONED_CLAIM_MS,
  downloadNameFor,
  isSpoolFileOf,
  MAX_ARCHIVE_ATTEMPTS,
  RecordingNotFoundException,
} from '../../domain/recording.js';
import { StartClassSessionUseCase } from './classroom.use-cases.js';
import {
  ArchiveNextRecordingUseCase,
  GetRecordingLinkUseCase,
  ListCourseRecordingsUseCase,
  RecordFinishedRecordingUseCase,
} from './recording.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const MATH = 'subject-math';
const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 15, minute));

/** One group of institution A taking maths with Alan, with Grace enrolled; Emmy and Linus are outsiders. */
function setup() {
  const directory = new InMemoryMemberDirectory();
  const groups = new InMemoryGroupRepository(createAdminFakes().pensums, new InMemoryPeriodRepository(), directory);
  const classroom = new InMemoryClassroomRepository(groups, directory);
  const recordings = new InMemoryRecordingRepository(classroom, groups);
  const spool = new InMemoryRecordingSpool();
  const storage = new InMemoryRecordingStorage();
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
  const record = new RecordFinishedRecordingUseCase(recordings);
  /** A class Alan gave, recorded into a file left in the spool. */
  const recorded = async (bytes = 'mp4 bytes') => {
    const { sessionId } = await new StartClassSessionUseCase(classroom).execute(
      { institutionId: A, memberships: [alan], groupId, subjectId: MATH },
      at(0),
    );
    const spoolFile = `${sessionId}/${randomUUID()}.mp4`;
    spool.files.set(spoolFile, Buffer.from(bytes));
    await record.execute({
      egressId: `EG_${randomUUID()}`,
      sessionId,
      spoolFile,
      startedAt: at(1),
      endedAt: at(46),
      sizeBytes: bytes.length,
    });
    return { sessionId, spoolFile };
  };
  return {
    recordings,
    spool,
    storage,
    notifier,
    groupId,
    alan,
    emmy,
    grace,
    linus,
    record,
    recorded,
    archive: new ArchiveNextRecordingUseCase(recordings, spool, storage, notifier),
    list: new ListCourseRecordingsUseCase(classroom, recordings),
    link: new GetRecordingLinkUseCase(classroom, recordings, storage),
  };
}

describe('a finished recording', () => {
  it('waits to be stored, once however many times it is reported', async () => {
    const ctx = setup();
    const { sessionId, spoolFile } = await ctx.recorded();
    const report = { egressId: ctx.recordings.rows[0].egressId, sessionId, spoolFile, startedAt: at(1), endedAt: at(46), sizeBytes: 9 };

    await ctx.record.execute(report);

    expect(ctx.recordings.rows).toHaveLength(1);
    expect(ctx.recordings.rows[0]).toMatchObject({ status: 'PENDING', spoolFile });
  });

  it('is refused unless it is a file the video-server named for that session, in order', async () => {
    const ctx = setup();
    const { sessionId } = await ctx.recorded();
    const report = { egressId: 'EG_x', sessionId, startedAt: at(1), endedAt: at(2), sizeBytes: 1 };

    for (const spoolFile of [`${randomUUID()}/${randomUUID()}.mp4`, `${sessionId}/../secret.mp4`, `${sessionId}/a.webm`]) {
      await expect(ctx.record.execute({ ...report, spoolFile })).rejects.toBeInstanceOf(InvalidSessionEventException);
    }
    await expect(
      ctx.record.execute({ ...report, spoolFile: `${sessionId}/${randomUUID()}.mp4`, endedAt: at(0) }),
    ).rejects.toBeInstanceOf(InvalidSessionEventException);
  });

  it('of a session that does not exist is not found', async () => {
    const ctx = setup();
    const sessionId = randomUUID();

    await expect(
      ctx.record.execute({
        egressId: 'EG_x',
        sessionId,
        spoolFile: `${sessionId}/${randomUUID()}.mp4`,
        startedAt: at(1),
        endedAt: at(2),
        sizeBytes: 1,
      }),
    ).rejects.toBeInstanceOf(ClassSessionNotFoundException);
  });
});

describe('storing recordings', () => {
  it('moves the file from the spool to the storage and tells the Teacher and the Students', async () => {
    const ctx = setup();
    const { sessionId, spoolFile } = await ctx.recorded('the whole class');

    expect(await ctx.archive.execute(at(50))).toBe('STORED');

    const [row] = ctx.recordings.rows;
    expect(row).toMatchObject({ status: 'READY', storageKey: `recordings/${A}/${sessionId}/${row.id}.mp4` });
    expect(Buffer.from(ctx.storage.files.get(row.storageKey ?? '') ?? []).toString()).toBe('the whole class');
    expect(ctx.spool.files.has(spoolFile)).toBe(false);
    expect(ctx.notifier.requests.map((request) => request.recipient)).toEqual([
      { membershipId: ctx.alan.id },
      { membershipId: ctx.grace.id },
    ]);
    expect(ctx.notifier.requests[0]).toMatchObject({
      type: 'RECORDING_READY',
      institutionId: A,
      email: false,
      data: { recordingId: row.id, sessionId, groupId: ctx.groupId, subjectId: MATH, groupName: '1ro A' },
    });
    expect(await ctx.archive.execute(at(51))).toBe('NONE');
  });

  it('tries again once the claim lapses, and gives up after the last attempt', async () => {
    const ctx = setup();
    await ctx.recorded();
    ctx.storage.failing = true;
    let now = at(50).getTime();

    for (let attempt = 1; attempt < MAX_ARCHIVE_ATTEMPTS; attempt++) {
      expect(await ctx.archive.execute(new Date(now))).toBe('RETRY');
      // Still claimed: nothing to take until the claim lapses
      expect(await ctx.archive.execute(new Date(now + 1000))).toBe('NONE');
      now += ABANDONED_CLAIM_MS + 1000;
    }
    expect(await ctx.archive.execute(new Date(now))).toBe('FAILED');

    expect(ctx.recordings.rows[0].status).toBe('FAILED');
    expect(ctx.notifier.requests).toHaveLength(0);
  });

  it('gives up at once on a file that is not in the spool', async () => {
    const ctx = setup();
    const { spoolFile } = await ctx.recorded();
    ctx.spool.files.delete(spoolFile);

    expect(await ctx.archive.execute(at(50))).toBe('FAILED');
  });
});

describe('watching recordings', () => {
  const course = (claim: MembershipClaim, groupId: string, institutionId = A) => ({
    institutionId,
    memberships: [claim],
    groupId,
    subjectId: MATH,
  });

  it('lists the stored recordings of a course for its Teacher and its Students', async () => {
    const ctx = setup();
    const { sessionId } = await ctx.recorded();
    await ctx.recorded();
    await ctx.archive.execute(at(50));

    for (const member of [ctx.alan, ctx.grace]) {
      const list = await ctx.list.execute(course(member, ctx.groupId));
      // The second is still waiting in the spool, so it is not listed yet
      expect(list.recordings).toEqual([
        expect.objectContaining({ sessionId, startedAt: at(1), endedAt: at(46), sizeBytes: 9 }),
      ]);
      expect(list.groupName).toBe('1ro A');
    }
  });

  it('hides the course from everyone else, in this institution or another', async () => {
    const ctx = setup();
    for (const outsider of [ctx.emmy, ctx.linus]) {
      await expect(ctx.list.execute(course(outsider, ctx.groupId))).rejects.toBeInstanceOf(CourseNotFoundException);
    }
    await expect(ctx.list.execute(course(ctx.alan, ctx.groupId, B))).rejects.toBeInstanceOf(CourseNotFoundException);
  });

  it('gives the Teacher and the Students a link to play or download it', async () => {
    const ctx = setup();
    await ctx.recorded();
    await ctx.archive.execute(at(50));
    const [row] = ctx.recordings.rows;

    const play = await ctx.link.execute(A, [ctx.grace], row.id, false, at(60));
    const save = await ctx.link.execute(A, [ctx.alan], row.id, true, at(60));

    expect(play.url).toMatch(new RegExp(`^https://storage.test/${row.storageKey}\\?name=.*1ro-A-2026-10-28\\.mp4&download=false$`));
    expect(save.url).toContain('download=true');
    expect(play.expiresAt).toEqual(new Date(at(60).getTime() + 6 * 60 * 60 * 1000));
  });

  it('is not found for anyone else, nor while it waits to be stored', async () => {
    const ctx = setup();
    await ctx.recorded();
    const [row] = ctx.recordings.rows;
    await expect(ctx.link.execute(A, [ctx.alan], row.id, false)).rejects.toBeInstanceOf(RecordingNotFoundException);

    await ctx.archive.execute(at(50));
    for (const [institutionId, member] of [[A, ctx.emmy], [A, ctx.linus], [B, ctx.alan]] as const) {
      await expect(ctx.link.execute(institutionId, [member], row.id, false)).rejects.toBeInstanceOf(
        RecordingNotFoundException,
      );
    }
  });
});

describe('recording names', () => {
  it('reads from the spool only files named for the session', () => {
    const sessionId = randomUUID();
    expect(isSpoolFileOf(sessionId, `${sessionId}/${randomUUID()}.mp4`)).toBe(true);
    expect(isSpoolFileOf(sessionId.toUpperCase(), `${sessionId}/${randomUUID()}.mp4`)).toBe(true);
    expect(isSpoolFileOf(sessionId, `${sessionId}/${randomUUID()}.mp4/../x.mp4`)).toBe(false);
    expect(isSpoolFileOf(sessionId, `/${sessionId}/${randomUUID()}.mp4`)).toBe(false);
  });

  it('downloads under the subject, the group and the day, in plain letters', () => {
    expect(downloadNameFor('Matemática I', '1ro "A"', at(0))).toBe('Matematica-I-1ro-A-2026-10-28.mp4');
    expect(downloadNameFor('¿?', '', at(0))).toBe('clase-2026-10-28.mp4');
  });
});
