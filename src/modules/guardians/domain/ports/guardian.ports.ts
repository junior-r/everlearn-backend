import type { GuardianLink, GuardianRelationship, Ward, WardAttendance } from '../guardian.js';

export const GUARDIAN_REPOSITORY = Symbol('GuardianRepository');
export const WARD_ACADEMICS = Symbol('WardAcademics');

export interface GuardianRepository {
  /** Every link of the institution, by the Student's name. */
  listLinks(institutionId: string): Promise<GuardianLink[]>;
  /**
   * Ties a Guardian to a Student, or changes how they are related. Resolves to
   * null unless both memberships belong to the institution with those roles.
   */
  link(
    institutionId: string,
    studentMembershipId: string,
    guardianMembershipId: string,
    relationship: GuardianRelationship,
  ): Promise<GuardianLink | null>;
  /** Removes a link of the institution; resolves to false when there was none. */
  unlink(institutionId: string, linkId: string): Promise<boolean>;
  /** The Students linked to these Guardian memberships inside the institution. */
  wardsOf(institutionId: string, guardianMembershipIds: string[]): Promise<Ward[]>;
  attendanceOf(studentMembershipId: string, recentLimit: number): Promise<WardAttendance>;
}

export interface ScheduledClass {
  dayOfWeek: string;
  /** Minutes from midnight, exclusive end. */
  startMinute: number;
  endMinute: number;
  groupName: string;
  subjectName: string;
  teacherName: string | null;
  room: string | null;
}

export interface CourseStanding {
  groupName: string;
  subjectName: string;
  subjectCode: string;
  teacherName: string | null;
  /** Percent, computed by the evaluations module; null while nothing is graded. */
  average: number | null;
  gradedWeight: number;
  gradedEvaluations: number;
  publishedEvaluations: number;
}

export interface UpcomingEvaluation {
  id: string;
  title: string;
  type: string;
  dueAt: Date;
  subjectName: string;
  groupName: string;
}

/**
 * What a Student sees of their own studies, read for someone entitled to see
 * it. Implemented over the modules that own each piece, so the figures are the
 * very ones the Student gets.
 */
export interface WardAcademics {
  scheduleOf(institutionId: string, groupIds: string[]): Promise<ScheduledClass[]>;
  coursesOf(institutionId: string, studentMembershipId: string): Promise<CourseStanding[]>;
  upcomingOf(institutionId: string, studentMembershipId: string, from: Date, to: Date): Promise<UpcomingEvaluation[]>;
}
