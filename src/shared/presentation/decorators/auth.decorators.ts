import {
  createParamDecorator,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedUser, MembershipClaim } from '../../domain/auth/authenticated-user.js';
import type { Role } from '../../domain/auth/role.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const PLATFORM_ADMIN_KEY = 'auth:platformAdmin';

export const ALLOW_PASSWORD_CHANGE_KEY = 'auth:allowDuringPasswordChange';

/** Keeps a route usable while the account still has a temporary password. Everything else is blocked. */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts a route to members holding one of the roles in the institution
 * named by the `x-institution-id` header. Platform Admins pass for any institution.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Restricts a route to Platform Admins. */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

const requestOf = (context: ExecutionContext) =>
  context.switchToHttp().getRequest<AuthenticatedRequest>();

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = requestOf(context);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  },
);

/** The membership that satisfied `@Roles`; undefined for Platform Admins acting without one. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MembershipClaim | undefined =>
    requestOf(context).membership,
);

/** The institution a `@Roles` route is acting on, already authorized by RolesGuard. */
export const CurrentInstitutionId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const { institutionId } = requestOf(context);
    if (!institutionId) {
      throw new ForbiddenException();
    }
    return institutionId;
  },
);
