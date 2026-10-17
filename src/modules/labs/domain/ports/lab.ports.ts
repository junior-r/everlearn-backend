import type {
  AssignmentData,
  LabAssignment,
  LabAttempt,
  LabCourse,
  PersonRef,
} from '../lab-assignment.js';
import type { InstitutionLab, LabKey } from '../lab-catalog.js';
import type { ExerciseData, LanguageExercise, LanguageLabKey } from '../language-exercise.js';

export const LAB_ACCESS_REPOSITORY = Symbol('LabAccessRepository');
export const LANGUAGE_EXERCISE_REPOSITORY = Symbol('LanguageExerciseRepository');
export const LAB_ASSIGNMENT_REPOSITORY = Symbol('LabAssignmentRepository');

/** The grant and the switch of each lab, per institution. */
export interface LabAccessRepository {
  institutionExists(institutionId: string): Promise<boolean>;
  /** The labs decided on in the institution; a lab not listed was never granted. */
  list(institutionId: string): Promise<InstitutionLab[]>;
  /** Grants or withdraws a lab. A lab granted again keeps the switch it had. */
  setGranted(institutionId: string, labKey: LabKey, granted: boolean): Promise<void>;
  /** Switches a lab already decided on; does nothing for one never granted. */
  setEnabled(institutionId: string, labKey: LabKey, enabled: boolean): Promise<void>;
}

/** An exercise of the platform's own bank, with the stable id it is stored under. */
export interface BuiltInExercise extends ExerciseData {
  id: string;
  labKey: LanguageLabKey;
}

export interface NewExercise extends ExerciseData {
  labKey: LanguageLabKey;
  institutionId: string;
  authorId: string;
}

export interface LanguageExerciseRepository {
  /** The bank's exercises of a lab, oldest first, archived ones left out. */
  listBuiltIn(labKey: LanguageLabKey): Promise<LanguageExercise[]>;
  /** The exercises a Teacher wrote for a lab in an institution, oldest first, archived ones left out. */
  listAuthored(institutionId: string, authorId: string, labKey: LanguageLabKey): Promise<LanguageExercise[]>;
  /** Archived ones included: an activity keeps the exercises it was given. Unknown ids are left out. */
  findMany(ids: readonly string[]): Promise<LanguageExercise[]>;
  create(data: NewExercise): Promise<LanguageExercise>;
  update(id: string, data: ExerciseData): Promise<LanguageExercise>;
  /** Hides an exercise from new activities; activities that use it keep it. */
  archive(id: string): Promise<void>;
  /** Writes the bank: adds new exercises, rewrites changed ones and archives those no longer in it. */
  syncBuiltIn(bank: readonly BuiltInExercise[]): Promise<void>;
}

/** An activity with how many of its Students handed it in. */
export interface AssignmentSummary extends LabAssignment {
  submittedCount: number;
  studentCount: number;
}

/** An activity as one Student sees it, with what they handed in. */
export interface StudentAssignment extends LabAssignment {
  attempt: LabAttempt | null;
}

export interface LabAssignmentRepository {
  /** Resolves to null unless the group belongs to the institution and takes the subject. */
  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<LabCourse | null>;
  create(courseId: string, createdById: string, data: AssignmentData): Promise<LabAssignment>;
  /** Resolves to null unless the activity belongs to the institution. */
  find(institutionId: string, assignmentId: string): Promise<LabAssignment | null>;
  /** The activities of a course, newest first. */
  listForCourse(courseId: string): Promise<AssignmentSummary[]>;
  delete(assignmentId: string): Promise<void>;
  /** The Students actively enrolled in a group, by name. */
  listStudents(groupId: string): Promise<PersonRef[]>;
  isEnrolled(groupId: string, studentId: string): Promise<boolean>;
  /** The activities of every group the Student is actively enrolled in, inside the institution. */
  listForStudent(institutionId: string, studentId: string): Promise<StudentAssignment[]>;
  findAttempt(assignmentId: string, studentId: string): Promise<LabAttempt | null>;
  listAttempts(assignmentId: string): Promise<LabAttempt[]>;
  /** Rejects with AttemptAlreadySubmittedException when the Student already handed it in. */
  saveAttempt(assignmentId: string, attempt: LabAttempt): Promise<void>;
}
