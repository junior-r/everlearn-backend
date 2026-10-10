import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../../../config/app-config.js';

const REFRESH_COOKIE = 'everlearn_refresh';
const OAUTH_STATE_COOKIE = 'everlearn_oauth_state';
const GOOGLE_LINK_COOKIE = 'everlearn_google_link';
const OAUTH_TTL_MS = 10 * 60 * 1000;
const OAUTH_PATH = '/auth/google';

function baseOptions(config: AppConfig, path: string): CookieOptions {
  return { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path };
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : undefined;
}

/** Reads and writes the auth cookies. All are httpOnly and scoped under `/auth`. */
export class AuthCookies {
  constructor(private readonly config: AppConfig) {}

  readRefreshToken(request: Request): string | undefined {
    return readCookie(request, REFRESH_COOKIE);
  }

  setRefreshToken(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      ...baseOptions(this.config, '/auth'),
      maxAge: this.config.jwt.refreshTtlSeconds * 1000,
    });
  }

  clearRefreshToken(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, baseOptions(this.config, '/auth'));
  }

  readOAuthState(request: Request): string | undefined {
    return readCookie(request, OAUTH_STATE_COOKIE);
  }

  /** Starting a sign-in cancels any pending link attempt, so the callback cannot confuse the two. */
  setOAuthState(response: Response, state: string): void {
    this.clearOAuthCookies(response);
    response.cookie(OAUTH_STATE_COOKIE, state, {
      ...baseOptions(this.config, OAUTH_PATH),
      maxAge: OAUTH_TTL_MS,
    });
  }

  readGoogleLinkTicket(request: Request): string | undefined {
    return readCookie(request, GOOGLE_LINK_COOKIE);
  }

  setGoogleLinkTicket(response: Response, ticket: string): void {
    this.clearOAuthCookies(response);
    response.cookie(GOOGLE_LINK_COOKIE, ticket, {
      ...baseOptions(this.config, OAUTH_PATH),
      maxAge: OAUTH_TTL_MS,
    });
  }

  clearOAuthCookies(response: Response): void {
    const options = baseOptions(this.config, OAUTH_PATH);
    response.clearCookie(OAUTH_STATE_COOKIE, options);
    response.clearCookie(GOOGLE_LINK_COOKIE, options);
  }
}
