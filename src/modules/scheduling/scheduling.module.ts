import { Module } from '@nestjs/common';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import { AcademicsModule } from '../academics/academics.module.js';
import {
  MEMBER_DIRECTORY,
  PERIOD_REPOSITORY,
} from '../academics/domain/ports/group.repositories.js';
import {
  GetGroupScheduleUseCase,
  GetTeacherAvailabilityUseCase,
  RemoveScheduleSlotUseCase,
  ScheduleCourseUseCase,
  SetTeacherAvailabilityUseCase,
} from './application/use-cases/scheduling.use-cases.js';
import {
  AVAILABILITY_REPOSITORY,
  SCHEDULE_LOCK,
  SCHEDULE_REPOSITORY,
} from './domain/ports/scheduling.ports.js';
import {
  PrismaAvailabilityRepository,
  PrismaScheduleRepository,
} from './infrastructure/prisma-scheduling.repositories.js';
import { RedisScheduleLock } from './infrastructure/redis-schedule-lock.js';
import { SchedulingController } from './presentation/scheduling.controller.js';

/** Builds on academics: it reuses that module's view of periods and of who is an active Teacher. */
@Module({
  imports: [AcademicsModule],
  controllers: [SchedulingController],
  providers: [
    { provide: AVAILABILITY_REPOSITORY, useClass: PrismaAvailabilityRepository },
    { provide: SCHEDULE_REPOSITORY, useClass: PrismaScheduleRepository },
    { provide: SCHEDULE_LOCK, useClass: RedisScheduleLock },
    useCaseProvider(GetTeacherAvailabilityUseCase, [
      AVAILABILITY_REPOSITORY,
      MEMBER_DIRECTORY,
      PERIOD_REPOSITORY,
    ]),
    useCaseProvider(SetTeacherAvailabilityUseCase, [
      AVAILABILITY_REPOSITORY,
      SCHEDULE_REPOSITORY,
      MEMBER_DIRECTORY,
      PERIOD_REPOSITORY,
      SCHEDULE_LOCK,
    ]),
    useCaseProvider(GetGroupScheduleUseCase, [SCHEDULE_REPOSITORY]),
    useCaseProvider(ScheduleCourseUseCase, [
      SCHEDULE_REPOSITORY,
      AVAILABILITY_REPOSITORY,
      SCHEDULE_LOCK,
    ]),
    useCaseProvider(RemoveScheduleSlotUseCase, [SCHEDULE_REPOSITORY]),
  ],
})
export class SchedulingModule {}
