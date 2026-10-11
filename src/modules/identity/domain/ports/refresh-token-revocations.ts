export const REFRESH_TOKEN_REVOCATIONS = Symbol('RefreshTokenRevocations');

export interface RefreshTokenRevocations {
  /** Blocks the token until `expiresAt`, after which it is invalid anyway. */
  revoke(tokenId: string, expiresAt: Date): Promise<void>;
  isRevoked(tokenId: string): Promise<boolean>;
  /** Closes every session of the user opened before `before`, on every device. */
  revokeAllFor(userId: string, before: Date): Promise<void>;
  /** Whether a token of the user issued at `issuedAt` falls under `revokeAllFor`. */
  isRevokedFor(userId: string, issuedAt: Date): Promise<boolean>;
}
