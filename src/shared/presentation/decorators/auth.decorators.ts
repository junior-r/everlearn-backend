import {
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedUser, MembershipClaim } from '../../domain/auth/authenticated-user.js';
import type { Role } from '../../domain/auth/role.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts a route to members holding one of the roles in the institution
 * named by the `x-institution-id` header. Platform admins always pass.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  },
);

/** The membership that satisfied `@Roles`; undefined for platform admins without one. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MembershipClaim | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().membership,
);
