import type { AuthenticatedUser } from './authenticated-user.js';
import { Role } from './role.js';

const BELOW_INSTITUTION_ADMIN: Role[] = [Role.COORDINATOR, Role.TEACHER, Role.STAFF, Role.GUARDIAN, Role.STUDENT];
/** The enrolment desk: Students, and with them the Guardians who answer for them. */
const REGISTERED_AT_THE_DESK: Role[] = [Role.GUARDIAN, Role.STUDENT];

/**
 * Who may register whom, and so check whose ID. Each level appoints only the
 * levels below it, so nobody can create a peer or promote themselves:
 * Platform Admin → Institution Admins (and everyone below);
 * Institution Admin → Directivos, Teachers, Staff, Students and Guardians;
 * Staff and Directivos → Students and Guardians.
 */
export function registrableRoles(actor: AuthenticatedUser, institutionId: string): Role[] {
  if (actor.isPlatformAdmin) {
    return [Role.ADMIN, ...BELOW_INSTITUTION_ADMIN];
  }
  const roles = actor.memberships
    .filter((membership) => membership.institutionId === institutionId)
    .map((membership) => membership.role);
  if (roles.includes(Role.ADMIN)) {
    return BELOW_INSTITUTION_ADMIN;
  }
  return roles.includes(Role.STAFF) || roles.includes(Role.COORDINATOR) ? REGISTERED_AT_THE_DESK : [];
}

export function canRegister(actor: AuthenticatedUser, institutionId: string, role: Role): boolean {
  return registrableRoles(actor, institutionId).includes(role);
}

/** Institution Admins are trusted by the Platform Admin who appoints them; everyone else shows their ID in person. */
export function requiresIdentityCheck(role: Role): boolean {
  return role !== Role.ADMIN;
}
