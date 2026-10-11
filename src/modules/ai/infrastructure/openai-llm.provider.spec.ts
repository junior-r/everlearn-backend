import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import {
  InMemoryAcademicRecords,
  InMemoryTeachingRecords,
} from '../../../../test/support/ai.fakes.js';
import { InMemoryRateLimiter } from '../../../../test/support/identity.fakes.js';
import { Role } from '../../../shared/domain/auth/role.js';
import { AcademicHistoryTool } from '../application/tools/assistant-tools.js';
import { ChatWithAssistantUseCase } from '../application/use-cases/chat-with-assistant.use-case.js';
import { AssistantUnavailableException, type AssistantEvent, type ToolDefinition } from '../domain/assistant.js';
import type { LLMEvent, LLMRequest } from '../domain/ports/assistant.ports.js';
import { OpenAILLMProvider, type OpenAIChat } from './openai-llm.provider.js';

type Chunk = OpenAI.Chat.ChatCompletionChunk;
type Delta = Chunk['choices'][number]['delta'];
type Body = Parameters<OpenAIChat>[0];

const chunk = (delta: Delta, finish: Chunk['choices'][number]['finish_reason'] = null): Chunk => ({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'gpt-4o-mini',
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const words = (...parts: string[]) => parts.map((content) => chunk({ content }));
/** A tool call as OpenAI streams it: the id and name first, the arguments in pieces. */
const toolCall = (index: number, id: string, name: string, ...argumentPieces: string[]) => [
  chunk({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] }),
  ...argumentPieces.map((piece) => chunk({ tool_calls: [{ index, function: { arguments: piece } }] })),
];

/** Stands in for the network: answers each call with the next scripted stream and records what was sent. */
function fakeOpenAI(turns: Array<Chunk[] | Error>) {
  const bodies: Body[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const chat: OpenAIChat = (body, options) => {
    // A copy: the conversation keeps growing after it is sent
    bodies.push(structuredClone(body));
    signals.push(options.signal);
    const turn = turns[bodies.length - 1] ?? [];
    if (turn instanceof Error) {
      return Promise.reject(turn);
    }
    return Promise.resolve(
      (async function* () {
        await Promise.resolve();
        yield* turn;
      })(),
    );
  };
  return { chat, bodies, signals };
}

const HISTORY_TOOL: ToolDefinition = {
  name: 'getAcademicHistory',
  description: "The current Student's grades",
  parameters: { type: 'object', properties: { studentId: { type: 'string' } }, additionalProperties: false },
};

async function collect(provider: OpenAILLMProvider, request: Partial<LLMRequest> = {}) {
  const events: LLMEvent[] = [];
  for await (const event of provider.stream({
    system: 'You are the assistant.',
    messages: [{ role: 'user', content: 'Hola' }],
    tools: [],
    ...request,
  })) {
    events.push(event);
  }
  return events;
}

describe('OpenAILLMProvider', () => {
  it('sends the prompt, the conversation and our tools as function tools', async () => {
    const { chat, bodies } = fakeOpenAI([words('Hola')]);

    await collect(new OpenAILLMProvider(chat, 'gpt-4o-mini'), {
      tools: [HISTORY_TOOL],
      messages: [
        { role: 'user', content: '¿Cómo van mis notas?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'getAcademicHistory', input: { studentId: 's1' } }] },
        { role: 'tool', toolCallId: 'call_1', name: 'getAcademicHistory', content: '{"ok":true,"data":{"courses":[]}}' },
        { role: 'assistant', content: 'No tienes materias.' },
        { role: 'user', content: 'Gracias' },
      ],
    });

    expect(bodies[0]).toMatchObject({ model: 'gpt-4o-mini', stream: true, max_completion_tokens: 1024 });
    expect(bodies[0].tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'getAcademicHistory',
          description: "The current Student's grades",
          parameters: HISTORY_TOOL.parameters,
        },
      },
    ]);
    expect(bodies[0].messages).toEqual([
      { role: 'system', content: 'You are the assistant.' },
      { role: 'user', content: '¿Cómo van mis notas?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'getAcademicHistory', arguments: '{"studentId":"s1"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true,"data":{"courses":[]}}' },
      { role: 'assistant', content: 'No tienes materias.' },
      { role: 'user', content: 'Gracias' },
    ]);
  });

  it('leaves the tools out when none are offered, which forces a written answer', async () => {
    const { chat, bodies } = fakeOpenAI([words('Hola')]);

    await collect(new OpenAILLMProvider(chat, 'gpt-4o-mini'));

    expect(bodies[0]).not.toHaveProperty('tools');
  });

  it('passes the text on as it arrives', async () => {
    const { chat } = fakeOpenAI([[...words('Hola, ', '¿en qué ', 'te ayudo?'), chunk({}, 'stop')]]);

    expect(await collect(new OpenAILLMProvider(chat, 'gpt-4o-mini'))).toEqual([
      { type: 'text', delta: 'Hola, ' },
      { type: 'text', delta: '¿en qué ' },
      { type: 'text', delta: 'te ayudo?' },
    ]);
  });

  it('puts together tool calls that arrive in fragments, several at once, in their order', async () => {
    const first = toolCall(0, 'call_a', 'getEvaluationContext', '{"evalua', 'tionId":"e1"}');
    const second = toolCall(1, 'call_b', 'getAcademicHistory');
    // Interleaved, as parallel tool calls are streamed
    const { chat } = fakeOpenAI([[first[0], second[0], first[1], first[2], chunk({}, 'tool_calls')]]);

    expect(await collect(new OpenAILLMProvider(chat, 'gpt-4o-mini'), { tools: [HISTORY_TOOL] })).toEqual([
      { type: 'tool_call', call: { id: 'call_a', name: 'getEvaluationContext', input: { evaluationId: 'e1' } } },
      { type: 'tool_call', call: { id: 'call_b', name: 'getAcademicHistory', input: {} } },
    ]);
  });

  it('hands a tool arguments that are not JSON as null, for the tool to refuse', async () => {
    const { chat } = fakeOpenAI([toolCall(0, 'call_a', 'getAcademicHistory', '{"studentId": ')]);

    expect(await collect(new OpenAILLMProvider(chat, 'gpt-4o-mini'))).toEqual([
      { type: 'tool_call', call: { id: 'call_a', name: 'getAcademicHistory', input: null } },
    ]);
  });

  it('reports any failure of OpenAI as the assistant being unavailable, without its details', async () => {
    const refused = fakeOpenAI([new Error('401 Incorrect API key provided: sk-secret')]);
    const broken: OpenAIChat = () =>
      Promise.resolve(
        (async function* () {
          yield chunk({ content: 'Ho' });
          await Promise.resolve();
          throw new Error('socket hang up');
        })(),
      );

    const atStart = await collect(new OpenAILLMProvider(refused.chat, 'gpt-4o-mini')).catch((error: unknown) => error);
    const midway = await collect(new OpenAILLMProvider(broken, 'gpt-4o-mini')).catch((error: unknown) => error);

    expect(atStart).toBeInstanceOf(AssistantUnavailableException);
    expect((atStart as Error).message).not.toContain('sk-secret');
    expect(midway).toBeInstanceOf(AssistantUnavailableException);
  });

  it('passes the abort signal to the request, and ends quietly when it was aborted', async () => {
    const gone = new AbortController();
    const { chat, signals } = fakeOpenAI([new Error('Request was aborted.')]);
    gone.abort();

    const events = await collect(new OpenAILLMProvider(chat, 'gpt-4o-mini'), { signal: gone.signal });

    expect(signals[0]).toBe(gone.signal);
    expect(events).toEqual([]);
  });
});

describe('OpenAILLMProvider inside the chat use case', () => {
  it('runs the tool OpenAI asks for and sends the result back for the final answer', async () => {
    const grace = randomUUID();
    const { chat, bodies } = fakeOpenAI([
      [...toolCall(0, 'call_1', 'getAcademicHistory', '{}'), chunk({}, 'tool_calls')],
      [...words('Vas ', 'bien: 75%.'), chunk({}, 'stop')],
    ]);
    const records = new InMemoryAcademicRecords();
    records.courses.set(grace, [
      {
        groupName: '1ro A',
        subject: { id: randomUUID(), code: 'MAT', name: 'Matemática' },
        teacher: null,
        average: 75,
        gradedWeight: 60,
        evaluations: [],
      },
    ]);
    const teaching = new InMemoryTeachingRecords();
    const useCase = new ChatWithAssistantUseCase(
      new OpenAILLMProvider(chat, 'gpt-4o-mini'),
      [new AcademicHistoryTool(records)],
      teaching,
      records,
      new InMemoryRateLimiter(),
      { maxQuestions: 20, windowSeconds: 60 },
    );

    const events: AssistantEvent[] = [];
    const actor = {
      userId: 'user-grace',
      institutionId: 'institution-a',
      isPlatformAdmin: false,
      memberships: [{ id: grace, institutionId: 'institution-a', role: Role.STUDENT }],
    };
    for await (const event of await useCase.execute(actor, [{ role: 'user', content: '¿Cómo van mis notas?' }])) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'tool', name: 'getAcademicHistory' },
      { type: 'text', delta: 'Vas ' },
      { type: 'text', delta: 'bien: 75%.' },
    ]);
    // The second request carries OpenAI's own tool call and our answer to it
    expect(bodies).toHaveLength(2);
    const [, , assistant, tool] = bodies[1].messages;
    expect(assistant).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'getAcademicHistory', arguments: '{}' } }],
    });
    expect(tool).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    expect(JSON.parse((tool as { content: string }).content)).toMatchObject({
      ok: true,
      data: { courses: [{ subject: 'Matemática', averagePercent: 75 }] },
    });
  });
});
