import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  AttendanceStatus,
  MAX_ATTENDANCE_NOTE_LENGTH,
  MAX_CHAT_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
} from '../domain/classroom.js';

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

export class ChatMessageDeletedDto {
  @IsUUID()
  id: string;

  @IsUUID()
  deletedById: string;

  @Type(() => Date)
  @IsDate()
  deletedAt: Date;
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

export class AttendanceMarkDto {
  @IsUUID()
  enrollmentId: string;

  @IsIn(Object.values(AttendanceStatus))
  status: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ATTENDANCE_NOTE_LENGTH)
  note?: string;
}

export class RecordHeldClassDto {
  @Type(() => Date)
  @IsDate()
  startsAt: Date;
}

export class RecordAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttendanceMarkDto)
  marks: AttendanceMarkDto[];
}
