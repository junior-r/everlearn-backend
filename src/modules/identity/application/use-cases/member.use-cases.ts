import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { requiresIdentityCheck } from '../../../../shared/domain/auth/registration.js';
import type { Role } from '../../../../shared/domain/auth/role.js';
import { normalizeEmail, type User } from '../../domain/entities/user.entity.js';
import { AccountSuspendedException } from '../../domain/exceptions/identity.exceptions.js';
import {
  assertCanRegister,
  MEMBER_PAGE_SIZE,
  MEMBER_SEARCH_LIMIT,
  searchTerms,
  type Member,
  type MemberMatch,
  type MemberPage,
} from '../../domain/member.js';
import type { MemberRepository } from '../../domain/ports/member.repository.js';
import type { PasswordHasher } from '../../domain/ports/password-hasher.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';

export interface RegisterMemberInput {
  actor: AuthenticatedUser;
  institutionId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export interface RegisteredMember {
  member: Member;
  /**
   * For a new account: shown to the admin once so they can hand it over; only
   * its hash is stored. Null when the person already had an account, because
   * they keep signing in with their own credentials.
   */
  temporaryPassword: string | null;
}

const generateTemporaryPassword = () => randomBytes(12).toString('base64url');

export class RegisterMemberUseCase {
  constructor(
    private readonly members: MemberRepository,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly generatePassword: () => string = generateTemporaryPassword,
  ) {}

  /**
   * Gives a person a role in an institution. One person (one email) can belong
   * to several institutions, so an existing account gains a membership instead
   * of being duplicated or refused.
   */
  async execute(input: RegisterMemberInput): Promise<RegisteredMember> {
    assertCanRegister(input.actor, input.institutionId, input.role);
    const email = normalizeEmail(input.email);
    const existing = await this.users.findByEmail(email);
    return existing ? this.addToExisting(existing, input) : this.createAccount(email, input);
  }

  /** New accounts start pending, with an inactive membership, until their ID is checked at the institution. */
  private async createAccount(email: string, input: RegisterMemberInput): Promise<RegisteredMember> {
    const temporaryPassword = this.generatePassword();
    const member = await this.members.register({
      institutionId: input.institutionId,
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      passwordHash: await this.hasher.hash(temporaryPassword),
      role: input.role,
      activate: !requiresIdentityCheck(input.role),
    });
    return { member, temporaryPassword };
  }

  /**
   * Identity is verified once per person, not once per institution: someone
   * already active gets the new role immediately, while someone still pending
   * gets it when their ID is checked. The name on the account is kept.
   */
  private async addToExisting(user: User, input: RegisterMemberInput): Promise<RegisteredMember> {
    if (user.isSuspended()) {
      throw new AccountSuspendedException();
    }
    const trusted = !requiresIdentityCheck(input.role);
    const member = await this.members.addMembership({
      userId: user.id,
      institutionId: input.institutionId,
      role: input.role,
      activate: trusted || user.isActive(),
      activateAccount: trusted,
    });
    return { member, temporaryPassword: null };
  }
}

export class ListMembersUseCase {
  constructor(private readonly members: MemberRepository) {}

  execute(institutionId: string): Promise<Member[]> {
    return this.members.listByInstitution(institutionId);
  }
}

export class PageMembersUseCase {
  constructor(private readonly members: MemberRepository) {}

  /** A page of the members of an institution, optionally narrowed by what was typed and by role. */
  async execute(
    institutionId: string,
    request: { page?: number; query?: string; role?: Role },
  ): Promise<MemberPage> {
    const page = Math.max(1, Math.trunc(request.page ?? 1));
    const { items, total } = await this.members.page(institutionId, {
      terms: searchTerms(request.query ?? ''),
      role: request.role ?? null,
      skip: (page - 1) * MEMBER_PAGE_SIZE,
      take: MEMBER_PAGE_SIZE,
    });
    return { items, total, page, pageSize: MEMBER_PAGE_SIZE };
  }
}

export class SearchMembersUseCase {
  constructor(private readonly members: MemberRepository) {}

  /**
   * Finds members of an institution holding a role, by name or document number;
   * a few at a time. `activeOnly` is for pickers whose choice must be an active member.
   */
  execute(institutionId: string, role: Role, query: string, activeOnly = false): Promise<MemberMatch[]> {
    const terms = searchTerms(query);
    return terms.length === 0
      ? Promise.resolve([])
      : this.members.search(institutionId, role, terms, MEMBER_SEARCH_LIMIT, activeOnly);
  }
}
