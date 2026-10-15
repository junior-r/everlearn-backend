import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { SyncBuiltInExercisesUseCase } from '../application/use-cases/language-exercise.use-cases.js';

/** Writes the platform's own exercise bank on start, so every deployment offers the one its code ships. */
@Injectable()
export class BuiltInExercisesBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(BuiltInExercisesBootstrap.name);

  constructor(@Inject(SyncBuiltInExercisesUseCase) private readonly sync: SyncBuiltInExercisesUseCase) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.sync.execute();
    } catch (error) {
      // The API should still start if the database is briefly unreachable
      this.logger.error(error instanceof Error ? error.message : String(error));
    }
  }
}
