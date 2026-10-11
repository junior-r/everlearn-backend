import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessTokenVerifier } from '../../domain/auth/access-token-verifier.js';
import {
  PasswordChangeRequiredException,
  type AuthenticatedUser,
} from '../../domain/auth/authenticated-user.js';
import { Role } from '../../domain/auth/role.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';
import {
  ALLOW_PASSWORD_CHANGE_KEY,
  IS_PUBLIC_KEY,
  PLATFORM_ADMIN_KEY,
  ROLES_KEY,
} from '../decorators/auth.decorators.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

type Metadata = Partial<Record<string, unknown>>;

function contextFor(request: Partial<AuthenticatedRequest>, metadata: Metadata, type: 'http' | 'ws' = 'http') {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(metadata)) {
    Reflect.defineMetadata(key, value, handler);
  }
  const context = {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => class {},
    // A websocket event has no HTTP request to hand over
    switchToHttp: () => ({ getRequest: () => (type === 'http' ? request : undefined) }),
  } as unknown as ExecutionContext;
  return context;
}

const teacher: AuthenticatedUser = {
  userId: 'user-1',
  email: 'ada@example.com',
  isPlatformAdmin: false,
  mustChangePassword: false,
  memberships: [
    { id: 'm-1', institutionId: 'inst-1', role: Role.TEACHER },
    { id: 'm-2', institutionId: 'inst-2', role: Role.STUDENT },
  ],
};

describe('JwtAuthGuard', () => {
  const verifier: AccessTokenVerifier = {
    verifyAccessToken: (token) => Promise.resolve(token === 'valid' ? teacher : null),
  };
  const guard = new JwtAuthGuard(new Reflector(), verifier);

  it('attaches the user for a valid bearer token', async () => {
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer valid' } };

    await expect(guard.canActivate(contextFor(request, {}))).resolves.toBe(true);
    expect(request.user).toEqual(teacher);
  });

  it.each([
    ['no header', {}],
    ['an invalid token', { authorization: 'Bearer forged' }],
    ['a non-bearer scheme', { authorization: 'Basic valid' }],
  ])('rejects %s', async (_label, headers) => {
    await expect(guard.canActivate(contextFor({ headers }, {}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lets public routes through without a token', async () => {
    const context = contextFor({ headers: {} }, { [IS_PUBLIC_KEY]: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('leaves websocket events to the gateway, which checks the token when a browser connects', async () => {
    await expect(guard.canActivate(contextFor({}, {}, 'ws'))).resolves.toBe(true);
    expect(new RolesGuard(new Reflector()).canActivate(contextFor({}, { [ROLES_KEY]: [Role.ADMIN] }, 'ws'))).toBe(true);
  });

  describe('with a temporary-password token', () => {
    const pendingVerifier: AccessTokenVerifier = {
      verifyAccessToken: () => Promise.resolve({ ...teacher, mustChangePassword: true }),
    };
    const pendingGuard = new JwtAuthGuard(new Reflector(), pendingVerifier);
    const headers = { authorization: 'Bearer valid' };

    it('blocks every route by default, without attaching the user', async () => {
      const request: Partial<AuthenticatedRequest> = { headers };

      await expect(pendingGuard.canActivate(contextFor(request, {}))).rejects.toBeInstanceOf(
        PasswordChangeRequiredException,
      );
      expect(request.user).toBeUndefined();
    });

    it('allows only routes explicitly opened for it', async () => {
      const context = contextFor({ headers }, { [ALLOW_PASSWORD_CHANGE_KEY]: true });

      await expect(pendingGuard.canActivate(context)).resolves.toBe(true);
    });
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const requires = (...roles: Role[]) => ({ [ROLES_KEY]: roles });

  it('allows any authenticated user when no roles are required', () => {
    expect(guard.canActivate(contextFor({ headers: {}, user: teacher }, {}))).toBe(true);
  });

  it('allows a member holding the role in the requested institution and exposes the membership', () => {
    const request: Partial<AuthenticatedRequest> = {
      headers: { 'x-institution-id': 'inst-1' },
      user: teacher,
    };

    expect(guard.canActivate(contextFor(request, requires(Role.ADMIN, Role.TEACHER)))).toBe(true);
    expect(request.membership).toEqual(teacher.memberships[0]);
  });

  it('does not let a role from one institution apply to another', () => {
    const request = { headers: { 'x-institution-id': 'inst-2' }, user: teacher };

    expect(() => guard.canActivate(contextFor(request, requires(Role.TEACHER)))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the institution header is missing', () => {
    const request = { headers: {}, user: teacher };

    expect(() => guard.canActivate(contextFor(request, requires(Role.TEACHER)))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the member lacks the role', () => {
    const request = { headers: { 'x-institution-id': 'inst-1' }, user: teacher };

    expect(() => guard.canActivate(contextFor(request, requires(Role.ADMIN)))).toThrow(
      ForbiddenException,
    );
  });

  it('fixes the institution being acted on for the controller', () => {
    const request: Partial<AuthenticatedRequest> = {
      headers: { 'x-institution-id': 'inst-1' },
      user: teacher,
    };

    guard.canActivate(contextFor(request, requires(Role.TEACHER)));

    expect(request.institutionId).toBe('inst-1');
  });

  describe('for a Platform Admin', () => {
    const admin: AuthenticatedUser = { ...teacher, isPlatformAdmin: true,
  mustChangePassword: false, memberships: [] };
    const anyInstitution = '11111111-1111-4111-8111-111111111111';

    it('allows acting on any institution named in the header, without a membership', () => {
      const request: Partial<AuthenticatedRequest> = {
        headers: { 'x-institution-id': anyInstitution },
        user: admin,
      };

      expect(guard.canActivate(contextFor(request, requires(Role.ADMIN)))).toBe(true);
      expect(request.institutionId).toBe(anyInstitution);
      expect(request.membership).toBeUndefined();
    });

    it.each([
      ['no institution header', {}],
      ['a header that is not an id', { 'x-institution-id': "' OR 1=1 --" }],
    ])('still requires an institution: rejects %s', (_label, headers) => {
      expect(() =>
        guard.canActivate(contextFor({ headers, user: admin }, requires(Role.ADMIN))),
      ).toThrow(ForbiddenException);
    });
  });

  describe('@PlatformAdminOnly', () => {
    const platformOnly = { [PLATFORM_ADMIN_KEY]: true };

    it('allows a Platform Admin', () => {
      const admin: AuthenticatedUser = { ...teacher, isPlatformAdmin: true };

      expect(guard.canActivate(contextFor({ headers: {}, user: admin }, platformOnly))).toBe(true);
    });

    it('rejects everyone else, including an Institution Admin', () => {
      const institutionAdmin: AuthenticatedUser = {
        ...teacher,
        memberships: [{ id: 'm-9', institutionId: 'inst-1', role: Role.ADMIN }],
      };
      const request = { headers: { 'x-institution-id': 'inst-1' }, user: institutionAdmin };

      expect(() => guard.canActivate(contextFor(request, platformOnly))).toThrow(ForbiddenException);
    });
  });
});
