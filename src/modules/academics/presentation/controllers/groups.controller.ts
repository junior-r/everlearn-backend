import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  Roles,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
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
} from '../../application/use-cases/group.use-cases.js';
import type {
  AcademicPeriod,
  Group,
  GroupSummary,
} from '../../domain/entities/group.entities.js';
import {
  AssignTeacherDto,
  CreateGroupDto,
  CreatePeriodDto,
  EnrollStudentDto,
} from '../dtos/group.dtos.js';

/** Academic periods of the institution in the `x-institution-id` header. */
@Controller('periods')
@Roles(Role.ADMIN)
export class PeriodsController {
  constructor(
    @Inject(ListPeriodsUseCase) private readonly listPeriods: ListPeriodsUseCase,
    @Inject(CreatePeriodUseCase) private readonly createPeriod: CreatePeriodUseCase,
  ) {}

  @Get()
  list(@CurrentInstitutionId() institutionId: string): Promise<AcademicPeriod[]> {
    return this.listPeriods.execute(institutionId);
  }

  @Post()
  create(
    @CurrentInstitutionId() institutionId: string,
    @Body() dto: CreatePeriodDto,
  ): Promise<AcademicPeriod> {
    return this.createPeriod.execute(institutionId, {
      name: dto.name,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
  }
}

/** Groups (classes) of the institution in the `x-institution-id` header, with their teachers and students. */
@Controller('groups')
@Roles(Role.ADMIN)
export class GroupsController {
  constructor(
    @Inject(ListGroupsUseCase) private readonly listGroups: ListGroupsUseCase,
    @Inject(GetGroupUseCase) private readonly getGroup: GetGroupUseCase,
    @Inject(CreateGroupUseCase) private readonly createGroup: CreateGroupUseCase,
    @Inject(DeleteGroupUseCase) private readonly deleteGroup: DeleteGroupUseCase,
    @Inject(AssignCourseTeacherUseCase) private readonly assignTeacher: AssignCourseTeacherUseCase,
    @Inject(EnrollStudentUseCase) private readonly enrollStudent: EnrollStudentUseCase,
    @Inject(UnenrollStudentUseCase) private readonly unenrollStudent: UnenrollStudentUseCase,
  ) {}

  @Get()
  list(@CurrentInstitutionId() institutionId: string): Promise<GroupSummary[]> {
    return this.listGroups.execute(institutionId);
  }

  @Get(':id')
  get(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Group> {
    return this.getGroup.execute(institutionId, id);
  }

  @Post()
  create(
    @CurrentInstitutionId() institutionId: string,
    @Body() dto: CreateGroupDto,
  ): Promise<Group> {
    return this.createGroup.execute(institutionId, {
      name: dto.name,
      level: dto.level,
      capacity: dto.capacity,
      pensumId: dto.pensumId,
      periodId: dto.periodId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteGroup.execute(institutionId, id);
  }

  @Put(':id/courses/:subjectId')
  assign(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: AssignTeacherDto,
  ): Promise<Group> {
    return this.assignTeacher.execute(institutionId, id, subjectId, dto.teacherMembershipId);
  }

  @Post(':id/students')
  @HttpCode(HttpStatus.OK)
  enroll(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollStudentDto,
  ): Promise<Group> {
    return this.enrollStudent.execute(institutionId, id, dto.membershipId);
  }

  @Delete(':id/students/:membershipId')
  unenroll(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<Group> {
    return this.unenrollStudent.execute(institutionId, id, membershipId);
  }
}
