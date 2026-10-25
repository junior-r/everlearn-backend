import type {
  AttendanceMark,
  AttendanceSheet,
  ChatMessage,
  ChatMessageRemoval,
  ClassroomCourse,
  ClassroomRole,
  CourseSession,
  TranscribedSession,
  TranscriptLine,
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
export const TRANSCRIPT_ARCHIVE = Symbol('TranscriptArchive');

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
  /** Marks a message of the session as taken down; a message that was never stored is left alone. */
  removeChatMessage(removal: ChatMessageRemoval): Promise<void>;
  addTranscriptSegment(segment: TranscriptSegment): Promise<void>;
}

export interface VideoGrant {
  roomName: string;
  /** Always the participant's Membership id. */
  identity: string;
  displayName: string;
  /** True for the Teacher of the class: the video-server lets only them keep order in the room. */
  canModerate: boolean;
  /** The labs this participant may share with the room; empty for anyone but the Teacher. */
  shareableLabs: string[];
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

/** The transcripts the video-server reported, read back once a class has been given. */
export interface TranscriptArchive {
  /** The latest `limit` classes of a course with at least one transcribed line, most recent first. */
  transcribedSessions(courseId: string, limit: number): Promise<TranscribedSession[]>;
  /** The lines of a session, in the order they were said. */
  lines(sessionId: string): Promise<TranscriptLine[]>;
}
