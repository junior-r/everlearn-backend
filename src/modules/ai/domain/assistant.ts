import type { MembershipClaim } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import { DomainException } from '../../../shared/domain/domain.exception.js';

/** How much of a conversation one request may carry. */
export const MAX_MESSAGES = 30;
export const MAX_MESSAGE_LENGTH = 4000;
/** How many times the model may ask for data before it must answer. */
export const MAX_TOOL_ROUNDS = 4;

/** One turn of the conversation as the member sees it. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Who is talking to the assistant, and in which institution. */
export interface AssistantActor {
  userId: string;
  institutionId: string;
  isPlatformAdmin: boolean;
  memberships: MembershipClaim[];
}

/** What the member is to the institution, as far as the assistant's data access goes. */
export const Audience = { ADMIN: 'ADMIN', STUDENT: 'STUDENT' } as const;
export type Audience = (typeof Audience)[keyof typeof Audience];

/** A tool as the model sees it. `parameters` is a JSON Schema, as MCP and the provider SDKs expect. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** What a tool hands back to the model. A refusal is data too: the model explains it to the member. */
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

/** What the member receives while the assistant answers. */
export type AssistantEvent =
  | { type: 'text'; delta: string }
  /** The assistant is looking something up. */
  | { type: 'tool'; name: string };

export const membershipIdsOf = (actor: AssistantActor, role: Role): string[] =>
  actor.memberships
    .filter((membership) => membership.institutionId === actor.institutionId && membership.role === role)
    .map((membership) => membership.id);

/** The data a member may reach through the assistant. Roles without an entry get conversation only. */
export function audiencesOf(actor: AssistantActor): Set<Audience> {
  const audiences = new Set<Audience>();
  if (actor.isPlatformAdmin || membershipIdsOf(actor, Role.ADMIN).length > 0) {
    audiences.add(Audience.ADMIN);
  }
  if (membershipIdsOf(actor, Role.STUDENT).length > 0) {
    audiences.add(Audience.STUDENT);
  }
  return audiences;
}

export class InvalidConversationException extends DomainException {
  constructor(message: string) {
    super('VALIDATION', 'INVALID_CONVERSATION', message);
  }
}

export class AssistantBusyException extends DomainException {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'ASSISTANT_BUSY', 'Too many questions in a short time. Try again in a moment');
  }
}

export class AssistantUnavailableException extends DomainException {
  constructor() {
    super('UNAVAILABLE', 'ASSISTANT_UNAVAILABLE', 'The assistant is not available right now');
  }
}
