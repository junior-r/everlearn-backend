import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import type { AccessTokenVerifier } from '../../../../shared/domain/auth/access-token-verifier.js';
import type {
  AuthenticatedUser,
  MembershipClaim,
} from '../../../../shared/domain/auth/authenticated-user.js';
import {
  REFRESH_TOKEN_REVOCATIONS,
  type RefreshTokenRevocations,
} from '../../domain/ports/refresh-token-revocations.js';
import type {
  GoogleLinkTicket,
  RefreshTokenClaims,
  TokenIssuer,
} from '../../domain/ports/token-issuer.js';

const ALGORITHM = 'HS256';
const GOOGLE_LINK_TTL_SECONDS = 600;

interface AccessTokenPayload {
  sub: string;
  typ: 'access';
  email: string;
  isPlatformAdmin: boolean;
  // Present only while the account has a temporary password
  mustChangePassword?: true;
  memberships: MembershipClaim[];
  iat: number;
}

interface RefreshTokenPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
  iat: number;
  exp: number;
}

interface GoogleLinkPayload {
  sub: string;
  typ: 'google-link';
  state: string;
}

/**
 * Signs and verifies every token kind. Access and refresh tokens have their own
 * secrets; each payload also carries its kind, so one can never pass for another.
 */
@Injectable()
export class JwtTokenService implements TokenIssuer, AccessTokenVerifier {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REFRESH_TOKEN_REVOCATIONS) private readonly revocations: RefreshTokenRevocations,
  ) {}

  issueAccessToken(user: AuthenticatedUser): Promise<string> {
    const payload: Omit<AccessTokenPayload, 'sub' | 'iat'> = {
      typ: 'access',
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
      ...(user.mustChangePassword ? { mustChangePassword: true } : {}),
      memberships: user.memberships,
    };
    return this.jwt.signAsync(payload, {
      subject: user.userId,
      secret: this.config.jwt.accessSecret,
      expiresIn: this.config.jwt.accessTtlSeconds,
      algorithm: ALGORITHM,
    });
  }

  issueRefreshToken(userId: string): Promise<string> {
    const payload: Pick<RefreshTokenPayload, 'typ'> = { typ: 'refresh' };
    return this.jwt.signAsync(payload, {
      subject: userId,
      jwtid: randomUUID(),
      secret: this.config.jwt.refreshSecret,
      expiresIn: this.config.jwt.refreshTtlSeconds,
      algorithm: ALGORITHM,
    });
  }

  issueGoogleLinkTicket(ticket: GoogleLinkTicket): Promise<string> {
    const payload: Omit<GoogleLinkPayload, 'sub'> = { typ: 'google-link', state: ticket.state };
    return this.jwt.signAsync(payload, {
      subject: ticket.userId,
      secret: this.config.jwt.accessSecret,
      expiresIn: GOOGLE_LINK_TTL_SECONDS,
      algorithm: ALGORITHM,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    const payload = await this.verify<AccessTokenPayload>(token, this.config.jwt.accessSecret);
    if (payload?.typ !== 'access') {
      return null;
    }
    // A password reset ends every session opened before it, the access tokens already out included
    if (await this.revocations.isRevokedFor(payload.sub, new Date(payload.iat * 1000))) {
      return null;
    }
    return {
      userId: payload.sub,
      email: payload.email,
      isPlatformAdmin: payload.isPlatformAdmin,
      mustChangePassword: payload.mustChangePassword === true,
      memberships: payload.memberships,
    };
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims | null> {
    const payload = await this.verify<RefreshTokenPayload>(token, this.config.jwt.refreshSecret);
    if (payload?.typ !== 'refresh' || !payload.jti) {
      return null;
    }
    return {
      userId: payload.sub,
      tokenId: payload.jti,
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
    };
  }

  async verifyGoogleLinkTicket(token: string): Promise<GoogleLinkTicket | null> {
    const payload = await this.verify<GoogleLinkPayload>(token, this.config.jwt.accessSecret);
    if (payload?.typ !== 'google-link' || !payload.state) {
      return null;
    }
    return { userId: payload.sub, state: payload.state };
  }

  private async verify<Payload extends object>(
    token: string,
    secret: string,
  ): Promise<Payload | null> {
    try {
      return await this.jwt.verifyAsync<Payload>(token, { secret, algorithms: [ALGORITHM] });
    } catch {
      return null;
    }
  }
}
