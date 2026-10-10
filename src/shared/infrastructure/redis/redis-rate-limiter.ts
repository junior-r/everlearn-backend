import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { RateLimitDecision, RateLimiter } from '../../domain/rate-limit/rate-limiter.js';
import { REDIS_CLIENT } from './redis.tokens.js';

// Increment and set the expiry in one step, so a counter can never be left without a TTL
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('TTL', KEYS[1]) }
`;

/** Fixed-window counter shared by every backend instance. */
@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const [count, ttl] = (await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      `rate-limit:${key}`,
      windowSeconds,
    )) as [number, number];
    return { allowed: count <= limit, retryAfterSeconds: Math.max(ttl, 1) };
  }
}
