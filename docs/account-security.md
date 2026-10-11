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
- **`POST /auth/change-password`** re-checks the current password, rejects reusing it, and returns a new access token without the restriction. The old token stays restricted until it expires.
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
  - **A reset closes every session.** Refresh tokens issued before the reset are refused (`RefreshTokenRevocations.revokeAllFor`): whoever asks for a reset may be locking someone else out.
  - **Fails closed.** Without Redis no token is issued or accepted.
- **The Implementation:** `RequestPasswordResetUseCase`, `ResetPasswordUseCase` (`identity/application/use-cases/password-reset.use-cases.ts`), the `PasswordResetTokens` port with `RedisPasswordResetTokens`, the shared `EmailProvider`. A reset also ends a forced password change. `forgot-password` accepts `locale` (`es` | `en`) for the screen the link opens; the email itself is in Spanish.
- **Known gaps:** an access token already issued stays valid until it expires (15 minutes at most); a session opened in the same second as the reset survives it; nothing tells the member by email that their password was changed.
