import { createIdentityFakes } from '../../../../../test/support/identity.fakes.js';
import {
  GoogleEmailNotVerifiedException,
  InvalidOAuthStateException,
} from '../../domain/exceptions/identity.exceptions.js';
import { LoginWithGoogleUseCase } from './login-with-google.use-case.js';
import { StartGoogleLoginUseCase } from './start-google-login.use-case.js';

const callback = { code: 'auth-code', state: 'state-1', expectedState: 'state-1' };

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
  it('creates a verified, password-less user on first sign-in', async () => {
    const { users, google, sessions } = createIdentityFakes();
    const useCase = new LoginWithGoogleUseCase(users, google, sessions);

    const session = await useCase.execute(callback);

    const stored = await users.findByEmail('ada@example.com');
    expect(stored?.passwordHash).toBeNull();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(stored?.avatarUrl).toBe('https://example.com/ada.png');
    expect(session.user.id).toBe(stored?.id);
    expect(users.oauthLogins).toHaveLength(1);
  });

  it('reuses the linked user on later sign-ins, even if the Google email changed', async () => {
    const { users, google, sessions } = createIdentityFakes();
    const useCase = new LoginWithGoogleUseCase(users, google, sessions);
    const first = await useCase.execute(callback);
    google.identity = { ...google.identity, email: 'renamed@example.com' };

    const second = await useCase.execute(callback);

    expect(second.user.id).toBe(first.user.id);
    expect(users.users.size).toBe(1);
  });

  it('links to an existing verified account and keeps its password', async () => {
    const { users, google, sessions } = createIdentityFakes();
    const existing = users.seed({ emailVerifiedAt: new Date() });
    const useCase = new LoginWithGoogleUseCase(users, google, sessions);

    const session = await useCase.execute(callback);

    expect(session.user.id).toBe(existing.id);
    expect((await users.findById(existing.id))?.passwordHash).toBe('hashed:correct-password');
  });

  it('drops the password when linking to an account whose email was never verified', async () => {
    const { users, google, sessions } = createIdentityFakes();
    const squatted = users.seed({ emailVerifiedAt: null });
    const useCase = new LoginWithGoogleUseCase(users, google, sessions);

    const session = await useCase.execute(callback);

    const stored = await users.findById(squatted.id);
    expect(session.user.id).toBe(squatted.id);
    expect(stored?.passwordHash).toBeNull();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('refuses an unverified Google email instead of creating or linking an account', async () => {
    const { users, google, sessions } = createIdentityFakes();
    users.seed();
    google.identity = { ...google.identity, emailVerified: false };
    const useCase = new LoginWithGoogleUseCase(users, google, sessions);

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
    const { users, google, sessions } = createIdentityFakes();
    const useCase = new LoginWithGoogleUseCase(users, google, sessions);

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(InvalidOAuthStateException);
    expect(google.exchangedCodes).toHaveLength(0);
  });
});
