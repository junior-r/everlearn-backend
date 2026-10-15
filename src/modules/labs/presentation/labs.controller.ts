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
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import { actorOf } from './actor-of.js';
import { ListAvailableLabsUseCase } from '../application/use-cases/lab-access.use-cases.js';
import {
  ArchiveExerciseUseCase,
  CheckPracticeUseCase,
  CreateExerciseUseCase,
  GetPracticeSetUseCase,
  ListTeacherExercisesUseCase,
  UpdateExerciseUseCase,
  type TeacherExercises,
} from '../application/use-cases/language-exercise.use-cases.js';
import type { LabDefinition } from '../domain/lab-catalog.js';
import type { ExerciseQuestion, LanguageExercise, MarkedAnswer } from '../domain/language-exercise.js';
import { ExerciseDto, PracticeAnswersDto } from './lab.dtos.js';


/** The labs a member may open, and the exercises of the language labs. */
@Controller()
export class LabsController {
  constructor(
    @Inject(ListAvailableLabsUseCase) private readonly listAvailable: ListAvailableLabsUseCase,
    @Inject(ListTeacherExercisesUseCase) private readonly listExercises: ListTeacherExercisesUseCase,
    @Inject(CreateExerciseUseCase) private readonly createExercise: CreateExerciseUseCase,
    @Inject(UpdateExerciseUseCase) private readonly updateExercise: UpdateExerciseUseCase,
    @Inject(ArchiveExerciseUseCase) private readonly archiveExercise: ArchiveExerciseUseCase,
    @Inject(GetPracticeSetUseCase) private readonly practiceSet: GetPracticeSetUseCase,
    @Inject(CheckPracticeUseCase) private readonly checkPractice: CheckPracticeUseCase,
  ) {}

  @Get('labs')
  @Roles(Role.TEACHER, Role.STUDENT)
  available(@CurrentInstitutionId() institutionId: string): Promise<LabDefinition[]> {
    return this.listAvailable.execute(institutionId);
  }

  @Get('labs/:labKey/exercises')
  @Roles(Role.TEACHER)
  exercises(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('labKey') labKey: string,
  ): Promise<TeacherExercises> {
    return this.listExercises.execute(actorOf(institutionId, user), labKey);
  }

  @Post('labs/:labKey/exercises')
  @Roles(Role.TEACHER)
  create(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('labKey') labKey: string,
    @Body() dto: ExerciseDto,
  ): Promise<LanguageExercise> {
    return this.createExercise.execute(actorOf(institutionId, user), labKey, {
      prompt: dto.prompt,
      answers: dto.answers,
      hint: dto.hint ?? null,
    });
  }

  @Patch('lab-exercises/:exerciseId')
  @Roles(Role.TEACHER)
  update(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
    @Body() dto: ExerciseDto,
  ): Promise<LanguageExercise> {
    return this.updateExercise.execute(actorOf(institutionId, user), exerciseId, {
      prompt: dto.prompt,
      answers: dto.answers,
      hint: dto.hint ?? null,
    });
  }

  @Delete('lab-exercises/:exerciseId')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId', ParseUUIDPipe) exerciseId: string,
  ): Promise<void> {
    await this.archiveExercise.execute(actorOf(institutionId, user), exerciseId);
  }

  @Get('labs/:labKey/practice')
  @Roles(Role.TEACHER, Role.STUDENT)
  practice(@CurrentInstitutionId() institutionId: string, @Param('labKey') labKey: string): Promise<ExerciseQuestion[]> {
    return this.practiceSet.execute(institutionId, labKey);
  }

  @Post('labs/:labKey/practice')
  @Roles(Role.TEACHER, Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  check(
    @CurrentInstitutionId() institutionId: string,
    @Param('labKey') labKey: string,
    @Body() dto: PracticeAnswersDto,
  ): Promise<MarkedAnswer[]> {
    return this.checkPractice.execute(institutionId, labKey, dto.answers);
  }
}
