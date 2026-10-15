import { DomainException } from '../../../shared/domain/domain.exception.js';
import type { LabKey } from './lab-catalog.js';
import type { MarkedAnswer } from './language-exercise.js';

export const MAX_ASSIGNMENT_TITLE_LENGTH = 120;
export const MAX_INSTRUCTIONS_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 1000;
/** A language activity holds between 1 and this many exercises. */
export const MAX_ASSIGNMENT_EXERCISES = 20;

/** A course (a group taking a subject), as an activity hangs from it. */
export interface LabCourse {
  courseId: string;
  groupId: string;
  groupName: string;
  subjectId: string;
  subjectName: string;
  teacherMembershipId: string | null;
}

/** What a Teacher decides about an activity. */
export interface AssignmentData {
  labKey: LabKey;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  /** The exercises of a language activity, in order; empty for any other lab. */
  exerciseIds: string[];
}

export interface LabAssignment extends AssignmentData {
  id: string;
  course: LabCourse;
  createdAt: Date;
}

/**
 * What a Student handed in. A language activity is scored (`score` over
 * `total`) from `answers`; any other lab is done once handed in, with an optional note.
 */
export interface LabAttempt {
  studentId: string;
  submittedAt: Date;
  score: number | null;
  total: number | null;
  note: string | null;
  answers: MarkedAnswer[];
}

export interface PersonRef {
  membershipId: string;
  firstName: string;
  lastName: string;
}

/** Handed in after the due date: accepted, and shown as such. */
export const isLate = (attempt: Pick<LabAttempt, 'submittedAt'>, dueAt: Date | null) =>
  dueAt !== null && attempt.submittedAt > dueAt;

/** Returns the data cleaned up, or refuses what no activity can be. */
export function checkedAssignment(data: AssignmentData): AssignmentData {
  const title = data.title.trim();
  if (!title || title.length > MAX_ASSIGNMENT_TITLE_LENGTH) {
    throw new InvalidAssignmentException(
      `A title must have between 1 and ${MAX_ASSIGNMENT_TITLE_LENGTH} characters`,
    );
  }
  const instructions = data.instructions?.trim() || null;
  if (instructions && instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    throw new InvalidAssignmentException(`Instructions have at most ${MAX_INSTRUCTIONS_LENGTH} characters`);
  }
  return { ...data, title, instructions, exerciseIds: [...new Set(data.exerciseIds)] };
}

export class LabCourseNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'COURSE_NOT_FOUND', 'Course not found');
  }
}

export class NotLabCourseTeacherException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'NOT_COURSE_TEACHER', 'Only the Teacher assigned to this subject may do this');
  }
}

export class TeacherOnlyException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'TEACHER_ONLY', 'Only a Teacher of the institution may do this');
  }
}

export class LabAssignmentNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'LAB_ASSIGNMENT_NOT_FOUND', 'Lab activity not found');
  }
}

export class InvalidAssignmentException extends DomainException {
  constructor(message: string) {
    super('VALIDATION', 'INVALID_LAB_ASSIGNMENT', message);
  }
}

export class AttemptAlreadySubmittedException extends DomainException {
  constructor() {
    super('CONFLICT', 'LAB_ATTEMPT_ALREADY_SUBMITTED', 'This activity was already handed in');
  }
}
