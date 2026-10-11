# Notifications, reminders, direct messages and realtime

## The Need

Members must hear about what concerns them (an approved account, a new evaluation, a deadline, a class about to start, a message) without looking for it, and must be able to write to each other outside a class.

## The Goal

One way to tell a person something, in the app and by email; a job that sends reminders on time and never twice; one-to-one messages between members of an institution, delivered live; and a live channel to the browser that both build on.

## The Reason

- **Any module announces through one port, `Notifier`** (`shared/domain/notifications`). It never rejects: a notice that cannot be delivered must not undo the approval or the publication it announces. Modules name a recipient by account or by membership and never touch notification tables.
- **A notice stores a type and facts, not a sentence.** The browser words it from its dictionaries, in the reader's language. Emails are worded here, in Spanish, because nothing knows the reader's language yet.
- **Idempotence lives in the database, not in the job.** A reminder carries a `dedupeKey`, unique per user, so the job can run as often as wanted, on several servers at once, and after a crash, and each person still gets it once. Only notices really inserted are emailed and pushed.
- **Notices that pile up collapse.** Messages from one sender share a `collapseKey`: while one notice is unread no other is added, and a new one appears once it was read.
- **`@nestjs/schedule`, not a queue.** The job is a query and a batch insert every five minutes; with the dedupe key there is nothing a queue would add yet. It registers only when `REMINDERS_ENABLED` is on, so tests and scripts boot without a timer.
- **Class reminders come from the timetable.** `ClassSession` rows exist only once a Teacher starts a class, so "upcoming classes" are the `ScheduleSlot`s of today, read on the institution's own clock (`Institution.timezone`).
- **Messages are sent over HTTP and delivered over Socket.io.** Sending is a normal request (validated, authorized, rate limited, answered with the stored message); the socket only pushes. Nothing depends on the socket alone: every screen loads its data over HTTP.
- **The socket authenticates in the handshake** with the same access token as HTTP. The global HTTP guards skip websocket events, so the gateway checks for itself, and the only thing a client may say is what conversation it is looking at.
- **A message is between two accounts inside one institution.** Both must be active members of it; a stranger, someone of another institution and oneself all look like "not found".
- **An email about a message never carries its text**, only who wrote.

## The Implementation

- **Schema:** `Notification` (`userId`, `institutionId?`, `type`, `data`, `read`, `dedupeKey?`, `collapseKey?`; unique `(userId, dedupeKey)`) and `DirectMessage` (`institutionId`, `senderId`, `recipientId`, `body`, `readAt?`). Migration `notifications_and_messages`.
- **`notifications` module (global):** `SendNotificationsUseCase` behind `NOTIFIER`; `GET /notifications` (latest 20 and the unread count), `POST /notifications/read` (`{ ids? }`, own notices only); `EmailProvider` port with `MockEmailProvider`, which logs the recipient and subject, never the body.
- **Triggers:** `ReviewApplicationUseCase` on approval (`WELCOME`); `PublishEvaluationUseCase` on the first publication (`EVALUATION_PUBLISHED`, to the enrolled Students); `SendDirectMessageUseCase` (`DIRECT_MESSAGE`).
- **Reminders (`SendRemindersUseCase`, run by `ReminderScheduler`):** published evaluations due within 24 hours (`EVALUATION_DUE`, key `evaluation-due:<id>`), and timetable classes starting within 15 minutes (`CLASS_STARTING`, key `class-starting:<slotId>:<local date>`, to the Teacher and the enrolled Students).
- **`messaging` module:** `GET /messages/contacts?query=`, `GET /messages/conversations`, `GET /messages/conversations/:userId` (latest 50, `?before=` for older; opening marks as read and dismisses the notice), `POST /messages/conversations/:userId` (`{ body }`, at most 2000 characters, 30 per minute per member). Every role, in the `x-institution-id` institution.
- **Who is told about a message:** nobody if the recipient has that conversation open; a notice if they are connected but elsewhere; a notice and an email if they are not connected.
- **Realtime (`shared/infrastructure/realtime`):** Socket.io namespace `/realtime`; `auth: { token }`; server events `message` (the message) and `notification` (no payload: fetch again); client event `viewing` (a conversation key or null). Behind the `Realtime` port (`publish`, `isOnline`, `isViewing`).
- **Config:** `REMINDERS_ENABLED` (on, except under `NODE_ENV=test`), `REMINDERS_CRON` (`*/5 * * * *`), `MESSAGES_MAX_PER_WINDOW` (30), `MESSAGES_WINDOW_SECONDS` (60).

## Known gaps

- **No email is really sent.** Only the mock exists; a real provider is one adapter of `EmailProvider`. Emails are always in Spanish and there is no way to unsubscribe.
- **Presence is kept in the memory of one server.** With several backend instances a recipient connected to another one counts as offline (they get an extra notice and email) and is not pushed the message until they reload. That needs the Socket.io Redis adapter before scaling out.
- A socket stays open after its access token expires, until it reconnects; the token is checked only at the handshake.
- Any member may write to any other member of the institution, Students included. There is no blocking, reporting, moderation or retention policy, and messages are stored in clear text.
- Notices are never deleted, and only the latest 20 are shown.
- Class reminders follow the timetable only: they know nothing of holidays or cancelled classes, and a class within 15 minutes of midnight may be missed.
- The list of conversations is built from a member's latest 500 messages.
- Emails are sent inside the request that causes them, one by one; a slow provider would slow down publishing to a large group.
