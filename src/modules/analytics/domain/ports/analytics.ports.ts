import type { StudentAttendance } from '../../../attendance/domain/attendance-standing.js';
import type { InstitutionCounts, PlatformDashboard } from '../dashboards.js';

export const DASHBOARD_QUERIES = Symbol('DashboardQueries');
export const DASHBOARD_CACHE = Symbol('DashboardCache');
export const COURSE_AVERAGES = Symbol('CourseAverages');

/** A course a Teacher is assigned to. */
export interface AssignedCourse {
  groupId: string;
  subjectId: string;
  /** The membership through which the Teacher is assigned to it. */
  teacherMembershipId: string;
}

export interface GroupAttendance {
  groupName: string;
  /** Every Student actively enrolled, with their marks in the Teacher's own classes only. */
  students: StudentAttendance[];
}

/** Read-only figures for the dashboards. `day` is the date that decides which academic periods are running. */
export interface DashboardQueries {
  platform(): Promise<PlatformDashboard>;
  institution(institutionId: string, day: Date): Promise<InstitutionCounts>;
  /** The courses these Teacher memberships have in the institution, in periods running on `day`. */
  coursesOf(institutionId: string, teacherMembershipIds: string[], day: Date): Promise<AssignedCourse[]>;
  /** Unpublished evaluations of those same courses. */
  draftEvaluations(institutionId: string, teacherMembershipIds: string[], day: Date): Promise<number>;
  /** Attendance, group by group, in the classes of those same courses. */
  attendanceOf(institutionId: string, teacherMembershipIds: string[], day: Date): Promise<GroupAttendance[]>;
}

/** The averages of the Students of one course, for the Teacher assigned to it. */
export interface CourseAverages {
  /** Rejects unless `teacherMembershipId` is the Teacher of the course. */
  averagesOf(institutionId: string, course: AssignedCourse): Promise<Array<number | null>>;
}

/** Keeps a figure that is costly to count for a short while. */
export interface DashboardCache {
  /** The value stored under `key`, or the result of `load`, which is then kept for `ttlSeconds`. */
  remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T>;
}
