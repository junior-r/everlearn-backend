import { DomainException } from '../domain.exception.js';
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
  /** True while the account still uses a temporary password; such a token can only change it. */
  mustChangePassword: boolean;
  memberships: MembershipClaim[];
}

export class PasswordChangeRequiredException extends DomainException {
  constructor() {
    super(
      'FORBIDDEN',
      'PASSWORD_CHANGE_REQUIRED',
      'Change your temporary password before continuing',
    );
  }
}
