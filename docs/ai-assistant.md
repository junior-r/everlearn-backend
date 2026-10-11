# AI assistant

## The Need

Members want to ask the platform questions in their own words ("how are my grades going?", "how many hours of Matemática were taught in October?") instead of finding the right screen.

## The Goal

`POST /ai/chat` answers a conversation with a language model that can look up the platform's data through tools, and can only reach what the member asking is allowed to see.

## The Reason

- **Tool calling, with tools described the MCP way.** Each tool is a name, a description and a JSON Schema for its input, which is what MCP and the provider SDKs (Anthropic, OpenAI) all take. The model asks for a tool; our code runs it. We did not stand up an MCP server: the tools are in-process and only this endpoint uses them. Exposing the same tools over MCP later is an adapter, not a redesign.
- **The role chooses the tools; the tool decides access from the actor, never from the model's input.** A model can be talked into asking for anything, so what it writes is treated like a request body from a stranger. `getAcademicHistory` ignores any `studentId` that is not the caller's own, and a tool the caller's role does not include is refused by name even if the model asks for it.
- **A Student's data is read through the evaluations module** (`GetMyProgressUseCase`), so the assistant sees exactly what "Mis notas" shows: published evaluations, own grades, and averages computed by the one rule.
- **Context is injected, not guessed.** The prompt lists the ids the tools accept (the institution's subjects for an admin; the Student's published evaluations and own id), so "Matemática" can become a `subjectId` without another round trip.
- **`LLMProvider` is a port that streams.** The use case only knows "one turn in, text and tool requests out". `MockLLMProvider` implements it with keyword rules so the whole pipeline (tools, streaming, UI) runs without a key or a cost.
- **Server-Sent Events over the POST response.** The browser reads the answer as it is written with `fetch`; no WebSocket or extra connection.
- **The conversation is not stored.** The browser sends the history with each question. Nothing about a chat is written to PostgreSQL.
- **Per-member limit.** An answer costs money with a real model, so each member gets `AI_CHAT_MAX_QUESTIONS` per `AI_CHAT_WINDOW_SECONDS` (20 per 60 s). Like every rate limit here, it fails open without Redis.

## The Implementation

- **Endpoint:** `POST /ai/chat` with `{ messages: [{ role: 'user' | 'assistant', content }] }`, at most 30 messages of 4000 characters, the last one from the user. Roles `ADMIN`, `COORDINATOR`, `TEACHER`, `STAFF`, `STUDENT` in the `x-institution-id` institution (a Platform Admin inside an institution passes).
  - Refused before answering: ordinary JSON errors (`400 INVALID_CONVERSATION`, `403`, `429 ASSISTANT_BUSY` with `Retry-After`).
  - Otherwise `200 text/event-stream`, each event `data: <json>`: `{type:'text',delta}`, `{type:'tool',name}` (a lookup started), then `{type:'done'}` or `{type:'error',code}`.
- **Who gets what** (`audiencesOf` in `domain/assistant.ts`):

  | Member | Tools | Context in the prompt |
  |---|---|---|
  | Institution Admin, Platform Admin inside an institution | `getTeacherHours(subjectId, month)` | subjects of the institution |
  | Student | `getAcademicHistory(studentId?)`, `getEvaluationContext(evaluationId)` | own id, published evaluations of their courses |
  | Principal, Teacher, Staff | none | none: conversation only |

- **`getTeacherHours`** returns, per Teacher of the subject, `scheduledHours` (their timetable slots counted over the days of the month inside the group's academic period) and `taughtHours` (completed class sessions that started in the month, by their real start and end). The maths is pure: `domain/teacher-hours.ts`.
- **Loop** (`ChatWithAssistantUseCase`): stream a turn; if the model asked for tools, run them, append the results and stream again, up to `MAX_TOOL_ROUNDS` (4); the last round offers no tools so the model must answer. A bad tool input comes back to the model as `{ ok: false, error }`, not as a failure.
- **Layers:** `domain/` (actor, audiences, tool contracts, hours maths, ports `LLMProvider`, `TeachingRecords`, `AcademicRecords`), `application/` (use case, tools, `systemPrompt`), `infrastructure/` (`MockLLMProvider`, `PrismaTeachingRecords`, `EvaluationsAcademicRecords`), `presentation/` (`AiController`, DTOs).
- **Adding a real model:** write an adapter of `LLMProvider` (map `LLMMessage` and `ToolDefinition` to the SDK's shapes, translate its stream into `text` / `tool_call` events, turn its errors into `AssistantUnavailableException`), add its name to `LLM_PROVIDERS` in `config/app-config.ts`, and return it from the `switch` in `ai.module.ts`. Nothing else changes.
- **Config:** `LLM_PROVIDER` (`mock`; anything else fails at start), `AI_CHAT_MAX_QUESTIONS`, `AI_CHAT_WINDOW_SECONDS`.

## Known gaps

- Only the mock exists. It matches keywords, always answers in Spanish, and has never been compared with a real model's behaviour; the prompt in `assistant-prompt.ts` is untested against one.
- Teachers, Principals and Staff have no tools yet; Guardians have no assistant.
- `getTeacherHours` counts in UTC: a class around midnight on the last day of a month may fall in the neighbouring month, and holidays are not known to the timetable.
- Tool results contain text written by members (titles, feedback). The tools are read-only and scoped to the caller, so injected text cannot widen access, but it could still steer what a real model says to that caller.
- The `assistant` turns of the history come from the browser and are not verified.
- A question is counted against the limit even if the model then fails.
