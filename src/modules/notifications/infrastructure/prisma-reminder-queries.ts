import { Inject, Injectable, Logger } from '@nestjs/common';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type { DueEvaluation, ReminderQueries, StartingClass } from '../domain/ports/notification.ports.js';
import type { LocalClock } from '../domain/reminders.js';

const activeStudents = { where: { status: 'ACTIVE' as const }, select: { studentId: true } };

@Injectable()
export class PrismaReminderQueries implements ReminderQueries {
  private readonly logger = new Logger(PrismaReminderQueries.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  evaluationsDue(from: Date, until: Date): Promise<DueEvaluation[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.evaluation.findMany({
        where: { isPublished: true, dueAt: { gt: from, lte: until }, course: { group: { institution: { isActive: true } } } },
        select: {
          id: true,
          title: true,
          dueAt: true,
          course: {
            select: {
              pensumSubject: { select: { subject: { select: { name: true } } } },
              group: { select: { name: true, institutionId: true, enrollments: activeStudents } },
            },
          },
        },
      });
      return rows.flatMap(({ id, title, dueAt, course }) =>
        dueAt
          ? [
              {
                evaluationId: id,
                institutionId: course.group.institutionId,
                title,
                subjectName: course.pensumSubject.subject.name,
                groupName: course.group.name,
                dueAt,
                studentMembershipIds: course.group.enrollments.map((enrollment) => enrollment.studentId),
              },
            ]
          : [],
      );
    });
  }

  timezones(): Promise<string[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.institution.findMany({ where: { isActive: true }, select: { timezone: true }, distinct: ['timezone'] })
      ).map((row) => row.timezone),
    );
  }

  classesStarting(timezone: string, clock: LocalClock, untilMinute: number): Promise<StartingClass[]> {
    // Academic periods store dates; the local date of the institution decides which are running
    const day = new Date(`${clock.date}T00:00:00Z`);
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.scheduleSlot.findMany({
        where: {
          dayOfWeek: clock.weekday,
          startMinute: { gt: clock.minute, lte: untilMinute },
          course: {
            group: {
              institution: { isActive: true, timezone },
              period: { startDate: { lte: day }, endDate: { gte: day } },
            },
          },
        },
        select: {
          id: true,
          startMinute: true,
          course: {
            select: {
              teacherId: true,
              pensumSubject: { select: { subject: { select: { name: true } } } },
              group: { select: { name: true, institutionId: true, enrollments: activeStudents } },
            },
          },
        },
      });
      return rows.map(({ id, startMinute, course }) => ({
        slotId: id,
        institutionId: course.group.institutionId,
        subjectName: course.pensumSubject.subject.name,
        groupName: course.group.name,
        startMinute,
        membershipIds: [
          ...(course.teacherId ? [course.teacherId] : []),
          ...course.group.enrollments.map((enrollment) => enrollment.studentId),
        ],
      }));
    });
  }
}
