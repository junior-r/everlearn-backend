import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
} from '../../domain/auth/access-token-verifier.js';
import { PasswordChangeRequiredException } from '../../domain/auth/authenticated-user.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';
import { ALLOW_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from '../decorators/auth.decorators.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * Global guard: every route requires a valid access token unless marked
 * `@Public()`. A token issued for a temporary password is refused everywhere
 * except on routes marked `@AllowDuringPasswordChange()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Global guards also run for websocket events, which carry no HTTP request:
    // the realtime gateway checks the access token itself when a browser connects
    if (context.getType() !== 'http') {
      return true;
    }
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : null;
    const user = token ? await this.verifier.verifyAccessToken(token) : null;
    if (!user) {
      throw new UnauthorizedException();
    }
    const allowedWhilePending = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_PASSWORD_CHANGE_KEY,
      targets,
    );
    if (user.mustChangePassword && !allowedWhilePending) {
      throw new PasswordChangeRequiredException();
    }
    request.user = user;
    return true;
  }
}
