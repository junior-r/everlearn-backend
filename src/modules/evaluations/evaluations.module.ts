import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  CreateEvaluationUseCase,
  DeleteEvaluationUseCase,
  ExportGradebookUseCase,
  GetGradebookUseCase,
  GetMyProgressUseCase,
  ListDueEvaluationsUseCase,
  PublishEvaluationUseCase,
  RecordGradesUseCase,
  UpdateEvaluationUseCase,
} from './application/use-cases/evaluation.use-cases.js';
import { NOTIFIER } from '../../shared/domain/notifications/notifier.js';
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
    useCaseProvider(PublishEvaluationUseCase, [EVALUATION_REPOSITORY, NOTIFIER]),
    useCaseProvider(DeleteEvaluationUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(RecordGradesUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(GetGradebookUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(ExportGradebookUseCase, [GetGradebookUseCase]),
    useCaseProvider(GetMyProgressUseCase, [EVALUATION_REPOSITORY]),
    useCaseProvider(ListDueEvaluationsUseCase, [EVALUATION_REPOSITORY]),
  ],
  // The AI assistant reads grades through the same use cases as the Student and the Teacher do
  exports: [GetMyProgressUseCase, GetGradebookUseCase, ListDueEvaluationsUseCase],
})
export class EvaluationsModule {}
