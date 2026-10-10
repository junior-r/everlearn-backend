import type { User } from '../../domain/entities/user.entity.js';
import { AccountSuspendedException } from '../../domain/exceptions/identity.exceptions.js';
import type { TokenIssuer } from '../../domain/ports/token-issuer.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthSession, AuthUserView } from '../auth-session.js';

/** Single place where an authenticated user is turned into a token pair. */
export class SessionIssuer {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
  ) {}

  async describe(user: User): Promise<AuthUserView> {
    const memberships = await this.users.findActiveMemberships(user.id);
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      isPlatformAdmin: user.isPlatformAdmin,
      memberships,
    };
  }

  async issueFor(user: User): Promise<AuthSession> {
    if (user.isSuspended()) {
      throw new AccountSuspendedException();
    }
    const view = await this.describe(user);
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.issueAccessToken({
        userId: view.id,
        email: view.email,
        isPlatformAdmin: view.isPlatformAdmin,
        memberships: view.memberships,
      }),
      this.tokens.issueRefreshToken(view.id),
    ]);
    return { accessToken, refreshToken, user: view };
  }
}
