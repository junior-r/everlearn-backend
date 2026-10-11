# Scheduling: teacher availability & group timetables

## The Need

Institution Admins must say when each Teacher can teach, and place every class of a group in the week without double-booking anyone.

## The Goal

A weekly timetable that is valid by construction: a class is only stored if the group is free, the Teacher is free, and the Teacher is available at that time.

## The Reason

- **Rules in the domain, not in SQL.** `findPlacementConflict` (`domain/schedule.ts`) is a pure function over time ranges, so every rule is unit-tested without a database.
- **Minutes from midnight.** A range is `{ dayOfWeek, startMinute, endMinute }` with an exclusive end, so back-to-back classes (08:00–09:00, 09:00–10:00) do not overlap and no time-zone arithmetic is involved.
- **A Redis lock per teacher and per group** (`ScheduleLock`). Two admins scheduling at once would both pass the checks and both write; the lock makes check-then-write atomic. If the lock is taken the request fails with `SCHEDULE_BUSY` instead of waiting.
- **Availability is replaced as a whole.** The grid UI sends the full week; touching windows are merged, so the stored rows are the minimal set.

## The Implementation

- **Endpoints (Institution Admin only, institution from `x-institution-id`):**
  - `GET` / `PUT /teachers/:teacherId/availability` (`periodId`, `windows[]`); `teacherId` is the Teacher's `Membership.id`.
  - `GET` / `POST /groups/:groupId/schedule` (`subjectId`, `dayOfWeek`, `startMinute`, `endMinute`, `room?`), `DELETE /groups/:groupId/schedule/:slotId`.
- **Conflict order and codes (409):** `GROUP_SCHEDULE_CONFLICT` → `TEACHER_SCHEDULE_CONFLICT` → `OUTSIDE_TEACHER_AVAILABILITY`. A subject with no Teacher cannot be scheduled (`COURSE_HAS_NO_TEACHER`).
- **A Teacher with no availability set is available at no time.** Availability is per academic period.
- **Guards against invalidating a timetable:** availability cannot be reduced below the Teacher's existing classes (`AVAILABILITY_CONFLICTS_WITH_SCHEDULE`), and a subject's Teacher cannot be changed while it has classes (`COURSE_HAS_SCHEDULE`); remove the classes first.
- **Frontend:** `features/scheduling/edit-availability` (toggle grid) and `features/scheduling/build-schedule` (click a free hour, fill the form; a conflict keeps the form open with the translated reason). Grid helpers live in `entities/schedule`.

## Known gaps

- Teacher conflicts are checked per `Membership`, so a person teaching in two institutions is not cross-checked.
- The grids show Monday–Saturday, 06:00–20:00, in whole hours; the API accepts any minute and Sunday.
- Rooms are free text and are not checked for double-booking.
- No automatic timetable generation, and classes cannot be moved, only removed and re-created.
