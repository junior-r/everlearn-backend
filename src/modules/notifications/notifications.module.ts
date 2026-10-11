import { randomUUID } from 'node:crypto';
import { Global, Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
  EMAIL_PROVIDER,
  NOTIFICATION_REPOSITORY,
  REMINDER_QUERIES,
  type EmailProvider,
  type NotificationRepository,
} from './domain/ports/notification.ports.js';
import { MockEmailProvider } from './infrastructure/mock-email.provider.js';
import { PrismaNotificationRepository } from './infrastructure/prisma-notification.repository.js';
import { PrismaReminderQueries } from './infrastructure/prisma-reminder-queries.js';
import { ReminderScheduler } from './infrastructure/reminder.scheduler.js';
import { NotificationsController } from './presentation/notifications.controller.js';

const logger = new Logger('Notifications');
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Composition root of notices and reminders. Global, so any module can announce
 * something through `NOTIFIER` without importing this one. A real email service
 * plugs in as another adapter of `EmailProvider`.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATION_REPOSITORY, useClass: PrismaNotificationRepository },
    { provide: REMINDER_QUERIES, useClass: PrismaReminderQueries },
    { provide: EMAIL_PROVIDER, useFactory: (): EmailProvider => new MockEmailProvider() },
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
  exports: [NOTIFIER],
})
export class NotificationsModule {}
