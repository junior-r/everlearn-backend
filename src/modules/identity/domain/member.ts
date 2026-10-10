import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import type { UserStatus } from './entities/user.entity.js';
import { MemberRoleNotAllowedException } from './exceptions/identity.exceptions.js';

/** A person's place in one institution: their account plus the role they hold there. */
export interface Member {
  userId: string;
  membershipId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: UserStatus;
  isActive: boolean;
}

const REGISTRABLE_BY_INSTITUTION_ADMIN: Role[] = [Role.TEACHER, Role.STUDENT];
const REGISTRABLE_BY_PLATFORM_ADMIN: Role[] = [Role.ADMIN, Role.TEACHER, Role.STUDENT];

/**
 * Institution Admins register Teachers and Students. Only a Platform Admin
 * can appoint an Institution Admin, so admins cannot multiply themselves.
 */
export function assertCanRegister(actor: AuthenticatedUser, role: Role): void {
  const allowed = actor.isPlatformAdmin
    ? REGISTRABLE_BY_PLATFORM_ADMIN
    : REGISTRABLE_BY_INSTITUTION_ADMIN;
  if (!allowed.includes(role)) {
    throw new MemberRoleNotAllowedException();
  }
}

/** Institution Admins are trusted by the Platform Admin who appoints them; everyone else must pass the ID check. */
export function requiresOnboarding(role: Role): boolean {
  return role !== Role.ADMIN;
}
