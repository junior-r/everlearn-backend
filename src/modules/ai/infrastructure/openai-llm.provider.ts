import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AssistantUnavailableException, type ToolCall, type ToolDefinition } from '../domain/assistant.js';
import type { LLMEvent, LLMMessage, LLMProvider, LLMRequest } from '../domain/ports/assistant.ports.js';

type Chunk = OpenAI.Chat.ChatCompletionChunk;
type CreateParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming;
type MessageParam = OpenAI.Chat.ChatCompletionMessageParam;

/** The one call of the SDK this adapter needs, so a test can stand in for the network. */
export type OpenAIChat = (body: CreateParams, options: { signal?: AbortSignal }) => Promise<AsyncIterable<Chunk>>;

export interface OpenAIOptions {
  apiKey: string;
  model: string;
}

/** Longest answer of one turn, so a runaway reply cannot run up the bill. */
const MAX_ANSWER_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 60_000;

const toFunctionTool = (tool: ToolDefinition): OpenAI.Chat.ChatCompletionTool => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
});

function toMessage(message: LLMMessage): MessageParam {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.content };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    case 'assistant':
      return {
        role: 'assistant',
        // OpenAI wants null, not an empty string, beside tool calls
        content: message.content || null,
        ...(message.toolCalls?.length && {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
          })),
        }),
      };
  }
}

/** The arguments the model wrote, or null when they are not JSON: the tool then refuses them. */
function parsed(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

/** Builds the call from the SDK's client. Retries are left to the member, who sees the error at once. */
export function openAIChat(apiKey: string): OpenAIChat {
  const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  return (body, options) => client.chat.completions.create(body, options);
}

/**
 * OpenAI's Chat Completions as an `LLMProvider`: our tools become its function
 * tools, and its stream becomes our text and tool-call events. A tool call
 * arrives in fragments, so it is announced once the turn is complete.
 */
export class OpenAILLMProvider implements LLMProvider {
  private readonly logger = new Logger(OpenAILLMProvider.name);

  constructor(
    private readonly chat: OpenAIChat,
    private readonly model: string,
  ) {}

  async *stream(request: LLMRequest): AsyncGenerator<LLMEvent> {
    // TODO: Implement PII Scrubber middleware before sending data to LLM
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    try {
      const chunks = await this.chat(
        {
          model: this.model,
          stream: true,
          max_completion_tokens: MAX_ANSWER_TOKENS,
          messages: [{ role: 'system', content: request.system }, ...request.messages.map(toMessage)],
          // An empty `tools` array is rejected; leaving it out is how a written answer is forced
          ...(request.tools.length > 0 && { tools: request.tools.map(toFunctionTool) }),
        },
        { signal: request.signal },
      );
      for await (const chunk of chunks) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { type: 'text', delta: delta.content };
        }
        for (const fragment of delta?.tool_calls ?? []) {
          const call = calls.get(fragment.index) ?? { id: '', name: '', arguments: '' };
          call.id ||= fragment.id ?? '';
          call.name += fragment.function?.name ?? '';
          call.arguments += fragment.function?.arguments ?? '';
          calls.set(fragment.index, call);
        }
      }
    } catch (error) {
      if (request.signal?.aborted) {
        return;
      }
      // The provider's message may name the key or the account; it is logged, never sent to the member
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw new AssistantUnavailableException();
    }
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
      const toolCall: ToolCall = { id: call.id, name: call.name, input: parsed(call.arguments) };
      yield { type: 'tool_call', call: toolCall };
    }
  }
}
