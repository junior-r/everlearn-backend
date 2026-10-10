import { InvalidRefreshTokenException } from '../../domain/exceptions/identity.exceptions.js';
import type { TokenIssuer } from '../../domain/ports/token-issuer.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthSession } from '../auth-session.js';
import type { SessionIssuer } from '../services/session-issuer.js';

export class RefreshSessionUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly sessions: SessionIssuer,
  ) {}

  /** Exchanges a refresh token for a new token pair with up-to-date memberships. */
  async execute(refreshToken: string | undefined): Promise<AuthSession> {
    if (!refreshToken) {
      throw new InvalidRefreshTokenException();
    }
    const userId = await this.tokens.verifyRefreshToken(refreshToken);
    const user = userId ? await this.users.findById(userId) : null;
    if (!user) {
      throw new InvalidRefreshTokenException();
    }
    return this.sessions.issueFor(user);
  }
}
