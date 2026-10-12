import { randomUUID } from 'node:crypto';
import { SessionIssuer } from '../../src/modules/identity/application/services/session-issuer.js';
import {
  User,
  UserStatus,
  type UserProps,
} from '../../src/modules/identity/domain/entities/user.entity.js';
import {
  EmailAlreadyRegisteredException,
  GoogleAccountAlreadyLinkedException,
  InstitutionNotFoundException,
  MemberAlreadyRegisteredException,
} from '../../src/modules/identity/domain/exceptions/identity.exceptions.js';
import type { Member, MemberMatch } from '../../src/modules/identity/domain/member.js';
import type {
  GoogleIdentity,
  GoogleOAuthGateway,
} from '../../src/modules/identity/domain/ports/google-oauth.gateway.js';
import type {
  MemberRepository,
  NewMember,
  NewMembership,
} from '../../src/modules/identity/domain/ports/member.repository.js';
import type { PasswordHasher } from '../../src/modules/identity/domain/ports/password-hasher.js';
import type { PasswordResetTokens } from '../../src/modules/identity/domain/ports/password-reset-tokens.js';
import type { RefreshTokenRevocations } from '../../src/modules/identity/domain/ports/refresh-token-revocations.js';
import type {
  GoogleLinkTicket,
  RefreshTokenClaims,
  TokenIssuer,
} from '../../src/modules/identity/domain/ports/token-issuer.js';
import type {
  NewUser,
  OAuthIdentity,
  OAuthProvider,
  UserRepository,
} from '../../src/modules/identity/domain/ports/user.repository.js';
import type {
  AuthenticatedUser,
  MembershipClaim,
} from '../../src/shared/domain/auth/authenticated-user.js';
import type { Role } from '../../src/shared/domain/auth/role.js';
import type {
  RateLimitDecision,
  RateLimiter,
} from '../../src/shared/domain/rate-limit/rate-limiter.js';

export const TEST_PASSWORD = 'correct-password';

const identityKey = (identity: OAuthIdentity) =>
  `${identity.provider}:${identity.providerAccountId}`;

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  /** Provider identity → user id. */
  readonly identities = new Map<string, string>();
  /** Active memberships only, which is all the identity module ever reads. */
  readonly memberships = new Map<string, MembershipClaim[]>();
  readonly oauthLogins: OAuthIdentity[] = [];

  seed(props: Partial<UserProps> = {}): User {
    const user = new User({
      id: randomUUID(),
      email: 'ada@example.com',
      passwordHash: `hashed:${TEST_PASSWORD}`,
      mustChangePassword: false,
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
        mustChangePassword: user.mustChangePassword,
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
      mustChangePassword: user.mustChangePassword,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerifiedAt: user.emailVerified ? new Date() : null,
    });
  }

  setPassword(userId: string, passwordHash: string): Promise<void> {
    this.patch(userId, { passwordHash, mustChangePassword: false });
    return Promise.resolve();
  }

  hasOAuthIdentity(userId: string, provider: OAuthProvider): Promise<boolean> {
    return Promise.resolve(
      [...this.identities].some(([key, owner]) => owner === userId && key.startsWith(`${provider}:`)),
    );
  }

  async linkOAuthIdentity(userId: string, identity: OAuthIdentity): Promise<void> {
    // Mirrors the two unique constraints on OAuthAccount
    if (
      this.identities.has(identityKey(identity)) ||
      (await this.hasOAuthIdentity(userId, identity.provider))
    ) {
      throw new GoogleAccountAlreadyLinkedException();
    }
    this.identities.set(identityKey(identity), userId);
  }

  recordOAuthLogin(identity: OAuthIdentity): Promise<void> {
    this.oauthLogins.push(identity);
    return Promise.resolve();
  }

  findActiveMemberships(userId: string): Promise<MembershipClaim[]> {
    return Promise.resolve(this.memberships.get(userId) ?? []);
  }
}

export type StoredMember = Member & { institutionId: string };

/** Shares its users with InMemoryUserRepository, so a registered member can then sign in. */
export class InMemoryMemberRepository implements MemberRepository {
  readonly members: StoredMember[] = [];
  /** User id → the document number on their profile. */
  readonly documentNumbers = new Map<string, string>();
  /** When set, registering into any other institution fails as it would for a missing row. */
  knownInstitutionIds: Set<string> | null = null;

  constructor(private readonly users: InMemoryUserRepository) {}

  register(member: NewMember): Promise<Member> {
    this.assertInstitutionExists(member.institutionId);
    const user = this.users.seed({
      email: member.email,
      passwordHash: member.passwordHash,
      mustChangePassword: true,
      firstName: member.firstName,
      lastName: member.lastName,
      status: member.activate ? UserStatus.ACTIVE : UserStatus.PENDING_ONBOARDING,
    });
    return Promise.resolve(this.store(user.id, member.institutionId, member.role, member.activate));
  }

  addMembership(membership: NewMembership): Promise<Member> {
    this.assertInstitutionExists(membership.institutionId);
    const duplicate = this.members.some(
      (member) =>
        member.userId === membership.userId &&
        member.institutionId === membership.institutionId &&
        member.role === membership.role,
    );
    if (duplicate) {
      return Promise.reject(new MemberAlreadyRegisteredException());
    }
    if (membership.activateAccount) {
      this.users.patch(membership.userId, { status: UserStatus.ACTIVE });
    }
    return Promise.resolve(
      this.store(membership.userId, membership.institutionId, membership.role, membership.activate),
    );
  }

  search(
    institutionId: string,
    role: Role,
    terms: string[],
    limit: number,
    activeOnly: boolean,
  ): Promise<MemberMatch[]> {
    const matches = this.members
      .filter((member) => member.institutionId === institutionId && member.role === role)
      .map((member) => ({ ...this.toMember(member), documentNumber: this.documentNumbers.get(member.userId) ?? null }))
      .filter((member) => !activeOnly || (member.isActive && member.status === UserStatus.ACTIVE))
      .filter((member) =>
        terms.every((term) =>
          [member.firstName, member.lastName, member.documentNumber ?? ''].some((value) =>
            value.toLowerCase().includes(term.toLowerCase()),
          ),
        ),
      )
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
      .slice(0, limit)
      .map(({ membershipId, firstName, lastName, email, documentNumber }) => ({
        membershipId,
        firstName,
        lastName,
        email,
        documentNumber,
      }));
    return Promise.resolve(matches);
  }

  page(
    institutionId: string,
    filter: { terms: string[]; role: Role | null; skip: number; take: number },
  ): Promise<{ items: Member[]; total: number }> {
    const matching = this.members
      .filter((member) => member.institutionId === institutionId && (!filter.role || member.role === filter.role))
      .map((member) => this.toMember(member))
      .filter((member) =>
        filter.terms.every((term) =>
          [member.firstName, member.lastName, member.email, this.documentNumbers.get(member.userId) ?? ''].some(
            (value) => value.toLowerCase().includes(term.toLowerCase()),
          ),
        ),
      )
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    return Promise.resolve({
      items: matching.slice(filter.skip, filter.skip + filter.take),
      total: matching.length,
    });
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

  /** What approving an onboarding application does: the account and all its pending memberships go active. */
  activate(userId: string, names?: { firstName: string; lastName: string }): void {
    this.users.patch(userId, { status: UserStatus.ACTIVE, ...names });
    for (const member of this.members.filter((candidate) => candidate.userId === userId)) {
      if (!member.isActive) {
        member.isActive = true;
        this.publish(member);
      }
    }
  }

  findActive(institutionId: string, membershipId: string): StoredMember | null {
    const member = this.members.find(
      (candidate) =>
        candidate.membershipId === membershipId &&
        candidate.institutionId === institutionId &&
        candidate.isActive,
    );
    return member && this.users.users.get(member.userId)?.isActive() ? member : null;
  }

  private assertInstitutionExists(institutionId: string): void {
    if (this.knownInstitutionIds && !this.knownInstitutionIds.has(institutionId)) {
      throw new InstitutionNotFoundException();
    }
  }

  private store(userId: string, institutionId: string, role: Role, isActive: boolean): Member {
    const stored = {
      userId,
      membershipId: randomUUID(),
      role,
      isActive,
      institutionId,
    } as StoredMember;
    this.members.push(stored);
    if (isActive) {
      this.publish(stored);
    }
    return this.toMember(stored);
  }

  private publish(member: StoredMember): void {
    const claims = this.users.memberships.get(member.userId) ?? [];
    claims.push({ id: member.membershipId, institutionId: member.institutionId, role: member.role });
    this.users.memberships.set(member.userId, claims);
  }

  // Name, email and status always come from the account, as they do in the database join
  private toMember(stored: StoredMember): Member {
    const user = this.users.users.get(stored.userId);
    return {
      userId: stored.userId,
      membershipId: stored.membershipId,
      email: user?.email ?? '',
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      role: stored.role,
      status: user?.status ?? UserStatus.PENDING_ONBOARDING,
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
  /** The clock tokens are stamped with; a test moves it to place a token before or after an event. */
  now: () => Date = () => new Date();
  private readonly issuedAt = new Map<string, Date>();
  private issued = 0;

  issueAccessToken(user: AuthenticatedUser): Promise<string> {
    this.issuedAccessTokens.push(user);
    return Promise.resolve(`access:${user.userId}`);
  }

  // Token format: refresh:<userId>:<tokenId>
  issueRefreshToken(userId: string): Promise<string> {
    this.issued += 1;
    this.issuedAt.set(`token-${this.issued}`, this.now());
    return Promise.resolve(`refresh:${userId}:token-${this.issued}`);
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenClaims | null> {
    const [kind, userId, tokenId] = token.split(':');
    if (kind !== 'refresh' || !userId || !tokenId) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      userId,
      tokenId,
      issuedAt: this.issuedAt.get(tokenId) ?? new Date(0),
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  // Ticket format: link:<userId>:<state>
  issueGoogleLinkTicket(ticket: GoogleLinkTicket): Promise<string> {
    return Promise.resolve(`link:${ticket.userId}:${ticket.state}`);
  }

  verifyGoogleLinkTicket(token: string): Promise<GoogleLinkTicket | null> {
    const [kind, userId, state] = token.split(':');
    return Promise.resolve(kind === 'link' && userId && state ? { userId, state } : null);
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

  /** User id → the instant before which their sessions no longer count. */
  readonly cutoffs = new Map<string, Date>();

  revokeAllFor(userId: string, before: Date): Promise<void> {
    this.cutoffs.set(userId, before);
    return Promise.resolve();
  }

  isRevokedFor(userId: string, issuedAt: Date): Promise<boolean> {
    const cutoff = this.cutoffs.get(userId);
    // Whole seconds, as the Redis adapter compares them: tokens carry no finer time
    const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
    return Promise.resolve(cutoff !== undefined && seconds(issuedAt) < seconds(cutoff));
  }
}

/** Reset tokens kept in memory; a test can expire them by hand. */
export class InMemoryPasswordResetTokens implements PasswordResetTokens {
  readonly issued: Array<{ token: string; userId: string; ttlSeconds: number }> = [];
  private readonly valid = new Map<string, string>();
  failWith: Error | null = null;

  issue(userId: string, ttlSeconds: number): Promise<string> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    for (const [token, owner] of this.valid) {
      if (owner === userId) {
        this.valid.delete(token);
      }
    }
    const token = `reset-token-${this.issued.length + 1}`;
    this.issued.push({ token, userId, ttlSeconds });
    this.valid.set(token, userId);
    return Promise.resolve(token);
  }

  consume(token: string): Promise<string | null> {
    const userId = this.valid.get(token) ?? null;
    this.valid.delete(token);
    return Promise.resolve(userId);
  }

  expire(token: string): void {
    this.valid.delete(token);
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
