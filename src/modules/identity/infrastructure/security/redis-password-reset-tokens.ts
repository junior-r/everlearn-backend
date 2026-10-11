import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../../shared/infrastructure/redis/redis.tokens.js';
import { SessionStoreUnavailableException } from '../../domain/exceptions/identity.exceptions.js';
import type { PasswordResetTokens } from '../../domain/ports/password-reset-tokens.js';

const TOKEN_BYTES = 32;
// Only a hash of the token is stored, so reading Redis does not hand out working links
const tokenKey = (token: string) => `password-reset:token:${createHash('sha256').update(token).digest('hex')}`;
const userKey = (userId: string) => `password-reset:user:${userId}`;

/** Read and delete in one step, so a token can be spent only once even by two requests at the same time. */
const CONSUME_SCRIPT = `
local userId = redis.call('GET', KEYS[1])
if userId then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', ARGV[1] .. userId)
end
return userId
`;

/**
 * Reset tokens kept in Redis until they are used or expire. Fails closed: if
 * Redis cannot answer, no token is issued or accepted.
 */
@Injectable()
export class RedisPasswordResetTokens implements PasswordResetTokens {
  private readonly logger = new Logger(RedisPasswordResetTokens.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async issue(userId: string, ttlSeconds: number): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    await this.run(async () => {
      // Asking again makes the previous link stop working
      const previous = await this.redis.get(userKey(userId));
      const batch = this.redis.multi();
      if (previous) {
        batch.del(previous);
      }
      batch.set(tokenKey(token), userId, 'EX', ttlSeconds);
      batch.set(userKey(userId), tokenKey(token), 'EX', ttlSeconds);
      await batch.exec();
    });
    return token;
  }

  consume(token: string): Promise<string | null> {
    return this.run(
      async () => (await this.redis.eval(CONSUME_SCRIPT, 1, tokenKey(token), userKey(''))) as string | null,
    );
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
