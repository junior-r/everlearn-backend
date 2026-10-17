import { Global, Module } from '@nestjs/common';
import { AVAILABLE_LABS } from '../../shared/domain/labs/available-labs.js';
import { NOTIFIER } from '../../shared/domain/notifications/notifier.js';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  LabAvailability,
  ListAvailableLabsUseCase,
  ListInstitutionLabsUseCase,
  ListLabSettingsUseCase,
  SetLabEnabledUseCase,
  SetLabGrantUseCase,
} from './application/use-cases/lab-access.use-cases.js';
import {
  CreateLabAssignmentUseCase,
  DeleteLabAssignmentUseCase,
  GetLabAssignmentResultsUseCase,
  GetMyLabAssignmentUseCase,
  ListCourseLabAssignmentsUseCase,
  ListMyLabAssignmentsUseCase,
  SubmitLabAttemptUseCase,
} from './application/use-cases/lab-assignment.use-cases.js';
import {
  ArchiveExerciseUseCase,
  CheckPracticeUseCase,
  CreateExerciseUseCase,
  GetPracticeSetUseCase,
  ListTeacherExercisesUseCase,
  SyncBuiltInExercisesUseCase,
  UpdateExerciseUseCase,
} from './application/use-cases/language-exercise.use-cases.js';
import {
  LAB_ACCESS_REPOSITORY,
  LAB_ASSIGNMENT_REPOSITORY,
  LANGUAGE_EXERCISE_REPOSITORY,
} from './domain/ports/lab.ports.js';
import { BuiltInExercisesBootstrap } from './infrastructure/built-in-exercises.bootstrap.js';
import { PrismaLabAccessRepository } from './infrastructure/prisma-lab-access.repository.js';
import { PrismaLabAssignmentRepository } from './infrastructure/prisma-lab-assignment.repository.js';
import { PrismaLanguageExerciseRepository } from './infrastructure/prisma-language-exercise.repository.js';
import { LabAssignmentsController } from './presentation/lab-assignments.controller.js';
import { LabSettingsController } from './presentation/lab-settings.controller.js';
import { LabsController } from './presentation/labs.controller.js';

/**
 * Composition root of Labs: which labs each institution may use, the language
 * exercises and the activities Teachers give. Global, so the classroom can ask
 * which labs a Teacher may share through `AVAILABLE_LABS` without importing it.
 */
@Global()
@Module({
  controllers: [LabSettingsController, LabsController, LabAssignmentsController],
  providers: [
    { provide: LAB_ACCESS_REPOSITORY, useClass: PrismaLabAccessRepository },
    { provide: LANGUAGE_EXERCISE_REPOSITORY, useClass: PrismaLanguageExerciseRepository },
    { provide: LAB_ASSIGNMENT_REPOSITORY, useClass: PrismaLabAssignmentRepository },
    useCaseProvider(LabAvailability, [LAB_ACCESS_REPOSITORY]),
    { provide: AVAILABLE_LABS, useExisting: LabAvailability },
    useCaseProvider(ListInstitutionLabsUseCase, [LAB_ACCESS_REPOSITORY]),
    useCaseProvider(SetLabGrantUseCase, [LAB_ACCESS_REPOSITORY]),
    useCaseProvider(ListLabSettingsUseCase, [LAB_ACCESS_REPOSITORY]),
    useCaseProvider(SetLabEnabledUseCase, [LAB_ACCESS_REPOSITORY]),
    useCaseProvider(ListAvailableLabsUseCase, [LAB_ACCESS_REPOSITORY]),
    useCaseProvider(ListTeacherExercisesUseCase, [LAB_ACCESS_REPOSITORY, LANGUAGE_EXERCISE_REPOSITORY]),
    useCaseProvider(CreateExerciseUseCase, [LAB_ACCESS_REPOSITORY, LANGUAGE_EXERCISE_REPOSITORY]),
    useCaseProvider(UpdateExerciseUseCase, [LANGUAGE_EXERCISE_REPOSITORY]),
    useCaseProvider(ArchiveExerciseUseCase, [LANGUAGE_EXERCISE_REPOSITORY]),
    useCaseProvider(GetPracticeSetUseCase, [LAB_ACCESS_REPOSITORY, LANGUAGE_EXERCISE_REPOSITORY]),
    useCaseProvider(CheckPracticeUseCase, [LAB_ACCESS_REPOSITORY, LANGUAGE_EXERCISE_REPOSITORY]),
    useCaseProvider(SyncBuiltInExercisesUseCase, [LANGUAGE_EXERCISE_REPOSITORY]),
    useCaseProvider(CreateLabAssignmentUseCase, [
      LAB_ACCESS_REPOSITORY,
      LANGUAGE_EXERCISE_REPOSITORY,
      LAB_ASSIGNMENT_REPOSITORY,
      NOTIFIER,
    ]),
    useCaseProvider(ListCourseLabAssignmentsUseCase, [LAB_ASSIGNMENT_REPOSITORY]),
    useCaseProvider(GetLabAssignmentResultsUseCase, [LANGUAGE_EXERCISE_REPOSITORY, LAB_ASSIGNMENT_REPOSITORY]),
    useCaseProvider(DeleteLabAssignmentUseCase, [LAB_ASSIGNMENT_REPOSITORY]),
    useCaseProvider(ListMyLabAssignmentsUseCase, [LAB_ACCESS_REPOSITORY, LAB_ASSIGNMENT_REPOSITORY]),
    useCaseProvider(GetMyLabAssignmentUseCase, [
      LAB_ACCESS_REPOSITORY,
      LANGUAGE_EXERCISE_REPOSITORY,
      LAB_ASSIGNMENT_REPOSITORY,
    ]),
    useCaseProvider(SubmitLabAttemptUseCase, [
      LAB_ACCESS_REPOSITORY,
      LANGUAGE_EXERCISE_REPOSITORY,
      LAB_ASSIGNMENT_REPOSITORY,
    ]),
    BuiltInExercisesBootstrap,
  ],
  exports: [AVAILABLE_LABS],
})
export class LabsModule {}
