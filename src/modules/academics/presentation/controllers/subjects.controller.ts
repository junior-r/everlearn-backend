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
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  Roles,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
import {
  CreateSubjectUseCase,
  DeleteSubjectUseCase,
  ListSubjectsUseCase,
  UpdateSubjectUseCase,
} from '../../application/use-cases/subject.use-cases.js';
import type { Subject } from '../../domain/entities/academic.entities.js';
import { CreateSubjectDto, UpdateSubjectDto } from '../dtos/academic.dtos.js';

/** Subjects of the institution in the `x-institution-id` header. */
@Controller('subjects')
@Roles(Role.ADMIN)
export class SubjectsController {
  constructor(
    @Inject(ListSubjectsUseCase) private readonly listSubjects: ListSubjectsUseCase,
    @Inject(CreateSubjectUseCase) private readonly createSubject: CreateSubjectUseCase,
    @Inject(UpdateSubjectUseCase) private readonly updateSubject: UpdateSubjectUseCase,
    @Inject(DeleteSubjectUseCase) private readonly deleteSubject: DeleteSubjectUseCase,
  ) {}

  @Get()
  list(@CurrentInstitutionId() institutionId: string): Promise<Subject[]> {
    return this.listSubjects.execute(institutionId);
  }

  @Post()
  create(
    @CurrentInstitutionId() institutionId: string,
    @Body() dto: CreateSubjectDto,
  ): Promise<Subject> {
    return this.createSubject.execute(institutionId, {
      code: dto.code,
      name: dto.name,
      description: dto.description,
    });
  }

  @Patch(':id')
  update(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
  ): Promise<Subject> {
    return this.updateSubject.execute(institutionId, id, {
      code: dto.code,
      name: dto.name,
      description: dto.description,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deleteSubject.execute(institutionId, id);
  }
}
