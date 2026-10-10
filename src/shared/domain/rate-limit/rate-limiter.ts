import { DomainException } from '../domain.exception.js';

export const RATE_LIMITER = Symbol('RateLimiter');

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one attempt for the key and reports whether it is within the limit for the window. */
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
}

export class RateLimitExceededException extends DomainException {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'RATE_LIMITED', 'Too many attempts. Try again later');
  }
}
