import type { ToolCall, ToolDefinition } from '../assistant.js';
import type { StudentAttendance } from '../class-standing.js';
import type { TaughtCourse, TimeRange } from '../teacher-hours.js';

export const LLM_PROVIDER = Symbol('LLMProvider');
export const TEACHING_RECORDS = Symbol('TeachingRecords');
export const ACADEMIC_RECORDS = Symbol('AcademicRecords');
export const COURSE_GRADES = Symbol('CourseGrades');

/** A turn of the conversation as the model sees it, tool traffic included. */
export type LLMMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  /** The tools the model may ask for in this turn; empty forces a written answer. */
  tools: ToolDefinition[];
  /** Aborted when nobody is waiting for the answer any more. */
  signal?: AbortSignal;
}

export type LLMEvent = { type: 'text'; delta: string } | { type: 'tool_call'; call: ToolCall };

/** A language model that answers one turn as a stream of text and requests for tools. */
export interface LLMProvider {
  stream(request: LLMRequest): AsyncIterable<LLMEvent>;
}

export interface SubjectSummary {
  id: string;
  code: string;
  name: string;
}

/** One subject a Teacher teaches to one group. */
export interface TeacherCourse {
  courseId: string;
  groupId: string;
  groupName: string;
  subject: SubjectSummary;
  /** The membership through which the Teacher is assigned to it. */
  teacherMembershipId: string;
}

export interface GroupAttendance {
  groupName: string;
  /** Completed classes of the Teacher's own courses in the group. */
  classesHeld: number;
  /** Every Student actively enrolled, with their marks in those classes only. */
  students: StudentAttendance[];
}

/** Who teaches what and when: for an Institution Admin's questions, and for a Teacher's about their own courses. */
export interface TeachingRecords {
  listSubjects(institutionId: string): Promise<SubjectSummary[]>;
  /** The courses assigned to these Teacher memberships inside the institution. */
  coursesTaughtBy(institutionId: string, teacherMembershipIds: string[]): Promise<TeacherCourse[]>;
  /**
   * Attendance of a group in the classes of the courses these memberships teach
   * there. Resolves to null unless they teach one, so other groups look missing.
   */
  attendanceIn(
    institutionId: string,
    groupId: string,
    teacherMembershipIds: string[],
  ): Promise<GroupAttendance | null>;
  /** Resolves to null unless the subject belongs to the institution. `month` bounds the held classes. */
  findTeaching(
    institutionId: string,
    subjectId: string,
    month: TimeRange,
  ): Promise<{ subject: SubjectSummary; courses: TaughtCourse[] } | null>;
}

export interface StudentEvaluation {
  id: string;
  title: string;
  type: string;
  weight: number;
  maxScore: number;
  dueAt: Date | null;
  grade: { score: number; feedback: string | null; gradedAt: Date } | null;
}

/** A course as one of its Students sees it: published evaluations only, and only their own grades. */
export interface StudentCourseRecord {
  groupName: string;
  subject: SubjectSummary;
  teacher: { firstName: string; lastName: string } | null;
  average: number | null;
  gradedWeight: number;
  evaluations: StudentEvaluation[];
}

export interface CourseStanding {
  /** Published evaluations of the course. */
  publishedEvaluations: number;
  students: Array<{ firstName: string; lastName: string; average: number | null; gradedWeight: number }>;
}

/** Where the Students of a course stand, for the Teacher assigned to it. */
export interface CourseGrades {
  /** Rejects unless `teacherMembershipId` is the Teacher of the course. */
  standingOf(
    institutionId: string,
    teacherMembershipId: string,
    course: { groupId: string; subjectId: string },
  ): Promise<CourseStanding>;
}

/** What a Student may know about their own studies. */
export interface AcademicRecords {
  coursesOf(institutionId: string, studentMembershipIds: string[]): Promise<StudentCourseRecord[]>;
}
