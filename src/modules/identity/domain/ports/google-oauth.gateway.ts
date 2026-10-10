export const GOOGLE_OAUTH_GATEWAY = Symbol('GoogleOAuthGateway');

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

export interface GoogleOAuthGateway {
  buildAuthorizationUrl(state: string): string;
  /** Exchanges an authorization code for the verified Google identity. */
  exchangeCode(code: string): Promise<GoogleIdentity>;
}
