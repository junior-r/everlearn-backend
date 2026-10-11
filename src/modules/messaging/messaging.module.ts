import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { NOTIFIER, type Notifier } from '../../shared/domain/notifications/notifier.js';
import { RATE_LIMITER, type RateLimiter } from '../../shared/domain/rate-limit/rate-limiter.js';
import { REALTIME, type Realtime } from '../../shared/domain/realtime/realtime.js';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  ListConversationsUseCase,
  OpenConversationUseCase,
  SearchContactsUseCase,
  SendDirectMessageUseCase,
} from './application/use-cases/messaging.use-cases.js';
import { MESSAGE_REPOSITORY, type MessageRepository } from './domain/ports/messaging.ports.js';
import { PrismaMessageRepository } from './infrastructure/prisma-message.repository.js';
import { MessagingController } from './presentation/messaging.controller.js';

/** Composition root of direct messages between members of an institution. */
@Module({
  controllers: [MessagingController],
  providers: [
    { provide: MESSAGE_REPOSITORY, useClass: PrismaMessageRepository },
    useCaseProvider(SearchContactsUseCase, [MESSAGE_REPOSITORY]),
    useCaseProvider(ListConversationsUseCase, [MESSAGE_REPOSITORY]),
    useCaseProvider(OpenConversationUseCase, [MESSAGE_REPOSITORY, NOTIFIER]),
    {
      provide: SendDirectMessageUseCase,
      useFactory: (
        messages: MessageRepository,
        realtime: Realtime,
        notifier: Notifier,
        limiter: RateLimiter,
        config: AppConfig,
      ) =>
        new SendDirectMessageUseCase(messages, realtime, notifier, limiter, {
          maxMessages: config.messaging.maxMessages,
          windowSeconds: config.messaging.windowSeconds,
        }),
      inject: [MESSAGE_REPOSITORY, REALTIME, NOTIFIER, RATE_LIMITER, APP_CONFIG],
    },
  ],
})
export class MessagingModule {}
