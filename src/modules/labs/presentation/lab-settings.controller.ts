import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  PlatformAdminOnly,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  ListInstitutionLabsUseCase,
  ListLabSettingsUseCase,
  SetLabEnabledUseCase,
  SetLabGrantUseCase,
  type LabGrantView,
  type LabSettingView,
} from '../application/use-cases/lab-access.use-cases.js';
import { SetLabEnabledDto, SetLabGrantDto } from './lab.dtos.js';

/** Which labs an institution may use: granted by a Platform Admin, switched by its Institution Admin. */
@Controller()
export class LabSettingsController {
  constructor(
    @Inject(ListInstitutionLabsUseCase) private readonly listInstitutionLabs: ListInstitutionLabsUseCase,
    @Inject(SetLabGrantUseCase) private readonly setGrant: SetLabGrantUseCase,
    @Inject(ListLabSettingsUseCase) private readonly listSettings: ListLabSettingsUseCase,
    @Inject(SetLabEnabledUseCase) private readonly setEnabled: SetLabEnabledUseCase,
  ) {}

  @Get('institutions/:institutionId/labs')
  @PlatformAdminOnly()
  grants(@Param('institutionId', ParseUUIDPipe) institutionId: string): Promise<LabGrantView[]> {
    return this.listInstitutionLabs.execute(institutionId);
  }

  @Put('institutions/:institutionId/labs/:labKey')
  @PlatformAdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  async grant(
    @Param('institutionId', ParseUUIDPipe) institutionId: string,
    @Param('labKey') labKey: string,
    @Body() dto: SetLabGrantDto,
  ): Promise<void> {
    await this.setGrant.execute(institutionId, labKey, dto.granted);
  }

  @Get('labs/settings')
  @Roles(Role.ADMIN)
  settings(@CurrentInstitutionId() institutionId: string): Promise<LabSettingView[]> {
    return this.listSettings.execute(institutionId);
  }

  @Put('labs/:labKey/enabled')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async enable(
    @CurrentInstitutionId() institutionId: string,
    @Param('labKey') labKey: string,
    @Body() dto: SetLabEnabledDto,
  ): Promise<void> {
    await this.setEnabled.execute(institutionId, labKey, dto.enabled);
  }
}
