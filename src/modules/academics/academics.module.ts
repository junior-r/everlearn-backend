import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  CreatePensumUseCase,
  DeletePensumUseCase,
  GetPensumUseCase,
  ListPensumsUseCase,
  PlaceSubjectInPensumUseCase,
  RemoveSubjectFromPensumUseCase,
  UpdatePensumUseCase,
} from './application/use-cases/pensum.use-cases.js';
import {
  CreateSubjectUseCase,
  DeleteSubjectUseCase,
  ListSubjectsUseCase,
  UpdateSubjectUseCase,
} from './application/use-cases/subject.use-cases.js';
import { PENSUM_REPOSITORY, SUBJECT_REPOSITORY } from './domain/ports/academic.repositories.js';
import { PrismaPensumRepository } from './infrastructure/repositories/prisma-pensum.repository.js';
import { PrismaSubjectRepository } from './infrastructure/repositories/prisma-subject.repository.js';
import { PensumsController } from './presentation/controllers/pensums.controller.js';
import { SubjectsController } from './presentation/controllers/subjects.controller.js';

@Module({
  controllers: [SubjectsController, PensumsController],
  providers: [
    { provide: SUBJECT_REPOSITORY, useClass: PrismaSubjectRepository },
    { provide: PENSUM_REPOSITORY, useClass: PrismaPensumRepository },
    useCaseProvider(ListSubjectsUseCase, [SUBJECT_REPOSITORY]),
    useCaseProvider(CreateSubjectUseCase, [SUBJECT_REPOSITORY]),
    useCaseProvider(UpdateSubjectUseCase, [SUBJECT_REPOSITORY]),
    useCaseProvider(DeleteSubjectUseCase, [SUBJECT_REPOSITORY]),
    useCaseProvider(ListPensumsUseCase, [PENSUM_REPOSITORY]),
    useCaseProvider(GetPensumUseCase, [PENSUM_REPOSITORY]),
    useCaseProvider(CreatePensumUseCase, [PENSUM_REPOSITORY]),
    useCaseProvider(UpdatePensumUseCase, [PENSUM_REPOSITORY]),
    useCaseProvider(DeletePensumUseCase, [PENSUM_REPOSITORY]),
    useCaseProvider(PlaceSubjectInPensumUseCase, [PENSUM_REPOSITORY, SUBJECT_REPOSITORY]),
    useCaseProvider(RemoveSubjectFromPensumUseCase, [PENSUM_REPOSITORY]),
  ],
})
export class AcademicsModule {}
