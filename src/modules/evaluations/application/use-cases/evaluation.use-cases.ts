import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { NotificationType, type Notifier } from '../../../../shared/domain/notifications/notifier.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  availableWeight,
  CourseNotFoundException,
  EvaluationAlreadyPublishedException,
  EvaluationHasGradesException,
  EvaluationNotFoundException,
  EvaluationNotPublishedException,
  EvaluationWeightExceededException,
  fitsWeight,
  InvalidEvaluationException,
  MAX_SCORE_LIMIT,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_WEIGHT,
  NotCourseTeacherException,
  ScoreOutOfRangeException,
  standingOf,
  StudentNotEnrolledException,
  totalWeight,
  type EnrolledStudent,
  type Evaluation,
  type EvaluationData,
  type GradedCourse,
  type GradeEntry,
  type PersonRef,
  type Standing,
  type SubjectRef,
} from '../../domain/evaluation.js';
import { gradebookCsv, type CsvFormat } from '../../domain/gradebook-csv.js';
import type { EvaluationRepository } from '../../domain/ports/evaluation.ports.js';

/** Who is asking, and in which institution. */
export interface Actor {
  institutionId: string;
  memberships: MembershipClaim[];
}

export interface CourseRef {
  groupId: string;
  subjectId: string;
}

const membershipIds = (actor: Actor, role: Role) =>
  actor.memberships
    .filter((membership) => membership.institutionId === actor.institutionId && membership.role === role)
    .map((membership) => membership.id);

/** The Teacher membership through which the actor is assigned to the course. */
function requireTeacher(actor: Actor, course: GradedCourse): string {
  const teacherId = membershipIds(actor, Role.TEACHER).find((id) => id === course.teacherMembershipId);
  if (!teacherId) {
    throw new NotCourseTeacherException();
  }
  return teacherId;
}

const hasTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/** Returns the data cleaned up, or refuses values no evaluation can have. */
function checked(data: EvaluationData): EvaluationData {
  const title = data.title.trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new InvalidEvaluationException(`A title must have between 1 and ${MAX_TITLE_LENGTH} characters`);
  }
  if (!(data.weight > 0 && data.weight <= MAX_TOTAL_WEIGHT) || !hasTwoDecimals(data.weight)) {
    throw new InvalidEvaluationException(`A weight must be above 0 and at most ${MAX_TOTAL_WEIGHT}`);
  }
  if (!(data.maxScore > 0 && data.maxScore <= MAX_SCORE_LIMIT) || !hasTwoDecimals(data.maxScore)) {
    throw new InvalidEvaluationException(`A maximum score must be above 0 and at most ${MAX_SCORE_LIMIT}`);
  }
  return { ...data, title };
}

function requireFit(others: Evaluation[], weight: number): void {
  if (!fitsWeight(others, weight)) {
    throw new EvaluationWeightExceededException(MAX_TOTAL_WEIGHT - totalWeight(others));
  }
}

async function requireCourse(
  evaluations: EvaluationRepository,
  actor: Actor,
  { groupId, subjectId }: CourseRef,
): Promise<GradedCourse> {
  const course = await evaluations.findCourse(actor.institutionId, groupId, subjectId);
  if (!course) {
    throw new CourseNotFoundException();
  }
  return course;
}

async function requireOwnEvaluation(evaluations: EvaluationRepository, actor: Actor, evaluationId: string) {
  const evaluation = await evaluations.findEvaluation(actor.institutionId, evaluationId);
  if (!evaluation) {
    throw new EvaluationNotFoundException();
  }
  return { evaluation, teacherId: requireTeacher(actor, evaluation.course) };
}

export class CreateEvaluationUseCase {
  constructor(private readonly evaluations: EvaluationRepository) {}

  /** Adds a draft evaluation to a course; only its assigned Teacher may, and only within 100% of weight. */
  async execute(actor: Actor, courseRef: CourseRef, data: EvaluationData): Promise<Evaluation> {
    const course = await requireCourse(this.evaluations, actor, courseRef);
    requireTeacher(actor, course);
    const evaluation = checked(data);
    requireFit(await this.evaluations.listEvaluations(course.courseId), evaluation.weight);
    return this.evaluations.create(course.courseId, evaluation);
  }
}

export class UpdateEvaluationUseCase {
  constructor(private readonly evaluations: EvaluationRepository) {}

  /** Changes an evaluation. The maximum score is fixed once grades exist, since they were given against it. */
  async execute(actor: Actor, evaluationId: string, changes: Partial<EvaluationData>): Promise<Evaluation> {
    const { evaluation: current } = await requireOwnEvaluation(this.evaluations, actor, evaluationId);
    const next = checked({
      title: changes.title ?? current.title,
      type: changes.type ?? current.type,
      weight: changes.weight ?? current.weight,
      maxScore: changes.maxScore ?? current.maxScore,
      dueAt: changes.dueAt === undefined ? current.dueAt : changes.dueAt,
    });
    if (next.maxScore !== current.maxScore && current.hasGrades) {
      throw new EvaluationHasGradesException();
    }
    const others = (await this.evaluations.listEvaluations(current.course.courseId)).filter(
      (other) => other.id !== evaluationId,
    );
    requireFit(others, next.weight);
    return this.evaluations.update(evaluationId, next);
  }
}

export class PublishEvaluationUseCase {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly notifier: Notifier,
  ) {}

  /**
   * Makes an evaluation visible to the Students of its course and open to
   * grading, and tells them and their Guardians. Publishing one already published tells nobody again.
   */
  async execute(actor: Actor, evaluationId: string): Promise<Evaluation> {
    const { evaluation: draft } = await requireOwnEvaluation(this.evaluations, actor, evaluationId);
    const published = await this.evaluations.publish(evaluationId);
    if (!draft.isPublished) {
      const { course } = draft;
      const students = await this.evaluations.listStudents(course.groupId);
      const about = {
        evaluationId,
        evaluationTitle: published.title,
        subjectName: course.subject.name,
        groupName: course.groupName,
        dueAt: published.dueAt?.toISOString() ?? null,
      };
      await this.notifier.notify(
        students.flatMap((student) => [
          {
            recipient: { membershipId: student.membershipId },
            institutionId: actor.institutionId,
            type: NotificationType.EVALUATION_PUBLISHED,
            data: about,
          },
          {
            recipient: { guardiansOf: student.membershipId },
            institutionId: actor.institutionId,
            type: NotificationType.WARD_EVALUATION_PUBLISHED,
            data: { ...about, studentId: student.membershipId, studentName: `${student.firstName} ${student.lastName}` },
          },
        ]),
      );
    }
    return published;
  }
}

export class DeleteEvaluationUseCase {
  constructor(private readonly evaluations: EvaluationRepository) {}

  /** Removes a draft. A published evaluation stays: Students have seen it and may hold grades in it. */
  async execute(actor: Actor, evaluationId: string): Promise<void> {
    const { evaluation } = await requireOwnEvaluation(this.evaluations, actor, evaluationId);
    if (evaluation.isPublished) {
      throw new EvaluationAlreadyPublishedException();
    }
    await this.evaluations.delete(evaluationId);
  }
}

export class RecordGradesUseCase {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly notifier: Notifier,
  ) {}

  /**
   * Stores the scores of enrolled Students in a published evaluation; a null
   * score removes the grade. A Student whose score is new or different is
   * told, and so are their Guardians.
   */
  async execute(actor: Actor, evaluationId: string, entries: GradeEntry[]): Promise<void> {
    const { evaluation, teacherId } = await requireOwnEvaluation(this.evaluations, actor, evaluationId);
    if (!evaluation.isPublished) {
      throw new EvaluationNotPublishedException();
    }
    const students = await this.evaluations.listStudents(evaluation.course.groupId);
    const enrolled = new Set(students.map((student) => student.enrollmentId));
    for (const { enrollmentId, score } of entries) {
      if (!enrolled.has(enrollmentId)) {
        throw new StudentNotEnrolledException();
      }
      if (score !== null && !(score >= 0 && score <= evaluation.maxScore && hasTwoDecimals(score))) {
        throw new ScoreOutOfRangeException(evaluation.maxScore);
      }
    }
    const before = new Map(
      (await this.evaluations.listGrades(evaluation.course.courseId))
        .filter((grade) => grade.evaluationId === evaluationId)
        .map((grade) => [grade.enrollmentId, grade.score]),
    );
    await this.evaluations.saveGrades(
      evaluationId,
      teacherId,
      entries.map((entry) => ({
        ...entry,
        feedback: entry.feedback === undefined ? undefined : entry.feedback?.trim() || null,
      })),
    );
    const about = {
      evaluationId,
      evaluationTitle: evaluation.title,
      subjectName: evaluation.course.subject.name,
      groupName: evaluation.course.groupName,
      maxScore: evaluation.maxScore,
    };
    await this.notifier.notify(
      entries.flatMap(({ enrollmentId, score }) => {
        const student = students.find((candidate) => candidate.enrollmentId === enrollmentId);
        // Saving the gradebook again without touching a score tells nobody twice
        if (!student || score === null || before.get(enrollmentId) === score) {
          return [];
        }
        // While a notice about this grade is unread, a correction does not add another
        const collapseKey = `grade:${evaluationId}:${enrollmentId}`;
        return [
          {
            recipient: { membershipId: student.membershipId },
            institutionId: actor.institutionId,
            type: NotificationType.GRADE_POSTED,
            data: { ...about, score },
            collapseKey,
          },
          {
            recipient: { guardiansOf: student.membershipId },
            institutionId: actor.institutionId,
            type: NotificationType.WARD_GRADE_POSTED,
            data: {
              ...about,
              score,
              studentId: student.membershipId,
              studentName: `${student.firstName} ${student.lastName}`,
            },
            collapseKey,
          },
        ];
      }),
    );
  }
}

export interface GradebookRow extends EnrolledStudent, Standing {
  grades: Array<{ evaluationId: string; score: number; feedback: string | null }>;
}

export interface Gradebook {
  groupId: string;
  groupName: string;
  subject: SubjectRef;
  /** Drafts included: the Teacher manages them here, but only published ones can be graded. */
  evaluations: Evaluation[];
  totalWeight: number;
  /** What is left of the 100% for new evaluations; zero when the course is full. */
  availableWeight: number;
  students: GradebookRow[];
}

export class GetGradebookUseCase {
  constructor(private readonly evaluations: EvaluationRepository) {}

  /** A course as its Teacher grades it: every evaluation, every enrolled Student, their scores and averages. */
  async execute(actor: Actor, courseRef: CourseRef): Promise<Gradebook> {
    const course = await requireCourse(this.evaluations, actor, courseRef);
    requireTeacher(actor, course);
    const [evaluations, students, grades] = await Promise.all([
      this.evaluations.listEvaluations(course.courseId),
      this.evaluations.listStudents(course.groupId),
      this.evaluations.listGrades(course.courseId),
    ]);
    return {
      groupId: course.groupId,
      groupName: course.groupName,
      subject: course.subject,
      evaluations,
      totalWeight: totalWeight(evaluations),
      availableWeight: availableWeight(evaluations),
      students: students.map((student) => {
        const own = grades.filter((grade) => grade.enrollmentId === student.enrollmentId);
        const scores = new Map(own.map((grade) => [grade.evaluationId, grade.score]));
        return {
          ...student,
          grades: own.map(({ evaluationId, score, feedback }) => ({ evaluationId, score, feedback })),
          ...standingOf(evaluations, (id) => scores.get(id)),
        };
      }),
    };
  }
}

export interface GradebookFile {
  /** A name for the download, without extension: the subject and the group. */
  name: string;
  csv: string;
}

export class ExportGradebookUseCase {
  constructor(private readonly gradebook: GetGradebookUseCase) {}

  /**
   * The gradebook of a course as a CSV file: enrolled Students, their score in
   * each published evaluation, and their average. It reads the gradebook itself,
   * so only the course's Teacher can export it and the figures are the same.
   */
  async execute(actor: Actor, courseRef: CourseRef, format: CsvFormat): Promise<GradebookFile> {
    const book = await this.gradebook.execute(actor, courseRef);
    const csv = gradebookCsv(
      {
        evaluations: book.evaluations.filter((evaluation) => evaluation.isPublished),
        students: book.students.map((student) => ({
          firstName: student.firstName,
          lastName: student.lastName,
          average: student.average,
          gradedWeight: student.gradedWeight,
          scores: new Map(student.grades.map((grade) => [grade.evaluationId, grade.score])),
        })),
      },
      format,
    );
    return { name: `${book.subject.name} ${book.groupName}`, csv };
  }
}

export interface GradedEvaluation extends Evaluation {
  grade: { score: number; feedback: string | null; gradedAt: Date } | null;
}

export interface CourseProgress extends Standing {
  groupId: string;
  groupName: string;
  subject: SubjectRef;
  teacher: PersonRef | null;
  evaluations: GradedEvaluation[];
}

export class GetMyProgressUseCase {
  constructor(private readonly evaluations: EvaluationRepository) {}

  /** A Student's courses in the institution: published evaluations, the grades received and the current average. */
  async execute(actor: Actor): Promise<CourseProgress[]> {
    const lists = await Promise.all(
      membershipIds(actor, Role.STUDENT).map((id) =>
        this.evaluations.listStudentCourses(actor.institutionId, id),
      ),
    );
    return lists.flat().map(({ course, teacher, evaluations, grades }) => {
      const byEvaluation = new Map(grades.map((grade) => [grade.evaluationId, grade]));
      const published = evaluations.filter((evaluation) => evaluation.isPublished);
      return {
        groupId: course.groupId,
        groupName: course.groupName,
        subject: course.subject,
        teacher,
        evaluations: published.map((evaluation) => {
          const grade = byEvaluation.get(evaluation.id);
          return {
            ...evaluation,
            grade: grade ? { score: grade.score, feedback: grade.feedback, gradedAt: grade.gradedAt } : null,
          };
        }),
        ...standingOf(published, (id) => byEvaluation.get(id)?.score),
      };
    });
  }
}

export interface CalendarEntry {
  id: string;
  title: string;
  type: Evaluation['type'];
  dueAt: Date;
  isPublished: boolean;
  groupId: string;
  groupName: string;
  subject: SubjectRef;
  /** How the member relates to the evaluation: they set it, or they must hand it in. */
  role: 'TEACHER' | 'STUDENT';
}

export class ListDueEvaluationsUseCase {
  constructor(private readonly evaluations: EvaluationRepository) {}

  /** Evaluations due from `from` on across everything the member teaches and attends, soonest first. */
  async execute(actor: Actor, from: Date, to: Date | null): Promise<CalendarEntry[]> {
    if (to && to.getTime() < from.getTime()) {
      throw new InvalidEvaluationException('The end of the range cannot come before its start');
    }
    const lookups = [
      ...membershipIds(actor, Role.TEACHER).map((teacherId) => ({ who: { teacherId }, role: 'TEACHER' as const })),
      ...membershipIds(actor, Role.STUDENT).map((studentId) => ({ who: { studentId }, role: 'STUDENT' as const })),
    ];
    const lists = await Promise.all(
      lookups.map(async ({ who, role }) =>
        (await this.evaluations.listDue(actor.institutionId, who, from, to)).map(
          ({ evaluation, course }): CalendarEntry => ({
            id: evaluation.id,
            title: evaluation.title,
            type: evaluation.type,
            dueAt: evaluation.dueAt,
            isPublished: evaluation.isPublished,
            groupId: course.groupId,
            groupName: course.groupName,
            subject: course.subject,
            role,
          }),
        ),
      ),
    );
    return lists.flat().sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  }
}
