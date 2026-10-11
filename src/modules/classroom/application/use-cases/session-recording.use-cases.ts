import {
  InvalidSessionEventException,
  MAX_CHAT_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
  takeAttendance,
  type ChatMessage,
  type Participation,
  type TranscriptSegment,
} from '../../domain/classroom.js';
import type { SessionRecorder } from '../../domain/ports/classroom.ports.js';

/** Trims reported text and refuses it when nothing is left or it is too long. */
function cleanText(value: string, maxLength: number, label: string): string {
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new InvalidSessionEventException(`${label} must have between 1 and ${maxLength} characters`);
  }
  return text;
}

export class RecordRoomLifecycleUseCase {
  constructor(private readonly recorder: SessionRecorder) {}

  /** The room opened: the class is live. */
  started(sessionId: string, at: Date): Promise<void> {
    return this.recorder.start(sessionId, at);
  }

  /** The room closed: the class is over, nobody is connected any more and attendance is taken. */
  async finished(sessionId: string, at: Date): Promise<void> {
    await this.recorder.finish(sessionId, at);
    const rollCall = await this.recorder.rollCall(sessionId);
    if (rollCall) {
      await this.recorder.saveAttendance(sessionId, takeAttendance(rollCall));
    }
  }
}

export class RecordParticipationUseCase {
  constructor(private readonly recorder: SessionRecorder) {}

  joined(participation: Participation): Promise<void> {
    return this.recorder.join(participation);
  }

  async left(participation: Participation, leftAt: Date): Promise<void> {
    if (leftAt.getTime() < participation.joinedAt.getTime()) {
      throw new InvalidSessionEventException('A participant cannot leave before joining');
    }
    await this.recorder.leave(participation, leftAt);
  }
}

export class RecordChatMessageUseCase {
  constructor(private readonly recorder: SessionRecorder) {}

  async execute(message: ChatMessage): Promise<void> {
    await this.recorder.addChatMessage({
      ...message,
      content: cleanText(message.content, MAX_CHAT_LENGTH, 'A chat message'),
    });
  }
}

export class RecordTranscriptSegmentUseCase {
  constructor(private readonly recorder: SessionRecorder) {}

  async execute(segment: TranscriptSegment): Promise<void> {
    if (segment.endedAt.getTime() < segment.startedAt.getTime()) {
      throw new InvalidSessionEventException('A transcript segment cannot end before it starts');
    }
    await this.recorder.addTranscriptSegment({
      ...segment,
      text: cleanText(segment.text, MAX_TRANSCRIPT_LENGTH, 'A transcript segment'),
    });
  }
}
