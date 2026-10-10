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
import { PLATFORM_ADMIN_KEY, ROLES_KEY } from '../decorators/auth.decorators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard enforcing `@PlatformAdminOnly()` and `@Roles(...)`. Runs after
 * JwtAuthGuard. On `@Roles` routes it also fixes the institution being acted on.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const platformAdminOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      PLATFORM_ADMIN_KEY,
      targets,
    );
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!platformAdminOnly && (!required || required.length === 0)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException();
    }
    if (platformAdminOnly) {
      if (!user.isPlatformAdmin) {
        throw new ForbiddenException();
      }
      return true;
    }
    const header = request.headers[INSTITUTION_HEADER];
    const institutionId = typeof header === 'string' ? header : undefined;
    const membership = user.memberships.find(
      (candidate) =>
        candidate.institutionId === institutionId && (required ?? []).includes(candidate.role),
    );
    // Platform Admins hold no membership, so their header is not checked against one; it must at least be a real id
    const actsAsPlatformAdmin =
      user.isPlatformAdmin && institutionId !== undefined && UUID.test(institutionId);
    if (!membership && !actsAsPlatformAdmin) {
      throw new ForbiddenException();
    }
    request.membership = membership;
    request.institutionId = institutionId;
    return true;
  }
}
