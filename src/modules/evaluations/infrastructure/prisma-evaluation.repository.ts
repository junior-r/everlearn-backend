import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
  type PrismaErrorMap,
} from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import {
  EvaluationNotFoundException,
  StudentNotEnrolledException,
  type EnrolledStudent,
  type Evaluation,
  type EvaluationData,
  type Grade,
  type GradedCourse,
  type GradeEntry,
} from '../domain/evaluation.js';
import type {
  DueEvaluation,
  DueFor,
  EvaluationRepository,
  OwnedEvaluation,
  StudentCourse,
} from '../domain/ports/evaluation.ports.js';

const courseInclude = {
  group: { select: { id: true, name: true } },
  pensumSubject: { include: { subject: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.CourseInclude;

type CourseRow = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;
type EvaluationRow = Prisma.EvaluationGetPayload<object>;
type GradeRow = Prisma.GradeGetPayload<object>;

const evaluationOrder = [
  { dueAt: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
] satisfies Prisma.EvaluationOrderByWithRelationInput[];

function toCourse(row: CourseRow): GradedCourse {
  return {
    courseId: row.id,
    groupId: row.group.id,
    groupName: row.group.name,
    subject: row.pensumSubject.subject,
    teacherMembershipId: row.teacherId,
  };
}

function toEvaluation(row: EvaluationRow): Evaluation {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    weight: row.weight.toNumber(),
    maxScore: row.maxScore.toNumber(),
    dueAt: row.dueAt,
    isPublished: row.isPublished,
  };
}

function toGrade(row: GradeRow): Grade {
  return {
    evaluationId: row.evaluationId,
    enrollmentId: row.enrollmentId,
    score: row.score.toNumber(),
    feedback: row.feedback,
    gradedAt: row.gradedAt,
  };
}

const evaluationGone: PrismaErrorMap = {
  [PrismaErrorCode.RECORD_NOT_FOUND]: () => new EvaluationNotFoundException(),
};

@Injectable()
export class PrismaEvaluationRepository implements EvaluationRepository {
  private readonly logger = new Logger(PrismaEvaluationRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<GradedCourse | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.course.findFirst({
        where: { groupId, group: { institutionId }, pensumSubject: { subjectId } },
        include: courseInclude,
      });
      return row && toCourse(row);
    });
  }

  findEvaluation(institutionId: string, evaluationId: string): Promise<OwnedEvaluation | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.evaluation.findFirst({
        where: { id: evaluationId, course: { group: { institutionId } } },
        include: { course: { include: courseInclude }, _count: { select: { grades: true } } },
      });
      return row && { ...toEvaluation(row), course: toCourse(row.course), hasGrades: row._count.grades > 0 };
    });
  }

  listEvaluations(courseId: string): Promise<Evaluation[]> {
    return runQuery(this.logger, async () =>
      (await this.prisma.evaluation.findMany({ where: { courseId }, orderBy: evaluationOrder })).map(
        toEvaluation,
      ),
    );
  }

  create(courseId: string, data: EvaluationData): Promise<Evaluation> {
    return runQuery(this.logger, async () =>
      toEvaluation(await this.prisma.evaluation.create({ data: { ...data, courseId } })),
    );
  }

  update(evaluationId: string, data: EvaluationData): Promise<Evaluation> {
    return runQuery(
      this.logger,
      async () => toEvaluation(await this.prisma.evaluation.update({ where: { id: evaluationId }, data })),
      evaluationGone,
    );
  }

  publish(evaluationId: string): Promise<Evaluation> {
    return runQuery(
      this.logger,
      async () =>
        toEvaluation(
          await this.prisma.evaluation.update({ where: { id: evaluationId }, data: { isPublished: true } }),
        ),
      evaluationGone,
    );
  }

  delete(evaluationId: string): Promise<void> {
    return runQuery(this.logger, async () => {
      // deleteMany: a draft already deleted by another request is not an error
      await this.prisma.evaluation.deleteMany({ where: { id: evaluationId, isPublished: false } });
    });
  }

  listStudents(groupId: string): Promise<EnrolledStudent[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.enrollment.findMany({
        where: { groupId, status: 'ACTIVE' },
        select: {
          id: true,
          studentId: true,
          student: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: [{ student: { user: { lastName: 'asc' } } }, { student: { user: { firstName: 'asc' } } }],
      });
      return rows.map((row) => ({
        enrollmentId: row.id,
        membershipId: row.studentId,
        firstName: row.student.user.firstName,
        lastName: row.student.user.lastName,
      }));
    });
  }

  listGrades(courseId: string): Promise<Grade[]> {
    return runQuery(this.logger, async () =>
      (await this.prisma.grade.findMany({ where: { evaluation: { courseId } } })).map(toGrade),
    );
  }

  saveGrades(evaluationId: string, gradedById: string, entries: GradeEntry[]): Promise<void> {
    const removed = entries.filter((entry) => entry.score === null).map((entry) => entry.enrollmentId);
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.$transaction([
          this.prisma.grade.deleteMany({ where: { evaluationId, enrollmentId: { in: removed } } }),
          ...entries.flatMap(({ enrollmentId, score, feedback }) =>
            score === null
              ? []
              : [
                  this.prisma.grade.upsert({
                    where: { evaluationId_enrollmentId: { evaluationId, enrollmentId } },
                    create: { evaluationId, enrollmentId, score, feedback, gradedById },
                    update: { score, feedback, gradedById, gradedAt: new Date() },
                  }),
                ],
          ),
        ]);
      },
      // An enrollment or evaluation deleted between the check and the write
      { [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new StudentNotEnrolledException() },
    );
  }

  listStudentCourses(institutionId: string, studentMembershipId: string): Promise<StudentCourse[]> {
    return runQuery(this.logger, async () => {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { studentId: studentMembershipId, status: 'ACTIVE', group: { institutionId } },
        select: {
          id: true,
          group: {
            select: {
              courses: {
                include: {
                  ...courseInclude,
                  teacher: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
                  evaluations: { where: { isPublished: true }, orderBy: evaluationOrder },
                },
                orderBy: { pensumSubject: { subject: { name: 'asc' } } },
              },
            },
          },
        },
        orderBy: { group: { name: 'asc' } },
      });
      const grades = await this.prisma.grade.findMany({
        where: { enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) } },
      });
      return enrollments.flatMap((enrollment) =>
        enrollment.group.courses.map((course) => {
          const evaluationIds = new Set(course.evaluations.map((evaluation) => evaluation.id));
          return {
            course: toCourse(course),
            teacher: course.teacher && {
              membershipId: course.teacher.id,
              firstName: course.teacher.user.firstName,
              lastName: course.teacher.user.lastName,
            },
            evaluations: course.evaluations.map(toEvaluation),
            grades: grades
              .filter((grade) => grade.enrollmentId === enrollment.id && evaluationIds.has(grade.evaluationId))
              .map(toGrade),
          };
        }),
      );
    });
  }

  listDue(institutionId: string, who: DueFor, from: Date, to: Date | null): Promise<DueEvaluation[]> {
    const course: Prisma.CourseWhereInput =
      'teacherId' in who
        ? { teacherId: who.teacherId, group: { institutionId } }
        : {
            group: {
              institutionId,
              enrollments: { some: { studentId: who.studentId, status: 'ACTIVE' } },
            },
          };
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.evaluation.findMany({
        where: {
          course,
          dueAt: { gte: from, ...(to && { lt: to }) },
          ...('studentId' in who && { isPublished: true }),
        },
        include: { course: { include: courseInclude } },
        orderBy: { dueAt: 'asc' },
      });
      return rows.flatMap((row) =>
        row.dueAt
          ? [{ evaluation: { ...toEvaluation(row), dueAt: row.dueAt }, course: toCourse(row.course) }]
          : [],
      );
    });
  }
}
