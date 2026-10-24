# Institutional hierarchy & admin pipeline

## The Need

Nobody self-registers. Institutions register their own staff, Teachers and Students, and decide when each one becomes active.

## The Goal

A chain of trust, each level registering only the levels below it: a Platform Admin creates institutions and appoints their first Institution Admin; Institution Admins register Principals (Directivos), Teachers, Staff, Students and Guardians; Staff and Principals enrol Students and Guardians. Whoever registers someone checks their ID in person, which activates them.

## The Reason

- **No public registration.** `POST /auth/register` was removed, and Google sign-in only signs in to an existing account. Accounts exist only because an admin created them.
- **Pending members hold no role.** A registered member gets an inactive `Membership`. Inactive memberships are left out of access tokens, so a pending member can only see that they must bring their ID to the institution. The ID check at the desk activates the membership and the account together (see `onboarding-ocr.md`).
- **Tenant isolation by construction.** `@Roles` fixes the institution from the `x-institution-id` header, and every repository method takes that id as a filter. Another institution's row is reported as "not found".
- **First account from configuration.** With no registration, the first Platform Admin is created on start from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`. It never modifies an existing account.

## The Implementation

| Who | Can |
|---|---|
| Platform Admin (`User.isPlatformAdmin`) | Create, update, deactivate, delete institutions; appoint Institution Admins; act on any institution by naming it in the header, where they may register any role |
| Institution Admin (`Membership` role `ADMIN`) | Register Principals (`COORDINATOR`), Teachers, Staff and Students, but not other Institution Admins; manage subjects, pensums, groups and schedules; check the ID of anyone they register — for their own institution only |
| Staff (`STAFF`) and Principal (`COORDINATOR`) | The enrolment desk of their own institution: list members, register Students and Guardians, check their ID and link them; nothing else |
| Teacher, Student, Guardian | Nothing in the admin API |

- **The hierarchy is one domain rule** (`registrableRoles` / `canRegister` in `shared/domain/auth/registration.ts`, used by identity's `assertCanRegister` and by the desk's ID check); the frontend mirrors it only to decide which roles to offer.

- **Endpoints:** `/institutions`, `/subjects`, `/pensums` (+ `/pensums/:id/subjects/:subjectId`), `/members`, `POST /onboarding/members/:membershipId/document`, `POST /onboarding/members/:membershipId/confirm`.
- **Registering a member** returns a random temporary password once; only its hash is stored, and it must be replaced at first sign-in (see `account-security.md`). Institution Admins are created active; every other role starts `PENDING_ONBOARDING`.
- **One person, several institutions.** Registering an email that already has an account adds a `Membership` to it instead of creating a second account: no temporary password is issued and the name on the account is kept. Identity is verified once per person, so someone already active gets the new role at once, and someone still pending gets it when their ID is checked.
- **The ID check** follows the registration at the desk: the account keeps its registered name until then, and adopts the one confirmed from the ID. There is no review afterwards and nothing to reject: a document that does not match is simply not confirmed.
- **Deleting an institution** is only allowed while it has no members; otherwise deactivate it. Members of an inactive institution lose their roles at their next token refresh.

## Known gaps

- When a pending person was registered by two institutions, the first desk to check their ID activates their roles in both.
- The check reactivates every inactive membership of the person. If deactivating a single membership is added later, it needs its own marker.
- No edit, suspend or remove actions for members.
- A Principal at the desk sees the whole members table, emails included, like Staff.
