import type { RefreshTokenRevocations } from '../../domain/ports/refresh-token-revocations.js';
import type { TokenIssuer } from '../../domain/ports/token-issuer.js';

export class LogoutUseCase {
  constructor(
    private readonly tokens: TokenIssuer,
    private readonly revocations: RefreshTokenRevocations,
  ) {}

  /** Revokes the refresh token server-side. A missing or invalid token is already unusable, so it is a no-op. */
  async execute(refreshToken: string | undefined): Promise<void> {
    const claims = refreshToken ? await this.tokens.verifyRefreshToken(refreshToken) : null;
    if (claims) {
      await this.revocations.revoke(claims.tokenId, claims.expiresAt);
    }
  }
}
