import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AcademicPeriod as PeriodRow,
  Prisma,
} from '../../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
} from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import {
  GroupInUseException,
  GroupNameTakenException,
  PeriodNameTakenException,
  StudentAlreadyEnrolledException,
  type AcademicPeriod,
  type Group,
  type GroupSummary,
  type InstitutionMember,
} from '../../domain/entities/group.entities.js';
import type {
  GroupData,
  GroupRepository,
  MemberDirectory,
  PeriodData,
  PeriodRepository,
} from '../../domain/ports/group.repositories.js';

const toDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

function toPeriod(row: PeriodRow): AcademicPeriod {
  return {
    id: row.id,
    institutionId: row.institutionId,
    name: row.name,
    startDate: toIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
  };
}

@Injectable()
export class PrismaPeriodRepository implements PeriodRepository {
  private readonly logger = new Logger(PrismaPeriodRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(institutionId: string): Promise<AcademicPeriod[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.academicPeriod.findMany({
          where: { institutionId },
          orderBy: { startDate: 'desc' },
        })
      ).map(toPeriod),
    );
  }

  findById(institutionId: string, id: string): Promise<AcademicPeriod | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.academicPeriod.findFirst({ where: { id, institutionId } });
      return row ? toPeriod(row) : null;
    });
  }

  create(institutionId: string, period: PeriodData): Promise<AcademicPeriod> {
    return runQuery(
      this.logger,
      async () =>
        toPeriod(
          await this.prisma.academicPeriod.create({
            data: {
              institutionId,
              name: period.name,
              startDate: toDate(period.startDate),
              endDate: toDate(period.endDate),
            },
          }),
        ),
      { [PrismaErrorCode.UNIQUE_VIOLATION]: () => new PeriodNameTakenException() },
    );
  }
}

const person = { select: { firstName: true, lastName: true, email: true } } as const;

const summaryInclude = {
  pensum: { select: { id: true, code: true, name: true, version: true } },
  period: { select: { id: true, name: true } },
  _count: { select: { enrollments: true } },
} satisfies Prisma.GroupInclude;

const detailInclude = {
  ...summaryInclude,
  courses: { include: { teacher: { include: { user: person } } } },
  enrollments: {
    include: { student: { include: { user: person } } },
    orderBy: [{ student: { user: { lastName: 'asc' } } }, { student: { user: { firstName: 'asc' } } }],
  },
} satisfies Prisma.GroupInclude;

type SummaryRow = Prisma.GroupGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.GroupGetPayload<{ include: typeof detailInclude }>;
type PlacementRow = Prisma.PensumSubjectGetPayload<{ include: { subject: true } }>;

function toSummary(row: SummaryRow): GroupSummary {
  return {
    id: row.id,
    institutionId: row.institutionId,
    name: row.name,
    level: row.level,
    capacity: row.capacity,
    pensum: row.pensum,
    period: row.period,
    studentCount: row._count.enrollments,
  };
}

function toGroup(row: DetailRow, placements: PlacementRow[]): Group {
  return {
    ...toSummary(row),
    // Every subject of the level is listed, whether or not a Course row exists for it yet
    courses: placements.map((placement) => {
      const teacher = row.courses.find((course) => course.pensumSubjectId === placement.id)?.teacher;
      return {
        subjectId: placement.subjectId,
        code: placement.subject.code,
        name: placement.subject.name,
        weeklyHours: placement.weeklyHours,
        teacher: teacher
          ? {
              membershipId: teacher.id,
              firstName: teacher.user.firstName,
              lastName: teacher.user.lastName,
            }
          : null,
      };
    }),
    students: row.enrollments.map((enrollment) => ({
      membershipId: enrollment.studentId,
      firstName: enrollment.student.user.firstName,
      lastName: enrollment.student.user.lastName,
      email: enrollment.student.user.email,
    })),
  };
}

@Injectable()
export class PrismaGroupRepository implements GroupRepository {
  private readonly logger = new Logger(PrismaGroupRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(institutionId: string): Promise<GroupSummary[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.group.findMany({
          where: { institutionId },
          include: summaryInclude,
          orderBy: [{ period: { startDate: 'desc' } }, { level: 'asc' }, { name: 'asc' }],
        })
      ).map(toSummary),
    );
  }

  findById(institutionId: string, id: string): Promise<Group | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.group.findFirst({
        where: { id, institutionId },
        include: detailInclude,
      });
      return row ? toGroup(row, await this.placements(row.pensumId, row.level)) : null;
    });
  }

  create(institutionId: string, group: GroupData): Promise<Group> {
    return runQuery(
      this.logger,
      async () => {
        const row = await this.prisma.group.create({
          data: { institutionId, ...group },
          include: detailInclude,
        });
        return toGroup(row, await this.placements(row.pensumId, row.level));
      },
      { [PrismaErrorCode.UNIQUE_VIOLATION]: () => new GroupNameTakenException() },
    );
  }

  delete(institutionId: string, id: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () => (await this.prisma.group.deleteMany({ where: { id, institutionId } })).count > 0,
      { [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new GroupInUseException() },
    );
  }

  assignTeacher(
    groupId: string,
    subjectId: string,
    teacherMembershipId: string | null,
  ): Promise<boolean> {
    return runQuery(this.logger, async () => {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        select: { pensumId: true, level: true },
      });
      const placement = group
        ? await this.prisma.pensumSubject.findFirst({
            where: { pensumId: group.pensumId, level: group.level, subjectId },
            select: { id: true },
          })
        : null;
      if (!placement) {
        return false;
      }
      await this.prisma.course.upsert({
        where: { groupId_pensumSubjectId: { groupId, pensumSubjectId: placement.id } },
        create: { groupId, pensumSubjectId: placement.id, teacherId: teacherMembershipId },
        update: { teacherId: teacherMembershipId },
      });
      return true;
    });
  }

  courseHasSchedule(groupId: string, subjectId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () =>
        (await this.prisma.scheduleSlot.count({
          where: { course: { groupId, pensumSubject: { subjectId } } },
        })) > 0,
    );
  }

  enroll(groupId: string, studentMembershipId: string): Promise<void> {
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.enrollment.create({ data: { groupId, studentId: studentMembershipId } });
      },
      { [PrismaErrorCode.UNIQUE_VIOLATION]: () => new StudentAlreadyEnrolledException() },
    );
  }

  unenroll(groupId: string, studentMembershipId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () =>
        (
          await this.prisma.enrollment.deleteMany({
            where: { groupId, studentId: studentMembershipId },
          })
        ).count > 0,
      // Grades or attendance already recorded for the student in this group
      { [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new GroupInUseException() },
    );
  }

  private placements(pensumId: string, level: number): Promise<PlacementRow[]> {
    return this.prisma.pensumSubject.findMany({
      where: { pensumId, level },
      include: { subject: true },
      orderBy: { subject: { code: 'asc' } },
    });
  }
}

@Injectable()
export class PrismaMemberDirectory implements MemberDirectory {
  private readonly logger = new Logger(PrismaMemberDirectory.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findActiveMember(institutionId: string, membershipId: string): Promise<InstitutionMember | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.membership.findFirst({
        where: { id: membershipId, institutionId, isActive: true, user: { status: 'ACTIVE' } },
        select: { id: true, role: true },
      });
      return row ? { membershipId: row.id, role: row.role } : null;
    });
  }
}
