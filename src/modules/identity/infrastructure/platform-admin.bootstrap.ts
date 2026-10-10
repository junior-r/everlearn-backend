import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config.js';
import { EnsurePlatformAdminUseCase } from '../application/use-cases/ensure-platform-admin.use-case.js';

/**
 * With no self-registration, something must create the first account. When
 * PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are set, this does so on start.
 */
@Injectable()
export class PlatformAdminBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformAdminBootstrap.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EnsurePlatformAdminUseCase) private readonly ensureAdmin: EnsurePlatformAdminUseCase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.platformAdmin) {
      return;
    }
    try {
      if (await this.ensureAdmin.execute(this.config.platformAdmin)) {
        this.logger.log(`Created Platform Admin ${this.config.platformAdmin.email}`);
      }
    } catch (error) {
      // The API should still start if the database is briefly unreachable
      this.logger.error(error instanceof Error ? error.message : String(error));
    }
  }
}
