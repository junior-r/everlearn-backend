import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config.js';
import { SendRemindersUseCase } from '../application/use-cases/notification.use-cases.js';

const JOB_NAME = 'reminders';

/**
 * Runs the reminders on a schedule. The job only starts when reminders are
 * switched on, so tests and one-off scripts boot the app without a timer.
 */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderScheduler.name);
  private isRunning = false;

  constructor(
    @Inject(SendRemindersUseCase) private readonly reminders: SendRemindersUseCase,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    const { enabled, cron } = this.config.reminders;
    if (!enabled) {
      return;
    }
    const job = CronJob.from({ cronTime: cron, onTick: () => void this.run(), start: true });
    this.registry.addCronJob(JOB_NAME, job as never);
    this.logger.log(`Reminders scheduled (${cron})`);
  }

  onModuleDestroy(): void {
    if (this.registry.doesExist('cron', JOB_NAME)) {
      this.registry.deleteCronJob(JOB_NAME);
    }
  }

  /** One pass. A pass that is still running is not started again on top of itself. */
  async run(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const sent = await this.reminders.execute(new Date());
      if (sent > 0) {
        this.logger.log(`Sent ${sent} reminders`);
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      this.isRunning = false;
    }
  }
}
