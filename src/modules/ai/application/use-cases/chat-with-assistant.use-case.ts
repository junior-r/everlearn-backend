import { Role } from '../../../../shared/domain/auth/role.js';
import type { RateLimiter } from '../../../../shared/domain/rate-limit/rate-limiter.js';
import {
  AssistantBusyException,
  Audience,
  audiencesOf,
  InvalidConversationException,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  MAX_TOOL_ROUNDS,
  membershipIdsOf,
  type AssistantActor,
  type AssistantEvent,
  type ChatMessage,
  type ToolCall,
  type ToolResult,
} from '../../domain/assistant.js';
import type {
  AcademicRecords,
  LLMMessage,
  LLMProvider,
  TeachingRecords,
} from '../../domain/ports/assistant.ports.js';
import { systemPrompt, type PromptContext } from '../assistant-prompt.js';
import type { AssistantTool } from '../tools/assistant-tools.js';

export interface ChatLimits {
  /** Questions one member may ask per window. */
  maxQuestions: number;
  windowSeconds: number;
}

/** Returns the conversation cleaned up, or refuses one the assistant cannot answer. */
function checked(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new InvalidConversationException(`A conversation has between 1 and ${MAX_MESSAGES} messages`);
  }
  const cleaned = messages.map(({ role, content }) => ({ role, content: content.trim() }));
  if (cleaned.some(({ content }) => !content || content.length > MAX_MESSAGE_LENGTH)) {
    throw new InvalidConversationException(`A message has between 1 and ${MAX_MESSAGE_LENGTH} characters`);
  }
  if (cleaned[cleaned.length - 1].role !== 'user') {
    throw new InvalidConversationException('The last message must be a question from the member');
  }
  return cleaned;
}

export class ChatWithAssistantUseCase {
  constructor(
    private readonly llm: LLMProvider,
    private readonly tools: AssistantTool[],
    private readonly teaching: TeachingRecords,
    private readonly records: AcademicRecords,
    private readonly limiter: RateLimiter,
    private readonly limits: ChatLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Answers the last message of a conversation. Resolves once the request is
   * accepted; the answer then arrives as a stream. The member's role decides
   * which tools the model gets, and each tool reads only what that member may see.
   */
  async execute(
    actor: AssistantActor,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<AsyncIterable<AssistantEvent>> {
    const conversation = checked(messages);
    await this.countQuestion(actor);
    const audiences = audiencesOf(actor);
    const tools = this.tools.filter((tool) => audiences.has(tool.audience));
    const system = systemPrompt(await this.context(actor, audiences));
    return this.answer(actor, system, conversation, tools, signal);
  }

  private async countQuestion(actor: AssistantActor): Promise<void> {
    const { maxQuestions, windowSeconds } = this.limits;
    const decision = await this.limiter
      .consume(`ai-chat:user:${actor.userId}`, maxQuestions, windowSeconds)
      // Fail open: without Redis the assistant keeps answering
      .catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
    if (!decision.allowed) {
      throw new AssistantBusyException(decision.retryAfterSeconds);
    }
  }

  private async context(actor: AssistantActor, audiences: Set<Audience>): Promise<PromptContext> {
    const studentIds = membershipIdsOf(actor, Role.STUDENT);
    const [subjects, teacherCourses, courses] = await Promise.all([
      audiences.has(Audience.ADMIN) ? this.teaching.listSubjects(actor.institutionId) : undefined,
      audiences.has(Audience.TEACHER)
        ? this.teaching.coursesTaughtBy(actor.institutionId, membershipIdsOf(actor, Role.TEACHER))
        : undefined,
      audiences.has(Audience.STUDENT) ? this.records.coursesOf(actor.institutionId, studentIds) : undefined,
    ]);
    return {
      today: this.now(),
      subjects,
      teacherCourses,
      student: courses && { membershipIds: studentIds, courses },
    };
  }

  private async *answer(
    actor: AssistantActor,
    system: string,
    conversation: ChatMessage[],
    tools: AssistantTool[],
    signal?: AbortSignal,
  ): AsyncGenerator<AssistantEvent> {
    const messages: LLMMessage[] = [...conversation];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      // The last round offers no tools, so the model has to answer with what it has
      const offered = round < MAX_TOOL_ROUNDS ? tools.map((tool) => tool.definition) : [];
      const calls: ToolCall[] = [];
      let text = '';
      for await (const event of this.llm.stream({ system, messages, tools: offered, signal })) {
        if (event.type === 'text') {
          text += event.delta;
          yield event;
        } else {
          calls.push(event.call);
        }
      }
      if (calls.length === 0) {
        return;
      }
      messages.push({ role: 'assistant', content: text, toolCalls: calls });
      for (const call of calls) {
        if (signal?.aborted) {
          return;
        }
        yield { type: 'tool', name: call.name };
        const result = await this.run(actor, tools, call);
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result) });
      }
    }
  }

  /** Runs a tool the member's role includes; any other name is refused, whatever the model asked for. */
  private async run(actor: AssistantActor, tools: AssistantTool[], call: ToolCall): Promise<ToolResult> {
    const tool = tools.find((candidate) => candidate.definition.name === call.name);
    return tool ? tool.run(actor, call.input) : { ok: false, error: `Unknown tool ${call.name}` };
  }
}
