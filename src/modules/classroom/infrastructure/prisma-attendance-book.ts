import { Inject, Injectable, Logger } from '@nestjs/common';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type { AttendanceSheet, ManualAttendanceMark } from '../domain/classroom.js';
import type { AttendanceBook } from '../domain/ports/classroom.ports.js';

@Injectable()
export class PrismaAttendanceBook implements AttendanceBook {
  private readonly logger = new Logger(PrismaAttendanceBook.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  sheet(institutionId: string, sessionId: string): Promise<AttendanceSheet | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.classSession.findFirst({
        where: { id: sessionId, course: { group: { institutionId } } },
        select: {
          startsAt: true,
          actualStartedAt: true,
          attendance: { select: { enrollmentId: true, status: true, source: true } },
          course: {
            select: {
              teacherId: true,
              pensumSubject: { select: { subject: { select: { name: true } } } },
              group: {
                select: {
                  name: true,
                  enrollments: {
                    where: { status: 'ACTIVE' },
                    select: {
                      id: true,
                      studentId: true,
                      student: { select: { user: { select: { firstName: true, lastName: true } } } },
                    },
                    orderBy: [
                      { student: { user: { lastName: 'asc' } } },
                      { student: { user: { firstName: 'asc' } } },
                    ],
                  },
                },
              },
            },
          },
        },
      });
      if (!row) {
        return null;
      }
      const records = new Map(row.attendance.map((record) => [record.enrollmentId, record]));
      return {
        startsAt: row.actualStartedAt ?? row.startsAt,
        teacherMembershipId: row.course.teacherId,
        course: {
          institutionId,
          subjectName: row.course.pensumSubject.subject.name,
          groupName: row.course.group.name,
        },
        students: row.course.group.enrollments.map((enrollment) => ({
          enrollmentId: enrollment.id,
          membershipId: enrollment.studentId,
          firstName: enrollment.student.user.firstName,
          lastName: enrollment.student.user.lastName,
          status: records.get(enrollment.id)?.status ?? null,
          takenByHand: records.get(enrollment.id)?.source === 'MANUAL',
        })),
      };
    });
  }

  record(sessionId: string, recordedById: string, marks: ManualAttendanceMark[]): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.$transaction(
        marks.map(({ enrollmentId, status, note }) =>
          this.prisma.attendanceRecord.upsert({
            where: { sessionId_enrollmentId: { sessionId, enrollmentId } },
            create: { sessionId, enrollmentId, status, note, source: 'MANUAL', recordedById },
            update: { status, note, source: 'MANUAL', recordedById, recordedAt: new Date() },
          }),
        ),
      );
    });
  }
}
