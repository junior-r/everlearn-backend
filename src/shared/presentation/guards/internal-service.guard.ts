import { createHash, timingSafeEqual } from 'node:crypto';
import {
  applyDecorators,
  Inject,
  Injectable,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config.js';
import { Public } from '../decorators/auth.decorators.js';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Admits only our own microservices, which prove themselves with the shared
 * secret in `X-Internal-Secret`. With no secret configured, nothing is admitted.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.internalServiceSecret;
    const header = context.switchToHttp().getRequest<Request>().headers[INTERNAL_SECRET_HEADER];
    // Hashed first so the comparison takes the same time whatever the lengths are
    if (!expected || typeof header !== 'string' || !timingSafeEqual(digest(header), digest(expected))) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/** Marks a controller or route as internal: no user session, only the shared service secret. */
export const InternalServiceOnly = () => applyDecorators(Public(), UseGuards(InternalServiceGuard));
