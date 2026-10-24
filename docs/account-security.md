# Account security: forced password change & Google linking

## The Need

An admin who registers a member sees their temporary password. That password must not stay valid, and Google sign-in must only work for accounts whose owner asked for it.

## The Goal

A new member chooses their own password before anything else opens. Google sign-in is something an active member turns on from their profile, not something an email match grants.

## The Reason

- **The restriction lives in the access token.** `User.mustChangePassword` becomes a claim, and the global `JwtAuthGuard` refuses every route for such a token except those marked `@AllowDuringPasswordChange()`. A per-route check could be forgotten on a new endpoint; this cannot.
- **Explicit linking instead of matching by email.** Earlier, a Google sign-in attached itself to the account with the same email. Now only an existing `OAuthAccount` row signs in, so controlling an email address at Google is not enough to enter someone's account.
- **The link is bound to the user by a signed ticket.** Starting a link needs the access token, but Google's redirect back cannot carry it. The backend therefore puts a short-lived signed ticket (user id + OAuth state) in an httpOnly cookie. A cookie the user forged themselves fails the signature check, so nobody can link their Google account to another user.

## The Implementation

- **Flag:** set when an admin registers a new account; cleared by `POST /auth/change-password`. The Platform Admin created from configuration is not flagged.
- **`POST /auth/change-password`** re-checks the current password and rejects reusing it. It then behaves like a reset: every access and refresh token issued before it is refused (`RefreshTokenRevocations.revokeAllFor`), and the owner gets the "your password was changed" email (`passwordChangedEmail`, shared with the reset). The caller receives a new session, access token and refresh cookie, issued after the cut-off, so the device the change was made on stays signed in and every other one is signed out. An email that cannot be sent does not undo the change.
- **`POST /auth/google/link`** (active accounts with their own password only) returns Google's consent URL and sets the ticket cookie.
- **`GET /auth/google/callback`** serves both flows. With a ticket cookie it links and redirects to `/settings?google=linked`; otherwise it signs in.
- **Unlinked Google sign-in** is refused with `GOOGLE_ACCOUNT_NOT_LINKED`.
- **Frontend:** `SessionRouting` sends a flagged session to `/change-password` from any page.

## Known gaps

- Changing the password does not end the user's other sessions.
- No password reset for a forgotten password, and no way to unlink Google.
- An account whose password was removed cannot set a new one from settings.

## Password reset

- **The Need:** a member who forgot their password had no way back in without an admin.
- **The Goal:** `POST /auth/forgot-password` emails a link; `POST /auth/reset-password` sets a new password with it. Both are public and rate limited like sign-in.
- **The Reason:**
  - **The answer never says whether an account exists.** `forgot-password` always returns 204, and the token and the email are produced after the response is on its way, so timing says nothing either. A suspended account gets no email.
  - **The token is random, single-use and short-lived.** 32 random bytes, valid 15 minutes, stored in Redis as a hash (reading Redis does not hand out working links), read and deleted in one step so it cannot be spent twice. Asking again cancels the previous link.
  - **The token travels after `#`** (`/es/reset-password#token=…`): that part of an address is never sent to a server, so it stays out of access logs and referrers.
  - **A reset closes every session, at once.** Refresh tokens and access tokens issued before the reset are both refused (`RefreshTokenRevocations.revokeAllFor`, checked by `JwtTokenService` on every request): whoever asks for a reset may be locking someone else out, and must not have to wait fifteen minutes for it.
  - **The owner is told.** A "your password was changed" email goes out after a successful reset; if it cannot be sent the reset still stands.
  - **Fails closed.** Without Redis no token is issued or accepted.
- **The Implementation:** `RequestPasswordResetUseCase`, `ResetPasswordUseCase` (`identity/application/use-cases/password-reset.use-cases.ts`), the `PasswordResetTokens` port with `RedisPasswordResetTokens`, the shared `EmailProvider`. A reset also ends a forced password change. `forgot-password` accepts `locale` (`es` | `en`) for the screen the link opens; the email itself is in Spanish.
- **Known gaps:** every authenticated request now reads Redis once, and is refused while Redis is down (security checks fail closed); a session opened in the same second as the reset survives it; a realtime socket already connected stays open until it reconnects; the same one-second window applies to a change from Profile Settings.

## Bot check on the public forms

- **The Need:** sign-in and "forgot password" are the only forms anyone can post to without an account, so scripts can hammer them (password guessing, reset-email floods from rotating addresses).
- **The Goal:** those two routes only accept a request from a browser that solved a Cloudflare Turnstile challenge.
- **The Reason:**
  - **Turnstile** is free, has no image puzzles for people, and keeps no tracking cookies; the domain already sits on Cloudflare.
  - **A guard, not use-case code.** `@RequireHumanCheck('<action>')` with `HumanCheckGuard`, beside `@RateLimit`: the rule is about the transport, not the business. The rate limit runs first, so refused floods never reach Cloudflare.
  - **The token is bound to its form.** The widget declares the route's action (`login`, `forgot-password`); a token solved for another form fails. Tokens are single-use, so the browser gets a fresh challenge after every failed attempt.
  - **Fails open when Cloudflare cannot answer** (timeout, 5xx, `internal-error`): like the rate limit still guarding these routes, an outage elsewhere must not lock the school out. A missing, reused or forged token is always refused (`403 HUMAN_CHECK_FAILED`).
- **The Implementation:** the `HumanCheck` port (`shared/domain/human-check`), `TurnstileHumanCheck` calling Siteverify (5 s timeout) and `DisabledHumanCheck`, chosen in `HumanCheckModule` from `TURNSTILE_SECRET_KEY` (unset: off, with a warning in production). The browser sends the token in `X-Human-Check`. `reset-password` needs none: its single-use emailed token already proves the request.
- **Known gaps:** the Google sign-in redirect is not checked (Google runs its own); authenticated forms rely on the session and the rate limits.
