import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsIn, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES } from '../domain/assistant.js';

export class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  content: string;
}

/** The conversation so far, oldest first; the last message is the question to answer. */
export class ChatDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];
}
