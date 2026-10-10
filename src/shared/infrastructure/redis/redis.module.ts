import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config.js';
import { RATE_LIMITER } from '../../domain/rate-limit/rate-limiter.js';
import { RedisRateLimiter } from './redis-rate-limiter.js';
import { REDIS_CLIENT } from './redis.tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AppConfig) =>
        // Fail commands quickly instead of queueing them while Redis is unreachable
        new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }),
      inject: [APP_CONFIG],
    },
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
  ],
  exports: [REDIS_CLIENT, RATE_LIMITER],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
