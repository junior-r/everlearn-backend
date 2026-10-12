import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { RedisIoAdapter } from './shared/infrastructure/realtime/redis-io.adapter.js';
import { REDIS_CLIENT } from './shared/infrastructure/redis/redis.tokens.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  // Behind a proxy every request comes from the proxy: without this, one sign-in limit is shared by everyone
  app.set('trust proxy', config.trustedProxies);
  app.use(cookieParser());
  // Credentials are required so the browser sends the httpOnly refresh cookie
  app.enableCors({ origin: config.frontendUrl, credentials: true });
  // Realtime events and presence go through Redis, so any number of servers can run side by side
  app.useWebSocketAdapter(new RedisIoAdapter(app, app.get<Redis>(REDIS_CLIENT)));
  await app.listen(config.port);
}
await bootstrap();
