import type { MembershipClaim } from '../../../shared/domain/auth/authenticated-user.js';
import type { UserStatus } from '../domain/entities/user.entity.js';

export interface AuthUserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: UserStatus;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  googleLinked: boolean;
  memberships: MembershipClaim[];
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUserView;
}
