import type {
  AttendanceMark,
  AttendanceSheet,
  ChatMessage,
  ClassroomCourse,
  ClassroomRole,
  CourseSession,
  ManualAttendanceMark,
  Participation,
  RollCall,
  SessionAccess,
  TeachableCourse,
  TranscriptSegment,
} from '../classroom.js';

export const CLASSROOM_REPOSITORY = Symbol('ClassroomRepository');
export const SESSION_RECORDER = Symbol('SessionRecorder');
export const VIDEO_TOKEN_ISSUER = Symbol('VideoTokenIssuer');
export const ATTENDANCE_BOOK = Symbol('AttendanceBook');

export interface ClassroomRepository {
  /** The courses a membership teaches, or follows through an active enrollment, inside the institution. */
  listCourses(
    institutionId: string,
    membershipId: string,
    role: ClassroomRole,
  ): Promise<ClassroomCourse[]>;
  /** Resolves to null unless the group belongs to the institution and takes the subject. */
  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<TeachableCourse | null>;
  findOpenSessionId(courseId: string): Promise<string | null>;
  createSession(courseId: string, startsAt: Date, endsAt: Date): Promise<string>;
  /** Stores a class that was given without video: already over, with no room to enter. */
  createHeldSession(courseId: string, startsAt: Date, endsAt: Date): Promise<string>;
  /** The latest `limit` classes of a course, most recent first. */
  listSessions(courseId: string, limit: number): Promise<CourseSession[]>;
  /** Resolves to null unless the session belongs to the institution. */
  findSession(institutionId: string, sessionId: string): Promise<SessionAccess | null>;
  isEnrolled(groupId: string, studentMembershipId: string): Promise<boolean>;
  displayName(membershipId: string): Promise<string>;
}

/**
 * Stores what the video-server reports about a live room. Every method is
 * idempotent, because deliveries are retried, and rejects with
 * ClassSessionNotFoundException when the session or the member does not exist.
 */
export interface SessionRecorder {
  start(sessionId: string, at: Date): Promise<void>;
  /** Closes the session and any connection still recorded as open. */
  finish(sessionId: string, at: Date): Promise<void>;
  join(participation: Participation): Promise<void>;
  leave(participation: Participation, leftAt: Date): Promise<void>;
  /** Resolves to null while the session has not finished. */
  rollCall(sessionId: string): Promise<RollCall | null>;
  /**
   * Stores automatic attendance, leaving alone any record a person took by hand.
   * Resolves to the marks that now stand as automatic: those are the ones to announce.
   */
  saveAttendance(sessionId: string, marks: AttendanceMark[]): Promise<AttendanceMark[]>;
  addChatMessage(message: ChatMessage): Promise<void>;
  addTranscriptSegment(segment: TranscriptSegment): Promise<void>;
}

export interface VideoGrant {
  roomName: string;
  /** Always the participant's Membership id. */
  identity: string;
  displayName: string;
  canModerate: boolean;
}

export interface VideoTokenIssuer {
  /** Rejects with VideoUnavailableException when no video server is configured. */
  issue(grant: VideoGrant): Promise<string>;
}

/** Attendance as a person takes it, class by class. */
export interface AttendanceBook {
  /** Resolves to null unless the session belongs to the institution. */
  sheet(institutionId: string, sessionId: string): Promise<AttendanceSheet | null>;
  /** Stores marks as taken by hand by `recordedById`, replacing whatever stood for those Students. */
  record(sessionId: string, recordedById: string, marks: ManualAttendanceMark[]): Promise<void>;
}
