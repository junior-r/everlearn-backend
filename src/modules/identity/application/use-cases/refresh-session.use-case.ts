import { InvalidRefreshTokenException } from '../../domain/exceptions/identity.exceptions.js';
import type { RefreshTokenRevocations } from '../../domain/ports/refresh-token-revocations.js';
import type { TokenIssuer } from '../../domain/ports/token-issuer.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { AuthSession } from '../auth-session.js';
import type { SessionIssuer } from '../services/session-issuer.js';

export class RefreshSessionUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly revocations: RefreshTokenRevocations,
    private readonly sessions: SessionIssuer,
  ) {}

  /** Exchanges a refresh token for a new access token with up-to-date memberships. */
  async execute(refreshToken: string | undefined): Promise<AuthSession> {
    const claims = refreshToken ? await this.tokens.verifyRefreshToken(refreshToken) : null;
    if (!refreshToken || !claims || (await this.revocations.isRevoked(claims.tokenId))) {
      throw new InvalidRefreshTokenException();
    }
    // Sessions opened before a password reset ended with it
    if (await this.revocations.isRevokedFor(claims.userId, claims.issuedAt)) {
      throw new InvalidRefreshTokenException();
    }
    const user = await this.users.findById(claims.userId);
    if (!user) {
      throw new InvalidRefreshTokenException();
    }
    const session = await this.sessions.issueFor(user);
    // Keep the same refresh token, so logging out revokes the one the browser holds
    return { ...session, refreshToken };
  }
}
