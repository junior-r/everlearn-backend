import type {
  EnrolledStudent,
  Evaluation,
  EvaluationData,
  Grade,
  GradedCourse,
  GradeEntry,
  PersonRef,
} from '../evaluation.js';

export const EVALUATION_REPOSITORY = Symbol('EvaluationRepository');

/** An evaluation with what deciding who may change it requires. */
export interface OwnedEvaluation extends Evaluation {
  course: GradedCourse;
  hasGrades: boolean;
}

/** A course as one enrolled Student sees it: its published evaluations and the Student's own grades. */
export interface StudentCourse {
  course: GradedCourse;
  teacher: PersonRef | null;
  evaluations: Evaluation[];
  grades: Grade[];
}

/** An evaluation with a due date, placed in its course. */
export interface DueEvaluation {
  evaluation: Evaluation & { dueAt: Date };
  course: GradedCourse;
}

/** Whose evaluations to look for: those a Teacher sets, or those a Student must hand in. */
export type DueFor = { teacherId: string } | { studentId: string };

export interface EvaluationRepository {
  /** Resolves to null unless the group belongs to the institution and takes the subject. */
  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<GradedCourse | null>;
  /** Resolves to null unless the evaluation belongs to the institution. */
  findEvaluation(institutionId: string, evaluationId: string): Promise<OwnedEvaluation | null>;
  /** Every evaluation of a course, drafts included, by due date. */
  listEvaluations(courseId: string): Promise<Evaluation[]>;
  create(courseId: string, data: EvaluationData): Promise<Evaluation>;
  update(evaluationId: string, data: EvaluationData): Promise<Evaluation>;
  publish(evaluationId: string): Promise<Evaluation>;
  delete(evaluationId: string): Promise<void>;
  /** The Students actively enrolled in a group, by name. */
  listStudents(groupId: string): Promise<EnrolledStudent[]>;
  listGrades(courseId: string): Promise<Grade[]>;
  /** Stores each score, replacing the one there was, and removes those entered as null. */
  saveGrades(evaluationId: string, gradedById: string, entries: GradeEntry[]): Promise<void>;
  /** The courses of the groups a Student is actively enrolled in, inside the institution. */
  listStudentCourses(institutionId: string, studentMembershipId: string): Promise<StudentCourse[]>;
  /** Evaluations due from `from` on, and before `to` when given. A Student gets published ones only. */
  listDue(institutionId: string, who: DueFor, from: Date, to: Date | null): Promise<DueEvaluation[]>;
}
