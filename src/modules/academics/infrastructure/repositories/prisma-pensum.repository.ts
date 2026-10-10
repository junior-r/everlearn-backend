import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
  type PrismaErrorMap,
} from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { Pensum } from '../../domain/entities/academic.entities.js';
import {
  PensumInUseException,
  PensumVersionTakenException,
} from '../../domain/exceptions/academic.exceptions.js';
import type {
  PensumChanges,
  PensumData,
  PensumRepository,
  PensumSubjectPlacement,
} from '../../domain/ports/academic.repositories.js';

const ERRORS: PrismaErrorMap = {
  [PrismaErrorCode.UNIQUE_VIOLATION]: () => new PensumVersionTakenException(),
  [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new PensumInUseException(),
};

const withSubjects = {
  subjects: {
    include: { subject: true },
    orderBy: [{ level: 'asc' }, { subject: { code: 'asc' } }],
  },
} satisfies Prisma.PensumInclude;

type PensumRow = Prisma.PensumGetPayload<{ include: typeof withSubjects }>;

function toDomain(row: PensumRow): Pensum {
  return {
    id: row.id,
    institutionId: row.institutionId,
    code: row.code,
    name: row.name,
    version: row.version,
    isActive: row.isActive,
    subjects: row.subjects.map((entry) => ({
      subjectId: entry.subjectId,
      code: entry.subject.code,
      name: entry.subject.name,
      level: entry.level,
      weeklyHours: entry.weeklyHours,
      credits: entry.credits,
    })),
  };
}

@Injectable()
export class PrismaPensumRepository implements PensumRepository {
  private readonly logger = new Logger(PrismaPensumRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(institutionId: string): Promise<Pensum[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.pensum.findMany({
          where: { institutionId },
          include: withSubjects,
          orderBy: [{ code: 'asc' }, { version: 'desc' }],
        })
      ).map(toDomain),
    );
  }

  findById(institutionId: string, id: string): Promise<Pensum | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.pensum.findFirst({
        where: { id, institutionId },
        include: withSubjects,
      });
      return row ? toDomain(row) : null;
    });
  }

  create(institutionId: string, pensum: PensumData): Promise<Pensum> {
    return runQuery(
      this.logger,
      async () =>
        toDomain(
          await this.prisma.pensum.create({
            data: { ...pensum, institutionId },
            include: withSubjects,
          }),
        ),
      ERRORS,
    );
  }

  update(institutionId: string, id: string, changes: PensumChanges): Promise<Pensum | null> {
    return runQuery(this.logger, async () => {
      await this.prisma.pensum.updateMany({ where: { id, institutionId }, data: changes });
      return this.findById(institutionId, id);
    });
  }

  delete(institutionId: string, id: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () => (await this.prisma.pensum.deleteMany({ where: { id, institutionId } })).count > 0,
      ERRORS,
    );
  }

  placeSubject(
    pensumId: string,
    subjectId: string,
    placement: PensumSubjectPlacement,
  ): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.pensumSubject.upsert({
        where: { pensumId_subjectId: { pensumId, subjectId } },
        create: { pensumId, subjectId, ...placement },
        update: placement,
      });
    });
  }

  removeSubject(pensumId: string, subjectId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () =>
        (await this.prisma.pensumSubject.deleteMany({ where: { pensumId, subjectId } })).count > 0,
      ERRORS,
    );
  }
}
