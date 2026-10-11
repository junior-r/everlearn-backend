import { randomUUID } from 'node:crypto';
import type {
  EnrolledStudent,
  Evaluation,
  EvaluationData,
  Grade,
  GradedCourse,
  GradeEntry,
} from '../../src/modules/evaluations/domain/evaluation.js';
import type {
  DueEvaluation,
  DueFor,
  EvaluationRepository,
  OwnedEvaluation,
  StudentCourse,
} from '../../src/modules/evaluations/domain/ports/evaluation.ports.js';
import type { InMemoryGroupRepository, InMemoryMemberDirectory } from './group.fakes.js';

interface StoredEvaluation extends Evaluation {
  courseId: string;
}

interface StoredGrade extends Grade {
  gradedById: string;
}

const courseKey = (groupId: string, subjectId: string) => `${groupId}:${subjectId}`;

/**
 * Evaluations and grades. Courses, teachers and enrollments are read from the
 * academics fakes; a Student's membership id stands in for their enrollment id.
 */
export class InMemoryEvaluationRepository implements EvaluationRepository {
  readonly evaluations: StoredEvaluation[] = [];
  readonly grades: StoredGrade[] = [];

  constructor(
    private readonly groups: InMemoryGroupRepository,
    private readonly directory: InMemoryMemberDirectory,
  ) {}

  private courseOf(courseId: string): GradedCourse | null {
    const [groupId, subjectId] = courseId.split(':');
    const group = this.groups.rows.find((row) => row.id === groupId);
    const teacherId = group?.teachers.get(subjectId);
    return group && teacherId
      ? {
          courseId,
          groupId,
          groupName: group.name,
          subject: { id: subjectId, code: '', name: '' },
          teacherMembershipId: teacherId,
        }
      : null;
  }

  private publicView({ courseId: _courseId, ...evaluation }: StoredEvaluation): Evaluation {
    return evaluation;
  }

  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<GradedCourse | null> {
    const group = this.groups.rows.find((row) => row.id === groupId && row.institutionId === institutionId);
    return Promise.resolve(group ? this.courseOf(courseKey(groupId, subjectId)) : null);
  }

  findEvaluation(institutionId: string, evaluationId: string): Promise<OwnedEvaluation | null> {
    const stored = this.evaluations.find((evaluation) => evaluation.id === evaluationId);
    const course = stored && this.courseOf(stored.courseId);
    const group = this.groups.rows.find((row) => row.id === course?.groupId);
    if (!stored || !course || group?.institutionId !== institutionId) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...this.publicView(stored),
      course,
      hasGrades: this.grades.some((grade) => grade.evaluationId === evaluationId),
    });
  }

  listEvaluations(courseId: string): Promise<Evaluation[]> {
    return Promise.resolve(
      this.evaluations
        .filter((evaluation) => evaluation.courseId === courseId)
        .map((evaluation) => this.publicView(evaluation)),
    );
  }

  create(courseId: string, data: EvaluationData): Promise<Evaluation> {
    const stored: StoredEvaluation = { ...data, id: randomUUID(), courseId, isPublished: false };
    this.evaluations.push(stored);
    return Promise.resolve(this.publicView(stored));
  }

  private change(evaluationId: string, changes: Partial<StoredEvaluation>): Promise<Evaluation> {
    const stored = this.evaluations.find((evaluation) => evaluation.id === evaluationId);
    if (!stored) {
      throw new Error(`No evaluation ${evaluationId}`);
    }
    Object.assign(stored, changes);
    return Promise.resolve(this.publicView(stored));
  }

  update(evaluationId: string, data: EvaluationData): Promise<Evaluation> {
    return this.change(evaluationId, data);
  }

  publish(evaluationId: string): Promise<Evaluation> {
    return this.change(evaluationId, { isPublished: true });
  }

  delete(evaluationId: string): Promise<void> {
    const index = this.evaluations.findIndex((evaluation) => evaluation.id === evaluationId);
    if (index >= 0) {
      this.evaluations.splice(index, 1);
    }
    return Promise.resolve();
  }

  listStudents(groupId: string): Promise<EnrolledStudent[]> {
    const group = this.groups.rows.find((row) => row.id === groupId);
    return Promise.resolve(
      (group?.studentIds ?? []).map((studentId) => {
        const { membershipId, firstName, lastName } = this.directory.describe(studentId);
        return { enrollmentId: studentId, membershipId, firstName, lastName };
      }),
    );
  }

  listGrades(courseId: string): Promise<Grade[]> {
    const ids = new Set(
      this.evaluations.filter((evaluation) => evaluation.courseId === courseId).map(({ id }) => id),
    );
    return Promise.resolve(this.grades.filter((grade) => ids.has(grade.evaluationId)));
  }

  saveGrades(evaluationId: string, gradedById: string, entries: GradeEntry[]): Promise<void> {
    for (const { enrollmentId, score, feedback } of entries) {
      const index = this.grades.findIndex(
        (grade) => grade.evaluationId === evaluationId && grade.enrollmentId === enrollmentId,
      );
      const kept = index >= 0 ? this.grades.splice(index, 1)[0].feedback : null;
      if (score !== null) {
        this.grades.push({
          evaluationId,
          enrollmentId,
          score,
          feedback: feedback === undefined ? kept : feedback,
          gradedById,
          gradedAt: new Date(),
        });
      }
    }
    return Promise.resolve();
  }

  listStudentCourses(institutionId: string, studentMembershipId: string): Promise<StudentCourse[]> {
    const courses = this.groups.rows
      .filter((group) => group.institutionId === institutionId && group.studentIds.includes(studentMembershipId))
      .flatMap((group) =>
        [...group.teachers].flatMap(([subjectId, teacherId]): StudentCourse[] => {
          const course = this.courseOf(courseKey(group.id, subjectId));
          if (!course) {
            return [];
          }
          const evaluations = this.evaluations.filter(
            (evaluation) => evaluation.courseId === course.courseId && evaluation.isPublished,
          );
          const { membershipId, firstName, lastName } = this.directory.describe(teacherId);
          return [
            {
              course,
              teacher: { membershipId, firstName, lastName },
              evaluations: evaluations.map((evaluation) => this.publicView(evaluation)),
              grades: this.grades.filter(
                (grade) =>
                  grade.enrollmentId === studentMembershipId &&
                  evaluations.some((evaluation) => evaluation.id === grade.evaluationId),
              ),
            },
          ];
        }),
      );
    return Promise.resolve(courses);
  }

  listDue(institutionId: string, who: DueFor, from: Date, to: Date | null): Promise<DueEvaluation[]> {
    const due = this.evaluations.flatMap((stored): DueEvaluation[] => {
      const course = this.courseOf(stored.courseId);
      const group = this.groups.rows.find((row) => row.id === course?.groupId);
      const { dueAt } = stored;
      if (!course || !group || group.institutionId !== institutionId || !dueAt) {
        return [];
      }
      const concerns =
        'teacherId' in who
          ? course.teacherMembershipId === who.teacherId
          : stored.isPublished && group.studentIds.includes(who.studentId);
      const inRange = dueAt >= from && (!to || dueAt < to);
      return concerns && inRange ? [{ evaluation: { ...this.publicView(stored), dueAt }, course }] : [];
    });
    return Promise.resolve(due);
  }
}
