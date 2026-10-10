export const REFRESH_TOKEN_REVOCATIONS = Symbol('RefreshTokenRevocations');

export interface RefreshTokenRevocations {
  /** Blocks the token until `expiresAt`, after which it is invalid anyway. */
  revoke(tokenId: string, expiresAt: Date): Promise<void>;
  isRevoked(tokenId: string): Promise<boolean>;
}
