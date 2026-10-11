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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
  ExportGradebookUseCase,
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
import type { CsvFormat } from '../domain/gradebook-csv.js';
import {
  CalendarQueryDto,
  CreateEvaluationDto,
  ExportQueryDto,
  RecordGradesDto,
  UpdateEvaluationDto,
} from './evaluation.dtos.js';

/** Evaluations and grades of the institution in the `x-institution-id` header. */
@Controller()
export class EvaluationsController {
  constructor(
    @Inject(GetGradebookUseCase) private readonly getGradebook: GetGradebookUseCase,
    @Inject(ExportGradebookUseCase) private readonly exportGradebook: ExportGradebookUseCase,
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

  /** The gradebook as a CSV file, worded and formatted for the language asked for. */
  @Get('groups/:groupId/courses/:subjectId/gradebook/export')
  @Roles(Role.TEACHER)
  async export(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const file = await this.exportGradebook.execute(
      actor(institutionId, user),
      { groupId, subjectId },
      CSV_FORMATS[query.lang ?? 'es'],
    );
    // An ASCII fallback, and the real name for browsers that read RFC 5987
    const ascii = file.name.normalize('NFD').replace(/[^\w -]/g, '').trim() || 'gradebook';
    // Set only now: a refusal above must go out as an ordinary JSON error, not as a file
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}.csv"; filename*=UTF-8''${encodeURIComponent(file.name)}.csv`,
    );
    return file.csv;
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

/** Spanish spreadsheets write decimals with a comma, so their cells are separated by semicolons. */
const CSV_FORMATS: Record<'es' | 'en', CsvFormat> = {
  es: {
    separator: ';',
    decimal: ',',
    labels: {
      lastName: 'Apellidos',
      firstName: 'Nombres',
      average: 'Promedio (%)',
      gradedWeight: 'Evaluado (% de la materia)',
      evaluation: (title, weight, maxScore) => `${title} (${weight}%, sobre ${maxScore})`,
    },
  },
  en: {
    separator: ',',
    decimal: '.',
    labels: {
      lastName: 'Last name',
      firstName: 'First name',
      average: 'Average (%)',
      gradedWeight: 'Graded (% of the subject)',
      evaluation: (title, weight, maxScore) => `${title} (${weight}%, out of ${maxScore})`,
    },
  },
};

function actor(institutionId: string, user: AuthenticatedUser): Actor {
  return { institutionId, memberships: user.memberships };
}
