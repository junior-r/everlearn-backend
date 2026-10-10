import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Subject as SubjectRow } from '../../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
  type PrismaErrorMap,
} from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { Subject } from '../../domain/entities/academic.entities.js';
import {
  SubjectCodeTakenException,
  SubjectInUseException,
} from '../../domain/exceptions/academic.exceptions.js';
import type { SubjectData, SubjectRepository } from '../../domain/ports/academic.repositories.js';

const ERRORS: PrismaErrorMap = {
  [PrismaErrorCode.UNIQUE_VIOLATION]: () => new SubjectCodeTakenException(),
  [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new SubjectInUseException(),
};

function toDomain(row: SubjectRow): Subject {
  return {
    id: row.id,
    institutionId: row.institutionId,
    code: row.code,
    name: row.name,
    description: row.description,
  };
}

@Injectable()
export class PrismaSubjectRepository implements SubjectRepository {
  private readonly logger = new Logger(PrismaSubjectRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(institutionId: string): Promise<Subject[]> {
    return runQuery(this.logger, async () =>
      (
        await this.prisma.subject.findMany({ where: { institutionId }, orderBy: { code: 'asc' } })
      ).map(toDomain),
    );
  }

  findById(institutionId: string, id: string): Promise<Subject | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.subject.findFirst({ where: { id, institutionId } });
      return row ? toDomain(row) : null;
    });
  }

  create(institutionId: string, subject: SubjectData): Promise<Subject> {
    return runQuery(
      this.logger,
      async () =>
        toDomain(await this.prisma.subject.create({ data: { ...subject, institutionId } })),
      ERRORS,
    );
  }

  update(institutionId: string, id: string, changes: Partial<SubjectData>): Promise<Subject | null> {
    return runQuery(
      this.logger,
      async () => {
        // updateMany lets the institution be part of the filter, so another tenant's row is never touched
        await this.prisma.subject.updateMany({ where: { id, institutionId }, data: changes });
        return this.findById(institutionId, id);
      },
      ERRORS,
    );
  }

  delete(institutionId: string, id: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () =>
        (await this.prisma.subject.deleteMany({ where: { id, institutionId } })).count > 0,
      ERRORS,
    );
  }
}
