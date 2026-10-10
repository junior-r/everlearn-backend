import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';

export const TOKEN_ISSUER = Symbol('TokenIssuer');

export interface TokenIssuer {
  issueAccessToken(user: AuthenticatedUser): Promise<string>;
  issueRefreshToken(userId: string): Promise<string>;
  /** Resolves to the user id, or null when the token is invalid or expired. */
  verifyRefreshToken(token: string): Promise<string | null>;
}
