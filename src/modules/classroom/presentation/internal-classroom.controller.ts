import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { InternalServiceOnly } from '../../../shared/presentation/guards/internal-service.guard.js';
import {
  RecordChatMessageUseCase,
  RecordParticipationUseCase,
  RecordRoomLifecycleUseCase,
  RecordTranscriptSegmentUseCase,
  RemoveChatMessageUseCase,
} from '../application/use-cases/session-recording.use-cases.js';
import {
  ChatMessageDeletedDto,
  ChatMessageDto,
  ParticipantJoinedDto,
  ParticipantLeftDto,
  RoomFinishedDto,
  RoomStartedDto,
  TranscriptSegmentDto,
} from './classroom.dtos.js';

/** Where the video-server reports what happens in a live room. Not reachable with a user session. */
@Controller('internal/classroom/sessions/:sessionId')
@InternalServiceOnly()
export class InternalClassroomController {
  constructor(
    @Inject(RecordRoomLifecycleUseCase) private readonly lifecycle: RecordRoomLifecycleUseCase,
    @Inject(RecordParticipationUseCase) private readonly participation: RecordParticipationUseCase,
    @Inject(RecordChatMessageUseCase) private readonly chat: RecordChatMessageUseCase,
    @Inject(RemoveChatMessageUseCase) private readonly chatRemoval: RemoveChatMessageUseCase,
    @Inject(RecordTranscriptSegmentUseCase) private readonly transcript: RecordTranscriptSegmentUseCase,
  ) {}

  @Post('started')
  @HttpCode(HttpStatus.NO_CONTENT)
  started(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: RoomStartedDto,
  ): Promise<void> {
    return this.lifecycle.started(sessionId, dto.startedAt);
  }

  @Post('finished')
  @HttpCode(HttpStatus.NO_CONTENT)
  finished(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: RoomFinishedDto,
  ): Promise<void> {
    return this.lifecycle.finished(sessionId, dto.endedAt);
  }

  @Post('participants/joined')
  @HttpCode(HttpStatus.NO_CONTENT)
  joined(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ParticipantJoinedDto,
  ): Promise<void> {
    return this.participation.joined({
      sessionId,
      membershipId: dto.membershipId,
      participantSid: dto.participantSid,
      joinedAt: dto.joinedAt,
    });
  }

  @Post('participants/left')
  @HttpCode(HttpStatus.NO_CONTENT)
  left(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ParticipantLeftDto,
  ): Promise<void> {
    return this.participation.left(
      {
        sessionId,
        membershipId: dto.membershipId,
        participantSid: dto.participantSid,
        joinedAt: dto.joinedAt,
      },
      dto.leftAt,
    );
  }

  @Post('chat-messages')
  @HttpCode(HttpStatus.NO_CONTENT)
  chatMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ChatMessageDto,
  ): Promise<void> {
    return this.chat.execute({
      id: dto.id,
      sessionId,
      senderId: dto.senderId,
      content: dto.content,
      sentAt: dto.sentAt,
    });
  }

  @Post('chat-messages/deleted')
  @HttpCode(HttpStatus.NO_CONTENT)
  chatMessageDeleted(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ChatMessageDeletedDto,
  ): Promise<void> {
    return this.chatRemoval.execute({
      id: dto.id,
      sessionId,
      deletedById: dto.deletedById,
      deletedAt: dto.deletedAt,
    });
  }

  @Post('transcript-segments')
  @HttpCode(HttpStatus.NO_CONTENT)
  transcriptSegment(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: TranscriptSegmentDto,
  ): Promise<void> {
    return this.transcript.execute({
      id: dto.id,
      sessionId,
      speakerId: dto.speakerId ?? null,
      text: dto.text,
      language: dto.language ?? null,
      startedAt: dto.startedAt,
      endedAt: dto.endedAt,
    });
  }
}
