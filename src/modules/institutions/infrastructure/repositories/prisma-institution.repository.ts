import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Institution as InstitutionRow } from '../../../../shared/infrastructure/prisma/generated/client.js';
import {
  isPrismaError,
  PrismaErrorCode,
  runQuery,
} from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { Institution } from '../../domain/entities/institution.entity.js';
import { InstitutionSlugTakenException } from '../../domain/exceptions/institution.exceptions.js';
import type {
  InstitutionChanges,
  InstitutionRepository,
  NewInstitution,
} from '../../domain/ports/institution.repository.js';

function toDomain(row: InstitutionRow): Institution {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    isActive: row.isActive,
  };
}

@Injectable()
export class PrismaInstitutionRepository implements InstitutionRepository {
  private readonly logger = new Logger(PrismaInstitutionRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(): Promise<Institution[]> {
    return runQuery(this.logger, async () =>
      (await this.prisma.institution.findMany({ orderBy: { name: 'asc' } })).map(toDomain),
    );
  }

  findByIds(ids: string[]): Promise<Institution[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.institution.findMany({
          where: { id: { in: ids } },
          orderBy: { name: 'asc' },
        })
      ).map(toDomain),
    );
  }

  create(institution: NewInstitution): Promise<Institution> {
    return runQuery(
      this.logger,
      async () => toDomain(await this.prisma.institution.create({ data: institution })),
      { [PrismaErrorCode.UNIQUE_VIOLATION]: () => new InstitutionSlugTakenException() },
    );
  }

  update(id: string, changes: InstitutionChanges): Promise<Institution | null> {
    return runQuery(this.logger, async () => {
      try {
        return toDomain(await this.prisma.institution.update({ where: { id }, data: changes }));
      } catch (error) {
        if (isPrismaError(error, PrismaErrorCode.RECORD_NOT_FOUND)) {
          return null;
        }
        throw error;
      }
    });
  }

  hasMembers(id: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () => (await this.prisma.membership.count({ where: { institutionId: id } })) > 0,
    );
  }

  delete(id: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () => (await this.prisma.institution.deleteMany({ where: { id } })).count > 0,
    );
  }
}
