import { randomUUID } from 'node:crypto';
import {
  ClassroomRole,
  ClassSessionNotFoundException,
  SessionStatus,
  type AttendanceMark,
  type AttendanceSheet,
  type AttendanceStatus,
  type ManualAttendanceMark,
  type ChatMessage,
  type ChatMessageRemoval,
  type ClassroomCourse,
  type CourseSession,
  type Participation,
  type RollCall,
  type SessionAccess,
  type TeachableCourse,
  type TranscribedSession,
  type TranscriptLine,
  type TranscriptSegment,
} from '../../src/modules/classroom/domain/classroom.js';
import type {
  AttendanceBook,
  ClassroomRepository,
  SessionRecorder,
  TranscriptArchive,
  VideoGrant,
  VideoTokenIssuer,
} from '../../src/modules/classroom/domain/ports/classroom.ports.js';
import type {
  RecordingContent,
  RecordingRepository,
  RecordingSpool,
  RecordingStorage,
} from '../../src/modules/classroom/domain/ports/recording.ports.js';
import {
  SpoolFileMissingException,
  type ClaimedRecording,
  type ClassRecordingSummary,
  type FinishedRecording,
  type StoredRecording,
} from '../../src/modules/classroom/domain/recording.js';
import type { InMemoryGroupRepository, InMemoryMemberDirectory } from './group.fakes.js';

interface StoredSession {
  id: string;
  groupId: string;
  subjectId: string;
  status: SessionStatus;
  startsAt: Date;
  endsAt: Date;
  actualStartedAt: Date | null;
  actualEndedAt: Date | null;
  peakParticipants: number | null;
}

interface StoredParticipation extends Participation {
  leftAt: Date | null;
}

const courseKey = (groupId: string, subjectId: string) => `${groupId}:${subjectId}`;
const isOpen = (session: StoredSession) =>
  session.status === SessionStatus.SCHEDULED || session.status === SessionStatus.LIVE;

/**
 * Sessions and what was recorded about them. Courses, teachers and
 * enrollments are read from the academics fakes, as the real one reads their tables.
 */
export class InMemoryClassroomRepository
  implements ClassroomRepository, SessionRecorder, AttendanceBook, TranscriptArchive
{
  readonly sessions: StoredSession[] = [];
  readonly participations: StoredParticipation[] = [];
  /** Automatic attendance by "sessionId:membershipId"; a Student's membership id stands in for the enrollment. */
  readonly attendance = new Map<string, AttendanceStatus>();
  /** Keys whose attendance a person took by hand. */
  readonly manualAttendance = new Set<string>();
  readonly chatMessages: ChatMessage[] = [];
  readonly removedChatMessages: ChatMessageRemoval[] = [];
  readonly transcriptSegments: TranscriptSegment[] = [];

  constructor(
    private readonly groups: InMemoryGroupRepository,
    private readonly directory: InMemoryMemberDirectory,
  ) {}

  private openSessionOf(groupId: string, subjectId: string) {
    return this.sessions.find(
      (session) => session.groupId === groupId && session.subjectId === subjectId && isOpen(session),
    );
  }

  listCourses(
    institutionId: string,
    membershipId: string,
    role: ClassroomRole,
  ): Promise<ClassroomCourse[]> {
    const courses = this.groups.rows
      .filter((group) => group.institutionId === institutionId)
      .flatMap((group) =>
        [...group.teachers].flatMap(([subjectId, teacherId]): ClassroomCourse[] => {
          const takesPart =
            role === ClassroomRole.TEACHER
              ? teacherId === membershipId
              : group.studentIds.includes(membershipId);
          if (!takesPart) {
            return [];
          }
          const teacher = this.directory.describe(teacherId);
          return [
            {
              groupId: group.id,
              groupName: group.name,
              subject: { id: subjectId, code: '', name: '' },
              teacher: {
                membershipId: teacher.membershipId,
                firstName: teacher.firstName,
                lastName: teacher.lastName,
              },
              role,
              openSessionId: this.openSessionOf(group.id, subjectId)?.id ?? null,
            },
          ];
        }),
      );
    return Promise.resolve(courses);
  }

  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<TeachableCourse | null> {
    const group = this.groups.rows.find(
      (row) => row.id === groupId && row.institutionId === institutionId,
    );
    const teacherId = group?.teachers.get(subjectId);
    return Promise.resolve(
      teacherId
        ? {
            courseId: courseKey(groupId, subjectId),
            teacherMembershipId: teacherId,
            subjectName: subjectId,
            groupName: group?.name ?? '',
          }
        : null,
    );
  }

  findOpenSessionId(courseId: string): Promise<string | null> {
    const [groupId, subjectId] = courseId.split(':');
    return Promise.resolve(this.openSessionOf(groupId, subjectId)?.id ?? null);
  }

  createSession(courseId: string, startsAt: Date, endsAt: Date): Promise<string> {
    const [groupId, subjectId] = courseId.split(':');
    const session: StoredSession = {
      id: randomUUID(),
      groupId,
      subjectId,
      status: SessionStatus.SCHEDULED,
      startsAt,
      endsAt,
      actualStartedAt: null,
      actualEndedAt: null,
      peakParticipants: null,
    };
    this.sessions.push(session);
    return Promise.resolve(session.id);
  }

  async createHeldSession(courseId: string, startsAt: Date, endsAt: Date): Promise<string> {
    const id = await this.createSession(courseId, startsAt, endsAt);
    this.requireSession(id).status = SessionStatus.COMPLETED;
    return id;
  }

  listSessions(courseId: string, limit: number): Promise<CourseSession[]> {
    const marked = (sessionId: string) =>
      [...this.attendance.keys()].filter((key) => key.startsWith(`${sessionId}:`)).length;
    return Promise.resolve(
      this.sessions
        .filter((session) => courseKey(session.groupId, session.subjectId) === courseId)
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
        .slice(0, limit)
        .map((session) => ({
          id: session.id,
          startsAt: session.actualStartedAt ?? session.startsAt,
          status: session.status,
          endedAt: session.actualEndedAt,
          marked: marked(session.id),
        })),
    );
  }

  findSession(institutionId: string, sessionId: string): Promise<SessionAccess | null> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    const group = this.groups.rows.find(
      (row) => row.id === session?.groupId && row.institutionId === institutionId,
    );
    return Promise.resolve(
      session && group
        ? {
            sessionId: session.id,
            status: session.status,
            startsAt: session.actualStartedAt ?? session.startsAt,
            groupId: group.id,
            groupName: group.name,
            subjectName: '',
            teacherMembershipId: group.teachers.get(session.subjectId) ?? null,
          }
        : null,
    );
  }

  isEnrolled(groupId: string, studentMembershipId: string): Promise<boolean> {
    const group = this.groups.rows.find((row) => row.id === groupId);
    return Promise.resolve(group?.studentIds.includes(studentMembershipId) ?? false);
  }

  displayName(membershipId: string): Promise<string> {
    const person = this.directory.describe(membershipId);
    return Promise.resolve(`${person.firstName} ${person.lastName}`.trim());
  }

  transcribedSessions(courseId: string, limit: number): Promise<TranscribedSession[]> {
    const sessions = this.sessions
      .filter((session) => courseKey(session.groupId, session.subjectId) === courseId)
      .map((session) => ({
        sessionId: session.id,
        startsAt: session.actualStartedAt ?? session.startsAt,
        lines: this.transcriptSegments.filter((segment) => segment.sessionId === session.id).length,
      }))
      .filter((session) => session.lines > 0)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    return Promise.resolve(sessions.slice(0, limit));
  }

  lines(sessionId: string): Promise<TranscriptLine[]> {
    const lines = this.transcriptSegments
      .filter((segment) => segment.sessionId === sessionId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((segment) => {
        const speaker = segment.speakerId ? this.directory.describe(segment.speakerId) : null;
        return {
          id: segment.id,
          speakerName: speaker ? `${speaker.firstName} ${speaker.lastName}`.trim() : null,
          text: segment.text,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
        };
      });
    return Promise.resolve(lines);
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new ClassSessionNotFoundException();
    }
    return session;
  }

  // The database refuses a member id that does not exist; the directory stands in for that check
  private requireMember(membershipId: string): void {
    if (!this.directory.resolve(membershipId)) {
      throw new ClassSessionNotFoundException();
    }
  }

  async start(sessionId: string, at: Date): Promise<void> {
    const session = this.requireSession(sessionId);
    if (session.status === SessionStatus.SCHEDULED) {
      session.status = SessionStatus.LIVE;
      session.actualStartedAt = at;
    }
  }

  async finish(sessionId: string, at: Date): Promise<void> {
    const session = this.requireSession(sessionId);
    if (isOpen(session)) {
      session.status = SessionStatus.COMPLETED;
      session.actualEndedAt = at;
    }
    for (const row of this.participations) {
      if (row.sessionId === sessionId) {
        row.leftAt ??= at;
      }
    }
  }

  private findParticipation(participation: Participation) {
    return this.participations.find(
      (row) =>
        row.sessionId === participation.sessionId && row.participantSid === participation.participantSid,
    );
  }

  async join(participation: Participation): Promise<void> {
    const session = this.requireSession(participation.sessionId);
    this.requireMember(participation.membershipId);
    if (!this.findParticipation(participation)) {
      this.participations.push({ ...participation, leftAt: null });
    }
    const connected = this.participations.filter(
      (row) => row.sessionId === session.id && row.leftAt === null,
    ).length;
    session.peakParticipants = Math.max(session.peakParticipants ?? 0, connected);
  }

  async leave(participation: Participation, leftAt: Date): Promise<void> {
    this.requireSession(participation.sessionId);
    this.requireMember(participation.membershipId);
    const existing = this.findParticipation(participation);
    if (existing) {
      existing.leftAt = leftAt;
    } else {
      this.participations.push({ ...participation, leftAt });
    }
  }

  async rollCall(sessionId: string): Promise<RollCall | null> {
    const session = this.requireSession(sessionId);
    const endedAt = session.actualEndedAt;
    if (!endedAt) {
      return null;
    }
    const group = this.groups.rows.find((row) => row.id === session.groupId);
    return {
      session: { from: session.actualStartedAt ?? session.startsAt, to: endedAt },
      course: { institutionId: group?.institutionId ?? '', subjectName: session.subjectId, groupName: group?.name ?? '' },
      students: (group?.studentIds ?? []).map((studentId) => ({
        enrollmentId: studentId,
        membershipId: studentId,
        firstName: this.directory.describe(studentId).firstName,
        lastName: this.directory.describe(studentId).lastName,
        connections: this.participations
          .filter((row) => row.sessionId === sessionId && row.membershipId === studentId)
          .map((row) => ({ from: row.joinedAt, to: row.leftAt ?? endedAt })),
      })),
    };
  }

  async saveAttendance(sessionId: string, marks: AttendanceMark[]): Promise<AttendanceMark[]> {
    const automatic = marks.filter(({ enrollmentId }) => !this.manualAttendance.has(`${sessionId}:${enrollmentId}`));
    for (const { enrollmentId, status } of automatic) {
      this.attendance.set(`${sessionId}:${enrollmentId}`, status);
    }
    return automatic;
  }

  sheet(institutionId: string, sessionId: string): Promise<AttendanceSheet | null> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    const group = this.groups.rows.find((row) => row.id === session?.groupId && row.institutionId === institutionId);
    if (!session || !group) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      startsAt: session.actualStartedAt ?? session.startsAt,
      teacherMembershipId: group.teachers.get(session.subjectId) ?? null,
      course: { institutionId, subjectName: session.subjectId, groupName: group.name },
      students: group.studentIds.map((studentId) => ({
        enrollmentId: studentId,
        membershipId: studentId,
        firstName: this.directory.describe(studentId).firstName,
        lastName: this.directory.describe(studentId).lastName,
        status: this.attendance.get(`${sessionId}:${studentId}`) ?? null,
        takenByHand: this.manualAttendance.has(`${sessionId}:${studentId}`),
      })),
    });
  }

  record(sessionId: string, _recordedById: string, marks: ManualAttendanceMark[]): Promise<void> {
    for (const { enrollmentId, status } of marks) {
      this.attendance.set(`${sessionId}:${enrollmentId}`, status);
      this.manualAttendance.add(`${sessionId}:${enrollmentId}`);
    }
    return Promise.resolve();
  }

  async addChatMessage(message: ChatMessage): Promise<void> {
    this.requireSession(message.sessionId);
    this.requireMember(message.senderId);
    if (!this.chatMessages.some((stored) => stored.id === message.id)) {
      this.chatMessages.push(message);
    }
  }

  async removeChatMessage(removal: ChatMessageRemoval): Promise<void> {
    this.requireSession(removal.sessionId);
    const isStored = this.chatMessages.some(
      (stored) => stored.id === removal.id && stored.sessionId === removal.sessionId,
    );
    if (isStored && !this.removedChatMessages.some((removed) => removed.id === removal.id)) {
      this.removedChatMessages.push(removal);
    }
  }

  async addTranscriptSegment(segment: TranscriptSegment): Promise<void> {
    this.requireSession(segment.sessionId);
    if (segment.speakerId) {
      this.requireMember(segment.speakerId);
    }
    if (!this.transcriptSegments.some((stored) => stored.id === segment.id)) {
      this.transcriptSegments.push(segment);
    }
  }
}

/** Records every grant it is asked for instead of signing a token. */
export class FakeVideoTokenIssuer implements VideoTokenIssuer {
  readonly grants: VideoGrant[] = [];

  issue(grant: VideoGrant): Promise<string> {
    this.grants.push(grant);
    return Promise.resolve(`token-for-${grant.identity}`);
  }
}

interface StoredRecordingRow extends FinishedRecording {
  id: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  storageKey: string | null;
  attempts: number;
  claimedAt: Date | null;
}

/** Recordings of the sessions an InMemoryClassroomRepository holds. */
export class InMemoryRecordingRepository implements RecordingRepository {
  readonly rows: StoredRecordingRow[] = [];

  constructor(
    private readonly classroom: InMemoryClassroomRepository,
    private readonly groups: InMemoryGroupRepository,
  ) {}

  private session(sessionId: string) {
    const session = this.classroom.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new ClassSessionNotFoundException();
    }
    return session;
  }

  async register(recording: FinishedRecording): Promise<void> {
    this.session(recording.sessionId);
    if (!this.rows.some((row) => row.egressId === recording.egressId)) {
      this.rows.push({ ...recording, id: randomUUID(), status: 'PENDING', storageKey: null, attempts: 0, claimedAt: null });
    }
  }

  async claimNext(now: Date, abandonedBefore: Date): Promise<ClaimedRecording | null> {
    const row = this.rows.find(
      (candidate) =>
        candidate.status === 'PENDING' &&
        (candidate.claimedAt === null || candidate.claimedAt.getTime() < abandonedBefore.getTime()),
    );
    if (!row) {
      return null;
    }
    row.claimedAt = now;
    row.attempts += 1;
    const session = this.session(row.sessionId);
    const group = this.groups.rows.find((candidate) => candidate.id === session.groupId);
    const teacherId = group?.teachers.get(session.subjectId);
    return {
      id: row.id,
      sessionId: row.sessionId,
      spoolFile: row.spoolFile,
      sizeBytes: row.sizeBytes,
      attempts: row.attempts,
      institutionId: group?.institutionId ?? '',
      groupId: session.groupId,
      subjectId: session.subjectId,
      subjectName: session.subjectId,
      groupName: group?.name ?? '',
      startsAt: session.actualStartedAt ?? session.startsAt,
      audience: [...(teacherId ? [teacherId] : []), ...(group?.studentIds ?? [])],
    };
  }

  private row(id: string): StoredRecordingRow {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error(`No recording ${id}`);
    }
    return row;
  }

  async markReady(id: string, storageKey: string): Promise<void> {
    Object.assign(this.row(id), { status: 'READY', storageKey, claimedAt: null });
  }

  async markFailed(id: string): Promise<void> {
    Object.assign(this.row(id), { status: 'FAILED', claimedAt: null });
  }

  async listReady(courseId: string, limit: number): Promise<ClassRecordingSummary[]> {
    return this.rows
      .filter((row) => row.status === 'READY')
      .map((row) => ({ row, session: this.session(row.sessionId) }))
      .filter(({ session }) => courseKey(session.groupId, session.subjectId) === courseId)
      .sort((a, b) => b.row.startedAt.getTime() - a.row.startedAt.getTime())
      .slice(0, limit)
      .map(({ row, session }) => ({
        id: row.id,
        sessionId: row.sessionId,
        startsAt: session.actualStartedAt ?? session.startsAt,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        sizeBytes: row.sizeBytes,
      }));
  }

  async findReady(recordingId: string): Promise<StoredRecording | null> {
    const row = this.rows.find((candidate) => candidate.id === recordingId && candidate.status === 'READY');
    return row?.storageKey
      ? { id: row.id, sessionId: row.sessionId, storageKey: row.storageKey, startedAt: row.startedAt }
      : null;
  }
}

/** A spool of named files in memory. */
export class InMemoryRecordingSpool implements RecordingSpool {
  readonly files = new Map<string, Uint8Array>();

  async read(spoolFile: string): Promise<RecordingContent> {
    const content = this.files.get(spoolFile);
    if (!content) {
      throw new SpoolFileMissingException();
    }
    return {
      sizeBytes: content.byteLength,
      chunks: (async function* () {
        yield content;
      })(),
    };
  }

  async remove(spoolFile: string): Promise<void> {
    this.files.delete(spoolFile);
  }
}

/** A recording storage in memory, whose links name the key; `failing` makes every save reject. */
export class InMemoryRecordingStorage implements RecordingStorage {
  readonly files = new Map<string, Uint8Array>();
  failing = false;

  async save(key: string, content: RecordingContent): Promise<void> {
    if (this.failing) {
      throw new Error('storage unreachable');
    }
    const parts: Uint8Array[] = [];
    for await (const chunk of content.chunks) {
      parts.push(chunk);
    }
    this.files.set(key, Buffer.concat(parts));
  }

  link(key: string, options: { fileName: string; download: boolean; expiresInSeconds: number }): Promise<string> {
    const query = new URLSearchParams({ name: options.fileName, download: String(options.download) });
    return Promise.resolve(`https://storage.test/${key}?${query}`);
  }
}
