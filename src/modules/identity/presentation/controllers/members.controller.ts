import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
import {
  ListMembersUseCase,
  PageMembersUseCase,
  RegisterMemberUseCase,
  SearchMembersUseCase,
  type RegisteredMember,
} from '../../application/use-cases/member.use-cases.js';
import type { Member, MemberMatch, MemberPage } from '../../domain/member.js';
import { PageMembersDto, RegisterMemberDto, SearchMembersDto } from '../dtos/member.dtos.js';

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
    @Inject(SearchMembersUseCase) private readonly searchMembers: SearchMembersUseCase,
    @Inject(PageMembersUseCase) private readonly pageMembers: PageMembersUseCase,
  ) {}

  @Get()
  list(@CurrentInstitutionId() institutionId: string): Promise<Member[]> {
    return this.listMembers.execute(institutionId);
  }

  /** The members table: one page at a time, narrowed by what was typed and by role. */
  @Get('page')
  page(@CurrentInstitutionId() institutionId: string, @Query() dto: PageMembersDto): Promise<MemberPage> {
    return this.pageMembers.execute(institutionId, dto);
  }

  /** A few members holding a role, by name or document number: what a picker needs, however large the institution. */
  @Get('search')
  search(@CurrentInstitutionId() institutionId: string, @Query() dto: SearchMembersDto): Promise<MemberMatch[]> {
    return this.searchMembers.execute(institutionId, dto.role, dto.query, dto.active === 'true');
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
