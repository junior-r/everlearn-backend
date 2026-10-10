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
    expect(session.refreshToken).toBe(`refresh:${stored?.id}`);
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
  it('issues a new token pair with the current memberships', async () => {
    const { users, tokens, sessions } = createIdentityFakes();
    const user = users.seed();
    const useCase = new RefreshSessionUseCase(users, tokens, sessions);
    const membership = { id: 'm-2', institutionId: 'inst-1', role: Role.STUDENT };
    users.memberships.set(user.id, [membership]);

    const session = await useCase.execute(`refresh:${user.id}`);

    expect(session.accessToken).toBe(`access:${user.id}`);
    expect(session.user.memberships).toEqual([membership]);
  });

  it.each([
    ['a missing token', undefined],
    ['a forged token', 'not-a-refresh-token'],
    ['a token for a deleted user', 'refresh:missing-user'],
  ])('rejects %s', async (_label, token) => {
    const { users, tokens, sessions } = createIdentityFakes();
    const useCase = new RefreshSessionUseCase(users, tokens, sessions);

    await expect(useCase.execute(token)).rejects.toBeInstanceOf(InvalidRefreshTokenException);
  });

  it('rejects a user suspended after the token was issued', async () => {
    const { users, tokens, sessions } = createIdentityFakes();
    const user = users.seed({ status: UserStatus.SUSPENDED });
    const useCase = new RefreshSessionUseCase(users, tokens, sessions);

    await expect(useCase.execute(`refresh:${user.id}`)).rejects.toBeInstanceOf(
      AccountSuspendedException,
    );
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
