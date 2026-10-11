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

/** A member found by a search: enough to tell two people with the same name apart. */
export interface MemberMatch {
  membershipId: string;
  firstName: string;
  lastName: string;
  email: string;
  documentNumber: string | null;
}

export const MEMBER_SEARCH_LIMIT = 10;
const MEMBER_SEARCH_MIN_LENGTH = 2;
const MEMBER_SEARCH_MAX_TERMS = 5;

/**
 * The words a search must all match, in a name or in a document number.
 * Empty when there is too little to search by: nobody is listed without asking.
 */
export function searchTerms(query: string): string[] {
  const text = query.trim();
  return text.length < MEMBER_SEARCH_MIN_LENGTH ? [] : text.split(/\s+/).slice(0, MEMBER_SEARCH_MAX_TERMS);
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
