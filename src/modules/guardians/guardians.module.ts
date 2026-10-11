import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  GetMyProgressUseCase,
  ListDueEvaluationsUseCase,
} from '../evaluations/application/use-cases/evaluation.use-cases.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import { GetGroupScheduleUseCase } from '../scheduling/application/use-cases/scheduling.use-cases.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import {
  GetWardOverviewUseCase,
  LinkGuardianUseCase,
  ListGuardianLinksUseCase,
  ListMyWardsUseCase,
  UnlinkGuardianUseCase,
} from './application/use-cases/guardian.use-cases.js';
import { GUARDIAN_REPOSITORY, WARD_ACADEMICS } from './domain/ports/guardian.ports.js';
import { ModuleWardAcademics } from './infrastructure/module-ward-academics.js';
import { PrismaGuardianRepository } from './infrastructure/prisma-guardian.repository.js';
import { GuardiansController } from './presentation/guardians.controller.js';

/** Composition root of Guardians: who answers for which Student, and what they may see of them. */
@Module({
  imports: [EvaluationsModule, SchedulingModule],
  controllers: [GuardiansController],
  providers: [
    { provide: GUARDIAN_REPOSITORY, useClass: PrismaGuardianRepository },
    {
      provide: WARD_ACADEMICS,
      useFactory: (schedule: GetGroupScheduleUseCase, progress: GetMyProgressUseCase, due: ListDueEvaluationsUseCase) =>
        new ModuleWardAcademics(schedule, progress, due),
      inject: [GetGroupScheduleUseCase, GetMyProgressUseCase, ListDueEvaluationsUseCase],
    },
    useCaseProvider(ListGuardianLinksUseCase, [GUARDIAN_REPOSITORY]),
    useCaseProvider(LinkGuardianUseCase, [GUARDIAN_REPOSITORY]),
    useCaseProvider(UnlinkGuardianUseCase, [GUARDIAN_REPOSITORY]),
    useCaseProvider(ListMyWardsUseCase, [GUARDIAN_REPOSITORY]),
    useCaseProvider(GetWardOverviewUseCase, [GUARDIAN_REPOSITORY, WARD_ACADEMICS]),
  ],
})
export class GuardiansModule {}
