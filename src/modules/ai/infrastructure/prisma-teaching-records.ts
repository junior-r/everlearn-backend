import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DayOfWeek } from '../../../shared/infrastructure/prisma/generated/client.js';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type { SubjectSummary, TeachingRecords } from '../domain/ports/assistant.ports.js';
import type { TaughtCourse, TimeRange } from '../domain/teacher-hours.js';

/** Our days as `Date.getUTCDay` numbers them. */
const WEEKDAY: Record<DayOfWeek, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const subjectSelect = { id: true, code: true, name: true } as const;

@Injectable()
export class PrismaTeachingRecords implements TeachingRecords {
  private readonly logger = new Logger(PrismaTeachingRecords.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listSubjects(institutionId: string): Promise<SubjectSummary[]> {
    return runQuery(this.logger, () =>
      this.prisma.subject.findMany({ where: { institutionId }, select: subjectSelect, orderBy: { name: 'asc' } }),
    );
  }

  findTeaching(
    institutionId: string,
    subjectId: string,
    month: TimeRange,
  ): Promise<{ subject: SubjectSummary; courses: TaughtCourse[] } | null> {
    return runQuery(this.logger, async () => {
      const subject = await this.prisma.subject.findFirst({
        where: { id: subjectId, institutionId },
        select: subjectSelect,
      });
      if (!subject) {
        return null;
      }
      const rows = await this.prisma.course.findMany({
        where: { group: { institutionId }, pensumSubject: { subjectId } },
        select: {
          group: { select: { name: true, period: { select: { startDate: true, endDate: true } } } },
          teacher: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
          scheduleSlots: { select: { dayOfWeek: true, startMinute: true, endMinute: true } },
          sessions: {
            where: { status: 'COMPLETED', startsAt: { gte: month.start, lt: month.end } },
            select: { startsAt: true, endsAt: true, actualStartedAt: true, actualEndedAt: true },
          },
        },
        orderBy: { group: { name: 'asc' } },
      });
      const courses = rows.map(
        (row): TaughtCourse => ({
          groupName: row.group.name,
          teacher: row.teacher && {
            membershipId: row.teacher.id,
            firstName: row.teacher.user.firstName,
            lastName: row.teacher.user.lastName,
          },
          period: { start: row.group.period.startDate, end: row.group.period.endDate },
          slots: row.scheduleSlots.map((slot) => ({
            weekday: WEEKDAY[slot.dayOfWeek],
            startMinute: slot.startMinute,
            endMinute: slot.endMinute,
          })),
          heldClasses: row.sessions.map((session) => ({
            start: session.actualStartedAt ?? session.startsAt,
            end: session.actualEndedAt ?? session.endsAt,
          })),
        }),
      );
      return { subject, courses };
    });
  }
}
