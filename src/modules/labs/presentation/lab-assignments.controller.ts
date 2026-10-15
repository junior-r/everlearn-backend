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
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  CreateLabAssignmentUseCase,
  DeleteLabAssignmentUseCase,
  GetLabAssignmentResultsUseCase,
  GetMyLabAssignmentUseCase,
  ListCourseLabAssignmentsUseCase,
  ListMyLabAssignmentsUseCase,
  SubmitLabAttemptUseCase,
  type AssignmentResults,
  type MyAssignment,
  type MyAssignmentDetail,
} from '../application/use-cases/lab-assignment.use-cases.js';
import type { LabAssignment, LabAttempt } from '../domain/lab-assignment.js';
import type { AssignmentSummary } from '../domain/ports/lab.ports.js';
import { CreateLabAssignmentDto, SubmitLabAttemptDto } from './lab.dtos.js';
import { actorOf } from './actor-of.js';

/** Lab activities: given by a course's Teacher to its group, handed in by its Students. */
@Controller()
export class LabAssignmentsController {
  constructor(
    @Inject(CreateLabAssignmentUseCase) private readonly createAssignment: CreateLabAssignmentUseCase,
    @Inject(ListCourseLabAssignmentsUseCase) private readonly listForCourse: ListCourseLabAssignmentsUseCase,
    @Inject(GetLabAssignmentResultsUseCase) private readonly getResults: GetLabAssignmentResultsUseCase,
    @Inject(DeleteLabAssignmentUseCase) private readonly deleteAssignment: DeleteLabAssignmentUseCase,
    @Inject(ListMyLabAssignmentsUseCase) private readonly listMine: ListMyLabAssignmentsUseCase,
    @Inject(GetMyLabAssignmentUseCase) private readonly getMine: GetMyLabAssignmentUseCase,
    @Inject(SubmitLabAttemptUseCase) private readonly submitAttempt: SubmitLabAttemptUseCase,
  ) {}

  @Post('groups/:groupId/courses/:subjectId/lab-assignments')
  @Roles(Role.TEACHER)
  create(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: CreateLabAssignmentDto,
  ): Promise<LabAssignment> {
    return this.createAssignment.execute(
      actorOf(institutionId, user),
      { groupId, subjectId },
      {
        labKey: dto.labKey,
        title: dto.title,
        instructions: dto.instructions ?? null,
        dueAt: dto.dueAt ?? null,
        exerciseIds: dto.exerciseIds ?? [],
      },
    );
  }

  @Get('groups/:groupId/courses/:subjectId/lab-assignments')
  @Roles(Role.TEACHER)
  list(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<AssignmentSummary[]> {
    return this.listForCourse.execute(actorOf(institutionId, user), { groupId, subjectId });
  }

  // Declared before `lab-assignments/:assignmentId`, which would otherwise take "mine" for an id
  @Get('lab-assignments/mine')
  @Roles(Role.STUDENT)
  mine(@CurrentInstitutionId() institutionId: string, @CurrentUser() user: AuthenticatedUser): Promise<MyAssignment[]> {
    return this.listMine.execute(actorOf(institutionId, user));
  }

  @Get('lab-assignments/:assignmentId')
  @Roles(Role.STUDENT)
  detail(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ): Promise<MyAssignmentDetail> {
    return this.getMine.execute(actorOf(institutionId, user), assignmentId);
  }

  @Post('lab-assignments/:assignmentId/attempt')
  @Roles(Role.STUDENT)
  submit(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: SubmitLabAttemptDto,
  ): Promise<LabAttempt> {
    return this.submitAttempt.execute(actorOf(institutionId, user), assignmentId, {
      answers: dto.answers ?? [],
      note: dto.note ?? null,
    });
  }

  @Get('lab-assignments/:assignmentId/results')
  @Roles(Role.TEACHER)
  results(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ): Promise<AssignmentResults> {
    return this.getResults.execute(actorOf(institutionId, user), assignmentId);
  }

  @Delete('lab-assignments/:assignmentId')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ): Promise<void> {
    await this.deleteAssignment.execute(actorOf(institutionId, user), assignmentId);
  }
}
