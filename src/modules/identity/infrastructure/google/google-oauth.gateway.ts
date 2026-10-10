import { Inject, Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import {
  GoogleAuthenticationFailedException,
  GoogleOAuthUnavailableException,
} from '../../domain/exceptions/identity.exceptions.js';
import type {
  GoogleIdentity,
  GoogleOAuthGateway,
} from '../../domain/ports/google-oauth.gateway.js';

const SCOPES = ['openid', 'email', 'profile'];

@Injectable()
export class GoogleAuthLibraryGateway implements GoogleOAuthGateway {
  private readonly logger = new Logger(GoogleAuthLibraryGateway.name);
  private readonly client: OAuth2Client | null;
  private readonly clientId: string | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.clientId = config.google?.clientId ?? null;
    this.client = config.google
      ? new OAuth2Client({
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          redirectUri: config.google.redirectUri,
        })
      : null;
  }

  buildAuthorizationUrl(state: string): string {
    return this.requireClient().generateAuthUrl({
      scope: SCOPES,
      state,
      prompt: 'select_account',
    });
  }

  async exchangeCode(code: string): Promise<GoogleIdentity> {
    const client = this.requireClient();
    try {
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token || !this.clientId) {
        throw new Error('Google did not return an id_token');
      }
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new Error('Google id_token is missing sub or email');
      }
      return {
        subject: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        firstName: payload.given_name ?? payload.name ?? payload.email,
        lastName: payload.family_name ?? '',
        avatarUrl: payload.picture ?? null,
      };
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : String(error));
      throw new GoogleAuthenticationFailedException();
    }
  }

  private requireClient(): OAuth2Client {
    if (!this.client) {
      throw new GoogleOAuthUnavailableException();
    }
    return this.client;
  }
}
