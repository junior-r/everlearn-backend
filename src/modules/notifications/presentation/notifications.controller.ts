import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { CurrentUser } from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  ListNotificationsUseCase,
  MarkNotificationsReadUseCase,
  type NotificationList,
} from '../application/use-cases/notification.use-cases.js';

const MAX_IDS_PER_REQUEST = 100;

export class MarkReadDto {
  // Left out to mark every notice as read
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS_PER_REQUEST)
  @IsUUID(undefined, { each: true })
  ids?: string[];
}

/** The signed-in user's own notices, whatever institution they come from. */
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(ListNotificationsUseCase) private readonly listNotifications: ListNotificationsUseCase,
    @Inject(MarkNotificationsReadUseCase) private readonly markRead: MarkNotificationsReadUseCase,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<NotificationList> {
    return this.listNotifications.execute(user.userId);
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async read(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto): Promise<void> {
    await this.markRead.execute(user.userId, dto.ids ?? null);
  }
}
