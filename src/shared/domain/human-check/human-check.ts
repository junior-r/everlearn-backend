import { DomainException } from '../domain.exception.js';

export const HUMAN_CHECK = Symbol('HumanCheck');

/** `unavailable` means the check itself could not run, which says nothing about the caller. */
export type HumanCheckOutcome = 'passed' | 'failed' | 'unavailable';

export interface HumanCheckRequest {
  /** What the challenge solved in the browser produced; empty when the browser sent none. */
  token: string;
  /** The form the challenge was solved for. */
  action: string;
  remoteIp: string | null;
}

/** Tells a person from a script by the token of a challenge solved in the browser. */
export interface HumanCheck {
  verify(request: HumanCheckRequest): Promise<HumanCheckOutcome>;
}

export class HumanCheckFailedException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'HUMAN_CHECK_FAILED', 'The anti-bot check failed. Try again');
  }
}
