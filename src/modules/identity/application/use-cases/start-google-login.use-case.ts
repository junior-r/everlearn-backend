import { randomBytes } from 'node:crypto';
import type { GoogleOAuthGateway } from '../../domain/ports/google-oauth.gateway.js';

export interface GoogleLoginRedirect {
  url: string;
  state: string;
}

export class StartGoogleLoginUseCase {
  constructor(private readonly google: GoogleOAuthGateway) {}

  /** Returns the Google consent URL and the anti-CSRF state bound to it. */
  execute(): GoogleLoginRedirect {
    const state = randomBytes(32).toString('base64url');
    return { url: this.google.buildAuthorizationUrl(state), state };
  }
}
