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
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import {
  CurrentUser,
  PlatformAdminOnly,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
import {
  CreateInstitutionUseCase,
  DeleteInstitutionUseCase,
  ListInstitutionsUseCase,
  UpdateInstitutionUseCase,
} from '../../application/use-cases/institution.use-cases.js';
import type { Institution } from '../../domain/entities/institution.entity.js';
import { CreateInstitutionDto, UpdateInstitutionDto } from '../dtos/institution.dtos.js';

@Controller('institutions')
export class InstitutionsController {
  constructor(
    @Inject(CreateInstitutionUseCase) private readonly createInstitution: CreateInstitutionUseCase,
    @Inject(ListInstitutionsUseCase) private readonly listInstitutions: ListInstitutionsUseCase,
    @Inject(UpdateInstitutionUseCase) private readonly updateInstitution: UpdateInstitutionUseCase,
    @Inject(DeleteInstitutionUseCase) private readonly deleteInstitution: DeleteInstitutionUseCase,
  ) {}

  /** Any signed-in user may call this; the result is limited to what they are allowed to see. */
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser): Promise<Institution[]> {
    return this.listInstitutions.execute(actor);
  }

  @Post()
  @PlatformAdminOnly()
  create(@Body() dto: CreateInstitutionDto): Promise<Institution> {
    return this.createInstitution.execute({
      name: dto.name,
      slug: dto.slug,
      timezone: dto.timezone,
    });
  }

  @Patch(':id')
  @PlatformAdminOnly()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstitutionDto,
  ): Promise<Institution> {
    return this.updateInstitution.execute(id, {
      name: dto.name,
      timezone: dto.timezone,
      isActive: dto.isActive,
    });
  }

  @Delete(':id')
  @PlatformAdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteInstitution.execute(id);
  }
}
