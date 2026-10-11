import { DomainException } from '../../../shared/domain/domain.exception.js';

export const SessionStatus = {
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** How a member takes part in a class: giving it or attending it. */
export const ClassroomRole = { TEACHER: 'TEACHER', STUDENT: 'STUDENT' } as const;
export type ClassroomRole = (typeof ClassroomRole)[keyof typeof ClassroomRole];

export const DEFAULT_SESSION_MINUTES = 60;
export const MAX_CHAT_LENGTH = 2000;
export const MAX_TRANSCRIPT_LENGTH = 4000;

interface Person {
  membershipId: string;
  firstName: string;
  lastName: string;
}

/** One subject of one group, as the member who teaches or attends it sees it. */
export interface ClassroomCourse {
  groupId: string;
  groupName: string;
  subject: { id: string; code: string; name: string };
  teacher: Person | null;
  role: ClassroomRole;
  /** The class in progress that the member can enter, if the Teacher has opened one. */
  openSessionId: string | null;
}

export interface TeachableCourse {
  courseId: string;
  teacherMembershipId: string | null;
}

/** What deciding who may enter a class session requires. */
export interface SessionAccess {
  sessionId: string;
  status: SessionStatus;
  groupId: string;
  groupName: string;
  subjectName: string;
  teacherMembershipId: string | null;
}

export interface Participation {
  sessionId: string;
  membershipId: string;
  /** LiveKit's id for one connection; a reconnect gets a new one. */
  participantSid: string;
  joinedAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  senderId: string;
  content: string;
  sentAt: Date;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  speakerId: string | null;
  text: string;
  language: string | null;
  startedAt: Date;
  endedAt: Date;
}

/** What a Student's time in a class amounts to once it is over. */
export const AutomaticAttendance = { PRESENT: 'PRESENT', LATE: 'LATE', ABSENT: 'ABSENT' } as const;
export type AutomaticAttendance = (typeof AutomaticAttendance)[keyof typeof AutomaticAttendance];

/** Above this share of the class a Student was present. */
export const PRESENT_ABOVE = 0.5;
/** Above this share, and up to PRESENT_ABOVE, a Student was late. */
export const LATE_ABOVE = 0.15;

export interface TimeSpan {
  from: Date;
  to: Date;
}

/** A finished class and the connections of every Student enrolled in its group. */
export interface RollCall {
  session: TimeSpan;
  students: { enrollmentId: string; connections: TimeSpan[] }[];
}

export interface AttendanceMark {
  enrollmentId: string;
  status: AutomaticAttendance;
}

const seconds = (span: TimeSpan) => Math.max(0, span.to.getTime() - span.from.getTime()) / 1000;

/** Seconds of `within` covered by the connections; overlapping connections count once. */
export function secondsConnected(connections: TimeSpan[], within: TimeSpan): number {
  const clipped = connections
    .map((span) => ({
      from: Math.max(span.from.getTime(), within.from.getTime()),
      to: Math.min(span.to.getTime(), within.to.getTime()),
    }))
    .filter((span) => span.to > span.from)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const span of clipped) {
    total += Math.max(0, span.to - Math.max(span.from, coveredUntil));
    coveredUntil = Math.max(coveredUntil, span.to);
  }
  return total / 1000;
}

/** Present above half of the class, late above 15% of it, absent otherwise. */
export function attendanceFor(connectedSeconds: number, sessionSeconds: number): AutomaticAttendance {
  const share = sessionSeconds > 0 ? connectedSeconds / sessionSeconds : 0;
  if (share > PRESENT_ABOVE) {
    return AutomaticAttendance.PRESENT;
  }
  return share > LATE_ABOVE ? AutomaticAttendance.LATE : AutomaticAttendance.ABSENT;
}

/** The attendance of every enrolled Student, including those who never connected. */
export function takeAttendance(rollCall: RollCall): AttendanceMark[] {
  const sessionSeconds = seconds(rollCall.session);
  return rollCall.students.map(({ enrollmentId, connections }) => ({
    enrollmentId,
    status: attendanceFor(secondsConnected(connections, rollCall.session), sessionSeconds),
  }));
}

/** The LiveKit room of a session. The video-server reads the session id back from this name. */
export const roomNameFor = (sessionId: string) => `class-${sessionId}`;

/** A session can be entered from the moment the Teacher opens it until its room closes. */
export function isOpen(status: SessionStatus): boolean {
  return status === SessionStatus.SCHEDULED || status === SessionStatus.LIVE;
}

export class ClassSessionNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'CLASS_SESSION_NOT_FOUND', 'Class session not found');
  }
}

export class ClassSessionClosedException extends DomainException {
  constructor() {
    super('CONFLICT', 'CLASS_SESSION_CLOSED', 'This class has already ended');
  }
}

export class NotClassParticipantException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'NOT_CLASS_PARTICIPANT', 'Only the assigned Teacher and enrolled Students may enter this class');
  }
}

export class CourseNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'COURSE_NOT_FOUND', 'Course not found');
  }
}

export class NotCourseTeacherException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'NOT_COURSE_TEACHER', 'Only the Teacher assigned to this subject may start its class');
  }
}

export class VideoUnavailableException extends DomainException {
  constructor() {
    super('UNAVAILABLE', 'VIDEO_UNAVAILABLE', 'Video classes are not available right now');
  }
}

export class InvalidSessionEventException extends DomainException {
  constructor(message: string) {
    super('VALIDATION', 'INVALID_SESSION_EVENT', message);
  }
}
