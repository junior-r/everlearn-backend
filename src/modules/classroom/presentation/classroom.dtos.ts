import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MAX_CHAT_LENGTH, MAX_TRANSCRIPT_LENGTH } from '../domain/classroom.js';

export class RoomStartedDto {
  @Type(() => Date)
  @IsDate()
  startedAt: Date;
}

export class RoomFinishedDto {
  @Type(() => Date)
  @IsDate()
  endedAt: Date;
}

export class ParticipantJoinedDto {
  @IsUUID()
  membershipId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  participantSid: string;

  @Type(() => Date)
  @IsDate()
  joinedAt: Date;
}

export class ParticipantLeftDto extends ParticipantJoinedDto {
  @Type(() => Date)
  @IsDate()
  leftAt: Date;
}

export class ChatMessageDto {
  @IsUUID()
  id: string;

  @IsUUID()
  senderId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHAT_LENGTH)
  content: string;

  @Type(() => Date)
  @IsDate()
  sentAt: Date;
}

export class TranscriptSegmentDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsUUID()
  speakerId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TRANSCRIPT_LENGTH)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  @Type(() => Date)
  @IsDate()
  startedAt: Date;

  @Type(() => Date)
  @IsDate()
  endedAt: Date;
}
