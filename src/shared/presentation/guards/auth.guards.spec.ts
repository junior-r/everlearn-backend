import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessTokenVerifier } from '../../domain/auth/access-token-verifier.js';
import type { AuthenticatedUser } from '../../domain/auth/authenticated-user.js';
import { Role } from '../../domain/auth/role.js';
import type { AuthenticatedRequest } from '../authenticated-request.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

type Metadata = Partial<Record<string, unknown>>;

function contextFor(request: Partial<AuthenticatedRequest>, metadata: Metadata) {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(metadata)) {
    Reflect.defineMetadata(key, value, handler);
  }
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return context;
}

const teacher: AuthenticatedUser = {
  userId: 'user-1',
  email: 'ada@example.com',
  isPlatformAdmin: false,
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

  it('lets platform admins through without a membership', () => {
    const admin: AuthenticatedUser = { ...teacher, isPlatformAdmin: true, memberships: [] };
    const request = { headers: {}, user: admin };

    expect(guard.canActivate(contextFor(request, requires(Role.ADMIN)))).toBe(true);
  });
});
