import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import { REDIS_CLIENT } from '../../../../shared/infrastructure/redis/redis.tokens.js';
import { SessionStoreUnavailableException } from '../../domain/exceptions/identity.exceptions.js';
import type { RefreshTokenRevocations } from '../../domain/ports/refresh-token-revocations.js';

const key = (tokenId: string) => `revoked-refresh-token:${tokenId}`;
const cutoffKey = (userId: string) => `sessions-revoked-before:${userId}`;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/**
 * Blocklist of logged-out refresh tokens. Fails closed: if Redis cannot answer,
 * the refresh is refused rather than risk honouring a revoked token.
 */
@Injectable()
export class RedisRefreshTokenRevocations implements RefreshTokenRevocations {
  private readonly logger = new Logger(RedisRefreshTokenRevocations.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async revoke(tokenId: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds <= 0) {
      return;
    }
    await this.run(() => this.redis.set(key(tokenId), '1', 'EX', ttlSeconds));
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    return (await this.run(() => this.redis.exists(key(tokenId)))) === 1;
  }

  async revokeAllFor(userId: string, before: Date): Promise<void> {
    // Kept for as long as a refresh token lives: after that none issued earlier can still be valid
    await this.run(() =>
      this.redis.set(cutoffKey(userId), String(seconds(before)), 'EX', this.config.jwt.refreshTtlSeconds),
    );
  }

  async isRevokedFor(userId: string, issuedAt: Date): Promise<boolean> {
    const cutoff = await this.run(() => this.redis.get(cutoffKey(userId)));
    // Tokens carry whole seconds: one issued in the very second of the cutoff is let through
    return cutoff !== null && seconds(issuedAt) < Number(cutoff);
  }

  private async run<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw new SessionStoreUnavailableException();
    }
  }
}
