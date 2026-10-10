import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../domain/auth/role.js';
import { INSTITUTION_HEADER, type AuthenticatedRequest } from '../authenticated-request.js';
import { ROLES_KEY } from '../decorators/auth.decorators.js';

/** Global guard enforcing `@Roles(...)` against the caller's memberships. Runs after JwtAuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException();
    }
    const institutionId = request.headers[INSTITUTION_HEADER];
    const membership =
      typeof institutionId === 'string'
        ? user.memberships.find(
            (candidate) =>
              candidate.institutionId === institutionId && required.includes(candidate.role),
          )
        : undefined;
    if (!membership && !user.isPlatformAdmin) {
      throw new ForbiddenException();
    }
    request.membership = membership;
    return true;
  }
}
