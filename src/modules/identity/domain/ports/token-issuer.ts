import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';

export const TOKEN_ISSUER = Symbol('TokenIssuer');

export interface RefreshTokenClaims {
  userId: string;
  /** Unique id of this token, used to revoke it. */
  tokenId: string;
  expiresAt: Date;
}

export interface TokenIssuer {
  issueAccessToken(user: AuthenticatedUser): Promise<string>;
  issueRefreshToken(userId: string): Promise<string>;
  /** Resolves to the token's claims, or null when it is invalid or expired. */
  verifyRefreshToken(token: string): Promise<RefreshTokenClaims | null>;
}
