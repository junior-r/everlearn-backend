import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DayOfWeek } from '../../../shared/infrastructure/prisma/generated/client.js';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type {
  GroupAttendance,
  SubjectSummary,
  TeacherCourse,
  TeachingRecords,
} from '../domain/ports/assistant.ports.js';
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

  coursesTaughtBy(institutionId: string, teacherMembershipIds: string[]): Promise<TeacherCourse[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.course.findMany({
        where: { teacherId: { in: teacherMembershipIds }, group: { institutionId } },
        select: {
          id: true,
          teacherId: true,
          group: { select: { id: true, name: true } },
          pensumSubject: { select: { subject: { select: subjectSelect } } },
        },
        orderBy: [{ group: { name: 'asc' } }, { pensumSubject: { subject: { name: 'asc' } } }],
      });
      return rows.flatMap((row) =>
        row.teacherId
          ? [
              {
                courseId: row.id,
                groupId: row.group.id,
                groupName: row.group.name,
                subject: row.pensumSubject.subject,
                teacherMembershipId: row.teacherId,
              },
            ]
          : [],
      );
    });
  }

  attendanceIn(
    institutionId: string,
    groupId: string,
    teacherMembershipIds: string[],
  ): Promise<GroupAttendance | null> {
    // Only the classes of the courses these memberships teach in the group
    const ownClasses = { course: { groupId, teacherId: { in: teacherMembershipIds } } };
    return runQuery(this.logger, async () => {
      const group = await this.prisma.group.findFirst({
        where: { id: groupId, institutionId, courses: { some: { teacherId: { in: teacherMembershipIds } } } },
        select: { name: true },
      });
      if (!group) {
        return null;
      }
      const [classesHeld, enrollments] = await Promise.all([
        this.prisma.classSession.count({ where: { ...ownClasses, status: 'COMPLETED' } }),
        this.prisma.enrollment.findMany({
          where: { groupId, status: 'ACTIVE' },
          select: {
            student: { select: { user: { select: { firstName: true, lastName: true } } } },
            attendance: { where: { session: ownClasses }, select: { status: true } },
          },
          orderBy: [{ student: { user: { lastName: 'asc' } } }, { student: { user: { firstName: 'asc' } } }],
        }),
      ]);
      return {
        groupName: group.name,
        classesHeld,
        students: enrollments.map(({ student, attendance }) => {
          const marked = (status: string) => attendance.filter((record) => record.status === status).length;
          return {
            firstName: student.user.firstName,
            lastName: student.user.lastName,
            present: marked('PRESENT'),
            late: marked('LATE'),
            absent: marked('ABSENT'),
            excused: marked('EXCUSED'),
          };
        }),
      };
    });
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
