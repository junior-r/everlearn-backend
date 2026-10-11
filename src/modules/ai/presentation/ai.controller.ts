import { Body, Controller, Inject, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import { DomainException } from '../../../shared/domain/domain.exception.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import { ChatWithAssistantUseCase } from '../application/use-cases/chat-with-assistant.use-case.js';
import { AssistantBusyException } from '../domain/assistant.js';
import { ChatDto } from './ai.dtos.js';

/** What the stream carries: the assistant's events, then `done`, or `error` if it broke midway. */
type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done' }
  | { type: 'error'; code: string };

/** The AI assistant, for the institution in the `x-institution-id` header. */
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(@Inject(ChatWithAssistantUseCase) private readonly chatWithAssistant: ChatWithAssistantUseCase) {}

  /**
   * Answers the last message of the conversation as Server-Sent Events. A
   * request refused before the answer starts gets an ordinary JSON error.
   */
  @Post('chat')
  @Roles(Role.ADMIN, Role.COORDINATOR, Role.TEACHER, Role.STAFF, Role.STUDENT)
  async chat(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChatDto,
    @Res() response: Response,
  ): Promise<void> {
    // Aborted when the connection closes, so a model nobody is listening to stops being paid for
    const gone = new AbortController();
    response.once('close', () => gone.abort());
    const events = await this.chatWithAssistant
      .execute(
        { userId: user.userId, institutionId, isPlatformAdmin: user.isPlatformAdmin, memberships: user.memberships },
        dto.messages.map(({ role, content }) => ({ role, content })),
        gone.signal,
      )
      .catch((error: unknown) => {
        if (error instanceof AssistantBusyException) {
          response.setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        throw error;
      });

    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Tells nginx-style proxies not to hold the answer back until it is complete
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const send = (event: StreamEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      for await (const event of events) {
        if (gone.signal.aborted) {
          return;
        }
        send(event);
      }
      send({ type: 'done' });
    } catch (error) {
      if (gone.signal.aborted) {
        return;
      }
      if (!(error instanceof DomainException)) {
        this.logger.error(error instanceof Error ? error.stack : String(error));
      }
      send({ type: 'error', code: error instanceof DomainException ? error.code : 'ASSISTANT_UNAVAILABLE' });
    } finally {
      // Nothing is written to a connection that is gone; ending it twice is harmless
      if (!response.writableEnded) {
        response.end();
      }
    }
  }
}
