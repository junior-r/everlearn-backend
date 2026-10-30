import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import { ArchiveNextRecordingUseCase } from '../../application/use-cases/recording.use-cases.js';

// How often the spool is looked at; a recording can be watched about this long after its class ends
const POLL_MS = 15_000;

/**
 * Moves finished recordings from Egress's spool into the recording storage, one at
 * a time. Every backend instance may run it: a recording is claimed before it is moved.
 */
@Injectable()
export class RecordingArchiveWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecordingArchiveWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    @Inject(ArchiveNextRecordingUseCase) private readonly archive: ArchiveNextRecordingUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.recordings.archiveEnabled) {
      return;
    }
    this.timer = setInterval(() => void this.run(), POLL_MS);
    this.logger.log(`Recordings are stored in ${this.config.recordings.storage.kind} storage`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Stores every recording waiting, until none is left or one could not be stored. */
  async run(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      for (;;) {
        const outcome = await this.archive.execute();
        if (outcome === 'NONE') {
          break;
        }
        if (outcome !== 'STORED') {
          this.logger.warn(`A recording could not be stored (${outcome})`);
          break;
        }
        this.logger.log('A recording was stored');
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.isRunning = false;
    }
  }
}
