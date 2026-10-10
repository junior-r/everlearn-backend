import { createIdentityFakes } from '../../../../../test/support/identity.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { UserStatus } from '../../domain/entities/user.entity.js';
import {
  AccountNotRegisteredException,
  AccountSuspendedException,
  GoogleEmailNotVerifiedException,
  InvalidCredentialsException,
  InvalidOAuthStateException,
  InvalidRefreshTokenException,
  UserNotFoundException,
} from '../../domain/exceptions/identity.exceptions.js';
import { GetCurrentUserUseCase } from './get-current-user.use-case.js';
import { LoginWithGoogleUseCase } from './login-with-google.use-case.js';
import { LoginWithPasswordUseCase } from './login-with-password.use-case.js';
import { LogoutUseCase } from './logout.use-case.js';
import { RefreshSessionUseCase } from './refresh-session.use-case.js';
import { StartGoogleLoginUseCase } from './start-google-login.use-case.js';

describe('LoginWithPasswordUseCase', () => {
  function setup() {
    const fakes = createIdentityFakes();
    return {
      ...fakes,
      useCase: new LoginWithPasswordUseCase(fakes.users, fakes.hasher, fakes.sessions),
    };
  }

  it('opens a session carrying the active memberships', async () => {
    const { users, tokens, useCase } = setup();
    const user = users.seed();
    const membership = { id: 'm-1', institutionId: 'inst-1', role: Role.TEACHER };
    users.memberships.set(user.id, [membership]);

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

  it('lets a pending member sign in, with no memberships, so they can reach onboarding', async () => {
    const { users, useCase } = setup();
    users.seed({ status: UserStatus.PENDING_ONBOARDING });

    const session = await useCase.execute({ email: 'ada@example.com', password: 'correct-password' });

    expect(session.user.status).toBe(UserStatus.PENDING_ONBOARDING);
    expect(session.user.memberships).toEqual([]);
  });

  it('rejects a wrong password', async () => {
    const { users, useCase } = setup();
    users.seed();

    await expect(
      useCase.execute({ email: 'ada@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('rejects an unknown email with the same error and still runs the hash comparison', async () => {
    const { hasher, useCase } = setup();

    await expect(
      useCase.execute({ email: 'nobody@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
    expect(hasher.verifyCalls).toBe(1);
  });

  it('rejects an account that only has Google sign-in', async () => {
    const { users, useCase } = setup();
    users.seed({ passwordHash: null });

    await expect(
      useCase.execute({ email: 'ada@example.com', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('rejects a suspended account even with the right password', async () => {
    const { users, useCase } = setup();
    users.seed({ status: UserStatus.SUSPENDED });

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

describe('StartGoogleLoginUseCase', () => {
  it('returns a consent URL bound to a fresh unguessable state', () => {
    const { google } = createIdentityFakes();
    const useCase = new StartGoogleLoginUseCase(google);

    const first = useCase.execute();
    const second = useCase.execute();

    expect(first.url).toContain(`state=${first.state}`);
    expect(first.state.length).toBeGreaterThanOrEqual(43);
    expect(first.state).not.toBe(second.state);
  });
});

describe('LoginWithGoogleUseCase', () => {
  const callback = { code: 'auth-code', state: 'state-1', expectedState: 'state-1' };

  function setup() {
    const fakes = createIdentityFakes();
    return {
      ...fakes,
      useCase: new LoginWithGoogleUseCase(fakes.users, fakes.google, fakes.sessions),
    };
  }

  it('never creates an account: someone their institution did not register is turned away', async () => {
    const { users, useCase } = setup();

    await expect(useCase.execute(callback)).rejects.toBeInstanceOf(AccountNotRegisteredException);
    expect(users.users.size).toBe(0);
    expect(users.identities.size).toBe(0);
  });

  it('signs a registered member in and reuses the link afterwards, even if their Google email changes', async () => {
    const { users, google, useCase } = setup();
    const registered = users.seed({ status: UserStatus.PENDING_ONBOARDING });

    const first = await useCase.execute(callback);
    google.identity = { ...google.identity, email: 'renamed@example.com' };
    const second = await useCase.execute(callback);

    expect(first.user.id).toBe(registered.id);
    expect(second.user.id).toBe(registered.id);
    expect(users.oauthLogins).toHaveLength(2);
  });

  it('links to an existing verified account and keeps its password', async () => {
    const { users, useCase } = setup();
    const existing = users.seed({ emailVerifiedAt: new Date() });

    await useCase.execute(callback);

    expect((await users.findById(existing.id))?.passwordHash).toBe('hashed:correct-password');
  });

  it('drops the temporary password when linking to an account whose email was never verified', async () => {
    const { users, useCase } = setup();
    const registered = users.seed({ emailVerifiedAt: null });

    await useCase.execute(callback);

    const stored = await users.findById(registered.id);
    expect(stored?.passwordHash).toBeNull();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('refuses an unverified Google email instead of linking an account', async () => {
    const { users, google, useCase } = setup();
    users.seed();
    google.identity = { ...google.identity, emailVerified: false };

    await expect(useCase.execute(callback)).rejects.toBeInstanceOf(
      GoogleEmailNotVerifiedException,
    );
    expect(users.identities.size).toBe(0);
  });

  it.each([
    ['a mismatched state', { ...callback, state: 'other-state' }],
    ['a missing state cookie', { ...callback, expectedState: undefined }],
    ['a missing state parameter', { ...callback, state: undefined }],
    ['a missing code', { ...callback, code: undefined }],
  ])('rejects %s before contacting Google', async (_label, input) => {
    const { google, useCase } = setup();

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidOAuthStateException);
    expect(google.exchangedCodes).toHaveLength(0);
  });
});
