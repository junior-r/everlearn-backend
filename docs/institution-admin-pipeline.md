# Institutional hierarchy & admin pipeline

## The Need

Nobody self-registers. Institutions register their own Teachers and Students, and decide when each one becomes active.

## The Goal

A chain of trust: a Platform Admin creates institutions and appoints their Institution Admins; Institution Admins register members and approve them after an ID check.

## The Reason

- **No public registration.** `POST /auth/register` was removed, and Google sign-in only signs in to an existing account. Accounts exist only because an admin created them.
- **Pending members hold no role.** A registered Teacher or Student gets an inactive `Membership`. Inactive memberships are left out of access tokens, so a pending member can only reach onboarding. Approval activates the membership and the account together.
- **Tenant isolation by construction.** `@Roles` fixes the institution from the `x-institution-id` header, and every repository method takes that id as a filter. Another institution's row is reported as "not found".
- **First account from configuration.** With no registration, the first Platform Admin is created on start from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`. It never modifies an existing account.

## The Implementation

| Who | Can |
|---|---|
| Platform Admin (`User.isPlatformAdmin`) | Create, update, deactivate, delete institutions; appoint Institution Admins; act on any institution by naming it in the header |
| Institution Admin (`Membership` role `ADMIN`) | Register Teachers and Students; manage subjects and pensums; review onboarding applications — for their own institution only |
| Teacher, Student | Nothing in the admin API |

- **Endpoints:** `/institutions`, `/subjects`, `/pensums` (+ `/pensums/:id/subjects/:subjectId`), `/members`, `GET /onboarding/applications/pending`, `POST /onboarding/application/:id/review`, `GET /onboarding/application/:id/document`.
- **Registering a member** returns a random temporary password once; only its hash is stored. Institution Admins are created active; Teachers and Students start `PENDING_ONBOARDING`.
- **Review** shows three things side by side: the account as the admin registered it, what the OCR read, and what the member confirmed. The account keeps its registered name until approval, then adopts the confirmed one.
- **Rejecting** requires a reason, which the member sees. Their retry is a new application; the rejected one is kept as history.
- **Deleting an institution** is only allowed while it has no members; otherwise deactivate it. Members of an inactive institution lose their roles at their next token refresh.

## Known gaps

- The temporary password is not forced to change at first sign-in, and there is no password change or reset flow yet. Until then the admin who registered a member knows their password.
- A person can belong to only one institution: registering an email that already has an account is refused.
- No edit, suspend or remove actions for members.
- Coordinators and Guardians cannot be registered yet.
