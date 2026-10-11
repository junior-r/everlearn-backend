import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type {
  AvailabilityRepository,
  SchedulableCourse,
  SchedulableGroup,
  ScheduleRepository,
} from '../domain/ports/scheduling.ports.js';
import type { ScheduledSlot, TimeRange } from '../domain/schedule.js';

@Injectable()
export class PrismaAvailabilityRepository implements AvailabilityRepository {
  private readonly logger = new Logger(PrismaAvailabilityRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(teacherMembershipId: string, periodId: string): Promise<TimeRange[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.teacherAvailability.findMany({
        where: { teacherId: teacherMembershipId, periodId, type: 'AVAILABLE' },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      });
      return rows.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      }));
    });
  }

  replace(teacherMembershipId: string, periodId: string, windows: TimeRange[]): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.$transaction([
        this.prisma.teacherAvailability.deleteMany({
          where: { teacherId: teacherMembershipId, periodId },
        }),
        this.prisma.teacherAvailability.createMany({
          data: windows.map((window) => ({ teacherId: teacherMembershipId, periodId, ...window })),
        }),
      ]);
    });
  }
}

const slotInclude = {
  course: {
    include: {
      group: { select: { id: true, name: true } },
      pensumSubject: { include: { subject: true } },
      teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.ScheduleSlotInclude;

type SlotRow = Prisma.ScheduleSlotGetPayload<{ include: typeof slotInclude }>;

function toSlot(row: SlotRow): ScheduledSlot {
  const { course } = row;
  return {
    id: row.id,
    dayOfWeek: row.dayOfWeek,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    room: row.room,
    groupId: course.group.id,
    groupName: course.group.name,
    subject: {
      id: course.pensumSubject.subject.id,
      code: course.pensumSubject.subject.code,
      name: course.pensumSubject.subject.name,
    },
    teacher: course.teacher && {
      membershipId: course.teacher.id,
      firstName: course.teacher.user.firstName,
      lastName: course.teacher.user.lastName,
    },
  };
}

const byTime = [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] satisfies Prisma.ScheduleSlotOrderByWithRelationInput[];

@Injectable()
export class PrismaScheduleRepository implements ScheduleRepository {
  private readonly logger = new Logger(PrismaScheduleRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findGroup(institutionId: string, groupId: string): Promise<SchedulableGroup | null> {
    return runQuery(this.logger, () =>
      this.prisma.group.findFirst({
        where: { id: groupId, institutionId },
        select: { id: true, periodId: true },
      }),
    );
  }

  findCourse(groupId: string, subjectId: string): Promise<SchedulableCourse | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.course.findFirst({
        where: { groupId, pensumSubject: { subjectId } },
        select: { id: true, teacherId: true },
      });
      return row && { courseId: row.id, teacherMembershipId: row.teacherId };
    });
  }

  listGroupSlots(groupId: string): Promise<ScheduledSlot[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.scheduleSlot.findMany({
          where: { course: { groupId } },
          include: slotInclude,
          orderBy: byTime,
        })
      ).map(toSlot),
    );
  }

  listTeacherSlots(teacherMembershipId: string, periodId: string): Promise<ScheduledSlot[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.scheduleSlot.findMany({
          where: { course: { teacherId: teacherMembershipId, group: { periodId } } },
          include: slotInclude,
          orderBy: byTime,
        })
      ).map(toSlot),
    );
  }

  create(courseId: string, range: TimeRange, room: string | null): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.scheduleSlot.create({ data: { courseId, ...range, room } });
    });
  }

  delete(groupId: string, slotId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () =>
        // The group is part of the filter, so a slot id from another group deletes nothing
        (await this.prisma.scheduleSlot.deleteMany({ where: { id: slotId, course: { groupId } } }))
          .count > 0,
    );
  }
}
