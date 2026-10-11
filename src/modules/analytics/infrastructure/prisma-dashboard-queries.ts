import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type { AttendanceCounts } from '../../attendance/domain/attendance-standing.js';
import type { AcademicOverview, GroupTeaching, InstitutionCounts, PlatformDashboard } from '../domain/dashboards.js';
import type { AssignedCourse, DashboardQueries, GroupAttendance } from '../domain/ports/analytics.ports.js';

const LARGEST_INSTITUTIONS = 5;
const PENDING_REVIEW = 'NEEDS_REVIEW';

/** An academic period that is running on `day`. */
const running = (day: Date): Prisma.AcademicPeriodWhereInput => ({ startDate: { lte: day }, endDate: { gte: day } });

/** The courses of these Teachers in the institution, in periods running on `day`. */
const ownCourses = (institutionId: string, teacherIds: string[], day: Date): Prisma.CourseWhereInput => ({
  teacherId: { in: teacherIds },
  group: { institutionId, period: running(day) },
});

function countsByStatus(rows: Array<{ status: string; _count: { _all: number } }>): AttendanceCounts {
  const of = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0;
  return { present: of('PRESENT'), late: of('LATE'), absent: of('ABSENT'), excused: of('EXCUSED') };
}

/** Dashboard figures counted by the database: aggregates only, never rows loaded to be counted here. */
@Injectable()
export class PrismaDashboardQueries implements DashboardQueries {
  private readonly logger = new Logger(PrismaDashboardQueries.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  platform(): Promise<PlatformDashboard> {
    return runQuery(this.logger, async () => {
      const [activeInstitutions, inactiveInstitutions, users, pendingReviews, largest] = await Promise.all([
        this.prisma.institution.count({ where: { isActive: true } }),
        this.prisma.institution.count({ where: { isActive: false } }),
        this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.onboardingApplication.count({ where: { status: PENDING_REVIEW } }),
        this.prisma.institution.findMany({
          where: { isActive: true },
          select: { id: true, name: true, _count: { select: { memberships: { where: { isActive: true } } } } },
          orderBy: [{ memberships: { _count: 'desc' } }, { name: 'asc' }],
          take: LARGEST_INSTITUTIONS,
        }),
      ]);
      const withStatus = (status: string) => users.find((row) => row.status === status)?._count._all ?? 0;
      return {
        activeInstitutions,
        inactiveInstitutions,
        totalUsers: users.reduce((total, row) => total + row._count._all, 0),
        pendingReviews,
        usersByStatus: {
          active: withStatus('ACTIVE'),
          pendingOnboarding: withStatus('PENDING_ONBOARDING'),
          suspended: withStatus('SUSPENDED'),
        },
        largestInstitutions: largest.map(({ id, name, _count }) => ({ id, name, members: _count.memberships })),
      };
    });
  }

  institution(institutionId: string, day: Date): Promise<InstitutionCounts> {
    return runQuery(this.logger, async () => {
      const [activeStudents, teachers, activeGroups, pendingReviews, attendance] = await Promise.all([
        this.prisma.membership.count({ where: { institutionId, role: 'STUDENT', isActive: true } }),
        this.prisma.membership.count({ where: { institutionId, role: 'TEACHER', isActive: true } }),
        this.prisma.group.count({ where: { institutionId, period: running(day) } }),
        this.prisma.onboardingApplication.count({ where: { institutionId, status: PENDING_REVIEW } }),
        this.prisma.attendanceRecord.groupBy({
          by: ['status'],
          where: { session: { course: { group: { institutionId } } } },
          _count: { _all: true },
        }),
      ]);
      return { activeStudents, teachers, activeGroups, pendingReviews, attendance: countsByStatus(attendance) };
    });
  }

  groupTeaching(institutionId: string, groupId: string): Promise<GroupTeaching | null> {
    return runQuery(this.logger, async () => {
      const person = { select: { id: true, user: { select: { firstName: true, lastName: true } } } };
      const group = await this.prisma.group.findFirst({
        where: { id: groupId, institutionId },
        select: {
          id: true,
          name: true,
          level: true,
          period: { select: { name: true } },
          pensum: { select: { name: true } },
          _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
          courses: {
            select: {
              teacher: person,
              pensumSubject: {
                select: { weeklyHours: true, subject: { select: { id: true, code: true, name: true } } },
              },
              scheduleSlots: { select: { dayOfWeek: true, startMinute: true, endMinute: true, room: true } },
            },
            orderBy: { pensumSubject: { subject: { name: 'asc' } } },
          },
        },
      });
      if (!group) {
        return null;
      }
      return {
        id: group.id,
        name: group.name,
        level: group.level,
        periodName: group.period.name,
        pensumName: group.pensum.name,
        students: group._count.enrollments,
        courses: group.courses.map(({ teacher, pensumSubject }) => ({
          subjectId: pensumSubject.subject.id,
          code: pensumSubject.subject.code,
          name: pensumSubject.subject.name,
          weeklyHours: pensumSubject.weeklyHours,
          teacher: teacher && {
            membershipId: teacher.id,
            firstName: teacher.user.firstName,
            lastName: teacher.user.lastName,
          },
        })),
        schedule: group.courses.flatMap(({ teacher, pensumSubject, scheduleSlots }) =>
          scheduleSlots.map((slot) => ({
            ...slot,
            subjectName: pensumSubject.subject.name,
            teacherName: teacher && `${teacher.user.firstName} ${teacher.user.lastName}`,
          })),
        ),
      };
    });
  }

  academic(institutionId: string, day: Date): Promise<AcademicOverview> {
    const runningGroup = { institutionId, period: running(day) };
    const slots = { select: { startMinute: true, endMinute: true } };
    const hours = (courses: Array<{ scheduleSlots: Array<{ startMinute: number; endMinute: number }> }>) =>
      Math.round(
        (courses.flatMap((course) => course.scheduleSlots).reduce((sum, slot) => sum + slot.endMinute - slot.startMinute, 0) /
          60) *
          100,
      ) / 100;
    return runQuery(this.logger, async () => {
      const [groups, pensums, teachers] = await Promise.all([
        this.prisma.group.findMany({
          where: runningGroup,
          select: {
            id: true,
            name: true,
            level: true,
            period: { select: { name: true } },
            pensum: { select: { name: true } },
            _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
            courses: { select: { teacherId: true, scheduleSlots: slots } },
          },
          orderBy: [{ level: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.pensum.findMany({
          where: { institutionId },
          select: {
            id: true,
            code: true,
            name: true,
            _count: { select: { subjects: true, groups: { where: { period: running(day) } } } },
          },
          orderBy: { name: 'asc' },
        }),
        this.prisma.membership.findMany({
          where: { institutionId, role: 'TEACHER', isActive: true },
          select: {
            id: true,
            user: { select: { firstName: true, lastName: true } },
            coursesTaught: { where: { group: runningGroup }, select: { scheduleSlots: slots } },
          },
          orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
        }),
      ]);
      return {
        groups: groups.map((group) => ({
          id: group.id,
          name: group.name,
          level: group.level,
          periodName: group.period.name,
          pensumName: group.pensum.name,
          students: group._count.enrollments,
          courses: group.courses.length,
          coursesWithoutTeacher: group.courses.filter((course) => course.teacherId === null).length,
          weeklyHours: hours(group.courses),
        })),
        pensums: pensums.map(({ id, code, name, _count }) => ({
          id,
          code,
          name,
          subjects: _count.subjects,
          activeGroups: _count.groups,
        })),
        teachers: teachers.map((teacher) => ({
          membershipId: teacher.id,
          name: `${teacher.user.firstName} ${teacher.user.lastName}`,
          courses: teacher.coursesTaught.length,
          weeklyHours: hours(teacher.coursesTaught),
        })),
      };
    });
  }

  coursesOf(institutionId: string, teacherMembershipIds: string[], day: Date): Promise<AssignedCourse[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.course.findMany({
        where: ownCourses(institutionId, teacherMembershipIds, day),
        select: { groupId: true, teacherId: true, pensumSubject: { select: { subjectId: true } } },
      });
      return rows.flatMap((row) =>
        row.teacherId
          ? [{ groupId: row.groupId, subjectId: row.pensumSubject.subjectId, teacherMembershipId: row.teacherId }]
          : [],
      );
    });
  }

  draftEvaluations(institutionId: string, teacherMembershipIds: string[], day: Date): Promise<number> {
    return runQuery(this.logger, () =>
      this.prisma.evaluation.count({
        where: { isPublished: false, course: ownCourses(institutionId, teacherMembershipIds, day) },
      }),
    );
  }

  attendanceOf(institutionId: string, teacherMembershipIds: string[], day: Date): Promise<GroupAttendance[]> {
    const own = ownCourses(institutionId, teacherMembershipIds, day);
    return runQuery(this.logger, async () => {
      const [enrollments, marks] = await Promise.all([
        this.prisma.enrollment.findMany({
          where: { status: 'ACTIVE', group: { courses: { some: own } } },
          select: {
            id: true,
            group: { select: { id: true, name: true } },
            student: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
          orderBy: [{ group: { name: 'asc' } }, { student: { user: { lastName: 'asc' } } }],
        }),
        // Counted by the database per Student and mark, in the Teacher's own classes only
        this.prisma.attendanceRecord.groupBy({
          by: ['enrollmentId', 'status'],
          where: { session: { course: own }, enrollment: { status: 'ACTIVE' } },
          _count: { _all: true },
        }),
      ]);
      const groups = new Map<string, GroupAttendance>();
      for (const enrollment of enrollments) {
        const group = groups.get(enrollment.group.id) ?? { groupName: enrollment.group.name, students: [] };
        group.students.push({
          firstName: enrollment.student.user.firstName,
          lastName: enrollment.student.user.lastName,
          ...countsByStatus(marks.filter((mark) => mark.enrollmentId === enrollment.id)),
        });
        groups.set(enrollment.group.id, group);
      }
      return [...groups.values()];
    });
  }
}
