import { Role } from '../../../../shared/domain/auth/role.js';
import { NotificationType, type Notifier } from '../../../../shared/domain/notifications/notifier.js';
import {
  AttemptAlreadySubmittedException,
  checkedAssignment,
  InvalidAssignmentException,
  isLate,
  LabAssignmentNotFoundException,
  LabCourseNotFoundException,
  MAX_ASSIGNMENT_EXERCISES,
  MAX_NOTE_LENGTH,
  NotLabCourseTeacherException,
  type AssignmentData,
  type LabAssignment,
  type LabAttempt,
  type LabCourse,
  type PersonRef,
} from '../../domain/lab-assignment.js';
import { availableLabs, isLanguageLab } from '../../domain/lab-catalog.js';
import {
  markAnswers,
  questionOf,
  scoreOf,
  type ExerciseQuestion,
  type GivenAnswer,
  type LanguageExercise,
} from '../../domain/language-exercise.js';
import type {
  AssignmentSummary,
  LabAccessRepository,
  LabAssignmentRepository,
  LanguageExerciseRepository,
  StudentAssignment,
} from '../../domain/ports/lab.ports.js';
import { membershipIds, type Actor } from '../actor.js';
import { requireAvailableLab } from './lab-access.use-cases.js';
import { isUsableBy } from './language-exercise.use-cases.js';

export interface CourseRef {
  groupId: string;
  subjectId: string;
}

/** The Teacher membership through which the actor is assigned to the course. */
function requireCourseTeacher(actor: Actor, course: LabCourse): string {
  const teacherId = membershipIds(actor, Role.TEACHER).find((id) => id === course.teacherMembershipId);
  if (!teacherId) {
    throw new NotLabCourseTeacherException();
  }
  return teacherId;
}

async function requireOwnAssignment(
  assignments: LabAssignmentRepository,
  actor: Actor,
  assignmentId: string,
): Promise<LabAssignment> {
  const assignment = await assignments.find(actor.institutionId, assignmentId);
  if (!assignment) {
    throw new LabAssignmentNotFoundException();
  }
  requireCourseTeacher(actor, assignment.course);
  return assignment;
}

/** The exercises of an activity, in the activity's order. */
async function exercisesOf(
  exercises: LanguageExerciseRepository,
  assignment: LabAssignment,
): Promise<LanguageExercise[]> {
  const found = await exercises.findMany(assignment.exerciseIds);
  return assignment.exerciseIds.flatMap((id) => found.filter((exercise) => exercise.id === id));
}

/**
 * The activity, if the actor is a Student of its group and its lab is available.
 * Anything else is not found, so a Student cannot learn what other groups were given.
 */
async function requireStudentAssignment(
  access: LabAccessRepository,
  assignments: LabAssignmentRepository,
  actor: Actor,
  assignmentId: string,
): Promise<{ assignment: LabAssignment; studentId: string }> {
  const assignment = await assignments.find(actor.institutionId, assignmentId);
  if (!assignment) {
    throw new LabAssignmentNotFoundException();
  }
  let studentId: string | undefined;
  for (const candidate of membershipIds(actor, Role.STUDENT)) {
    if (await assignments.isEnrolled(assignment.course.groupId, candidate)) {
      studentId = candidate;
      break;
    }
  }
  if (!studentId) {
    throw new LabAssignmentNotFoundException();
  }
  try {
    await requireAvailableLab(access, actor.institutionId, assignment.labKey);
  } catch {
    throw new LabAssignmentNotFoundException();
  }
  return { assignment, studentId };
}

export class CreateLabAssignmentUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly exercises: LanguageExerciseRepository,
    private readonly assignments: LabAssignmentRepository,
    private readonly notifier: Notifier,
  ) {}

  /**
   * Gives a group an activity in an available lab; only the course's Teacher may.
   * A language activity holds exercises from the bank or the Teacher's own; any
   * other lab holds none. Every Student of the group is told.
   */
  async execute(actor: Actor, { groupId, subjectId }: CourseRef, data: AssignmentData): Promise<LabAssignment> {
    const course = await this.assignments.findCourse(actor.institutionId, groupId, subjectId);
    if (!course) {
      throw new LabCourseNotFoundException();
    }
    const teacherId = requireCourseTeacher(actor, course);
    const labKey = await requireAvailableLab(this.access, actor.institutionId, data.labKey);
    const checked = checkedAssignment({ ...data, labKey });
    await this.requireExercises(actor.institutionId, teacherId, checked);
    const assignment = await this.assignments.create(course.courseId, teacherId, checked);
    const students = await this.assignments.listStudents(course.groupId);
    await this.notifier.notify(
      students.map((student) => ({
        recipient: { membershipId: student.membershipId },
        institutionId: actor.institutionId,
        type: NotificationType.LAB_ASSIGNED,
        data: {
          assignmentId: assignment.id,
          labKey: assignment.labKey,
          title: assignment.title,
          subjectName: course.subjectName,
          groupName: course.groupName,
          dueAt: assignment.dueAt?.toISOString() ?? null,
        },
        dedupeKey: `lab-assigned:${assignment.id}:${student.membershipId}`,
      })),
    );
    return assignment;
  }

  private async requireExercises(institutionId: string, teacherId: string, data: AssignmentData) {
    if (!isLanguageLab(data.labKey)) {
      if (data.exerciseIds.length > 0) {
        throw new InvalidAssignmentException('Only a language activity holds exercises');
      }
      return;
    }
    if (data.exerciseIds.length === 0 || data.exerciseIds.length > MAX_ASSIGNMENT_EXERCISES) {
      throw new InvalidAssignmentException(
        `A language activity holds between 1 and ${MAX_ASSIGNMENT_EXERCISES} exercises`,
      );
    }
    const found = await this.exercises.findMany(data.exerciseIds);
    const usable = found.filter(
      (exercise) => exercise.labKey === data.labKey && isUsableBy(exercise, institutionId, teacherId),
    );
    if (usable.length !== data.exerciseIds.length) {
      throw new InvalidAssignmentException('Some exercises do not exist or do not belong to this lab');
    }
  }
}

export class ListCourseLabAssignmentsUseCase {
  constructor(private readonly assignments: LabAssignmentRepository) {}

  /** The activities of a course with how many Students handed each in; only its Teacher may see them. */
  async execute(actor: Actor, { groupId, subjectId }: CourseRef): Promise<AssignmentSummary[]> {
    const course = await this.assignments.findCourse(actor.institutionId, groupId, subjectId);
    if (!course) {
      throw new LabCourseNotFoundException();
    }
    requireCourseTeacher(actor, course);
    return this.assignments.listForCourse(course.courseId);
  }
}

export interface ResultRow {
  student: PersonRef;
  attempt: LabAttempt | null;
  late: boolean;
}

export interface AssignmentResults {
  assignment: LabAssignment;
  /** With their answers: the Teacher wrote or chose them. */
  exercises: LanguageExercise[];
  rows: ResultRow[];
}

export class GetLabAssignmentResultsUseCase {
  constructor(
    private readonly exercises: LanguageExerciseRepository,
    private readonly assignments: LabAssignmentRepository,
  ) {}

  /** Every Student of the group with what they handed in, if anything. */
  async execute(actor: Actor, assignmentId: string): Promise<AssignmentResults> {
    const assignment = await requireOwnAssignment(this.assignments, actor, assignmentId);
    const [students, attempts, exercises] = await Promise.all([
      this.assignments.listStudents(assignment.course.groupId),
      this.assignments.listAttempts(assignment.id),
      exercisesOf(this.exercises, assignment),
    ]);
    const rows = students.map((student) => {
      const attempt = attempts.find((candidate) => candidate.studentId === student.membershipId) ?? null;
      return { student, attempt, late: attempt !== null && isLate(attempt, assignment.dueAt) };
    });
    return { assignment, exercises, rows };
  }
}

export class DeleteLabAssignmentUseCase {
  constructor(private readonly assignments: LabAssignmentRepository) {}

  /** Removes an activity and what was handed in for it; only the course's Teacher may. */
  async execute(actor: Actor, assignmentId: string): Promise<void> {
    const assignment = await requireOwnAssignment(this.assignments, actor, assignmentId);
    await this.assignments.delete(assignment.id);
  }
}

export interface MyAssignment extends StudentAssignment {
  late: boolean;
}

const byDueDate = (left: LabAssignment, right: LabAssignment) =>
  (left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
  right.createdAt.getTime() - left.createdAt.getTime();

export class ListMyLabAssignmentsUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly assignments: LabAssignmentRepository,
  ) {}

  /** The Student's activities in labs still available, the soonest due first. */
  async execute(actor: Actor): Promise<MyAssignment[]> {
    const available = new Set<string>(availableLabs(await this.access.list(actor.institutionId)).map((lab) => lab.key));
    const lists = await Promise.all(
      membershipIds(actor, Role.STUDENT).map((studentId) =>
        this.assignments.listForStudent(actor.institutionId, studentId),
      ),
    );
    return lists
      .flat()
      .filter((assignment) => available.has(assignment.labKey))
      .map((assignment) => ({
        ...assignment,
        late: assignment.attempt !== null && isLate(assignment.attempt, assignment.dueAt),
      }))
      .sort(byDueDate);
  }
}

export interface Solution {
  exerciseId: string;
  answers: string[];
}

export interface MyAssignmentDetail {
  assignment: LabAssignment;
  questions: ExerciseQuestion[];
  attempt: LabAttempt | null;
  /** The accepted answers, shown only once the Student handed the activity in. */
  solutions: Solution[] | null;
}

export class GetMyLabAssignmentUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly exercises: LanguageExerciseRepository,
    private readonly assignments: LabAssignmentRepository,
  ) {}

  async execute(actor: Actor, assignmentId: string): Promise<MyAssignmentDetail> {
    const { assignment, studentId } = await requireStudentAssignment(
      this.access,
      this.assignments,
      actor,
      assignmentId,
    );
    const [exercises, attempt] = await Promise.all([
      exercisesOf(this.exercises, assignment),
      this.assignments.findAttempt(assignment.id, studentId),
    ]);
    return {
      assignment,
      questions: exercises.map(questionOf),
      attempt,
      solutions: attempt && exercises.map(({ id, answers }) => ({ exerciseId: id, answers })),
    };
  }
}

export interface Submission {
  answers: GivenAnswer[];
  note: string | null;
}

export class SubmitLabAttemptUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly exercises: LanguageExerciseRepository,
    private readonly assignments: LabAssignmentRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Hands an activity in, once. A language activity is scored here, from the
   * answers given; any other is done, with the Student's note if they left one.
   */
  async execute(actor: Actor, assignmentId: string, submission: Submission): Promise<LabAttempt> {
    const { assignment, studentId } = await requireStudentAssignment(
      this.access,
      this.assignments,
      actor,
      assignmentId,
    );
    if (await this.assignments.findAttempt(assignment.id, studentId)) {
      throw new AttemptAlreadySubmittedException();
    }
    const note = submission.note?.trim() || null;
    if (note && note.length > MAX_NOTE_LENGTH) {
      throw new InvalidAssignmentException(`A note has at most ${MAX_NOTE_LENGTH} characters`);
    }
    const attempt: LabAttempt = { studentId, submittedAt: this.now(), score: null, total: null, note, answers: [] };
    if (isLanguageLab(assignment.labKey)) {
      const answers = markAnswers(await exercisesOf(this.exercises, assignment), submission.answers);
      Object.assign(attempt, { answers, score: scoreOf(answers), total: answers.length });
    }
    await this.assignments.saveAttempt(assignment.id, attempt);
    return attempt;
  }
}
