import { randomUUID } from 'node:crypto';
import { SessionIssuer } from '../../src/modules/identity/application/services/session-issuer.js';
import {
  User,
  UserStatus,
  type UserProps,
} from '../../src/modules/identity/domain/entities/user.entity.js';
import {
  EmailAlreadyRegisteredException,
  InstitutionNotFoundException,
} from '../../src/modules/identity/domain/exceptions/identity.exceptions.js';
import type { Member } from '../../src/modules/identity/domain/member.js';
import type {
  GoogleIdentity,
  GoogleOAuthGateway,
} from '../../src/modules/identity/domain/ports/google-oauth.gateway.js';
import type {
  MemberRepository,
  NewMember,
} from '../../src/modules/identity/domain/ports/member.repository.js';
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
import type {
  AuthenticatedUser,
  MembershipClaim,
} from '../../src/shared/domain/auth/authenticated-user.js';
import type {
  RateLimitDecision,
  RateLimiter,
} from '../../src/shared/domain/rate-limit/rate-limiter.js';

export const TEST_PASSWORD = 'correct-password';

const identityKey = (identity: OAuthIdentity) =>
  `${identity.provider}:${identity.providerAccountId}`;

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  readonly identities = new Map<string, string>();
  /** Active memberships only, which is all the identity module ever reads. */
  readonly memberships = new Map<string, MembershipClaim[]>();
  readonly oauthLogins: OAuthIdentity[] = [];

  seed(props: Partial<UserProps> = {}): User {
    const user = new User({
      id: randomUUID(),
      email: 'ada@example.com',
      passwordHash: `hashed:${TEST_PASSWORD}`,
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

  /** Replaces a stored user with a changed copy. */
  patch(userId: string, changes: Partial<UserProps>): void {
    const user = this.users.get(userId);
    if (user) {
      this.seed({
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        isPlatformAdmin: user.isPlatformAdmin,
        emailVerifiedAt: user.emailVerifiedAt,
        ...changes,
      });
    }
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

  async create(user: NewUser): Promise<User> {
    if (await this.findByEmail(user.email)) {
      throw new EmailAlreadyRegisteredException();
    }
    return this.seed({
      email: user.email,
      passwordHash: user.passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerifiedAt: user.emailVerified ? new Date() : null,
    });
  }

  linkOAuthIdentity(
    userId: string,
    identity: OAuthIdentity,
    options: LinkOAuthOptions,
  ): Promise<void> {
    this.identities.set(identityKey(identity), userId);
    if (options.resetUnverifiedCredentials) {
      this.patch(userId, { passwordHash: null, emailVerifiedAt: new Date() });
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

type StoredMember = Member & { institutionId: string };

/** Shares its users with InMemoryUserRepository, so a registered member can then sign in. */
export class InMemoryMemberRepository implements MemberRepository {
  readonly members: StoredMember[] = [];
  /** When set, registering into any other institution fails as it would for a missing row. */
  knownInstitutionIds: Set<string> | null = null;

  constructor(private readonly users: InMemoryUserRepository) {}

  register(member: NewMember): Promise<Member> {
    if (this.knownInstitutionIds && !this.knownInstitutionIds.has(member.institutionId)) {
      return Promise.reject(new InstitutionNotFoundException());
    }
    const user = this.users.seed({
      email: member.email,
      passwordHash: member.passwordHash,
      firstName: member.firstName,
      lastName: member.lastName,
      status: member.activate ? UserStatus.ACTIVE : UserStatus.PENDING_ONBOARDING,
    });
    const stored: StoredMember = {
      userId: user.id,
      membershipId: randomUUID(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: member.role,
      status: user.status,
      isActive: member.activate,
      institutionId: member.institutionId,
    };
    this.members.push(stored);
    if (stored.isActive) {
      this.publish(stored);
    }
    return Promise.resolve(this.toMember(stored));
  }

  listByInstitution(institutionId: string): Promise<Member[]> {
    return Promise.resolve(
      this.members
        .filter((member) => member.institutionId === institutionId)
        .map((member) => this.toMember(member)),
    );
  }

  pendingEnrollment(userId: string) {
    const member = this.members.find((candidate) => candidate.userId === userId && !candidate.isActive);
    return member ? { institutionId: member.institutionId, requestedRole: member.role } : null;
  }

  /** What approving an onboarding application does to the account. */
  activate(userId: string, names?: { firstName: string; lastName: string }): void {
    const member = this.members.find((candidate) => candidate.userId === userId);
    if (!member) {
      return;
    }
    member.isActive = true;
    member.status = UserStatus.ACTIVE;
    Object.assign(member, names);
    this.users.patch(userId, { status: UserStatus.ACTIVE, ...names });
    this.publish(member);
  }

  private publish(member: StoredMember): void {
    const claims = this.users.memberships.get(member.userId) ?? [];
    claims.push({ id: member.membershipId, institutionId: member.institutionId, role: member.role });
    this.users.memberships.set(member.userId, claims);
  }

  private toMember(stored: StoredMember): Member {
    return {
      userId: stored.userId,
      membershipId: stored.membershipId,
      email: stored.email,
      firstName: stored.firstName,
      lastName: stored.lastName,
      role: stored.role,
      status: stored.status,
      isActive: stored.isActive,
    };
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
  private issued = 0;

  issueAccessToken(user: AuthenticatedUser): Promise<string> {
    this.issuedAccessTokens.push(user);
    return Promise.resolve(`access:${user.userId}`);
  }

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
  const members = new InMemoryMemberRepository(users);
  const hasher = new FakePasswordHasher();
  const tokens = new FakeTokenIssuer();
  const google = new FakeGoogleGateway();
  const revocations = new InMemoryRefreshTokenRevocations();
  const sessions = new SessionIssuer(users, tokens);
  return { users, members, hasher, tokens, google, revocations, sessions };
}
