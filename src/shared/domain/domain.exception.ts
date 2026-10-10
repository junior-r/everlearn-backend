export type DomainErrorKind =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INTERNAL';

/**
 * Base class for every business error. `kind` is a transport-agnostic category
 * and `code` is a stable machine-readable identifier for clients.
 */
export class DomainException extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PersistenceException extends DomainException {
  constructor() {
    super('INTERNAL', 'PERSISTENCE_FAILURE', 'The operation could not be completed');
  }
}
