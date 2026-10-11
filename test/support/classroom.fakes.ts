import { randomUUID } from 'node:crypto';
import {
  ClassroomRole,
  ClassSessionNotFoundException,
  SessionStatus,
  type AttendanceMark,
  type AutomaticAttendance,
  type ChatMessage,
  type ClassroomCourse,
  type Participation,
  type RollCall,
  type SessionAccess,
  type TeachableCourse,
  type TranscriptSegment,
} from '../../src/modules/classroom/domain/classroom.js';
import type {
  ClassroomRepository,
  SessionRecorder,
  VideoGrant,
  VideoTokenIssuer,
} from '../../src/modules/classroom/domain/ports/classroom.ports.js';
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
export class InMemoryClassroomRepository implements ClassroomRepository, SessionRecorder {
  readonly sessions: StoredSession[] = [];
  readonly participations: StoredParticipation[] = [];
  /** Automatic attendance by "sessionId:membershipId"; a Student's membership id stands in for the enrollment. */
  readonly attendance = new Map<string, AutomaticAttendance>();
  /** Keys whose attendance a person took by hand. */
  readonly manualAttendance = new Set<string>();
  readonly chatMessages: ChatMessage[] = [];
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
      teacherId ? { courseId: courseKey(groupId, subjectId), teacherMembershipId: teacherId } : null,
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
      students: (group?.studentIds ?? []).map((studentId) => ({
        enrollmentId: studentId,
        connections: this.participations
          .filter((row) => row.sessionId === sessionId && row.membershipId === studentId)
          .map((row) => ({ from: row.joinedAt, to: row.leftAt ?? endedAt })),
      })),
    };
  }

  async saveAttendance(sessionId: string, marks: AttendanceMark[]): Promise<void> {
    for (const { enrollmentId, status } of marks) {
      const key = `${sessionId}:${enrollmentId}`;
      if (!this.manualAttendance.has(key)) {
        this.attendance.set(key, status);
      }
    }
  }

  async addChatMessage(message: ChatMessage): Promise<void> {
    this.requireSession(message.sessionId);
    this.requireMember(message.senderId);
    if (!this.chatMessages.some((stored) => stored.id === message.id)) {
      this.chatMessages.push(message);
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
