import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../shared/infrastructure/redis/redis.tokens.js';
import type { ScheduleLock } from '../domain/ports/scheduling.ports.js';
import { ScheduleBusyException } from '../domain/schedule.js';

// Long enough for the checks and the insert; short enough that a crashed request frees the schedule quickly
const LOCK_TTL_MS = 10_000;

// Delete only if we still own the lock, so an expired lock taken over by someone else is left alone
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Cross-instance mutual exclusion on teachers and groups. Fails closed: if a
 * lock cannot be taken, including because Redis is down, nothing is scheduled.
 */
@Injectable()
export class RedisScheduleLock implements ScheduleLock {
  private readonly logger = new Logger(RedisScheduleLock.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async runExclusive<T>(keys: string[], work: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    // Always taken in the same order, so two requests cannot each hold what the other needs
    const ordered = [...new Set(keys)].sort().map((key) => `schedule-lock:${key}`);
    const held: string[] = [];
    try {
      for (const key of ordered) {
        if (!(await this.acquire(key, token))) {
          throw new ScheduleBusyException();
        }
        held.push(key);
      }
      return await work();
    } finally {
      await Promise.all(held.map((key) => this.release(key, token)));
    }
  }

  private async acquire(key: string, token: string): Promise<boolean> {
    try {
      return (await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch (error) {
      // The lock expires on its own; a failed release only delays the next change slightly
      this.logger.warn(error instanceof Error ? error.message : String(error));
    }
  }
}
