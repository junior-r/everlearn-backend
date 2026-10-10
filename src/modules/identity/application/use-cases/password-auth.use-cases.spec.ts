import { createIdentityFakes } from '../../../../../test/support/identity.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { UserStatus } from '../../domain/entities/user.entity.js';
import {
  AccountSuspendedException,
  EmailAlreadyRegisteredException,
  InvalidCredentialsException,
  InvalidRefreshTokenException,
  UserNotFoundException,
} from '../../domain/exceptions/identity.exceptions.js';
import { GetCurrentUserUseCase } from './get-current-user.use-case.js';
import { LogoutUseCase } from './logout.use-case.js';
import { LoginWithPasswordUseCase } from './login-with-password.use-case.js';
import { RefreshSessionUseCase } from './refresh-session.use-case.js';
import { RegisterUserUseCase } from './register-user.use-case.js';

describe('RegisterUserUseCase', () => {
  it('stores a normalized email and a hashed password, then opens a session', async () => {
    const { users, hasher, sessions } = createIdentityFakes();
    const useCase = new RegisterUserUseCase(users, hasher, sessions);

    const session = await useCase.execute({
      email: '  Grace@Example.COM ',
      password: 'correct-password',
      firstName: ' Grace ',
      lastName: 'Hopper',
    });

    const stored = await users.findByEmail('grace@example.com');
    expect(stored?.passwordHash).toBe('hashed:correct-password');
    expect(stored?.firstName).toBe('Grace');
    expect(stored?.emailVerifiedAt).toBeNull();
    expect(session.user.status).toBe(UserStatus.PENDING_ONBOARDING);
    expect(session.accessToken).toBe(`access:${stored?.id}`);
    expect(session.refreshToken).toBe(`refresh:${stored?.id}:token-1`);
  });

  it('rejects an email that is already registered, ignoring case', async () => {
    const { users, hasher, sessions } = createIdentityFakes();
    users.seed({ email: 'ada@example.com' });
    const useCase = new RegisterUserUseCase(users, hasher, sessions);

    await expect(
      useCase.execute({
        email: 'ADA@example.com',
        password: 'another-password',
        firstName: 'Ada',
        lastName: 'Clone',
      }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredException);
    expect(users.users.size).toBe(1);
  });
});

describe('LoginWithPasswordUseCase', () => {
  it('opens a session carrying the active memberships', async () => {
    const { users, hasher, tokens, sessions } = createIdentityFakes();
    const user = users.seed();
    const membership = { id: 'm-1', institutionId: 'inst-1', role: Role.TEACHER };
    users.memberships.set(user.id, [membership]);
    const useCase = new LoginWithPasswordUseCase(users, hasher, sessions);

    const session = await useCase.execute({
      email: 'Ada@Example.com',
      password: 'correct-password',
    });

    expect(session.user.memberships).toEqual([membership]);
    expect(tokens.issuedAccessTokens[0]).toEqual({
      userId: user.id,
      email: 'ada@example.com',
      isPlatformAdmin: false,
      memberships: [membership],
    });
  });

  it('rejects a wrong password', async () => {
    const { users, hasher, sessions } = createIdentityFakes();
    users.seed();
    const useCase = new LoginWithPasswordUseCase(users, hasher, sessions);

    await expect(
      useCase.execute({ email: 'ada@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('rejects an unknown email with the same error and still runs the hash comparison', async () => {
    const { users, hasher, sessions } = createIdentityFakes();
    const useCase = new LoginWithPasswordUseCase(users, hasher, sessions);

    await expect(
      useCase.execute({ email: 'nobody@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
    expect(hasher.verifyCalls).toBe(1);
  });

  it('rejects an account that only has Google sign-in', async () => {
    const { users, hasher, sessions } = createIdentityFakes();
    users.seed({ passwordHash: null });
    const useCase = new LoginWithPasswordUseCase(users, hasher, sessions);

    await expect(
      useCase.execute({ email: 'ada@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('rejects a suspended account even with the right password', async () => {
    const { users, hasher, sessions } = createIdentityFakes();
    users.seed({ status: UserStatus.SUSPENDED });
    const useCase = new LoginWithPasswordUseCase(users, hasher, sessions);

    await expect(
      useCase.execute({ email: 'ada@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(AccountSuspendedException);
  });
});

describe('RefreshSessionUseCase', () => {
  function setup() {
    const fakes = createIdentityFakes();
    const useCase = new RefreshSessionUseCase(
      fakes.users,
      fakes.tokens,
      fakes.revocations,
      fakes.sessions,
    );
    return { ...fakes, useCase };
  }

  it('issues a new access token with the current memberships and keeps the same refresh token', async () => {
    const { users, useCase } = setup();
    const user = users.seed();
    const membership = { id: 'm-2', institutionId: 'inst-1', role: Role.STUDENT };
    users.memberships.set(user.id, [membership]);
    const refreshToken = `refresh:${user.id}:token-a`;

    const session = await useCase.execute(refreshToken);

    expect(session.accessToken).toBe(`access:${user.id}`);
    expect(session.refreshToken).toBe(refreshToken);
    expect(session.user.memberships).toEqual([membership]);
  });

  it.each([
    ['a missing token', undefined],
    ['a forged token', 'not-a-refresh-token'],
    ['a token for a deleted user', 'refresh:missing-user:token-a'],
  ])('rejects %s', async (_label, token) => {
    const { useCase } = setup();

    await expect(useCase.execute(token)).rejects.toBeInstanceOf(InvalidRefreshTokenException);
  });

  it('rejects a user suspended after the token was issued', async () => {
    const { users, useCase } = setup();
    const user = users.seed({ status: UserStatus.SUSPENDED });

    await expect(useCase.execute(`refresh:${user.id}:token-a`)).rejects.toBeInstanceOf(
      AccountSuspendedException,
    );
  });

  it('rejects a token that was revoked by logout, while other sessions keep working', async () => {
    const { users, tokens, revocations, useCase } = setup();
    const user = users.seed();
    const logout = new LogoutUseCase(tokens, revocations);
    const laptop = `refresh:${user.id}:token-laptop`;
    const phone = `refresh:${user.id}:token-phone`;

    await logout.execute(laptop);

    await expect(useCase.execute(laptop)).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    await expect(useCase.execute(phone)).resolves.toMatchObject({ refreshToken: phone });
  });
});

describe('LogoutUseCase', () => {
  it('blocks the token until its own expiry', async () => {
    const { tokens, revocations } = createIdentityFakes();
    const useCase = new LogoutUseCase(tokens, revocations);

    await useCase.execute('refresh:user-1:token-a');

    expect(revocations.revoked.get('token-a')?.getTime()).toBeGreaterThan(Date.now());
  });

  it.each([
    ['no token', undefined],
    ['an invalid token', 'garbage'],
  ])('does nothing for %s', async (_label, token) => {
    const { tokens, revocations } = createIdentityFakes();
    const useCase = new LogoutUseCase(tokens, revocations);

    await expect(useCase.execute(token)).resolves.toBeUndefined();
    expect(revocations.revoked.size).toBe(0);
  });
});

describe('GetCurrentUserUseCase', () => {
  it('returns the profile without the password hash', async () => {
    const { users, sessions } = createIdentityFakes();
    const user = users.seed();
    const useCase = new GetCurrentUserUseCase(users, sessions);

    const view = await useCase.execute(user.id);

    expect(view).toMatchObject({ id: user.id, email: 'ada@example.com' });
    expect(view).not.toHaveProperty('passwordHash');
  });

  it('fails for a user that no longer exists', async () => {
    const { users, sessions } = createIdentityFakes();
    const useCase = new GetCurrentUserUseCase(users, sessions);

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(UserNotFoundException);
  });
});
