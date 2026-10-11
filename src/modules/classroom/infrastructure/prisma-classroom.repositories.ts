import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
  type PrismaErrorMap,
} from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import {
  ClassroomRole,
  ClassSessionNotFoundException,
  roomNameFor,
  SessionStatus,
  type ChatMessage,
  type ClassroomCourse,
  type Participation,
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
        select: { id: true, teacherId: true },
      });
      return row && { courseId: row.id, teacherMembershipId: row.teacherId };
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

  markPresent(sessionId: string, membershipId: string): Promise<void> {
    return runQuery(
      this.logger,
      async () => {
        const enrollment = await this.prisma.enrollment.findFirst({
          where: {
            studentId: membershipId,
            status: 'ACTIVE',
            group: { courses: { some: { sessions: { some: { id: sessionId } } } } },
          },
          select: { id: true },
        });
        if (!enrollment) {
          return;
        }
        await this.prisma.attendanceRecord.upsert({
          where: { sessionId_enrollmentId: { sessionId, enrollmentId: enrollment.id } },
          create: { sessionId, enrollmentId: enrollment.id, status: 'PRESENT', source: 'AUTOMATIC' },
          update: {},
        });
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
