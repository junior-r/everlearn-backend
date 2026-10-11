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
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  CreateEvaluationUseCase,
  DeleteEvaluationUseCase,
  GetGradebookUseCase,
  GetMyProgressUseCase,
  ListDueEvaluationsUseCase,
  PublishEvaluationUseCase,
  RecordGradesUseCase,
  UpdateEvaluationUseCase,
  type Actor,
  type CalendarEntry,
  type CourseProgress,
  type Gradebook,
} from '../application/use-cases/evaluation.use-cases.js';
import type { Evaluation } from '../domain/evaluation.js';
import {
  CalendarQueryDto,
  CreateEvaluationDto,
  RecordGradesDto,
  UpdateEvaluationDto,
} from './evaluation.dtos.js';

/** Evaluations and grades of the institution in the `x-institution-id` header. */
@Controller()
export class EvaluationsController {
  constructor(
    @Inject(GetGradebookUseCase) private readonly getGradebook: GetGradebookUseCase,
    @Inject(CreateEvaluationUseCase) private readonly createEvaluation: CreateEvaluationUseCase,
    @Inject(UpdateEvaluationUseCase) private readonly updateEvaluation: UpdateEvaluationUseCase,
    @Inject(PublishEvaluationUseCase) private readonly publishEvaluation: PublishEvaluationUseCase,
    @Inject(DeleteEvaluationUseCase) private readonly deleteEvaluation: DeleteEvaluationUseCase,
    @Inject(RecordGradesUseCase) private readonly recordGrades: RecordGradesUseCase,
    @Inject(GetMyProgressUseCase) private readonly getProgress: GetMyProgressUseCase,
    @Inject(ListDueEvaluationsUseCase) private readonly listDue: ListDueEvaluationsUseCase,
  ) {}

  @Get('groups/:groupId/courses/:subjectId/gradebook')
  @Roles(Role.TEACHER)
  gradebook(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<Gradebook> {
    return this.getGradebook.execute(actor(institutionId, user), { groupId, subjectId });
  }

  @Post('groups/:groupId/courses/:subjectId/evaluations')
  @Roles(Role.TEACHER)
  create(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: CreateEvaluationDto,
  ): Promise<Evaluation> {
    return this.createEvaluation.execute(
      actor(institutionId, user),
      { groupId, subjectId },
      {
        title: dto.title,
        type: dto.type,
        weight: dto.weight,
        maxScore: dto.maxScore,
        dueAt: dto.dueAt ?? null,
      },
    );
  }

  @Patch('evaluations/:evaluationId')
  @Roles(Role.TEACHER)
  update(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('evaluationId', ParseUUIDPipe) evaluationId: string,
    @Body() dto: UpdateEvaluationDto,
  ): Promise<Evaluation> {
    return this.updateEvaluation.execute(actor(institutionId, user), evaluationId, dto);
  }

  @Post('evaluations/:evaluationId/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.TEACHER)
  publish(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('evaluationId', ParseUUIDPipe) evaluationId: string,
  ): Promise<Evaluation> {
    return this.publishEvaluation.execute(actor(institutionId, user), evaluationId);
  }

  @Delete('evaluations/:evaluationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.TEACHER)
  async remove(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('evaluationId', ParseUUIDPipe) evaluationId: string,
  ): Promise<void> {
    await this.deleteEvaluation.execute(actor(institutionId, user), evaluationId);
  }

  @Put('evaluations/:evaluationId/grades')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.TEACHER)
  async grade(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('evaluationId', ParseUUIDPipe) evaluationId: string,
    @Body() dto: RecordGradesDto,
  ): Promise<void> {
    await this.recordGrades.execute(
      actor(institutionId, user),
      evaluationId,
      dto.grades.map(({ enrollmentId, score, feedback }) => ({ enrollmentId, score, feedback })),
    );
  }

  @Get('evaluations/progress')
  @Roles(Role.STUDENT)
  progress(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CourseProgress[]> {
    return this.getProgress.execute(actor(institutionId, user));
  }

  @Get('evaluations/calendar')
  @Roles(Role.TEACHER, Role.STUDENT)
  calendar(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CalendarQueryDto,
  ): Promise<CalendarEntry[]> {
    return this.listDue.execute(actor(institutionId, user), query.from ?? new Date(), query.to ?? null);
  }
}

function actor(institutionId: string, user: AuthenticatedUser): Actor {
  return { institutionId, memberships: user.memberships };
}
