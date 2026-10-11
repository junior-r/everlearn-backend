import { Logger } from '@nestjs/common';
import type { DashboardCache } from '../domain/ports/analytics.ports.js';

/** The two Redis commands the cache needs, so a test can stand in for the server. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/**
 * Dashboard figures kept in Redis for a few seconds, shared by every backend
 * instance. Fails open: without Redis the figures are simply counted each time.
 */
export class RedisDashboardCache implements DashboardCache {
  private readonly logger = new Logger(RedisDashboardCache.name);

  constructor(private readonly redis: CacheStore) {}

  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    if (ttlSeconds <= 0) {
      return load();
    }
    const cacheKey = `dashboard:${key}`;
    try {
      const stored = await this.redis.get(cacheKey);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch (error) {
      this.logger.warn(`Dashboard cache unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return load();
    }
    const value = await load();
    // Not awaited into the answer: a failed write only means the next request counts again
    await this.redis.set(cacheKey, JSON.stringify(value), 'EX', ttlSeconds).catch(() => undefined);
    return value;
  }
}
