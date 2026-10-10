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
} from '@nestjs/common';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  Roles,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
import {
  CreatePensumUseCase,
  DeletePensumUseCase,
  GetPensumUseCase,
  ListPensumsUseCase,
  PlaceSubjectInPensumUseCase,
  RemoveSubjectFromPensumUseCase,
  UpdatePensumUseCase,
} from '../../application/use-cases/pensum.use-cases.js';
import type { Pensum } from '../../domain/entities/academic.entities.js';
import { CreatePensumDto, PlaceSubjectDto, UpdatePensumDto } from '../dtos/academic.dtos.js';

/** Pensums (curricula) of the institution in the `x-institution-id` header. */
@Controller('pensums')
@Roles(Role.ADMIN)
export class PensumsController {
  constructor(
    @Inject(ListPensumsUseCase) private readonly listPensums: ListPensumsUseCase,
    @Inject(GetPensumUseCase) private readonly getPensum: GetPensumUseCase,
    @Inject(CreatePensumUseCase) private readonly createPensum: CreatePensumUseCase,
    @Inject(UpdatePensumUseCase) private readonly updatePensum: UpdatePensumUseCase,
    @Inject(DeletePensumUseCase) private readonly deletePensum: DeletePensumUseCase,
    @Inject(PlaceSubjectInPensumUseCase) private readonly placeSubject: PlaceSubjectInPensumUseCase,
    @Inject(RemoveSubjectFromPensumUseCase)
    private readonly removeSubject: RemoveSubjectFromPensumUseCase,
  ) {}

  @Get()
  list(@CurrentInstitutionId() institutionId: string): Promise<Pensum[]> {
    return this.listPensums.execute(institutionId);
  }

  @Get(':id')
  get(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Pensum> {
    return this.getPensum.execute(institutionId, id);
  }

  @Post()
  create(
    @CurrentInstitutionId() institutionId: string,
    @Body() dto: CreatePensumDto,
  ): Promise<Pensum> {
    return this.createPensum.execute(institutionId, {
      code: dto.code,
      name: dto.name,
      version: dto.version,
    });
  }

  @Patch(':id')
  update(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePensumDto,
  ): Promise<Pensum> {
    return this.updatePensum.execute(institutionId, id, { name: dto.name, isActive: dto.isActive });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.deletePensum.execute(institutionId, id);
  }

  @Put(':id/subjects/:subjectId')
  place(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: PlaceSubjectDto,
  ): Promise<Pensum> {
    return this.placeSubject.execute(institutionId, id, subjectId, {
      level: dto.level,
      weeklyHours: dto.weeklyHours,
      credits: dto.credits ?? null,
    });
  }

  @Delete(':id/subjects/:subjectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unplace(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<void> {
    await this.removeSubject.execute(institutionId, id, subjectId);
  }
}
