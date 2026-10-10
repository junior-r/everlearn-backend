import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import type { Role } from '../../../../shared/domain/auth/role.js';
import { normalizeEmail } from '../../domain/entities/user.entity.js';
import { EmailAlreadyRegisteredException } from '../../domain/exceptions/identity.exceptions.js';
import { assertCanRegister, requiresOnboarding, type Member } from '../../domain/member.js';
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
  /** Shown to the admin once so they can hand it over; only its hash is stored. */
  temporaryPassword: string;
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
   * Creates an account for a person in an institution. Teachers and Students
   * start pending, with an inactive membership, until their ID is reviewed.
   */
  async execute(input: RegisterMemberInput): Promise<RegisteredMember> {
    assertCanRegister(input.actor, input.role);
    const email = normalizeEmail(input.email);
    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredException();
    }
    const temporaryPassword = this.generatePassword();
    const member = await this.members.register({
      institutionId: input.institutionId,
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      passwordHash: await this.hasher.hash(temporaryPassword),
      role: input.role,
      activate: !requiresOnboarding(input.role),
    });
    return { member, temporaryPassword };
  }
}

export class ListMembersUseCase {
  constructor(private readonly members: MemberRepository) {}

  execute(institutionId: string): Promise<Member[]> {
    return this.members.listByInstitution(institutionId);
  }
}
