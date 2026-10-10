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

- **Endpoints (`/auth`):** `register`, `login`, `refresh`, `logout`, `me`, `google`, `google/callback`.
- **Guards:** `JwtAuthGuard` and `RolesGuard` are global. Use `@Public()` to open a route and `@Roles(Role.TEACHER, ...)` to restrict one.
- **Institution context:** `@Roles` is evaluated against the institution in the `x-institution-id` header. Platform admins bypass role checks.
- **Use cases** are plain classes with no NestJS imports; `identity.module.ts` wires them to adapters by factory.
- **Errors:** adapters throw Domain Exceptions; `DomainExceptionFilter` maps them to `{ statusCode, code, message }`.
- **Google account linking:** matched by Google `sub`, then by verified email. Linking to an account whose email was never verified removes its password, so someone who pre-registered another person's address cannot keep access.

## Known gaps

- Refresh tokens are stateless: no rotation, and logout only clears the cookie. Server-side revocation needs a store (Redis).
- No rate limiting on `login` / `register`.
- No email verification or password reset flow.
