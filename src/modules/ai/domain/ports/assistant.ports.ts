import type { ToolCall, ToolDefinition } from '../assistant.js';
import type { TaughtCourse, TimeRange } from '../teacher-hours.js';

export const LLM_PROVIDER = Symbol('LLMProvider');
export const TEACHING_RECORDS = Symbol('TeachingRecords');
export const ACADEMIC_RECORDS = Symbol('AcademicRecords');

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

/** Who teaches what and when, for the Institution Admin's questions. */
export interface TeachingRecords {
  listSubjects(institutionId: string): Promise<SubjectSummary[]>;
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

/** What a Student may know about their own studies. */
export interface AcademicRecords {
  coursesOf(institutionId: string, studentMembershipIds: string[]): Promise<StudentCourseRecord[]>;
}
