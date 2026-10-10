import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../../../config/app-config.js';

const REFRESH_COOKIE = 'everlearn_refresh';
const OAUTH_STATE_COOKIE = 'everlearn_oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function baseOptions(config: AppConfig, path: string): CookieOptions {
  return { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path };
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : undefined;
}

/** Reads and writes the auth cookies. Both are httpOnly and scoped to `/auth`. */
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

  setOAuthState(response: Response, state: string): void {
    response.cookie(OAUTH_STATE_COOKIE, state, {
      ...baseOptions(this.config, '/auth/google'),
      maxAge: OAUTH_STATE_TTL_MS,
    });
  }

  clearOAuthState(response: Response): void {
    response.clearCookie(OAUTH_STATE_COOKIE, baseOptions(this.config, '/auth/google'));
  }
}
