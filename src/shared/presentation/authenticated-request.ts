import type { Request } from 'express';
import type { AuthenticatedUser, MembershipClaim } from '../domain/auth/authenticated-user.js';

export const INSTITUTION_HEADER = 'x-institution-id';

/**
 * Express request after the auth guards ran: `user` is set by JwtAuthGuard;
 * `institutionId` and `membership` by RolesGuard on `@Roles` routes.
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  membership?: MembershipClaim;
  institutionId?: string;
}
