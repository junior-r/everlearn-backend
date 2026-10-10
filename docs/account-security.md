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
