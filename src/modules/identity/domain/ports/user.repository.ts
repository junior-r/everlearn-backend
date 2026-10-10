import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import type { User } from '../entities/user.entity.js';

export const USER_REPOSITORY = Symbol('UserRepository');

export const OAuthProvider = { GOOGLE: 'GOOGLE' } as const;
export type OAuthProvider = (typeof OAuthProvider)[keyof typeof OAuthProvider];

export interface NewUser {
  email: string;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

export interface OAuthIdentity {
  provider: OAuthProvider;
  providerAccountId: string;
  providerEmail: string;
}

export interface LinkOAuthOptions {
  // Drops the existing password and marks the email verified; see LoginWithGoogleUseCase
  resetUnverifiedCredentials: boolean;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByOAuthIdentity(identity: OAuthIdentity): Promise<User | null>;
  /** Creates a user, optionally with its first OAuth identity, atomically. */
  create(user: NewUser, identity?: OAuthIdentity): Promise<User>;
  linkOAuthIdentity(
    userId: string,
    identity: OAuthIdentity,
    options: LinkOAuthOptions,
  ): Promise<void>;
  recordOAuthLogin(identity: OAuthIdentity): Promise<void>;
  findActiveMemberships(userId: string): Promise<MembershipClaim[]>;
}
