# Guardians

## The Need

Parents and legal guardians must be able to follow the Students they answer for: when they have class, how they are doing, whether they attend. Nothing in the platform let them in, and nothing recorded who answers for whom.

## The Goal

The office registers Guardians and links each to their Students; a Guardian then reads the schedule, averages, upcoming evaluations and attendance of those Students, and of nobody else.

## The Reason

- **A link is the only key.** `GuardianLink` ties a Guardian membership to a Student membership of the same institution. Every Guardian query starts from the caller's own links, so a Student who is not linked answers "not found", exactly like one who does not exist.
- **A Guardian sees what the Student sees.** The schedule comes from the scheduling module's use case and the grades from the evaluations module's (`GetMyProgressUseCase`, `ListDueEvaluationsUseCase`), called as that Student. Nothing is computed again, so the two can never disagree, and drafts and other Students' grades stay as hidden as they are from the Student.
- **Guardians are registered like everyone else.** The Institution Admin, Staff and Principals may register the `GUARDIAN` role (`registrableRoles`), and a Guardian shows their ID at the desk like everyone else before their account is active. The desk enrols Students, so it also registers and links the Guardians who come with them.
- **Linking again updates, it does not duplicate.** The link is unique per pair; a second request only changes the relationship.

## The Implementation

- **Office endpoints** (`ADMIN`, `STAFF`, `COORDINATOR`): `GET /guardian-links`, `PUT /guardian-links` (`{ studentMembershipId, guardianMembershipId, relationship }`; `INVALID_GUARDIAN_LINK` unless they are a Student and a Guardian of the institution), `DELETE /guardian-links/:id`.
- **Guardian endpoints** (`GUARDIAN`): `GET /guardian/wards` (linked Students with their active groups) and `GET /guardian/wards/:studentMembershipId` (`WARD_NOT_FOUND` unless linked): `schedule`, `courses` (average and graded weight per subject), `upcoming` (evaluations due in the next 30 days) and `attendance` (counts, the rate by the shared rule in `attendance/domain`, and the latest 10 records).
- **Layers:** `domain/guardian.ts`, ports `GuardianRepository` and `WardAcademics`, `application/use-cases/guardian.use-cases.ts`, adapters `PrismaGuardianRepository` and `ModuleWardAcademics`.
- **Notifications:** a Guardian is told, in the app and by email, when a ward's evaluation is published or graded and when the ward is marked absent or late (see `notifications-and-messaging.md`).
- **Finding who to link:** `GET /members/search?role=&query=` (`ADMIN`, `STAFF`, `COORDINATOR`) returns at most 10 members of the institution holding that role whose name or document number contains every word typed (2 characters at least), with their email and document number. `active=true` leaves out members who cannot be chosen yet (ID not checked yet, or deactivated), for the pickers of the Groups and Availability pages. The rule (`searchTerms`, `MEMBER_SEARCH_LIMIT`) is in `identity/domain/member.ts`.
- **The members table:** `GET /members/page?page=&query=&role=` (`ADMIN`, `STAFF`, `COORDINATOR`) returns 20 members at a time by last name, with the total; `query` matches name, email or document number. `GET /members` (everyone, unpaged) is no longer called by the app.
- **Messaging:** a Guardian may write to the office and to the Teachers who currently teach a ward, and those Teachers to them (`reachOf`, see `notifications-and-messaging.md`).
- **Schema:** `GuardianLink` already existed; no migration.

## Known gaps

- The member search uses `ILIKE '%term%'` on names and document numbers, which no index serves; it is bounded by institution and role and returns 10 rows, and would need trigram indexes for a very large institution.
- Attendance shows the latest 10 records only, and the Guardian cannot justify an absence.
- Links are made one at a time by the office; there is no import, and a Guardian cannot ask to be linked.
- A Student has no say in who is linked to them, and is not told.
- The AI assistant is not offered to Guardians.
