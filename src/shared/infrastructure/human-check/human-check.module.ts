import { Global, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config.js';
import { HUMAN_CHECK, type HumanCheck } from '../../domain/human-check/human-check.js';
import { DisabledHumanCheck, TurnstileHumanCheck } from './turnstile-human-check.js';

/** Provides `HUMAN_CHECK`: Turnstile when `TURNSTILE_SECRET_KEY` is set, a pass-through otherwise. */
@Global()
@Module({
  providers: [
    {
      provide: HUMAN_CHECK,
      useFactory: (config: AppConfig): HumanCheck => {
        if (config.turnstile) {
          return new TurnstileHumanCheck({ secretKey: config.turnstile.secretKey });
        }
        if (config.isProduction) {
          new Logger('HumanCheck').warn('TURNSTILE_SECRET_KEY is not set: public forms have no bot check');
        }
        return new DisabledHumanCheck();
      },
      inject: [APP_CONFIG],
    },
  ],
  exports: [HUMAN_CHECK],
})
export class HumanCheckModule {}
