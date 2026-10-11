export const PASSWORD_RESET_TOKENS = Symbol('PasswordResetTokens');

/** How long a reset link works. */
export const PASSWORD_RESET_TTL_SECONDS = 15 * 60;

/** Single-use, short-lived proofs that whoever holds them may choose a new password for an account. */
export interface PasswordResetTokens {
  /** Stores a new token for the user, replacing any they already had, and returns it. */
  issue(userId: string, ttlSeconds: number): Promise<string>;
  /** Resolves to the user the token was issued for and spends it; null if it is unknown, expired or spent. */
  consume(token: string): Promise<string | null>;
}
