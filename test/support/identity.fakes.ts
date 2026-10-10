import { randomUUID } from 'node:crypto';
import type {
  RateLimitDecision,
  RateLimiter,
} from '../../src/shared/domain/rate-limit/rate-limiter.js';
import type {
  AuthenticatedUser,
  MembershipClaim,
} from '../../src/shared/domain/auth/authenticated-user.js';
import { SessionIssuer } from '../../src/modules/identity/application/services/session-issuer.js';
import {
  User,
  UserStatus,
  type UserProps,
} from '../../src/modules/identity/domain/entities/user.entity.js';
import { EmailAlreadyRegisteredException } from '../../src/modules/identity/domain/exceptions/identity.exceptions.js';
import type {
  GoogleIdentity,
  GoogleOAuthGateway,
} from '../../src/modules/identity/domain/ports/google-oauth.gateway.js';
import type { PasswordHasher } from '../../src/modules/identity/domain/ports/password-hasher.js';
import type { RefreshTokenRevocations } from '../../src/modules/identity/domain/ports/refresh-token-revocations.js';
import type {
  RefreshTokenClaims,
  TokenIssuer,
} from '../../src/modules/identity/domain/ports/token-issuer.js';
import type {
  LinkOAuthOptions,
  NewUser,
  OAuthIdentity,
  UserRepository,
} from '../../src/modules/identity/domain/ports/user.repository.js';

const identityKey = (identity: OAuthIdentity) =>
  `${identity.provider}:${identity.providerAccountId}`;

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  readonly identities = new Map<string, string>();
  readonly memberships = new Map<string, MembershipClaim[]>();
  readonly oauthLogins: OAuthIdentity[] = [];

  seed(props: Partial<UserProps> = {}): User {
    const user = new User({
      id: randomUUID(),
      email: 'ada@example.com',
      passwordHash: 'hashed:correct-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatarUrl: null,
      status: UserStatus.ACTIVE,
      isPlatformAdmin: false,
      emailVerifiedAt: null,
      ...props,
    });
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    const match = [...this.users.values()].find((user) => user.email === email);
    return Promise.resolve(match ?? null);
  }

  findByOAuthIdentity(identity: OAuthIdentity): Promise<User | null> {
    const userId = this.identities.get(identityKey(identity));
    return Promise.resolve(userId ? (this.users.get(userId) ?? null) : null);
  }

  async create(user: NewUser, identity?: OAuthIdentity): Promise<User> {
    if (await this.findByEmail(user.email)) {
      throw new EmailAlreadyRegisteredException();
    }
    const created = this.seed({
      email: user.email,
      passwordHash: user.passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      status: UserStatus.PENDING_ONBOARDING,
      emailVerifiedAt: user.emailVerified ? new Date() : null,
    });
    if (identity) {
      this.identities.set(identityKey(identity), created.id);
    }
    return created;
  }

  linkOAuthIdentity(
    userId: string,
    identity: OAuthIdentity,
    options: LinkOAuthOptions,
  ): Promise<void> {
    this.identities.set(identityKey(identity), userId);
    const user = this.users.get(userId);
    if (user && options.resetUnverifiedCredentials) {
      this.seed({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        isPlatformAdmin: user.isPlatformAdmin,
        passwordHash: null,
        emailVerifiedAt: new Date(),
      });
    }
    return Promise.resolve();
  }

  recordOAuthLogin(identity: OAuthIdentity): Promise<void> {
    this.oauthLogins.push(identity);
    return Promise.resolve();
  }

  findActiveMemberships(userId: string): Promise<MembershipClaim[]> {
    return Promise.resolve(this.memberships.get(userId) ?? []);
  }
}

export class FakePasswordHasher implements PasswordHasher {
  verifyCalls = 0;

  hash(plain: string): Promise<string> {
    return Promise.resolve(`hashed:${plain}`);
  }

  verify(plain: string, hash: string | null): Promise<boolean> {
    this.verifyCalls += 1;
    return Promise.resolve(hash === `hashed:${plain}`);
  }
}

export class FakeTokenIssuer implements TokenIssuer {
  readonly issuedAccessTokens: AuthenticatedUser[] = [];

  issueAccessToken(user: AuthenticatedUser): Promise<string> {
    this.issuedAccessTokens.push(user);
    return Promise.resolve(`access:${user.userId}`);
  }

  private issued = 0;

  // Token format: refresh:<userId>:<tokenId>
  issueRefreshToken(userId: string): Promise<string> {
    this.issued += 1;
    return Promise.resolve(`refresh:${userId}:token-${this.issued}`);
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenClaims | null> {
    const [kind, userId, tokenId] = token.split(':');
    if (kind !== 'refresh' || !userId || !tokenId) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ userId, tokenId, expiresAt: new Date(Date.now() + 60_000) });
  }
}

export class InMemoryRefreshTokenRevocations implements RefreshTokenRevocations {
  readonly revoked = new Map<string, Date>();

  revoke(tokenId: string, expiresAt: Date): Promise<void> {
    this.revoked.set(tokenId, expiresAt);
    return Promise.resolve();
  }

  isRevoked(tokenId: string): Promise<boolean> {
    return Promise.resolve(this.revoked.has(tokenId));
  }
}

/** Counts attempts per key without expiring them, which is enough for a single test. */
export class InMemoryRateLimiter implements RateLimiter {
  readonly attempts = new Map<string, number>();
  failWith: Error | null = null;

  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    const count = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, count);
    return Promise.resolve({ allowed: count <= limit, retryAfterSeconds: windowSeconds });
  }
}

export class FakeGoogleGateway implements GoogleOAuthGateway {
  identity: GoogleIdentity = {
    subject: 'google-sub-1',
    email: 'Ada@Example.com',
    emailVerified: true,
    firstName: 'Ada',
    lastName: 'Lovelace',
    avatarUrl: 'https://example.com/ada.png',
  };
  exchangedCodes: string[] = [];

  buildAuthorizationUrl(state: string): string {
    return `https://accounts.google.test/auth?state=${state}`;
  }

  exchangeCode(code: string): Promise<GoogleIdentity> {
    this.exchangedCodes.push(code);
    return Promise.resolve(this.identity);
  }
}

export function createIdentityFakes() {
  const users = new InMemoryUserRepository();
  const hasher = new FakePasswordHasher();
  const tokens = new FakeTokenIssuer();
  const google = new FakeGoogleGateway();
  const revocations = new InMemoryRefreshTokenRevocations();
  const sessions = new SessionIssuer(users, tokens);
  return { users, hasher, tokens, google, revocations, sessions };
}
