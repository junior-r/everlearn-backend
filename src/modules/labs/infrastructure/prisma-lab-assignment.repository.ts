import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
} from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import {
  AttemptAlreadySubmittedException,
  type AssignmentData,
  type LabAssignment,
  type LabAttempt,
  type LabCourse,
  type PersonRef,
} from '../domain/lab-assignment.js';
import { isLabKey, LabKey } from '../domain/lab-catalog.js';
import { Verdict, type MarkedAnswer } from '../domain/language-exercise.js';
import type {
  AssignmentSummary,
  LabAssignmentRepository,
  StudentAssignment,
} from '../domain/ports/lab.ports.js';

const courseInclude = {
  group: { select: { id: true, name: true } },
  pensumSubject: { select: { subject: { select: { id: true, name: true } } } },
} satisfies Prisma.CourseInclude;

const assignmentInclude = {
  course: { include: courseInclude },
  exercises: { select: { exerciseId: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.LabAssignmentInclude;

type CourseRow = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;
type AssignmentRow = Prisma.LabAssignmentGetPayload<{ include: typeof assignmentInclude }>;
type AttemptRow = Prisma.LabAttemptGetPayload<object>;

function toCourse(row: CourseRow): LabCourse {
  return {
    courseId: row.id,
    groupId: row.group.id,
    groupName: row.group.name,
    subjectId: row.pensumSubject.subject.id,
    subjectName: row.pensumSubject.subject.name,
    teacherMembershipId: row.teacherId,
  };
}

function toAssignment(row: AssignmentRow): LabAssignment {
  return {
    id: row.id,
    // Rows are only written with catalogue keys; the fallback keeps the type honest
    labKey: isLabKey(row.labKey) ? row.labKey : LabKey.GRAVITY,
    title: row.title,
    instructions: row.instructions,
    dueAt: row.dueAt,
    exerciseIds: row.exercises.map((exercise) => exercise.exerciseId),
    course: toCourse(row.course),
    createdAt: row.createdAt,
  };
}

const VERDICTS = new Set<string>(Object.values(Verdict));

/** Reads back the answers stored with an attempt, leaving out anything that is not one. */
function toAnswers(value: Prisma.JsonValue): MarkedAnswer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): MarkedAnswer[] => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return [];
    }
    const { exerciseId, answer, verdict } = item;
    return typeof exerciseId === 'string' && typeof answer === 'string' && typeof verdict === 'string' && VERDICTS.has(verdict)
      ? [{ exerciseId, answer, verdict: verdict as Verdict }]
      : [];
  });
}

function toAttempt(row: AttemptRow): LabAttempt {
  return {
    studentId: row.studentId,
    submittedAt: row.submittedAt,
    score: row.score,
    total: row.total,
    note: row.note,
    answers: toAnswers(row.answers),
  };
}

const newestFirst = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.LabAssignmentOrderByWithRelationInput[];

@Injectable()
export class PrismaLabAssignmentRepository implements LabAssignmentRepository {
  private readonly logger = new Logger(PrismaLabAssignmentRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<LabCourse | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.course.findFirst({
        where: { groupId, group: { institutionId }, pensumSubject: { subjectId } },
        include: courseInclude,
      });
      return row && toCourse(row);
    });
  }

  create(courseId: string, createdById: string, data: AssignmentData): Promise<LabAssignment> {
    return runQuery(this.logger, async () =>
      toAssignment(
        await this.prisma.labAssignment.create({
          data: {
            courseId,
            createdById,
            labKey: data.labKey,
            title: data.title,
            instructions: data.instructions,
            dueAt: data.dueAt,
            exercises: { create: data.exerciseIds.map((exerciseId, position) => ({ exerciseId, position })) },
          },
          include: assignmentInclude,
        }),
      ),
    );
  }

  find(institutionId: string, assignmentId: string): Promise<LabAssignment | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.labAssignment.findFirst({
        where: { id: assignmentId, course: { group: { institutionId } } },
        include: assignmentInclude,
      });
      return row && toAssignment(row);
    });
  }

  listForCourse(courseId: string): Promise<AssignmentSummary[]> {
    return runQuery(this.logger, async () => {
      const [rows, course] = await Promise.all([
        this.prisma.labAssignment.findMany({
          where: { courseId },
          include: { ...assignmentInclude, _count: { select: { attempts: true } } },
          orderBy: newestFirst,
        }),
        this.prisma.course.findUnique({ where: { id: courseId }, select: { groupId: true } }),
      ]);
      const studentCount = course
        ? await this.prisma.enrollment.count({ where: { groupId: course.groupId, status: 'ACTIVE' } })
        : 0;
      return rows.map((row) => ({ ...toAssignment(row), submittedCount: row._count.attempts, studentCount }));
    });
  }

  async delete(assignmentId: string): Promise<void> {
    await runQuery(this.logger, () => this.prisma.labAssignment.deleteMany({ where: { id: assignmentId } }));
  }

  listStudents(groupId: string): Promise<PersonRef[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.enrollment.findMany({
        where: { groupId, status: 'ACTIVE' },
        select: { studentId: true, student: { select: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: [{ student: { user: { lastName: 'asc' } } }, { student: { user: { firstName: 'asc' } } }],
      });
      return rows.map((row) => ({
        membershipId: row.studentId,
        firstName: row.student.user.firstName,
        lastName: row.student.user.lastName,
      }));
    });
  }

  isEnrolled(groupId: string, studentId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () => (await this.prisma.enrollment.count({ where: { groupId, studentId, status: 'ACTIVE' } })) > 0,
    );
  }

  listForStudent(institutionId: string, studentId: string): Promise<StudentAssignment[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.labAssignment.findMany({
        where: {
          course: { group: { institutionId, enrollments: { some: { studentId, status: 'ACTIVE' } } } },
        },
        include: { ...assignmentInclude, attempts: { where: { studentId } } },
        orderBy: newestFirst,
      });
      return rows.map((row) => ({
        ...toAssignment(row),
        attempt: row.attempts[0] ? toAttempt(row.attempts[0]) : null,
      }));
    });
  }

  findAttempt(assignmentId: string, studentId: string): Promise<LabAttempt | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.labAttempt.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId } },
      });
      return row && toAttempt(row);
    });
  }

  listAttempts(assignmentId: string): Promise<LabAttempt[]> {
    return runQuery(this.logger, async () =>
      (await this.prisma.labAttempt.findMany({ where: { assignmentId } })).map(toAttempt),
    );
  }

  async saveAttempt(assignmentId: string, attempt: LabAttempt): Promise<void> {
    await runQuery(
      this.logger,
      () =>
        this.prisma.labAttempt.create({
          data: {
            assignmentId,
            studentId: attempt.studentId,
            submittedAt: attempt.submittedAt,
            score: attempt.score,
            total: attempt.total,
            note: attempt.note,
            answers: attempt.answers.map(({ exerciseId, answer, verdict }) => ({ exerciseId, answer, verdict })),
          },
        }),
      { [PrismaErrorCode.UNIQUE_VIOLATION]: () => new AttemptAlreadySubmittedException() },
    );
  }
}
