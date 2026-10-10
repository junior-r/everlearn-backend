import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';

export const TOKEN_ISSUER = Symbol('TokenIssuer');

export interface RefreshTokenClaims {
  userId: string;
  /** Unique id of this token, used to revoke it. */
  tokenId: string;
  expiresAt: Date;
}

/** Proof that a signed-in user started a Google link, bound to the OAuth state of that attempt. */
export interface GoogleLinkTicket {
  userId: string;
  state: string;
}

export interface TokenIssuer {
  issueAccessToken(user: AuthenticatedUser): Promise<string>;
  issueRefreshToken(userId: string): Promise<string>;
  /** Resolves to the token's claims, or null when it is invalid or expired. */
  verifyRefreshToken(token: string): Promise<RefreshTokenClaims | null>;
  /** A short-lived, tamper-proof ticket. It must be unforgeable: it decides which account gets linked. */
  issueGoogleLinkTicket(ticket: GoogleLinkTicket): Promise<string>;
  verifyGoogleLinkTicket(token: string): Promise<GoogleLinkTicket | null>;
}
