# Identity: Authentication & RBAC

## The Need

Sign-in with email/password and Google, plus a way to protect every endpoint by institution-scoped role.

## The Goal

One security layer that all future modules reuse: routes are private by default and roles are declared with a decorator.

## The Reason

- **Short-lived access JWT + httpOnly refresh cookie.** The access token (15 min) lives only in browser memory; the refresh token (7 days) is unreadable by scripts. Chosen over localStorage tokens, which any XSS can steal.
- **Memberships inside the access token.** Guards check roles without a database query per request. The cost is that a role change takes effect at the next refresh (at most 15 minutes).
- **Google redirect flow handled by the backend** with `google-auth-library`, instead of Passport. One small adapter behind a port, no strategy/session machinery, and no token ever appears in a URL.
- **bcrypt (cost 12)** behind the `PasswordHasher` port, so the algorithm can be swapped without touching use cases.

## The Implementation

- **Endpoints (`/auth`):** `login`, `refresh`, `logout`, `me`, `google`, `google/callback`. There is no public registration; see `institution-admin-pipeline.md`.
- **Guards:** `JwtAuthGuard` and `RolesGuard` are global. Use `@Public()` to open a route and `@Roles(Role.TEACHER, ...)` to restrict one.
- **Institution context:** `@Roles` is evaluated against the institution in the `x-institution-id` header. Platform admins bypass role checks.
- **Use cases** are plain classes with no NestJS imports; `identity.module.ts` wires them to adapters by factory.
- **Errors:** adapters throw Domain Exceptions; `DomainExceptionFilter` maps them to `{ statusCode, code, message }`.
- **Google sign-in** works only for a Google account the user linked from their profile, matched by Google `sub`. It never creates an account or attaches itself by email. See `account-security.md`, which also covers the forced change of temporary passwords.

## Hardening (Redis)

- **Logout revokes the refresh token.** Each refresh token has a unique id (`jti`); logout stores it in a Redis blocklist until the token's own expiry. `refresh` checks the blocklist and fails closed (503) if Redis cannot answer.
- **One refresh token per session.** `refresh` returns a new access token but keeps the same refresh token, so revoking it ends that session. Sessions last 7 days and do not slide.
- **Rate limiting** on `login`: a fixed-window counter in Redis, per client IP and per email, so one account cannot be attacked from many IPs. Returns 429 with `Retry-After`. Fails open if Redis is down.
- **Settings:** `RATE_LIMIT_AUTH_MAX_ATTEMPTS` (default 10) and `RATE_LIMIT_AUTH_WINDOW_SECONDS` (default 60).

## Known gaps

- No "sign out everywhere": revocation is per session.
- Signing in again does not revoke the refresh token the browser already held.
- Rate limiting uses `request.ip`. Behind a reverse proxy, `trust proxy` must be configured or every client shares one counter.
- No email verification, and no reset for a forgotten password.
