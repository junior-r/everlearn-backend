import { Logger } from '@nestjs/common';
import type {
  HumanCheck,
  HumanCheckOutcome,
  HumanCheckRequest,
} from '../../domain/human-check/human-check.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;
// Cloudflare's documented maximum; anything longer is not a token
const MAX_TOKEN_LENGTH = 2048;
const MISCONFIGURED = new Set(['missing-input-secret', 'invalid-input-secret']);

export interface TurnstileOptions {
  secretKey: string;
  fetch?: typeof fetch;
}

interface SiteverifyAnswer {
  success?: unknown;
  action?: unknown;
  'error-codes'?: unknown;
}

/**
 * Cloudflare Turnstile as a `HumanCheck`: asks Siteverify about the token the
 * widget produced. A token is single-use and bound to the action of its form.
 */
export class TurnstileHumanCheck implements HumanCheck {
  private readonly logger = new Logger(TurnstileHumanCheck.name);
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: TurnstileOptions) {
    this.doFetch = options.fetch ?? fetch;
  }

  async verify({ token, action, remoteIp }: HumanCheckRequest): Promise<HumanCheckOutcome> {
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return 'failed';
    }
    const answer = await this.ask(token, remoteIp);
    if (!answer) {
      return 'unavailable';
    }
    if (answer.success === true) {
      // Cloudflare's test keys answer without an action; real widgets always send theirs
      return !answer.action || answer.action === action ? 'passed' : 'failed';
    }
    const codes = Array.isArray(answer['error-codes']) ? answer['error-codes'] : [];
    if (codes.includes('internal-error')) {
      return 'unavailable';
    }
    if (codes.some((code) => MISCONFIGURED.has(String(code)))) {
      this.logger.error('Turnstile refused the secret key: check TURNSTILE_SECRET_KEY');
    }
    return 'failed';
  }

  private async ask(token: string, remoteIp: string | null): Promise<SiteverifyAnswer | null> {
    const body = new URLSearchParams({ secret: this.options.secretKey, response: token });
    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }
    try {
      const response = await this.doFetch(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.error(`Turnstile answered ${response.status}`);
        return null;
      }
      return (await response.json()) as SiteverifyAnswer;
    } catch (error) {
      this.logger.error(`Turnstile unreachable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

/** Lets everyone through; used when no Turnstile key is configured (development and tests). */
export class DisabledHumanCheck implements HumanCheck {
  verify(): Promise<HumanCheckOutcome> {
    return Promise.resolve('passed');
  }
}
