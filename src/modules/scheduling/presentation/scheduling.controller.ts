import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  GetGroupScheduleUseCase,
  GetTeacherAvailabilityUseCase,
  RemoveScheduleSlotUseCase,
  ScheduleCourseUseCase,
  SetTeacherAvailabilityUseCase,
} from '../application/use-cases/scheduling.use-cases.js';
import type { ScheduledSlot, TimeRange } from '../domain/schedule.js';
import { AvailabilityQueryDto, ScheduleCourseDto, SetAvailabilityDto } from './scheduling.dtos.js';

/** Teacher availability and group timetables of the institution in the `x-institution-id` header. */
@Controller()
@Roles(Role.ADMIN)
export class SchedulingController {
  constructor(
    @Inject(GetTeacherAvailabilityUseCase)
    private readonly getAvailability: GetTeacherAvailabilityUseCase,
    @Inject(SetTeacherAvailabilityUseCase)
    private readonly setAvailability: SetTeacherAvailabilityUseCase,
    @Inject(GetGroupScheduleUseCase) private readonly getSchedule: GetGroupScheduleUseCase,
    @Inject(ScheduleCourseUseCase) private readonly scheduleCourse: ScheduleCourseUseCase,
    @Inject(RemoveScheduleSlotUseCase) private readonly removeSlot: RemoveScheduleSlotUseCase,
  ) {}

  @Get('teachers/:teacherId/availability')
  availability(
    @CurrentInstitutionId() institutionId: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<TimeRange[]> {
    return this.getAvailability.execute(institutionId, teacherId, query.periodId);
  }

  @Put('teachers/:teacherId/availability')
  replaceAvailability(
    @CurrentInstitutionId() institutionId: string,
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<TimeRange[]> {
    const windows = dto.windows.map((window) => ({
      dayOfWeek: window.dayOfWeek,
      startMinute: window.startMinute,
      endMinute: window.endMinute,
    }));
    return this.setAvailability.execute(institutionId, teacherId, dto.periodId, windows);
  }

  @Get('groups/:groupId/schedule')
  schedule(
    @CurrentInstitutionId() institutionId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<ScheduledSlot[]> {
    return this.getSchedule.execute(institutionId, groupId);
  }

  @Post('groups/:groupId/schedule')
  add(
    @CurrentInstitutionId() institutionId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: ScheduleCourseDto,
  ): Promise<ScheduledSlot[]> {
    return this.scheduleCourse.execute({
      institutionId,
      groupId,
      subjectId: dto.subjectId,
      dayOfWeek: dto.dayOfWeek,
      startMinute: dto.startMinute,
      endMinute: dto.endMinute,
      room: dto.room,
    });
  }

  @Delete('groups/:groupId/schedule/:slotId')
  remove(
    @CurrentInstitutionId() institutionId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ): Promise<ScheduledSlot[]> {
    return this.removeSlot.execute(institutionId, groupId, slotId);
  }
}
