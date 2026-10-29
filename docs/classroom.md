# Classroom: live class sessions

## The Need

Teachers give classes by video and Students attend them. The backend must decide who may enter each class and keep what happened in it: who connected and for how long, the chat, and the transcript.

## The Goal

Only the Teacher assigned to a subject and the Students enrolled in its group get into a class, and everything the video-server reports about a live room is stored through Prisma.

## The Reason

- **The backend issues the LiveKit token; the browser never holds the API secret.** The token names one room and one identity (the `Membership.id`), so LiveKit itself enforces what the backend decided.
- **Tokens are signed with `@nestjs/jwt`, not the LiveKit SDK.** A LiveKit token is a plain HS256 JWT (`iss` = API key, `sub` = identity, a `video` claim); signing it ourselves adds no dependency. It sits behind the `VideoTokenIssuer` port.
- **Browsers cannot publish data (`canPublishData: false`).** Chat and captions enter a room only through the video-server, so a participant cannot forge a message from someone else.
- **No browser holds LiveKit's room administration.** The token says who the Teacher is with a signed attribute (`attributes.role`: `TEACHER` or `STUDENT`), which the video-server reads to decide who may moderate. A `roomAdmin` grant would have let the Teacher's browser call LiveKit directly, publishing data included.
- **The labs a Teacher may share are signed too.** The Teacher's token carries `attributes.labs`: the keys of the labs the institution may use, comma separated (`AVAILABLE_LABS`, see `labs.md`); a Student's is empty. The video-server shares a lab with the room only if its key is listed there, so it never has to ask the backend.
- **Internal endpoints are idempotent.** The video-server retries deliveries, so each write is an upsert keyed by what LiveKit or the video-server generated (`participantSid`, message id, segment id).
- **A shared secret, not a user session, protects the internal API** (`InternalServiceOnly`, header `X-Internal-Secret`, compared in constant time). With no secret configured every call is refused.

## The Implementation

- **Member endpoints** (institution from `x-institution-id`):
  - `GET /classroom/courses` (Teacher, Student): the subjects the member teaches or attends, each with `openSessionId` when a class is in progress.
  - `POST /groups/:groupId/courses/:subjectId/sessions` (Teacher): opens a class, or returns the one already open. Only the assigned Teacher (`NOT_COURSE_TEACHER` otherwise).
  - `POST /class-sessions/:sessionId/token` (Teacher, Student): `{ token, roomName, identity, role, subjectName, groupName, startedAt }`; `startedAt` is when the room started (or when the Teacher opened the class, before anyone joined), so every participant's timer counts from the same moment. `NOT_CLASS_PARTICIPANT` (403) for anyone else, `CLASS_SESSION_NOT_FOUND` (404) for another institution's session, `CLASS_SESSION_CLOSED` (409) once it ended.
- **Internal endpoints** (`/internal/classroom/sessions/:sessionId/…`, all `204`): `started`, `finished`, `participants/joined`, `participants/left`, `chat-messages`, `chat-messages/deleted`, `transcript-segments`. An unknown session or member is `404`.
- **A chat message taken down** (`chat-messages/deleted`: `{ id, deletedById, deletedAt }`) stays stored, marked with when and by whom (`ChatMessage.deletedAt`, `deletedById`). The video-server has already checked that it was the author or the Teacher; a message that was never stored is left alone.
- **Ending a class** is not a backend endpoint: the Teacher asks the video-server, the room closes, and the usual `finished` report closes the session and takes attendance.
- **Session lifecycle:** `SCHEDULED` (opened by the Teacher) → `LIVE` (first participant, `started`) → `COMPLETED` (room closed, `finished`, which also closes connections still open). The room is named `class-<sessionId>`.
- **Attendance:** each connection is a `SessionParticipation` row (`joinedAt`, `leftAt`); time in class is the sum of a member's rows. When the room finishes, every Student enrolled in the group gets an automatic `AttendanceRecord` from the share of the class they were connected: above 50% `PRESENT`, above 15% `LATE`, otherwise `ABSENT` (`takeAttendance` in `domain/classroom.ts`). The class runs from `actualStartedAt` to `actualEndedAt`; reconnections add up and overlapping connections count once. A record taken by hand is never overwritten. `peakParticipants` is the most connections open at once.
- **A person with several memberships** in the institution enters with the one that takes part in the class.
- **Config:** `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (without them the token endpoint answers `VIDEO_UNAVAILABLE`), `INTERNAL_SERVICE_SECRET`.

## Attendance by hand

- **`GET` / `PUT /class-sessions/:sessionId/attendance`** (`TEACHER`, and only the Teacher assigned to that course; another institution's session is "not found"). `PUT` takes `{ marks: [{ enrollmentId, status, note? }] }` with `PRESENT`, `LATE`, `ABSENT` or `EXCUSED`, for Students enrolled in the class (`STUDENT_NOT_IN_CLASS` otherwise), and answers with the sheet.
- A mark taken by hand is stored as `MANUAL` with who took it; automatic attendance never overwrites it, and it may be taken while the class is open or after it.
- `ABSENT` and `LATE` tell the Student's Guardians exactly as the automatic ones do (see `notifications-and-messaging.md`).
- Port `AttendanceBook` (`PrismaAttendanceBook`); use cases in `application/use-cases/attendance.use-cases.ts`.
- **`GET /groups/:groupId/courses/:subjectId/sessions`** (same Teacher) lists the course's latest 60 classes, most recent first, each with how many Students have a mark and `endedAt` (when its room closed; null while open and for a class recorded without video), for the Teacher to pick the roll to take and to see how long each class lasted.
- **`POST /groups/:groupId/courses/:subjectId/sessions/held`** `{ startsAt }` records a class given without video: stored `COMPLETED` with no room, so nobody can enter it and the video-server never reports on it. A moment still to come is refused (`CLASS_NOT_HELD_YET`).

## Transcripts of past classes

- **`GET /groups/:groupId/courses/:subjectId/transcripts`** (`TEACHER`, `STUDENT`) lists the course's latest 60 classes that have at least one transcribed line, most recent first, with how many lines each has. **`GET /class-sessions/:sessionId/transcript`** answers `{ sessionId, subjectName, groupName, startsAt, lines: [{ id, speakerName, text, startedAt, endedAt }] }`, in the order said; `speakerName` is null when nobody was named.
- Who reads them is the course rule: the Teacher assigned to it and the Students enrolled in its group (`participantOf`, shared with the room token). Anyone else, here or in another institution, gets "not found" (`COURSE_NOT_FOUND`, `CLASS_SESSION_NOT_FOUND`), so a transcript never reveals that a class took place.
- Read-only, through the `TranscriptArchive` port (`PrismaTranscriptArchive`); use cases in `application/use-cases/transcript.use-cases.ts`. The download is a plain-text file the browser builds from this answer (see `frontend/docs/virtual-classroom.md`), so dates follow the reader's locale.

## Recordings of past classes

- **Need:** a Teacher records a class, and the Teacher and the Students of its group watch it, or download it, afterwards.
- **Goal:** one file per recording with everything seen and heard in the room: every camera and shared screen in LiveKit's speaker layout, every microphone and screen sound mixed in.
- **Reason:** LiveKit Egress (room composite) films the room from a hidden Chrome, so the file is what a participant saw, with nothing to mix ourselves. Egress writes to a spool volume and the backend moves each file into the recording storage behind a port, so where recordings live (this server's disk, Cloudflare R2, AWS S3, MinIO) is a configuration choice: Egress's own uploaders would tie the storage to Egress and leave no place for an access rule.
- **Who records:** the Teacher's room token carries the signed attribute `record=true` when `RECORDINGS_ENABLED=true`; `ClassroomAccess.canRecord` tells the browser. Starting and stopping go to the video-server, never here. LiveKit tells everyone in the room that it is being recorded.
- **Internal endpoint:** `POST /internal/classroom/sessions/:id/recordings` `{ egressId, file, startedAt, endedAt, sizeBytes }` (`204`). `file` is relative to the spool and must be `<session id>/<uuid>.mp4` (`isSpoolFileOf`), or `INVALID_SESSION_EVENT`; the Egress id makes a second delivery harmless.
- **Archiving:** `RecordingArchiveWorker` runs `ArchiveNextRecordingUseCase` every 15 s on every instance: it claims the oldest `PENDING` recording (a conditional update, so two instances never take the same one), copies it from the spool (`RecordingSpool`) to the storage (`RecordingStorage`) as `recordings/<institution>/<session>/<recording>.mp4`, marks it `READY`, deletes the spool copy and tells the Teacher and the enrolled Students (`RECORDING_READY`, in the app only). A failed copy keeps its claim, so it is tried again once the claim lapses (30 min), up to 5 times, then `FAILED`; a file missing from the spool fails at once. `RECORDINGS_ARCHIVE_ENABLED` (on, off under `NODE_ENV=test`) switches the worker.
- **Member endpoints** (`TEACHER`, `STUDENT`; the course rule, `participantOf`, as for transcripts; anyone else gets "not found"): `GET /groups/:groupId/courses/:subjectId/recordings` lists the latest 60 `READY` recordings, most recent first (`{ id, sessionId, startsAt, startedAt, endedAt, sizeBytes }`); `GET /class-recordings/:recordingId/link[?download=true]` answers `{ url, expiresAt }`, a link valid for 6 hours that plays the file, or downloads it as `<subject>-<group>-<date>.mp4`.
- **Storages** (`RECORDINGS_STORAGE`, chosen in `classroom.module.ts`):
  - `local` (default): `LocalDiskRecordingStorage`, under `UPLOADS_DIR`. Its links point to `GET /recordings/media/:token` on `PUBLIC_API_URL`, public because a `<video>` cannot send the session: the token is an HMAC of the key, the download name and the expiry, with a key derived from `JWT_ACCESS_SECRET` for links only. Express serves byte ranges, so the player seeks.
  - `s3`: `S3RecordingStorage`, any S3-compatible bucket (`RECORDINGS_S3_ENDPOINT`, `RECORDINGS_S3_REGION` (`auto`), `RECORDINGS_S3_BUCKET`, `RECORDINGS_S3_ACCESS_KEY_ID`, `RECORDINGS_S3_SECRET_ACCESS_KEY`). Multipart upload in 16 MB parts; links are presigned `GetObject` URLs, so the bucket serves the bytes. For R2 the endpoint is `https://<account id>.r2.cloudflarestorage.com`.
- **Config:** `RECORDINGS_ENABLED` (default `false`), `RECORDINGS_SPOOL_DIR` (the volume Egress writes to), `RECORDINGS_STORAGE`, `PUBLIC_API_URL`.
- Ports in `domain/ports/recording.ports.ts` (`RecordingRepository` → `PrismaRecordingRepository`, `RecordingSpool` → `LocalRecordingSpool`, `RecordingStorage`, `RecordingMediaFiles`); rules in `domain/recording.ts`; use cases in `application/use-cases/recording.use-cases.ts`.

## Known gaps

- A course's list of classes stops at the latest 60; older ones cannot be reopened from the screen.
- Nothing stops a Teacher recording two classes for the same moment, and a recorded class cannot be deleted.
- Sessions are opened by hand and last a nominal 60 minutes; they are not generated from the timetable (`ScheduleSlot`).
- Attendance measures connection time, not when the Student arrived: LATE means "attended part of the class".
- A Teacher who stays alone in the room after the class keeps it open, which lowers every Student's share.
- Two simultaneous "start class" requests for the same subject could open two sessions.
- No endpoint reads a past class's chat history; whoever adds it must leave out messages with `deletedAt`.
- Transcripts are kept with no expiry and hold what Students said as text; there is no retention policy yet, nor a way for a Guardian to read them.
- `speakingSeconds`, `cameraOnSeconds` and `screenShareSeconds` are not filled.
- Recordings are kept forever and cannot be deleted from the app; a deleted session leaves its file in storage. Guardians cannot watch them.
- The S3 adapter is tested only through its port: it has not run against R2 or S3. The local storage has run end to end.
- Egress and the backend must share the spool volume, so they run on the same host.
- Two "record" clicks at the same moment could start two recordings of a class; both are stored.
- A recording that fails before Egress writes any byte is only logged by the video-server: the Teacher sees the badge go away and no recording appears.
