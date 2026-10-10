import { createIdentityFakes } from '../../../../../test/support/identity.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { UserStatus } from '../../domain/entities/user.entity.js';
import {
  AccountNotActiveException,
  GoogleAccountAlreadyLinkedException,
  GoogleAccountNotLinkedException,
  GoogleEmailNotVerifiedException,
  InvalidCurrentPasswordException,
  InvalidOAuthStateException,
  PasswordUnchangedException,
} from '../../domain/exceptions/identity.exceptions.js';
import {
  ChangePasswordUseCase,
  CompleteGoogleLinkUseCase,
  StartGoogleLinkUseCase,
} from './account-security.use-cases.js';
import { LoginWithGoogleUseCase } from './login-with-google.use-case.js';
import { LoginWithPasswordUseCase } from './login-with-password.use-case.js';
import { RegisterMemberUseCase } from './member.use-cases.js';
import { StartGoogleLoginUseCase } from './start-google-login.use-case.js';

function setup() {
  const fakes = createIdentityFakes();
  return {
    ...fakes,
    login: new LoginWithPasswordUseCase(fakes.users, fakes.hasher, fakes.sessions),
    changePassword: new ChangePasswordUseCase(fakes.users, fakes.hasher, fakes.sessions),
    startLink: new StartGoogleLinkUseCase(fakes.users, fakes.google, fakes.tokens),
    completeLink: new CompleteGoogleLinkUseCase(fakes.users, fakes.google, fakes.tokens),
    googleLogin: new LoginWithGoogleUseCase(fakes.users, fakes.google, fakes.sessions),
  };
}

describe('forced password change', () => {
  it('flags a newly registered member, and the flag travels in their access token', async () => {
    const { members, users, hasher, tokens, login } = setup();
    const register = new RegisterMemberUseCase(members, users, hasher, () => 'temp-password-1');
    await register.execute({
      actor: { userId: 'a', email: 'a@x.co', isPlatformAdmin: true, mustChangePassword: false, memberships: [] },
      institutionId: 'inst-1',
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: Role.STUDENT,
    });

    const session = await login.execute({ email: 'grace@example.com', password: 'temp-password-1' });

    expect(session.user.mustChangePassword).toBe(true);
    expect(tokens.issuedAccessTokens.at(-1)?.mustChangePassword).toBe(true);
  });

  it('replaces the password, clears the flag and returns an unrestricted token', async () => {
    const { users, tokens, login, changePassword } = setup();
    const user = users.seed({ passwordHash: 'hashed:temp-password-1', mustChangePassword: true });

    const result = await changePassword.execute({
      userId: user.id,
      currentPassword: 'temp-password-1',
      newPassword: 'my-own-password',
    });

    expect(result.user.mustChangePassword).toBe(false);
    expect(tokens.issuedAccessTokens.at(-1)?.mustChangePassword).toBe(false);
    await expect(login.execute({ email: user.email, password: 'my-own-password' })).resolves.toBeDefined();
    await expect(login.execute({ email: user.email, password: 'temp-password-1' })).rejects.toThrow();
  });

  it('requires the current password, so a stolen session cannot take the account over', async () => {
    const { users, changePassword } = setup();
    const user = users.seed({ mustChangePassword: true });

    await expect(
      changePassword.execute({ userId: user.id, currentPassword: 'a-guess', newPassword: 'attacker-password' }),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordException);
    const stored = await users.findById(user.id);
    expect(stored?.passwordHash).toBe('hashed:correct-password');
    expect(stored?.mustChangePassword).toBe(true);
  });

  it('refuses to "change" to the same password, which would keep the temporary one', async () => {
    const { users, changePassword } = setup();
    const user = users.seed({ mustChangePassword: true });

    await expect(
      changePassword.execute({
        userId: user.id,
        currentPassword: 'correct-password',
        newPassword: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(PasswordUnchangedException);
    expect((await users.findById(user.id))?.mustChangePassword).toBe(true);
  });

  it('refuses an account with no password to compare against', async () => {
    const { users, changePassword } = setup();
    const user = users.seed({ passwordHash: null });

    await expect(
      changePassword.execute({ userId: user.id, currentPassword: '', newPassword: 'new-password' }),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordException);
  });
});

describe('linking a Google account', () => {
  /** Runs the whole link for a user the way the two HTTP calls would. */
  async function link(context: ReturnType<typeof setup>, userId: string) {
    const { url, ticket } = await context.startLink.execute(userId);
    const state = new URL(url).searchParams.get('state') ?? undefined;
    await context.completeLink.execute({ code: 'auth-code', state, ticket });
  }

  it('records the Google identity for the signed-in user, who can then sign in with Google', async () => {
    const context = setup();
    const user = context.users.seed();

    await link(context, user.id);

    expect(await context.users.hasOAuthIdentity(user.id, 'GOOGLE')).toBe(true);
    const start = new StartGoogleLoginUseCase(context.google).execute();
    const session = await context.googleLogin.execute({
      code: 'auth-code',
      state: start.state,
      expectedState: start.state,
    });
    expect(session.user).toMatchObject({ id: user.id, googleLinked: true });
    expect(context.users.oauthLogins).toHaveLength(1);
  });

  it('links by the signed ticket, so the Google email does not have to match the account email', async () => {
    const context = setup();
    const user = context.users.seed({ email: 'school-address@example.com' });
    context.google.identity = { ...context.google.identity, email: 'personal@gmail.com' };

    await link(context, user.id);

    expect(await context.users.hasOAuthIdentity(user.id, 'GOOGLE')).toBe(true);
  });

  it.each([
    ['still pending onboarding', { status: UserStatus.PENDING_ONBOARDING }],
    ['still on a temporary password', { mustChangePassword: true }],
    ['suspended', { status: UserStatus.SUSPENDED }],
  ])('is only offered to verified accounts: refused while %s', async (_label, props) => {
    const { users, startLink } = setup();
    const user = users.seed(props);

    await expect(startLink.execute(user.id)).rejects.toBeInstanceOf(AccountNotActiveException);
  });

  it.each([
    ['a missing ticket', (ticket: string) => ({ ticket: undefined, state: ticket.split(':')[2] })],
    ['a forged ticket', (ticket: string) => ({ ticket: 'garbage', state: ticket.split(':')[2] })],
    ['a state that does not match the ticket', (ticket: string) => ({ ticket, state: 'other-state' })],
    ['a missing code', (ticket: string) => ({ ticket, state: ticket.split(':')[2], code: undefined })],
  ])('rejects %s before contacting Google', async (_label, tamper) => {
    const { users, google, startLink, completeLink } = setup();
    const user = users.seed();
    const { ticket } = await startLink.execute(user.id);

    await expect(
      completeLink.execute({ code: 'auth-code', ...tamper(ticket) }),
    ).rejects.toBeInstanceOf(InvalidOAuthStateException);
    expect(google.exchangedCodes).toHaveLength(0);
    expect(users.identities.size).toBe(0);
  });

  it('cannot attach one Google account to two users, or two Google accounts to one user', async () => {
    const context = setup();
    const first = context.users.seed({ email: 'first@example.com' });
    const second = context.users.seed({ email: 'second@example.com' });
    await link(context, first.id);

    await expect(link(context, second.id)).rejects.toBeInstanceOf(GoogleAccountAlreadyLinkedException);

    context.google.identity = { ...context.google.identity, subject: 'another-google-account' };
    await expect(link(context, first.id)).rejects.toBeInstanceOf(GoogleAccountAlreadyLinkedException);
    expect(context.users.identities.size).toBe(1);
  });

  it('refuses a Google account whose email is not verified', async () => {
    const context = setup();
    const user = context.users.seed();
    context.google.identity = { ...context.google.identity, emailVerified: false };

    await expect(link(context, user.id)).rejects.toBeInstanceOf(GoogleEmailNotVerifiedException);
  });
});

describe('LoginWithGoogleUseCase', () => {
  const callback = { code: 'auth-code', state: 'state-1', expectedState: 'state-1' };

  it('never signs in by email match alone: an unlinked Google account is turned away', async () => {
    const { users, googleLogin } = setup();
    // Same email as the Google account, but the user never linked it
    users.seed({ email: 'ada@example.com' });

    await expect(googleLogin.execute(callback)).rejects.toBeInstanceOf(GoogleAccountNotLinkedException);
    expect(users.identities.size).toBe(0);
    expect(users.users.size).toBe(1);
  });

  it('keeps working after the Google email changes, because it follows the Google account id', async () => {
    const { users, google, googleLogin } = setup();
    const user = users.seed();
    users.identities.set('GOOGLE:google-sub-1', user.id);
    google.identity = { ...google.identity, email: 'renamed@example.com' };

    await expect(googleLogin.execute(callback)).resolves.toMatchObject({ user: { id: user.id } });
  });

  it.each([
    ['a mismatched state', { ...callback, state: 'other-state' }],
    ['a missing state cookie', { ...callback, expectedState: undefined }],
    ['a missing code', { ...callback, code: undefined }],
  ])('rejects %s before contacting Google', async (_label, input) => {
    const { google, googleLogin } = setup();

    await expect(googleLogin.execute(input)).rejects.toBeInstanceOf(InvalidOAuthStateException);
    expect(google.exchangedCodes).toHaveLength(0);
  });
});
