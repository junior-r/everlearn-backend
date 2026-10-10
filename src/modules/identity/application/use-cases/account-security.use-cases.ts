import { randomBytes } from 'node:crypto';
import {
  AccountNotActiveException,
  GoogleEmailNotVerifiedException,
  InvalidCurrentPasswordException,
  InvalidOAuthStateException,
  PasswordUnchangedException,
  UserNotFoundException,
} from '../../domain/exceptions/identity.exceptions.js';
import type { GoogleOAuthGateway } from '../../domain/ports/google-oauth.gateway.js';
import type { PasswordHasher } from '../../domain/ports/password-hasher.js';
import type { TokenIssuer } from '../../domain/ports/token-issuer.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthUserView } from '../auth-session.js';
import type { SessionIssuer } from '../services/session-issuer.js';
import { statesMatch, toOAuthIdentity } from './login-with-google.use-case.js';

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export interface PasswordChanged {
  /** Replaces the caller's token; the old one stays limited to changing the password. */
  accessToken: string;
  user: AuthUserView;
}

export class ChangePasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionIssuer,
  ) {}

  /** Replaces the password after re-checking the current one, which ends a forced password change. */
  async execute(input: ChangePasswordInput): Promise<PasswordChanged> {
    const user = await this.users.findById(input.userId);
    if (!user) {
      throw new UserNotFoundException();
    }
    if (!(await this.hasher.verify(input.currentPassword, user.passwordHash))) {
      throw new InvalidCurrentPasswordException();
    }
    if (input.newPassword === input.currentPassword) {
      throw new PasswordUnchangedException();
    }
    await this.users.setPassword(user.id, await this.hasher.hash(input.newPassword));

    const updated = await this.users.findById(user.id);
    if (!updated) {
      throw new UserNotFoundException();
    }
    const view = await this.sessions.describe(updated);
    return { accessToken: await this.sessions.issueAccessToken(view), user: view };
  }
}

export interface GoogleLinkStart {
  url: string;
  /** Goes into an httpOnly cookie; the callback uses it to know whose account to link. */
  ticket: string;
}

export class StartGoogleLinkUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly google: GoogleOAuthGateway,
    private readonly tokens: TokenIssuer,
  ) {}

  /** Begins linking Google to an account that is already verified and has its own password. */
  async execute(userId: string): Promise<GoogleLinkStart> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UserNotFoundException();
    }
    if (!user.isActive() || user.mustChangePassword) {
      throw new AccountNotActiveException();
    }
    const state = randomBytes(32).toString('base64url');
    return {
      url: this.google.buildAuthorizationUrl(state),
      ticket: await this.tokens.issueGoogleLinkTicket({ userId, state }),
    };
  }
}

export interface CompleteGoogleLinkInput {
  code: string | undefined;
  state: string | undefined;
  ticket: string | undefined;
}

export class CompleteGoogleLinkUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly google: GoogleOAuthGateway,
    private readonly tokens: TokenIssuer,
  ) {}

  /**
   * Records the Google account in `OAuthAccount` for the user named by the
   * signed ticket, never by anything the browser sends in the clear.
   */
  async execute(input: CompleteGoogleLinkInput): Promise<void> {
    const ticket = input.ticket ? await this.tokens.verifyGoogleLinkTicket(input.ticket) : null;
    if (!input.code || !ticket || !statesMatch(input.state, ticket.state)) {
      throw new InvalidOAuthStateException();
    }
    const google = await this.google.exchangeCode(input.code);
    if (!google.emailVerified) {
      throw new GoogleEmailNotVerifiedException();
    }
    await this.users.linkOAuthIdentity(ticket.userId, toOAuthIdentity(google));
  }
}
