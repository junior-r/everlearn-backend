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
- **`LLMProvider` is a port that streams.** The use case only knows "one turn in, text and tool requests out", and owns the loop that runs the tools the model asks for and sends the results back. `OpenAILLMProvider` (official `openai` SDK, Chat Completions, `gpt-4o-mini`) and `MockLLMProvider` (keyword rules, no key, no cost) both implement it, so the tool loop is the same code with either.
- **The real model is opt-in and falls back.** `USE_REAL_AI=true` with an `OPENAI_API_KEY` selects OpenAI; anything else runs the mock. Switched on without a key, the backend still starts, logs a warning and uses the mock.
- **A Teacher's access is checked twice.** The tool only accepts a course or group among those assigned to the caller, and the averages are then read through the gradebook use case, which refuses anyone but the course's Teacher on its own.
- **An abandoned answer is cancelled.** When the browser closes the connection the request's `AbortSignal` fires: the model call is aborted and no further tool runs, so nobody pays for text nobody reads.
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
  | Teacher | `getCourseAverages(courseId)`, `getGroupAttendanceRisk(groupId)` | the courses and groups assigned to them |
  | Student | `getAcademicHistory(studentId?)`, `getEvaluationContext(evaluationId)` | own id, published evaluations of their courses |
  | Principal, Staff | none | none: conversation only |

- **`getTeacherHours`** returns, per Teacher of the subject, `scheduledHours` (their timetable slots counted over the days of the month inside the group's academic period) and `taughtHours` (completed class sessions that started in the month, by their real start and end). The maths is pure: `domain/teacher-hours.ts`.
- **`getCourseAverages`** returns each Student's average and graded weight in one course, plus the class average (mean of the Students who have one). A course of a colleague, or of another institution, is "Course not found".
- **`getGroupAttendanceRisk`** returns the Students below 70% attendance (`attendanceRisk` in `domain/class-standing.ts`), counting only the classes of the caller's own courses in that group. Late counts as attended; excused absences are left out; a Student with nothing counted is reported apart, not as at risk. A group the caller does not teach is "Group not found".
- **Loop** (`ChatWithAssistantUseCase`): stream a turn; if the model asked for tools, run them, append the results and stream again, up to `MAX_TOOL_ROUNDS` (4); the last round offers no tools so the model must answer. A bad tool input comes back to the model as `{ ok: false, error }`, not as a failure.
- **Layers:** `domain/` (actor, audiences, tool contracts, hours maths, ports `LLMProvider`, `TeachingRecords`, `AcademicRecords`), `application/` (use case, tools, `systemPrompt`), `infrastructure/` (`OpenAILLMProvider`, `MockLLMProvider`, `PrismaTeachingRecords`, `EvaluationsAcademicRecords`, `EvaluationsCourseGrades`), `presentation/` (`AiController`, DTOs).
- **OpenAI mapping** (`infrastructure/openai-llm.provider.ts`): each tool becomes `{ type: 'function', function: { name, description, parameters } }`; our `assistant` turn with tool calls becomes `tool_calls` (arguments as a JSON string) and each result a `tool` message with its `tool_call_id`. Streamed tool calls arrive in fragments keyed by `index` and are announced once the turn ends; arguments that are not JSON reach the tool as `null`, which it refuses. Any SDK error becomes `ASSISTANT_UNAVAILABLE`; its message is logged, never sent to the member. One turn is capped at 1024 output tokens, 60 s and one retry.
- **Another provider** is another adapter of `LLMProvider`, chosen in `ai.module.ts`.
- **Config:** `USE_REAL_AI` (`false`), `OPENAI_API_KEY`, `OPENAI_MODEL` (`gpt-4o-mini`), `AI_CHAT_MAX_QUESTIONS`, `AI_CHAT_WINDOW_SECONDS`.
- **Tests:** the adapter is tested against a scripted stream in place of the network (`openai-llm.provider.spec.ts`), including a full tool round trip through the use case. HTTP tests close the app with `ctx.close()`, which drops open connections first; `ai.e2e-spec.ts` covers a client hanging up mid-answer and the app closing with a stream open. `pnpm test:e2e` keeps the full output of the last run in `test-results/http-suite.log`, and of the last failed run in `http-suite.failed.log`.

## Known gaps

- **OpenAI has never been called.** There is no key here: the adapter is verified against the SDK's types and a scripted stream, not the real API, and the prompt in `assistant-prompt.ts` has not been tried on a real model.
- The mock matches keywords and always answers in Spanish.
- Principals and Staff have no tools yet; Guardians have no assistant.
- With a real model, what members type and the data the tools return (names, grades, feedback) is sent to OpenAI. Whether that is acceptable for Students' data is a decision for the institution, not the code.
- Attendance risk needs attendance records; automatic ones exist only for classes held in the virtual classroom.
- `getTeacherHours` counts in UTC: a class around midnight on the last day of a month may fall in the neighbouring month, and holidays are not known to the timetable.
- Tool results contain text written by members (titles, feedback). The tools are read-only and scoped to the caller, so injected text cannot widen access, but it could still steer what a real model says to that caller.
- The `assistant` turns of the history come from the browser and are not verified.
- A question is counted against the limit even if the model then fails.
