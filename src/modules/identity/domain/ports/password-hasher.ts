export const PASSWORD_HASHER = Symbol('PasswordHasher');

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /**
   * Compares a password with a stored hash. A null hash must still cost the same
   * time as a real comparison, so callers do not reveal which emails exist.
   */
  verify(plain: string, hash: string | null): Promise<boolean>;
}
