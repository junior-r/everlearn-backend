import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  ListConversationsUseCase,
  OpenConversationUseCase,
  SearchContactsUseCase,
  SendDirectMessageUseCase,
  type Conversation,
} from '../application/use-cases/messaging.use-cases.js';
import {
  MAX_MESSAGE_LENGTH,
  MessagesTooFastException,
  type Contact,
  type ConversationSummary,
  type DirectMessage,
} from '../domain/direct-message.js';

const MAX_QUERY_LENGTH = 80;
const EVERY_ROLE = Object.values(Role);

export class ContactQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUERY_LENGTH)
  query?: string;
}

export class ConversationQueryDto {
  // Messages sent before this instant, to page back through a long conversation
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  body: string;
}

/** Direct messages between members of the institution in the `x-institution-id` header. */
@Controller('messages')
@Roles(...EVERY_ROLE)
export class MessagingController {
  constructor(
    @Inject(SearchContactsUseCase) private readonly searchContacts: SearchContactsUseCase,
    @Inject(ListConversationsUseCase) private readonly listConversations: ListConversationsUseCase,
    @Inject(OpenConversationUseCase) private readonly openConversation: OpenConversationUseCase,
    @Inject(SendDirectMessageUseCase) private readonly sendMessage: SendDirectMessageUseCase,
  ) {}

  @Get('contacts')
  contacts(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() { query }: ContactQueryDto,
  ): Promise<Contact[]> {
    return this.searchContacts.execute({ institutionId, userId: user.userId }, query ?? '');
  }

  @Get('conversations')
  conversations(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ConversationSummary[]> {
    return this.listConversations.execute({ institutionId, userId: user.userId });
  }

  /** Opening a conversation marks what the other person sent as read. */
  @Get('conversations/:userId')
  conversation(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) peerId: string,
    @Query() { before }: ConversationQueryDto,
  ): Promise<Conversation> {
    return this.openConversation.execute({ institutionId, userId: user.userId }, peerId, before ?? null);
  }

  @Post('conversations/:userId')
  async send(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) recipientId: string,
    @Body() dto: SendMessageDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DirectMessage> {
    try {
      return await this.sendMessage.execute({ institutionId, userId: user.userId }, recipientId, dto.body);
    } catch (error) {
      if (error instanceof MessagesTooFastException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}
