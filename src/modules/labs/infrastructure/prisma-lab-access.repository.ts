import { Inject, Injectable, Logger } from '@nestjs/common';
import { runQuery } from '../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service.js';
import { isLabKey, type InstitutionLab, type LabKey } from '../domain/lab-catalog.js';
import type { LabAccessRepository } from '../domain/ports/lab.ports.js';

@Injectable()
export class PrismaLabAccessRepository implements LabAccessRepository {
  private readonly logger = new Logger(PrismaLabAccessRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  institutionExists(institutionId: string): Promise<boolean> {
    return runQuery(
      this.logger,
      async () => (await this.prisma.institution.count({ where: { id: institutionId } })) > 0,
    );
  }

  list(institutionId: string): Promise<InstitutionLab[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.institutionLab.findMany({ where: { institutionId } });
      // A lab removed from the catalogue may still have a row: it is simply not offered
      return rows.flatMap(({ labKey, granted, enabled }) =>
        isLabKey(labKey) ? [{ labKey, granted, enabled }] : [],
      );
    });
  }

  async setGranted(institutionId: string, labKey: LabKey, granted: boolean): Promise<void> {
    await runQuery(this.logger, () =>
      this.prisma.institutionLab.upsert({
        where: { institutionId_labKey: { institutionId, labKey } },
        create: { institutionId, labKey, granted },
        update: { granted },
      }),
    );
  }

  async setEnabled(institutionId: string, labKey: LabKey, enabled: boolean): Promise<void> {
    await runQuery(this.logger, () =>
      this.prisma.institutionLab.updateMany({ where: { institutionId, labKey }, data: { enabled } }),
    );
  }
}
