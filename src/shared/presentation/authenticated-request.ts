import type { Request } from 'express';
import type { AuthenticatedUser, MembershipClaim } from '../domain/auth/authenticated-user.js';

export const INSTITUTION_HEADER = 'x-institution-id';

/** Express request after the auth guards ran: `user` by JwtAuthGuard, `membership` by RolesGuard. */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  membership?: MembershipClaim;
}
