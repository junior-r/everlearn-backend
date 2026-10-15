import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import type { Actor } from '../application/actor.js';

/** The actor of a request: the signed-in user, acting in the institution `@Roles` authorized. */
export const actorOf = (institutionId: string, user: AuthenticatedUser): Actor => ({
  institutionId,
  memberships: user.memberships,
});
