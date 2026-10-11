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

const INSTITUTION_STAFF: Role[] = [Role.COORDINATOR, Role.TEACHER, Role.STAFF, Role.GUARDIAN, Role.STUDENT];
/** Staff enrol Students, and with them the Guardians who answer for them. */
const REGISTERED_BY_STAFF: Role[] = [Role.GUARDIAN, Role.STUDENT];

/**
 * Who may register whom. Each level appoints only the levels below it, so
 * nobody can create a peer or promote themselves:
 * Platform Admin → Institution Admins (and everyone below);
 * Institution Admin → Directivos, Teachers, Staff, Students and Guardians;
 * Staff → Students and Guardians.
 */
export function registrableRoles(actor: AuthenticatedUser, institutionId: string): Role[] {
  if (actor.isPlatformAdmin) {
    return [Role.ADMIN, ...INSTITUTION_STAFF];
  }
  const roles = actor.memberships
    .filter((membership) => membership.institutionId === institutionId)
    .map((membership) => membership.role);
  if (roles.includes(Role.ADMIN)) {
    return INSTITUTION_STAFF;
  }
  return roles.includes(Role.STAFF) ? REGISTERED_BY_STAFF : [];
}

export function assertCanRegister(
  actor: AuthenticatedUser,
  institutionId: string,
  role: Role,
): void {
  if (!registrableRoles(actor, institutionId).includes(role)) {
    throw new MemberRoleNotAllowedException();
  }
}

/** Institution Admins are trusted by the Platform Admin who appoints them; everyone else must pass the ID check. */
export function requiresOnboarding(role: Role): boolean {
  return role !== Role.ADMIN;
}
