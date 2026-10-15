import { DomainException } from '../../../shared/domain/domain.exception.js';

export const EvaluationType = {
  EXAM: 'EXAM',
  QUIZ: 'QUIZ',
  ASSIGNMENT: 'ASSIGNMENT',
  PROJECT: 'PROJECT',
  PARTICIPATION: 'PARTICIPATION',
} as const;
export type EvaluationType = (typeof EvaluationType)[keyof typeof EvaluationType];

/** The evaluations of a course can be worth at most this much together, in percent. */
export const MAX_TOTAL_WEIGHT = 100;
export const MAX_TITLE_LENGTH = 120;
export const MAX_FEEDBACK_LENGTH = 1000;
/** The largest score the database column holds. */
export const MAX_SCORE_LIMIT = 9999.99;

/** What a Teacher decides about an evaluation. `weight` is the percent of the course it is worth. */
export interface EvaluationData {
  title: string;
  type: EvaluationType;
  weight: number;
  maxScore: number;
  dueAt: Date | null;
}

export interface Evaluation extends EvaluationData {
  id: string;
  /** Students see an evaluation, and can be graded in it, only once it is published. */
  isPublished: boolean;
}

export interface Grade {
  evaluationId: string;
  enrollmentId: string;
  score: number;
  feedback: string | null;
  gradedAt: Date;
}

/** A score to store, or null to remove the one stored. */
export interface GradeEntry {
  enrollmentId: string;
  score: number | null;
  /** Left out to keep the feedback already given; null removes it. */
  feedback?: string | null;
}

export interface SubjectRef {
  id: string;
  code: string;
  name: string;
}

export interface PersonRef {
  membershipId: string;
  firstName: string;
  lastName: string;
}

/** One subject of one group, with the Teacher who grades it. */
export interface GradedCourse {
  courseId: string;
  groupId: string;
  groupName: string;
  subject: SubjectRef;
  teacherMembershipId: string | null;
}

export interface EnrolledStudent extends PersonRef {
  enrollmentId: string;
}

/** Where a Student stands in a course. */
export interface Standing {
  /** Percent of the graded work the Student earned, 0 to 100; null while nothing is graded. */
  average: number | null;
  /** Percent of the course the graded evaluations are worth together. */
  gradedWeight: number;
}

// Scores and weights have two decimals; adding them as hundredths keeps sums exact
const toHundredths = (value: number) => Math.round(value * 100);
const round = (value: number) => Math.round(value * 100) / 100;

export function totalWeight(evaluations: ReadonlyArray<{ weight: number }>): number {
  return evaluations.reduce((sum, evaluation) => sum + toHundredths(evaluation.weight), 0) / 100;
}

/** How much weight is left for new evaluations in a course, in percent; never below zero. */
export function availableWeight(evaluations: ReadonlyArray<{ weight: number }>): number {
  return Math.max(0, toHundredths(MAX_TOTAL_WEIGHT) - toHundredths(totalWeight(evaluations))) / 100;
}

/** Whether an evaluation worth `weight` fits beside the others of its course. */
export function fitsWeight(others: ReadonlyArray<{ weight: number }>, weight: number): boolean {
  return toHundredths(totalWeight(others)) + toHundredths(weight) <= toHundredths(MAX_TOTAL_WEIGHT);
}

/**
 * The weighted average of a Student over the published evaluations they have a
 * score in. Evaluations not graded yet do not count, for or against.
 */
export function standingOf(
  evaluations: ReadonlyArray<Evaluation>,
  scoreIn: (evaluationId: string) => number | undefined,
): Standing {
  let earned = 0;
  let gradedWeight = 0;
  for (const evaluation of evaluations) {
    const score = scoreIn(evaluation.id);
    if (!evaluation.isPublished || score === undefined) {
      continue;
    }
    earned += (score / evaluation.maxScore) * evaluation.weight;
    gradedWeight += toHundredths(evaluation.weight);
  }
  return {
    average: gradedWeight > 0 ? round((earned / (gradedWeight / 100)) * 100) : null,
    gradedWeight: gradedWeight / 100,
  };
}

export class CourseNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'COURSE_NOT_FOUND', 'Course not found');
  }
}

export class NotCourseTeacherException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'NOT_COURSE_TEACHER', 'Only the Teacher assigned to this subject may do this');
  }
}

export class EvaluationNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'EVALUATION_NOT_FOUND', 'Evaluation not found');
  }
}

export class EvaluationWeightExceededException extends DomainException {
  constructor(available: number) {
    super(
      'CONFLICT',
      'EVALUATION_WEIGHT_EXCEEDED',
      `The evaluations of a course cannot be worth more than ${MAX_TOTAL_WEIGHT}% together; ${available}% is left`,
    );
  }
}

export class InvalidEvaluationException extends DomainException {
  constructor(message: string) {
    super('VALIDATION', 'INVALID_EVALUATION', message);
  }
}

export class EvaluationHasGradesException extends DomainException {
  constructor() {
    super('CONFLICT', 'EVALUATION_HAS_GRADES', 'The maximum score cannot change once grades exist');
  }
}

export class EvaluationAlreadyPublishedException extends DomainException {
  constructor() {
    super('CONFLICT', 'EVALUATION_ALREADY_PUBLISHED', 'Only a draft evaluation can be deleted');
  }
}

export class EvaluationNotPublishedException extends DomainException {
  constructor() {
    super('CONFLICT', 'EVALUATION_NOT_PUBLISHED', 'Publish the evaluation before grading it');
  }
}

export class ScoreOutOfRangeException extends DomainException {
  constructor(maxScore: number) {
    super('VALIDATION', 'SCORE_OUT_OF_RANGE', `A score must be between 0 and ${maxScore}`);
  }
}

export class StudentNotEnrolledException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'STUDENT_NOT_ENROLLED', 'The student is not enrolled in this group');
  }
}
