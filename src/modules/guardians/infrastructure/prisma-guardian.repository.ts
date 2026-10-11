import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type { GuardianLink, GuardianRelationship, Ward, WardAttendance } from '../domain/guardian.js';
import type { GuardianRepository } from '../domain/ports/guardian.ports.js';

const person = { select: { id: true, user: { select: { firstName: true, lastName: true } } } } as const;
const linkInclude = { student: person, guardian: person } satisfies Prisma.GuardianLinkInclude;

type LinkRow = Prisma.GuardianLinkGetPayload<{ include: typeof linkInclude }>;
type PersonRow = LinkRow['student'];

const toName = (row: PersonRow) => ({
  membershipId: row.id,
  firstName: row.user.firstName,
  lastName: row.user.lastName,
});

const toLink = (row: LinkRow): GuardianLink => ({
  id: row.id,
  student: toName(row.student),
  guardian: toName(row.guardian),
  relationship: row.relationship,
});

@Injectable()
export class PrismaGuardianRepository implements GuardianRepository {
  private readonly logger = new Logger(PrismaGuardianRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listLinks(institutionId: string): Promise<GuardianLink[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.guardianLink.findMany({
          where: { student: { institutionId }, guardian: { institutionId } },
          include: linkInclude,
          orderBy: [{ student: { user: { lastName: 'asc' } } }, { student: { user: { firstName: 'asc' } } }],
        })
      ).map(toLink),
    );
  }

  link(
    institutionId: string,
    studentMembershipId: string,
    guardianMembershipId: string,
    relationship: GuardianRelationship,
  ): Promise<GuardianLink | null> {
    return runQuery(this.logger, async () => {
      // Both ends must be memberships of this institution, each with its own role
      const ends = await this.prisma.membership.findMany({
        where: {
          institutionId,
          OR: [
            { id: studentMembershipId, role: 'STUDENT' },
            { id: guardianMembershipId, role: 'GUARDIAN' },
          ],
        },
        select: { id: true },
      });
      if (ends.length !== 2) {
        return null;
      }
      const row = await this.prisma.guardianLink.upsert({
        where: { studentId_guardianId: { studentId: studentMembershipId, guardianId: guardianMembershipId } },
        create: { studentId: studentMembershipId, guardianId: guardianMembershipId, relationship },
        update: { relationship },
        include: linkInclude,
      });
      return toLink(row);
    });
  }

  unlink(institutionId: string, linkId: string): Promise<boolean> {
    return runQuery(this.logger, async () => {
      const { count } = await this.prisma.guardianLink.deleteMany({
        where: { id: linkId, student: { institutionId } },
      });
      return count > 0;
    });
  }

  wardsOf(institutionId: string, guardianMembershipIds: string[]): Promise<Ward[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.guardianLink.findMany({
        where: {
          guardianId: { in: guardianMembershipIds },
          guardian: { institutionId, isActive: true },
          student: { institutionId },
        },
        select: {
          relationship: true,
          student: {
            select: {
              ...person.select,
              enrollments: {
                where: { status: 'ACTIVE' },
                select: { group: { select: { id: true, name: true } } },
                orderBy: { group: { name: 'asc' } },
              },
            },
          },
        },
        orderBy: [{ student: { user: { firstName: 'asc' } } }, { student: { user: { lastName: 'asc' } } }],
      });
      return rows.map(({ relationship, student }) => ({
        ...toName(student),
        relationship,
        groups: student.enrollments.map((enrollment) => enrollment.group),
      }));
    });
  }

  attendanceOf(studentMembershipId: string, recentLimit: number): Promise<WardAttendance> {
    const ofStudent = { enrollment: { studentId: studentMembershipId } };
    return runQuery(this.logger, async () => {
      const [counts, recent] = await Promise.all([
        this.prisma.attendanceRecord.groupBy({ by: ['status'], where: ofStudent, _count: { _all: true } }),
        this.prisma.attendanceRecord.findMany({
          where: ofStudent,
          select: {
            status: true,
            session: {
              select: {
                startsAt: true,
                course: { select: { pensumSubject: { select: { subject: { select: { name: true } } } } } },
              },
            },
          },
          orderBy: { session: { startsAt: 'desc' } },
          take: recentLimit,
        }),
      ]);
      const marked = (status: string) => counts.find((row) => row.status === status)?._count._all ?? 0;
      return {
        counts: {
          present: marked('PRESENT'),
          late: marked('LATE'),
          absent: marked('ABSENT'),
          excused: marked('EXCUSED'),
        },
        recent: recent.map(({ status, session }) => ({
          date: session.startsAt,
          subjectName: session.course.pensumSubject.subject.name,
          status,
        })),
      };
    });
  }
}
