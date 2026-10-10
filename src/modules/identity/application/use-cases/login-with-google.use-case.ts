import { timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from '../../domain/entities/user.entity.js';
import {
  GoogleAccountNotLinkedException,
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

export function toOAuthIdentity(google: GoogleIdentity): OAuthIdentity {
  return {
    provider: OAuthProvider.GOOGLE,
    providerAccountId: google.subject,
    providerEmail: normalizeEmail(google.email),
  };
}

export function statesMatch(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) {
    return false;
  }
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class LoginWithGoogleUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly google: GoogleOAuthGateway,
    private readonly sessions: SessionIssuer,
  ) {}

  /**
   * Signs in with a Google account the user linked from their profile. An
   * email match alone is never enough: Google sign-in neither creates an
   * account nor attaches itself to one.
   */
  async execute(input: LoginWithGoogleInput): Promise<AuthSession> {
    if (!input.code || !statesMatch(input.state, input.expectedState)) {
      throw new InvalidOAuthStateException();
    }
    const identity = toOAuthIdentity(await this.google.exchangeCode(input.code));
    const user = await this.users.findByOAuthIdentity(identity);
    if (!user) {
      throw new GoogleAccountNotLinkedException();
    }
    await this.users.recordOAuthLogin(identity);
    return this.sessions.issueFor(user);
  }
}
