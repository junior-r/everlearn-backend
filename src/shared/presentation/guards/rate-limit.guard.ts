import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config.js';
import {
  RATE_LIMITER,
  RateLimitExceededException,
  type RateLimiter,
} from '../../domain/rate-limit/rate-limiter.js';

const RATE_LIMIT_KEY = 'rate-limit:options';

export interface RateLimitOptions {
  /** Separates the counters of different endpoints. */
  scope: string;
  /** Also limit by this body field (e.g. `email`), so one account cannot be attacked from many IPs. */
  bodyField?: string;
}

/** Applies the auth rate limit to a route. Requires `@UseGuards(RateLimitGuard)`. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

function bodyValue(request: Request, field: string | undefined): string | null {
  const body = request.body as Record<string, unknown> | undefined;
  const value = field ? body?.[field] : undefined;
  return typeof value === 'string' && value.length > 0 ? value.trim().toLowerCase() : null;
}

// Keys are hashed so emails and addresses are not stored in Redis in clear text
const hashed = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const subject = bodyValue(request, options.bodyField);
    const keys = [
      `${options.scope}:ip:${hashed(request.ip ?? 'unknown')}`,
      ...(subject ? [`${options.scope}:${options.bodyField}:${hashed(subject)}`] : []),
    ];
    const retryAfterSeconds = await this.retryAfter(keys);
    if (retryAfterSeconds !== null) {
      http.getResponse<Response>().setHeader('Retry-After', String(retryAfterSeconds));
      throw new RateLimitExceededException(retryAfterSeconds);
    }
    return true;
  }

  /** Counts the attempt against every key; resolves to the wait time if any key is over its limit. */
  private async retryAfter(keys: string[]): Promise<number | null> {
    const { authMaxAttempts, authWindowSeconds } = this.config.rateLimit;
    try {
      const decisions = await Promise.all(
        keys.map((key) => this.limiter.consume(key, authMaxAttempts, authWindowSeconds)),
      );
      const blocked = decisions.filter((decision) => !decision.allowed);
      return blocked.length > 0
        ? Math.max(...blocked.map((decision) => decision.retryAfterSeconds))
        : null;
    } catch (error) {
      // Fail open: a Redis outage must not lock every user out of signing in
      this.logger.error(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
