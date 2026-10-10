import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import type { User, UserStatus } from '../entities/user.entity.js';

export const USER_REPOSITORY = Symbol('UserRepository');

export const OAuthProvider = { GOOGLE: 'GOOGLE' } as const;
export type OAuthProvider = (typeof OAuthProvider)[keyof typeof OAuthProvider];

export interface NewUser {
  email: string;
  passwordHash: string | null;
  mustChangePassword: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  status: UserStatus;
  isPlatformAdmin: boolean;
}

export interface OAuthIdentity {
  provider: OAuthProvider;
  providerAccountId: string;
  providerEmail: string;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByOAuthIdentity(identity: OAuthIdentity): Promise<User | null>;
  create(user: NewUser): Promise<User>;
  /** Stores a password the user chose themselves, which ends any forced password change. */
  setPassword(userId: string, passwordHash: string): Promise<void>;
  hasOAuthIdentity(userId: string, provider: OAuthProvider): Promise<boolean>;
  /** Rejects with GoogleAccountAlreadyLinkedException if either side is already linked. */
  linkOAuthIdentity(userId: string, identity: OAuthIdentity): Promise<void>;
  recordOAuthLogin(identity: OAuthIdentity): Promise<void>;
  findActiveMemberships(userId: string): Promise<MembershipClaim[]>;
}
