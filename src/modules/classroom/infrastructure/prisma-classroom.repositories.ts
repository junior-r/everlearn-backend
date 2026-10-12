import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
  type PrismaErrorMap,
} from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import {
  AutomaticAttendance,
  ClassroomRole,
  ClassSessionNotFoundException,
  roomNameFor,
  SessionStatus,
  type AttendanceMark,
  type ChatMessage,
  type ClassroomCourse,
  type CourseSession,
  type Participation,
  type RollCall,
  type SessionAccess,
  type TeachableCourse,
  type TranscriptSegment,
} from '../domain/classroom.js';
import type { ClassroomRepository, SessionRecorder } from '../domain/ports/classroom.ports.js';

const OPEN_STATUSES = [SessionStatus.SCHEDULED, SessionStatus.LIVE];

const courseInclude = {
  group: { select: { id: true, name: true } },
  pensumSubject: { include: { subject: true } },
  teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
  sessions: {
    where: { status: { in: OPEN_STATUSES } },
    orderBy: { startsAt: 'desc' },
    take: 1,
    select: { id: true },
  },
} satisfies Prisma.CourseInclude;

type CourseRow = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

function toCourse(row: CourseRow, role: ClassroomRole): ClassroomCourse {
  const { subject } = row.pensumSubject;
  return {
    groupId: row.group.id,
    groupName: row.group.name,
    subject: { id: subject.id, code: subject.code, name: subject.name },
    teacher: row.teacher && {
      membershipId: row.teacher.id,
      firstName: row.teacher.user.firstName,
      lastName: row.teacher.user.lastName,
    },
    role,
    openSessionId: row.sessions[0]?.id ?? null,
  };
}

@Injectable()
export class PrismaClassroomRepository implements ClassroomRepository {
  private readonly logger = new Logger(PrismaClassroomRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listCourses(
    institutionId: string,
    membershipId: string,
    role: ClassroomRole,
  ): Promise<ClassroomCourse[]> {
    const where: Prisma.CourseWhereInput =
      role === ClassroomRole.TEACHER
        ? { teacherId: membershipId, group: { institutionId } }
        : {
            group: {
              institutionId,
              enrollments: { some: { studentId: membershipId, status: 'ACTIVE' } },
            },
          };
    return runQuery(this.logger, async () =>
      (
        await this.prisma.course.findMany({
          where,
          include: courseInclude,
          orderBy: [{ group: { name: 'asc' } }, { pensumSubject: { subject: { name: 'asc' } } }],
        })
      ).map((row) => toCourse(row, role)),
    );
  }

  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<TeachableCourse | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.course.findFirst({
        where: { groupId, group: { institutionId }, pensumSubject: { subjectId } },
        select: {
          id: true,
          teacherId: true,
          group: { select: { name: true } },
          pensumSubject: { select: { subject: { select: { name: true } } } },
        },
      });
      return (
        row && {
          courseId: row.id,
          teacherMembershipId: row.teacherId,
          subjectName: row.pensumSubject.subject.name,
          groupName: row.group.name,
        }
      );
    });
  }

  findOpenSessionId(courseId: string): Promise<string | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.classSession.findFirst({
        where: { courseId, status: { in: OPEN_STATUSES } },
        orderBy: { startsAt: 'desc' },
        select: { id: true },
      });
      return row?.id ?? null;
    });
  }

  createSession(courseId: string, startsAt: Date, endsAt: Date): Promise<string> {
    return runQuery(this.logger, () =>
      this.prisma.$transaction(async (tx) => {
        const { id } = await tx.classSession.create({ data: { courseId, startsAt, endsAt } });
        // The room is named after the id, which only exists once the row does
        await tx.classSession.update({ where: { id }, data: { videoRoomName: roomNameFor(id) } });
        return id;
      }),
    );
  }

  createHeldSession(courseId: string, startsAt: Date, endsAt: Date): Promise<string> {
    return runQuery(this.logger, async () => {
      // No room name: the class has no video, so the video-server will never report on it
      const { id } = await this.prisma.classSession.create({
        data: { courseId, startsAt, endsAt, status: SessionStatus.COMPLETED },
      });
      return id;
    });
  }

  listSessions(courseId: string, limit: number): Promise<CourseSession[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.classSession.findMany({
        where: { courseId },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          startsAt: true,
          actualStartedAt: true,
          status: true,
          _count: { select: { attendance: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        startsAt: row.actualStartedAt ?? row.startsAt,
        status: row.status,
        marked: row._count.attendance,
      }));
    });
  }

  findSession(institutionId: string, sessionId: string): Promise<SessionAccess | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.classSession.findFirst({
        where: { id: sessionId, course: { group: { institutionId } } },
        include: {
          course: {
            include: {
              group: { select: { id: true, name: true } },
              pensumSubject: { include: { subject: { select: { name: true } } } },
            },
          },
        },
      });
      return (
        row && {
          sessionId: row.id,
          status: row.status,
          groupId: row.course.group.id,
          groupName: row.course.group.name,
          subjectName: row.course.pensumSubject.subject.name,
          teacherMembershipId: row.course.teacherId,
        }
      );
    });
  }

  isEnrolled(groupId: string, studentMembershipId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () =>
        (await this.prisma.enrollment.count({
          where: { groupId, studentId: studentMembershipId, status: 'ACTIVE' },
        })) > 0,
    );
  }

  displayName(membershipId: string): Promise<string> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.membership.findUnique({
        where: { id: membershipId },
        select: { user: { select: { firstName: true, lastName: true } } },
      });
      return row ? `${row.user.firstName} ${row.user.lastName}`.trim() : '';
    });
  }
}

// A report naming a session or member that does not exist fails on its foreign key
const unknownReference: PrismaErrorMap = {
  [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new ClassSessionNotFoundException(),
  [PrismaErrorCode.RECORD_NOT_FOUND]: () => new ClassSessionNotFoundException(),
};

@Injectable()
export class PrismaSessionRecorder implements SessionRecorder {
  private readonly logger = new Logger(PrismaSessionRecorder.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async requireSession(sessionId: string): Promise<void> {
    if ((await this.prisma.classSession.count({ where: { id: sessionId } })) === 0) {
      throw new ClassSessionNotFoundException();
    }
  }

  start(sessionId: string, at: Date): Promise<void> {
    return runQuery(this.logger, async () => {
      // Only a session that has not started moves to LIVE, so a late or repeated report changes nothing
      const { count } = await this.prisma.classSession.updateMany({
        where: { id: sessionId, status: SessionStatus.SCHEDULED },
        data: { status: SessionStatus.LIVE, actualStartedAt: at },
      });
      if (count === 0) {
        await this.requireSession(sessionId);
      }
    });
  }

  finish(sessionId: string, at: Date): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.requireSession(sessionId);
      await this.prisma.$transaction([
        this.prisma.classSession.updateMany({
          where: { id: sessionId, status: { in: OPEN_STATUSES } },
          data: { status: SessionStatus.COMPLETED, actualEndedAt: at },
        }),
        this.prisma.sessionParticipation.updateMany({
          where: { sessionId, leftAt: null },
          data: { leftAt: at },
        }),
      ]);
    });
  }

  join(participation: Participation): Promise<void> {
    const { sessionId, participantSid } = participation;
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.sessionParticipation.upsert({
          where: { sessionId_participantSid: { sessionId, participantSid } },
          create: participation,
          update: {},
        });
        const connected = await this.prisma.sessionParticipation.count({
          where: { sessionId, leftAt: null },
        });
        await this.prisma.classSession.updateMany({
          where: {
            id: sessionId,
            OR: [{ peakParticipants: null }, { peakParticipants: { lt: connected } }],
          },
          data: { peakParticipants: connected },
        });
      },
      unknownReference,
    );
  }

  leave(participation: Participation, leftAt: Date): Promise<void> {
    const { sessionId, participantSid } = participation;
    return runQuery(
      this.logger,
      async () => {
        // Created here if the join report never arrived, so the connection is not lost
        await this.prisma.sessionParticipation.upsert({
          where: { sessionId_participantSid: { sessionId, participantSid } },
          create: { ...participation, leftAt },
          update: { leftAt },
        });
      },
      unknownReference,
    );
  }

  rollCall(sessionId: string): Promise<RollCall | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.classSession.findUnique({
        where: { id: sessionId },
        select: {
          startsAt: true,
          actualStartedAt: true,
          actualEndedAt: true,
          participations: { select: { membershipId: true, joinedAt: true, leftAt: true } },
          course: {
            select: {
              pensumSubject: { select: { subject: { select: { name: true } } } },
              group: {
                select: {
                  name: true,
                  institutionId: true,
                  enrollments: {
                    where: { status: 'ACTIVE' },
                    select: {
                      id: true,
                      studentId: true,
                      student: { select: { user: { select: { firstName: true, lastName: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!row) {
        throw new ClassSessionNotFoundException();
      }
      const endedAt = row.actualEndedAt;
      if (!endedAt) {
        return null;
      }
      return {
        // A class whose start was never reported counts from the moment the Teacher opened it
        session: { from: row.actualStartedAt ?? row.startsAt, to: endedAt },
        course: {
          institutionId: row.course.group.institutionId,
          subjectName: row.course.pensumSubject.subject.name,
          groupName: row.course.group.name,
        },
        students: row.course.group.enrollments.map((enrollment) => ({
          enrollmentId: enrollment.id,
          membershipId: enrollment.studentId,
          firstName: enrollment.student.user.firstName,
          lastName: enrollment.student.user.lastName,
          connections: row.participations
            .filter((stay) => stay.membershipId === enrollment.studentId)
            .map((stay) => ({ from: stay.joinedAt, to: stay.leftAt ?? endedAt })),
        })),
      };
    });
  }

  saveAttendance(sessionId: string, marks: AttendanceMark[]): Promise<AttendanceMark[]> {
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.$transaction([
          this.prisma.attendanceRecord.createMany({
            data: marks.map((mark) => ({ ...mark, sessionId, source: 'AUTOMATIC' as const })),
            skipDuplicates: true,
          }),
          // A repeated report recalculates automatic records; one taken by hand is never touched
          ...Object.values(AutomaticAttendance).map((status) =>
            this.prisma.attendanceRecord.updateMany({
              where: {
                sessionId,
                source: 'AUTOMATIC',
                enrollmentId: {
                  in: marks.filter((mark) => mark.status === status).map((mark) => mark.enrollmentId),
                },
              },
              data: { status },
            }),
          ),
        ]);
        // What stands as automatic now: a record taken by hand keeps what its author wrote
        const automatic = await this.prisma.attendanceRecord.findMany({
          where: { sessionId, source: 'AUTOMATIC', enrollmentId: { in: marks.map((mark) => mark.enrollmentId) } },
          select: { enrollmentId: true },
        });
        const stored = new Set(automatic.map((record) => record.enrollmentId));
        return marks.filter((mark) => stored.has(mark.enrollmentId));
      },
      unknownReference,
    );
  }

  addChatMessage(message: ChatMessage): Promise<void> {
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.chatMessage.upsert({
          where: { id: message.id },
          create: message,
          update: {},
        });
      },
      unknownReference,
    );
  }

  addTranscriptSegment(segment: TranscriptSegment): Promise<void> {
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.transcriptSegment.upsert({
          where: { id: segment.id },
          create: segment,
          update: {},
        });
      },
      unknownReference,
    );
  }
}
