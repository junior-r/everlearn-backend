# Notifications, reminders, direct messages and realtime

## The Need

Members must hear about what concerns them (an account made active, a new evaluation, a deadline, a class about to start, a message) without looking for it, and must be able to write to each other outside a class.

## The Goal

One way to tell a person something, in the app and by email; a job that sends reminders on time and never twice; one-to-one messages between members of an institution, delivered live; and a live channel to the browser that both build on.

## The Reason

- **Any module announces through one port, `Notifier`** (`shared/domain/notifications`). It never rejects: a notice that cannot be delivered must not undo the ID check or the publication it announces. Modules name a recipient by account or by membership and never touch notification tables.
- **A notice stores a type and facts, not a sentence.** The browser words it from its dictionaries, in the reader's language. Emails are worded here, in Spanish, because nothing knows the reader's language yet.
- **Idempotence lives in the database, not in the job.** A reminder carries a `dedupeKey`, unique per user, so the job can run as often as wanted, on several servers at once, and after a crash, and each person still gets it once. Only notices really inserted are emailed and pushed.
- **Notices that pile up collapse.** Messages from one sender share a `collapseKey`: while one notice is unread no other is added, and a new one appears once it was read.
- **`@nestjs/schedule`, not a queue.** The job is a query and a batch insert every five minutes; with the dedupe key there is nothing a queue would add yet. It registers only when `REMINDERS_ENABLED` is on, so tests and scripts boot without a timer.
- **Class reminders come from the timetable.** `ClassSession` rows exist only once a Teacher starts a class, so "upcoming classes" are the `ScheduleSlot`s of today, read on the institution's own clock (`Institution.timezone`).
- **Messages are sent over HTTP and delivered over Socket.io.** Sending is a normal request (validated, authorized, rate limited, answered with the stored message); the socket only pushes. Nothing depends on the socket alone: every screen loads its data over HTTP.
- **The socket authenticates in the handshake** with the same access token as HTTP. The global HTTP guards skip websocket events, so the gateway checks for itself, and the only thing a client may say is what conversation it is looking at.
- **A message is between two accounts inside one institution, and only between people who have a reason to talk.** The rule exists to protect Students and is one pure function, `reachOf` (`messaging/domain/messaging-reach.ts`):

  | Who writes | May start a conversation with |
  |---|---|
  | Institution Admin, Principal, Staff | anyone in the institution |
  | Teacher | Students actively enrolled in a group they teach and those Students' Guardians, other Teachers, and the office (Admin, Principal, Staff) |
  | Student | Teachers of a group they are actively enrolled in, and Students of those groups |
  | Guardian | the office, and the Teachers who currently teach a Student linked to them |

  Someone holding several roles gets what any of them allows. The same filter decides the search and the delivery, so a person out of reach cannot be found, written to or opened: all three answer "not found", as for a stranger.
- **Answering is allowed where starting is not.** A Student may reply to the office once the office has written to them, because a conversation one side cannot answer is a broadcast. It opens nothing else: not the other members of the office, and not a Teacher who is not theirs.
- **A conversation that falls out of reach stays readable and closes.** If a Student leaves a group, what was said remains (`canWrite: false`) and sending answers `MESSAGE_NOT_ALLOWED`.
- **Realtime state lives in Redis, not in a server.** With `@socket.io/redis-adapter` an event emitted by one backend reaches browsers connected to another, and "is this user connected / looking at this conversation" is answered by all of them. The gateway keeps nothing in memory.
- **An email about a message never carries its text**, only who wrote.

## The Implementation

- **Schema:** `Notification` (`userId`, `institutionId?`, `type`, `data`, `read`, `dedupeKey?`, `collapseKey?`; unique `(userId, dedupeKey)`) and `DirectMessage` (`institutionId`, `senderId`, `recipientId`, `body`, `readAt?`). Migration `notifications_and_messages`.
- **`notifications` module (global):** `SendNotificationsUseCase` behind `NOTIFIER`; `GET /notifications` (latest 20 and the unread count), `POST /notifications/read` (`{ ids? }`, own notices only); the `EmailProvider` port (`shared/domain/email`, so identity can send too) with two adapters: `ResendEmailProvider` (official `resend` SDK; a refusal reported in its answer becomes a rejection) and `MockEmailProvider`, which logs the recipient and subject, and the body only with `EMAIL_LOG_BODIES=true`.
- **Triggers:** `ConfirmIdentityUseCase` when the desk checks an ID (`WELCOME`); `PublishEvaluationUseCase` on the first publication (`EVALUATION_PUBLISHED`, to the enrolled Students); `RecordGradesUseCase` for each score that is new or changed (`GRADE_POSTED`, to the Student); `SendDirectMessageUseCase` (`DIRECT_MESSAGE`).
- **Guardians are told what concerns their ward:** a published evaluation (`WARD_EVALUATION_PUBLISHED`), a grade (`WARD_GRADE_POSTED`) and an `ABSENT` or `LATE` in a class (`WARD_ATTENDANCE`), whether taken automatically when the room closes (`RecordRoomLifecycleUseCase`) or by hand by the Teacher (`RecordAttendanceByHandUseCase`). Both build the notice with `absenceNotices`, keyed `attendance:<sessionId>:<enrollmentId>:<status>`: the same mark is announced once, a corrected one is news. Every ward notice carries `studentId`, so the browser can open that ward. The module that knows what happened asks with `recipient: { guardiansOf: <Student membership> }`; only `notifications` knows who the Guardians are (`NotificationRepository.guardiansOf`: active Guardian memberships of active accounts), and each gets their own notice and email.
- **A grade is announced once per score.** Saving the gradebook again without touching a score tells nobody; a corrected score is not added while the first notice is still unread (collapse key `grade:<evaluationId>:<enrollmentId>`). Attendance already taken by hand is never announced: `saveAttendance` returns only the marks that stand as automatic.
- **Reminders (`SendRemindersUseCase`, run by `ReminderScheduler`):** published evaluations due within 24 hours (`EVALUATION_DUE`, key `evaluation-due:<id>`), and timetable classes starting within 15 minutes (`CLASS_STARTING`, key `class-starting:<slotId>:<local date>`, to the Teacher and the enrolled Students).
- **`messaging` module:** `GET /messages/contacts?query=`, `GET /messages/conversations`, `GET /messages/conversations/:userId` (latest 50, `?before=` for older; opening marks as read and dismisses the notice), `POST /messages/conversations/:userId` (`{ body }`, at most 2000 characters, 30 per minute per member). Every role, in the `x-institution-id` institution.
- **Who is told about a message:** nobody if the recipient has that conversation open; a notice if they are connected but elsewhere; a notice and an email if they are not connected.
- **Realtime (`shared/infrastructure/realtime`):** `RedisIoAdapter`, set in `main.ts`, with its own publisher and subscriber connections. Socket.io namespace `/realtime`; `auth: { token }`; server events `message` (the message) and `notification` (no payload: fetch again); client event `viewing` (a conversation key or null). Behind the `Realtime` port (`publish`, and the asynchronous `isOnline` and `isViewing`, which ask every server; if they cannot be asked the user counts as away).
- **Email config:** `USE_REAL_EMAIL` (`false`), `RESEND_API_KEY`, `EMAIL_FROM` (a sender on a domain verified with Resend). Switched on without both, the backend starts, warns and logs emails instead. `EMAIL_LOG_BODIES` is for a developer's machine only: bodies carry names and reset links.
- **Config:** `REMINDERS_ENABLED` (on, except under `NODE_ENV=test`), `REMINDERS_CRON` (`*/5 * * * *`), `MESSAGES_MAX_PER_WINDOW` (30), `MESSAGES_WINDOW_SECONDS` (60).

## Known gaps

- **Resend has never been called.** There is no key here; the adapter is tested against a scripted answer. Emails are always in Spanish and plain text, and there is no way to unsubscribe.
- A socket stays open after its access token expires, until it reconnects; the token is checked only at the handshake.
- Nobody is told when an absence is later excused or turned into a presence, nor when a grade is removed.
- A Guardian cannot choose which notices or emails they receive.
- The messaging rule limits who may talk; there is still no blocking, reporting, moderation or retention policy, and messages are stored in clear text. A Guardian cannot write to their own ward, nor to other Guardians.
- "Group mates" means any group both Students are actively enrolled in, whatever its academic period.
- Notices are never deleted, and only the latest 20 are shown.
- Class reminders follow the timetable only: they know nothing of holidays or cancelled classes, and a class within 15 minutes of midnight may be missed.
- The list of conversations is built from a member's latest 500 messages.
- Emails are sent inside the request that causes them, one by one; a slow provider would slow down publishing to a large group.
- Two servers were checked side by side by hand (delivery and presence across them); no automated test starts two.
