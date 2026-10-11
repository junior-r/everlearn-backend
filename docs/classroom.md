# Classroom: live class sessions

## The Need

Teachers give classes by video and Students attend them. The backend must decide who may enter each class and keep what happened in it: who connected and for how long, the chat, and the transcript.

## The Goal

Only the Teacher assigned to a subject and the Students enrolled in its group get into a class, and everything the video-server reports about a live room is stored through Prisma.

## The Reason

- **The backend issues the LiveKit token; the browser never holds the API secret.** The token names one room and one identity (the `Membership.id`), so LiveKit itself enforces what the backend decided.
- **Tokens are signed with `@nestjs/jwt`, not the LiveKit SDK.** A LiveKit token is a plain HS256 JWT (`iss` = API key, `sub` = identity, a `video` claim); signing it ourselves adds no dependency. It sits behind the `VideoTokenIssuer` port.
- **Browsers cannot publish data (`canPublishData: false`).** Chat and captions enter a room only through the video-server, so a participant cannot forge a message from someone else.
- **Internal endpoints are idempotent.** The video-server retries deliveries, so each write is an upsert keyed by what LiveKit or the video-server generated (`participantSid`, message id, segment id).
- **A shared secret, not a user session, protects the internal API** (`InternalServiceOnly`, header `X-Internal-Secret`, compared in constant time). With no secret configured every call is refused.

## The Implementation

- **Member endpoints** (institution from `x-institution-id`):
  - `GET /classroom/courses` (Teacher, Student): the subjects the member teaches or attends, each with `openSessionId` when a class is in progress.
  - `POST /groups/:groupId/courses/:subjectId/sessions` (Teacher): opens a class, or returns the one already open. Only the assigned Teacher (`NOT_COURSE_TEACHER` otherwise).
  - `POST /class-sessions/:sessionId/token` (Teacher, Student): `{ token, roomName, identity, role, subjectName, groupName }`. `NOT_CLASS_PARTICIPANT` (403) for anyone else, `CLASS_SESSION_NOT_FOUND` (404) for another institution's session, `CLASS_SESSION_CLOSED` (409) once it ended.
- **Internal endpoints** (`/internal/classroom/sessions/:sessionId/…`, all `204`): `started`, `finished`, `participants/joined`, `participants/left`, `chat-messages`, `transcript-segments`. An unknown session or member is `404`.
- **Session lifecycle:** `SCHEDULED` (opened by the Teacher) → `LIVE` (first participant, `started`) → `COMPLETED` (room closed, `finished`, which also closes connections still open). The room is named `class-<sessionId>`.
- **Attendance:** each connection is a `SessionParticipation` row (`joinedAt`, `leftAt`); time in class is the sum of a member's rows. A Student who connects gets an automatic `PRESENT` `AttendanceRecord`, never overwriting one that already exists. `peakParticipants` is the most connections open at once.
- **A person with several memberships** in the institution enters with the one that takes part in the class.
- **Config:** `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (without them the token endpoint answers `VIDEO_UNAVAILABLE`), `INTERNAL_SERVICE_SECRET`.

## Known gaps

- Sessions are opened by hand and last a nominal 60 minutes; they are not generated from the timetable (`ScheduleSlot`).
- Automatic attendance is only "connected at least once": no lateness, no minimum time.
- Two simultaneous "start class" requests for the same subject could open two sessions.
- No endpoints yet to read a session's attendance, chat history or transcript.
- `speakingSeconds`, `cameraOnSeconds` and `screenShareSeconds` are not filled.
