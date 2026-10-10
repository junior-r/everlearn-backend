import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import type { AccessTokenVerifier } from '../../../../shared/domain/auth/access-token-verifier.js';
import type {
  AuthenticatedUser,
  MembershipClaim,
} from '../../../../shared/domain/auth/authenticated-user.js';
import type { RefreshTokenClaims, TokenIssuer } from '../../domain/ports/token-issuer.js';

const ALGORITHM = 'HS256';

interface AccessTokenPayload {
  sub: string;
  typ: 'access';
  email: string;
  isPlatformAdmin: boolean;
  memberships: MembershipClaim[];
}

interface RefreshTokenPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
  exp: number;
}

/** Signs and verifies both token kinds; each kind has its own secret. */
@Injectable()
export class JwtTokenService implements TokenIssuer, AccessTokenVerifier {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  issueAccessToken(user: AuthenticatedUser): Promise<string> {
    const payload: Omit<AccessTokenPayload, 'sub'> = {
      typ: 'access',
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
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

  async verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwt.accessSecret,
        algorithms: [ALGORITHM],
      });
      if (payload.typ !== 'access') {
        return null;
      }
      return {
        userId: payload.sub,
        email: payload.email,
        isPlatformAdmin: payload.isPlatformAdmin,
        memberships: payload.memberships,
      };
    } catch {
      return null;
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.jwt.refreshSecret,
        algorithms: [ALGORITHM],
      });
      if (payload.typ !== 'refresh' || !payload.jti) {
        return null;
      }
      return {
        userId: payload.sub,
        tokenId: payload.jti,
        expiresAt: new Date(payload.exp * 1000),
      };
    } catch {
      return null;
    }
  }
}
