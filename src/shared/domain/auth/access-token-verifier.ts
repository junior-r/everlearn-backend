import type { AuthenticatedUser } from './authenticated-user.js';

export const ACCESS_TOKEN_VERIFIER = Symbol('AccessTokenVerifier');

export interface AccessTokenVerifier {
  /** Resolves to the token's identity, or null when the token is invalid or expired. */
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null>;
}
