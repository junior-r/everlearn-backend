import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaErrorCode, runQuery, type PrismaErrorMap } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import { ClassSessionNotFoundException } from '../domain/classroom.js';
import type { RecordingRepository } from '../domain/ports/recording.ports.js';
import type {
  ClaimedRecording,
  ClassRecordingSummary,
  FinishedRecording,
  StoredRecording,
} from '../domain/recording.js';

const unknownSession: PrismaErrorMap = {
  [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new ClassSessionNotFoundException(),
};

@Injectable()
export class PrismaRecordingRepository implements RecordingRepository {
  private readonly logger = new Logger(PrismaRecordingRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  register(recording: FinishedRecording): Promise<void> {
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.classRecording.upsert({
          where: { egressId: recording.egressId },
          create: { ...recording, sizeBytes: BigInt(recording.sizeBytes) },
          update: {},
        });
      },
      unknownSession,
    );
  }

  claimNext(now: Date, abandonedBefore: Date): Promise<ClaimedRecording | null> {
    return runQuery(this.logger, async () => {
      const candidate = await this.prisma.classRecording.findFirst({
        where: { status: 'PENDING', OR: [{ claimedAt: null }, { claimedAt: { lt: abandonedBefore } }] },
        orderBy: { createdAt: 'asc' },
        select: { id: true, claimedAt: true },
      });
      if (!candidate) {
        return null;
      }
      // Taken only if nobody took it since it was read: the claim it had is part of the condition
      const { count } = await this.prisma.classRecording.updateMany({
        where: { id: candidate.id, status: 'PENDING', claimedAt: candidate.claimedAt },
        data: { claimedAt: now, attempts: { increment: 1 } },
      });
      return count === 1 ? this.claimed(candidate.id) : null;
    });
  }

  private async claimed(id: string): Promise<ClaimedRecording> {
    const row = await this.prisma.classRecording.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        sessionId: true,
        spoolFile: true,
        sizeBytes: true,
        attempts: true,
        session: {
          select: {
            startsAt: true,
            actualStartedAt: true,
            course: {
              select: {
                groupId: true,
                teacherId: true,
                pensumSubject: { select: { subject: { select: { id: true, name: true } } } },
                group: {
                  select: {
                    name: true,
                    institutionId: true,
                    enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const { course } = row.session;
    return {
      id: row.id,
      sessionId: row.sessionId,
      spoolFile: row.spoolFile,
      sizeBytes: Number(row.sizeBytes),
      attempts: row.attempts,
      institutionId: course.group.institutionId,
      groupId: course.groupId,
      subjectId: course.pensumSubject.subject.id,
      subjectName: course.pensumSubject.subject.name,
      groupName: course.group.name,
      startsAt: row.session.actualStartedAt ?? row.session.startsAt,
      audience: [
        ...(course.teacherId ? [course.teacherId] : []),
        ...course.group.enrollments.map((enrollment) => enrollment.studentId),
      ],
    };
  }

  markReady(id: string, storageKey: string): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.classRecording.update({
        where: { id },
        data: { status: 'READY', storageKey, claimedAt: null },
      });
    });
  }

  markFailed(id: string): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.classRecording.update({ where: { id }, data: { status: 'FAILED', claimedAt: null } });
    });
  }

  listReady(courseId: string, limit: number): Promise<ClassRecordingSummary[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.classRecording.findMany({
        where: { status: 'READY', session: { courseId } },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          sessionId: true,
          startedAt: true,
          endedAt: true,
          sizeBytes: true,
          session: { select: { startsAt: true, actualStartedAt: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        startsAt: row.session.actualStartedAt ?? row.session.startsAt,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        sizeBytes: Number(row.sizeBytes),
      }));
    });
  }

  findReady(recordingId: string): Promise<StoredRecording | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.classRecording.findFirst({
        where: { id: recordingId, status: 'READY' },
        select: { id: true, sessionId: true, storageKey: true, startedAt: true },
      });
      return row?.storageKey
        ? { id: row.id, sessionId: row.sessionId, storageKey: row.storageKey, startedAt: row.startedAt }
        : null;
    });
  }
}
