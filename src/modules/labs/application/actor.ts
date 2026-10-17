import type { MembershipClaim } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import { TeacherOnlyException } from '../domain/lab-assignment.js';

/** Who is asking, and in which institution. */
export interface Actor {
  institutionId: string;
  memberships: MembershipClaim[];
}

/** The actor's memberships holding `role` in the institution they act in. */
export const membershipIds = (actor: Actor, role: Role): string[] =>
  actor.memberships
    .filter((membership) => membership.institutionId === actor.institutionId && membership.role === role)
    .map((membership) => membership.id);

/** The Teacher membership the actor writes exercises with. */
export function requireTeacherMembership(actor: Actor): string {
  const [teacherId] = membershipIds(actor, Role.TEACHER);
  if (!teacherId) {
    throw new TeacherOnlyException();
  }
  return teacherId;
}
