import type { User } from '../../domain/entities/user.entity.js';
import { AccountSuspendedException } from '../../domain/exceptions/identity.exceptions.js';
import type { TokenIssuer } from '../../domain/ports/token-issuer.js';
import { OAuthProvider, type UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthSession, AuthUserView } from '../auth-session.js';

/** Single place where an authenticated user is turned into a token pair. */
export class SessionIssuer {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
  ) {}

  async describe(user: User): Promise<AuthUserView> {
    const [memberships, googleLinked] = await Promise.all([
      this.users.findActiveMemberships(user.id),
      this.users.hasOAuthIdentity(user.id, OAuthProvider.GOOGLE),
    ]);
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isPlatformAdmin: user.isPlatformAdmin,
      mustChangePassword: user.mustChangePassword,
      googleLinked,
      memberships,
    };
  }

  /** The access token for a user. While a password change is pending it carries that restriction. */
  async issueAccessToken(view: AuthUserView): Promise<string> {
    return this.tokens.issueAccessToken({
      userId: view.id,
      email: view.email,
      isPlatformAdmin: view.isPlatformAdmin,
      mustChangePassword: view.mustChangePassword,
      memberships: view.memberships,
    });
  }

  async issueFor(user: User): Promise<AuthSession> {
    if (user.isSuspended()) {
      throw new AccountSuspendedException();
    }
    const view = await this.describe(user);
    const [accessToken, refreshToken] = await Promise.all([
      this.issueAccessToken(view),
      this.tokens.issueRefreshToken(view.id),
    ]);
    return { accessToken, refreshToken, user: view };
  }
}
