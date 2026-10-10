import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  AssignCourseTeacherUseCase,
  CreateGroupUseCase,
  CreatePeriodUseCase,
  DeleteGroupUseCase,
  EnrollStudentUseCase,
  GetGroupUseCase,
  ListGroupsUseCase,
  ListPeriodsUseCase,
  UnenrollStudentUseCase,
} from './application/use-cases/group.use-cases.js';
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
import {
  GROUP_REPOSITORY,
  MEMBER_DIRECTORY,
  PERIOD_REPOSITORY,
} from './domain/ports/group.repositories.js';
import {
  PrismaGroupRepository,
  PrismaMemberDirectory,
  PrismaPeriodRepository,
} from './infrastructure/repositories/prisma-group.repositories.js';
import { PrismaPensumRepository } from './infrastructure/repositories/prisma-pensum.repository.js';
import { PrismaSubjectRepository } from './infrastructure/repositories/prisma-subject.repository.js';
import { GroupsController, PeriodsController } from './presentation/controllers/groups.controller.js';
import { PensumsController } from './presentation/controllers/pensums.controller.js';
import { SubjectsController } from './presentation/controllers/subjects.controller.js';

@Module({
  controllers: [SubjectsController, PensumsController, PeriodsController, GroupsController],
  providers: [
    { provide: SUBJECT_REPOSITORY, useClass: PrismaSubjectRepository },
    { provide: PENSUM_REPOSITORY, useClass: PrismaPensumRepository },
    { provide: PERIOD_REPOSITORY, useClass: PrismaPeriodRepository },
    { provide: GROUP_REPOSITORY, useClass: PrismaGroupRepository },
    { provide: MEMBER_DIRECTORY, useClass: PrismaMemberDirectory },
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
    useCaseProvider(ListPeriodsUseCase, [PERIOD_REPOSITORY]),
    useCaseProvider(CreatePeriodUseCase, [PERIOD_REPOSITORY]),
    useCaseProvider(ListGroupsUseCase, [GROUP_REPOSITORY]),
    useCaseProvider(GetGroupUseCase, [GROUP_REPOSITORY]),
    useCaseProvider(CreateGroupUseCase, [GROUP_REPOSITORY, PENSUM_REPOSITORY, PERIOD_REPOSITORY]),
    useCaseProvider(DeleteGroupUseCase, [GROUP_REPOSITORY]),
    useCaseProvider(AssignCourseTeacherUseCase, [GROUP_REPOSITORY, MEMBER_DIRECTORY]),
    useCaseProvider(EnrollStudentUseCase, [GROUP_REPOSITORY, MEMBER_DIRECTORY]),
    useCaseProvider(UnenrollStudentUseCase, [GROUP_REPOSITORY]),
  ],
})
export class AcademicsModule {}
