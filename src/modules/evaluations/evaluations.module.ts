import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  CreateEvaluationUseCase,
  DeleteEvaluationUseCase,
  GetGradebookUseCase,
  GetMyProgressUseCase,
  ListDueEvaluationsUseCase,
  PublishEvaluationUseCase,
  RecordGradesUseCase,
  UpdateEvaluationUseCase,
} from './application/use-cases/evaluation.use-cases.js';
import { EVALUATION_REPOSITORY } from './domain/ports/evaluation.ports.js';
import { PrismaEvaluationRepository } from './infrastructure/prisma-evaluation.repository.js';
import { EvaluationsController } from './presentation/evaluations.controller.js';

/** Composition root of academic progress: evaluations, grades and averages. */
@Module({
  controllers: [EvaluationsController],
  providers: [
    { provide: EVALUATION_REPOSITORY, useClass: PrismaEvaluationRepository },
    useCaseProvider(CreateEvaluationUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(UpdateEvaluationUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(PublishEvaluationUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(DeleteEvaluationUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(RecordGradesUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(GetGradebookUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(GetMyProgressUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(ListDueEvaluationsUseCase, [EVALUATION_REPOSITORY]),
  ],
})
export class EvaluationsModule {}
