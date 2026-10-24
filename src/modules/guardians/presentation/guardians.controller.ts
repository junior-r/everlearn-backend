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
  Put,
} from '@nestjs/common';
import { IsEnum, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  GetWardOverviewUseCase,
  LinkGuardianUseCase,
  ListGuardianLinksUseCase,
  ListMyWardsUseCase,
  UnlinkGuardianUseCase,
  type WardOverview,
} from '../application/use-cases/guardian.use-cases.js';
import { GuardianRelationship, type GuardianLink, type Ward } from '../domain/guardian.js';

export class LinkGuardianDto {
  @IsUUID()
  studentMembershipId: string;

  @IsUUID()
  guardianMembershipId: string;

  @IsEnum(GuardianRelationship)
  relationship: GuardianRelationship;
}

/** Guardians and the Students they answer for, in the institution of the `x-institution-id` header. */
@Controller()
export class GuardiansController {
  constructor(
    @Inject(ListGuardianLinksUseCase) private readonly listLinks: ListGuardianLinksUseCase,
    @Inject(LinkGuardianUseCase) private readonly linkGuardian: LinkGuardianUseCase,
    @Inject(UnlinkGuardianUseCase) private readonly unlinkGuardian: UnlinkGuardianUseCase,
    @Inject(ListMyWardsUseCase) private readonly listWards: ListMyWardsUseCase,
    @Inject(GetWardOverviewUseCase) private readonly wardOverview: GetWardOverviewUseCase,
  ) {}

  // The desk that enrols Students also records who answers for them
  @Get('guardian-links')
  @Roles(Role.ADMIN, Role.STAFF, Role.COORDINATOR)
  links(@CurrentInstitutionId() institutionId: string): Promise<GuardianLink[]> {
    return this.listLinks.execute(institutionId);
  }

  @Put('guardian-links')
  @Roles(Role.ADMIN, Role.STAFF, Role.COORDINATOR)
  link(@CurrentInstitutionId() institutionId: string, @Body() dto: LinkGuardianDto): Promise<GuardianLink> {
    return this.linkGuardian.execute({
      institutionId,
      studentMembershipId: dto.studentMembershipId,
      guardianMembershipId: dto.guardianMembershipId,
      relationship: dto.relationship,
    });
  }

  @Delete('guardian-links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.STAFF, Role.COORDINATOR)
  async unlink(
    @CurrentInstitutionId() institutionId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    await this.unlinkGuardian.execute(institutionId, linkId);
  }

  @Get('guardian/wards')
  @Roles(Role.GUARDIAN)
  wards(@CurrentInstitutionId() institutionId: string, @CurrentUser() user: AuthenticatedUser): Promise<Ward[]> {
    return this.listWards.execute({ institutionId, memberships: user.memberships });
  }

  @Get('guardian/wards/:studentMembershipId')
  @Roles(Role.GUARDIAN)
  ward(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentMembershipId', ParseUUIDPipe) studentMembershipId: string,
  ): Promise<WardOverview> {
    return this.wardOverview.execute({ institutionId, memberships: user.memberships }, studentMembershipId);
  }
}
