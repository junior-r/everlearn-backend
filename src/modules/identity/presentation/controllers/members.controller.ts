import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
import {
  ListMembersUseCase,
  RegisterMemberUseCase,
  type RegisteredMember,
} from '../../application/use-cases/member.use-cases.js';
import type { Member } from '../../domain/member.js';
import { RegisterMemberDto } from '../dtos/member.dtos.js';

/**
 * Member management for the institution in the `x-institution-id` header.
 * Staff may enter, but the use case limits them to registering Students.
 */
@Controller('members')
@Roles(Role.ADMIN, Role.STAFF)
export class MembersController {
  constructor(
    @Inject(RegisterMemberUseCase) private readonly registerMember: RegisterMemberUseCase,
    @Inject(ListMembersUseCase) private readonly listMembers: ListMembersUseCase,
  ) {}

  @Get()
  list(@CurrentInstitutionId() institutionId: string): Promise<Member[]> {
    return this.listMembers.execute(institutionId);
  }

  @Post()
  register(
    @CurrentUser() actor: AuthenticatedUser,
    @CurrentInstitutionId() institutionId: string,
    @Body() dto: RegisterMemberDto,
  ): Promise<RegisteredMember> {
    return this.registerMember.execute({
      actor,
      institutionId,
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
    });
  }
}
