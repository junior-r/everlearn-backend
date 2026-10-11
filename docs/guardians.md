# Guardians

## The Need

Parents and legal guardians must be able to follow the Students they answer for: when they have class, how they are doing, whether they attend. Nothing in the platform let them in, and nothing recorded who answers for whom.

## The Goal

The office registers Guardians and links each to their Students; a Guardian then reads the schedule, averages, upcoming evaluations and attendance of those Students, and of nobody else.

## The Reason

- **A link is the only key.** `GuardianLink` ties a Guardian membership to a Student membership of the same institution. Every Guardian query starts from the caller's own links, so a Student who is not linked answers "not found", exactly like one who does not exist.
- **A Guardian sees what the Student sees.** The schedule comes from the scheduling module's use case and the grades from the evaluations module's (`GetMyProgressUseCase`, `ListDueEvaluationsUseCase`), called as that Student. Nothing is computed again, so the two can never disagree, and drafts and other Students' grades stay as hidden as they are from the Student.
- **Guardians are registered like everyone else.** The Institution Admin and Staff may register the `GUARDIAN` role (`registrableRoles`), and a Guardian passes the same ID check before their account is active. Staff enrol Students, so they also register and link the Guardians who come with them.
- **Linking again updates, it does not duplicate.** The link is unique per pair; a second request only changes the relationship.

## The Implementation

- **Office endpoints** (`ADMIN`, `STAFF`): `GET /guardian-links`, `PUT /guardian-links` (`{ studentMembershipId, guardianMembershipId, relationship }`; `INVALID_GUARDIAN_LINK` unless they are a Student and a Guardian of the institution), `DELETE /guardian-links/:id`.
- **Guardian endpoints** (`GUARDIAN`): `GET /guardian/wards` (linked Students with their active groups) and `GET /guardian/wards/:studentMembershipId` (`WARD_NOT_FOUND` unless linked): `schedule`, `courses` (average and graded weight per subject), `upcoming` (evaluations due in the next 30 days) and `attendance` (counts, the rate by the shared rule in `attendance/domain`, and the latest 10 records).
- **Layers:** `domain/guardian.ts`, ports `GuardianRepository` and `WardAcademics`, `application/use-cases/guardian.use-cases.ts`, adapters `PrismaGuardianRepository` and `ModuleWardAcademics`.
- **Messaging:** a Guardian may write to the office and to the Teachers who currently teach a ward, and those Teachers to them (`reachOf`, see `notifications-and-messaging.md`).
- **Schema:** `GuardianLink` already existed; no migration.

## Known gaps

- A Guardian gets no notifications about their wards (a new evaluation, a grade, an absence).
- Attendance shows the latest 10 records only, and the Guardian cannot justify an absence.
- Links are made one at a time by the office; there is no import, and a Guardian cannot ask to be linked.
- A Student has no say in who is linked to them, and is not told.
- The AI assistant is not offered to Guardians.
