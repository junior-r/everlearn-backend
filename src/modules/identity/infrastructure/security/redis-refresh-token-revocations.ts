import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../../shared/infrastructure/redis/redis.tokens.js';
import { SessionStoreUnavailableException } from '../../domain/exceptions/identity.exceptions.js';
import type { RefreshTokenRevocations } from '../../domain/ports/refresh-token-revocations.js';

const key = (tokenId: string) => `revoked-refresh-token:${tokenId}`;

/**
 * Blocklist of logged-out refresh tokens. Fails closed: if Redis cannot answer,
 * the refresh is refused rather than risk honouring a revoked token.
 */
@Injectable()
export class RedisRefreshTokenRevocations implements RefreshTokenRevocations {
  private readonly logger = new Logger(RedisRefreshTokenRevocations.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

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

  private async run<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw new SessionStoreUnavailableException();
    }
  }
}
