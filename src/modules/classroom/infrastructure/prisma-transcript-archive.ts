import { Inject, Injectable, Logger } from '@nestjs/common';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import type { TranscribedSession, TranscriptLine } from '../domain/classroom.js';
import type { TranscriptArchive } from '../domain/ports/classroom.ports.js';

@Injectable()
export class PrismaTranscriptArchive implements TranscriptArchive {
  private readonly logger = new Logger(PrismaTranscriptArchive.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transcribedSessions(courseId: string, limit: number): Promise<TranscribedSession[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.classSession.findMany({
        where: { courseId, transcriptSegments: { some: {} } },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          startsAt: true,
          actualStartedAt: true,
          _count: { select: { transcriptSegments: true } },
        },
      });
      return rows.map((row) => ({
        sessionId: row.id,
        startsAt: row.actualStartedAt ?? row.startsAt,
        lines: row._count.transcriptSegments,
      }));
    });
  }

  lines(sessionId: string): Promise<TranscriptLine[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.transcriptSegment.findMany({
        where: { sessionId },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          text: true,
          startedAt: true,
          endedAt: true,
          speaker: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        speakerName: row.speaker ? `${row.speaker.user.firstName} ${row.speaker.user.lastName}`.trim() : null,
        text: row.text,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      }));
    });
  }
}
