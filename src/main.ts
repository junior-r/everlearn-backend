import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);
  app.use(cookieParser());
  // Credentials are required so the browser sends the httpOnly refresh cookie
  app.enableCors({ origin: config.frontendUrl, credentials: true });
  await app.listen(config.port);
}
await bootstrap();
