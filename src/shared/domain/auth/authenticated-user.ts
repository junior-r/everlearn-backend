import type { Role } from './role.js';

export interface MembershipClaim {
  id: string;
  institutionId: string;
  role: Role;
}

/** The identity carried by a verified access token. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  isPlatformAdmin: boolean;
  memberships: MembershipClaim[];
}
