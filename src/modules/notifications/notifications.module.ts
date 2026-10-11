import { randomUUID } from 'node:crypto';
import { Global, Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { EMAIL_PROVIDER, type EmailProvider } from '../../shared/domain/email/email-provider.js';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import { NOTIFIER, type Notifier } from '../../shared/domain/notifications/notifier.js';
import { REALTIME, type Realtime } from '../../shared/domain/realtime/realtime.js';
import {
  ListNotificationsUseCase,
  MarkNotificationsReadUseCase,
  SendNotificationsUseCase,
  SendRemindersUseCase,
} from './application/use-cases/notification.use-cases.js';
import {
  NOTIFICATION_REPOSITORY,
  REMINDER_QUERIES,
  type NotificationRepository,
} from './domain/ports/notification.ports.js';
import { MockEmailProvider } from './infrastructure/mock-email.provider.js';
import { PrismaNotificationRepository } from './infrastructure/prisma-notification.repository.js';
import { PrismaReminderQueries } from './infrastructure/prisma-reminder-queries.js';
import { ResendEmailProvider, resendSend } from './infrastructure/resend-email.provider.js';
import { ReminderScheduler } from './infrastructure/reminder.scheduler.js';
import { NotificationsController } from './presentation/notifications.controller.js';

const logger = new Logger('Notifications');
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Composition root of notices and reminders. Global, so any module can announce
 * something through `NOTIFIER`, or send an email through `EMAIL_PROVIDER`, without
 * importing this one. Emails go through Resend when `USE_REAL_EMAIL` is on and
 * configured, and to the log otherwise.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
    { provide: REMINDER_QUERIES, useClass: PrismaReminderQueries },
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: AppConfig): EmailProvider => {
        const { resend, realEmailWithoutKey, logBodies } = config.email;
        if (resend) {
          return new ResendEmailProvider(resendSend(resend.apiKey), resend.from);
        }
        if (realEmailWithoutKey) {
          logger.warn('USE_REAL_EMAIL is on but RESEND_API_KEY or EMAIL_FROM is missing: emails are only logged');
        }
        return new MockEmailProvider(logBodies);
      },
      inject: [APP_CONFIG],
    },
    {
      provide: SendNotificationsUseCase,
      useFactory: (notifications: NotificationRepository, emails: EmailProvider, realtime: Realtime) =>
        new SendNotificationsUseCase(notifications, emails, realtime, randomUUID, (error) =>
          logger.warn(`Email not sent: ${describe(error)}`),
        ),
      inject: [NOTIFICATION_REPOSITORY, EMAIL_PROVIDER, REALTIME],
    },
    {
      // What other modules see: the same use case, made unable to fail them
      provide: NOTIFIER,
      useFactory: (send: SendNotificationsUseCase, notifications: NotificationRepository): Notifier => ({
        notify: async (requests) => {
          await send.execute(requests).catch((error: unknown) => logger.error(`Notices not sent: ${describe(error)}`));
        },
        dismiss: async (userId, collapseKey) => {
          await notifications
            .markCollapsedRead(userId, collapseKey)
            .catch((error: unknown) => logger.error(`Notices not dismissed: ${describe(error)}`));
        },
      }),
      inject: [SendNotificationsUseCase, NOTIFICATION_REPOSITORY],
    },
    useCaseProvider(ListNotificationsUseCase, [NOTIFICATION_REPOSITORY]),
    useCaseProvider(MarkNotificationsReadUseCase, [NOTIFICATION_REPOSITORY]),
    useCaseProvider(SendRemindersUseCase, [REMINDER_QUERIES, SendNotificationsUseCase]),
    ReminderScheduler,
  ],
  exports: [NOTIFIER, EMAIL_PROVIDER],
})
export class NotificationsModule {}
