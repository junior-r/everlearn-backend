import { timingSafeEqual } from 'node:crypto';
import { normalizeEmail, type User } from '../../domain/entities/user.entity.js';
import {
  GoogleEmailNotVerifiedException,
  InvalidOAuthStateException,
} from '../../domain/exceptions/identity.exceptions.js';
import type {
  GoogleIdentity,
  GoogleOAuthGateway,
} from '../../domain/ports/google-oauth.gateway.js';
import {
  OAuthProvider,
  type OAuthIdentity,
  type UserRepository,
} from '../../domain/ports/user.repository.js';
import type { AuthSession } from '../auth-session.js';
import type { SessionIssuer } from '../services/session-issuer.js';

export interface LoginWithGoogleInput {
  code: string | undefined;
  state: string | undefined;
  expectedState: string | undefined;
}

export class LoginWithGoogleUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly google: GoogleOAuthGateway,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: LoginWithGoogleInput): Promise<AuthSession> {
    if (!input.code || !statesMatch(input.state, input.expectedState)) {
      throw new InvalidOAuthStateException();
    }
    const google = await this.google.exchangeCode(input.code);
    const identity: OAuthIdentity = {
      provider: OAuthProvider.GOOGLE,
      providerAccountId: google.subject,
      providerEmail: normalizeEmail(google.email),
    };
    const user = await this.resolveUser(google, identity);
    await this.users.recordOAuthLogin(identity);
    return this.sessions.issueFor(user);
  }

  private async resolveUser(google: GoogleIdentity, identity: OAuthIdentity): Promise<User> {
    const linked = await this.users.findByOAuthIdentity(identity);
    if (linked) {
      return linked;
    }
    // An unverified Google email proves nothing about who owns the address
    if (!google.emailVerified) {
      throw new GoogleEmailNotVerifiedException();
    }
    const existing = await this.users.findByEmail(identity.providerEmail);
    if (!existing) {
      return this.users.create(
        {
          email: identity.providerEmail,
          passwordHash: null,
          firstName: google.firstName,
          lastName: google.lastName,
          avatarUrl: google.avatarUrl,
          emailVerified: true,
        },
        identity,
      );
    }
    // Whoever registered an unverified email may not own it, so their password must not survive the link
    await this.users.linkOAuthIdentity(existing.id, identity, {
      resetUnverifiedCredentials: !existing.hasVerifiedEmail(),
    });
    return existing;
  }
}

function statesMatch(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) {
    return false;
  }
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
