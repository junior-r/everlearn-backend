import { RecordingEmailProvider } from '../../../../../test/support/communication.fakes.js';
import {
  createIdentityFakes,
  InMemoryPasswordResetTokens,
  TEST_PASSWORD,
} from '../../../../../test/support/identity.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { UserStatus } from '../../domain/entities/user.entity.js';
import {
  AccountNotActiveException,
  GoogleAccountAlreadyLinkedException,
  GoogleAccountNotLinkedException,
  GoogleEmailNotVerifiedException,
  InvalidCurrentPasswordException,
  InvalidOAuthStateException,
  InvalidRefreshTokenException,
  InvalidResetTokenException,
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
import { RequestPasswordResetUseCase, ResetPasswordUseCase } from './password-reset.use-cases.js';
import { RefreshSessionUseCase } from './refresh-session.use-case.js';
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

describe('password reset', () => {
  const FRONTEND = 'https://app.everlearn.test';

  function resetSetup() {
    const fakes = createIdentityFakes();
    const resetTokens = new InMemoryPasswordResetTokens();
    const emails = new RecordingEmailProvider();
    const pending: Array<Promise<void>> = [];
    const failures: unknown[] = [];
    const user = fakes.users.seed({ email: 'grace@example.com', firstName: 'Grace', status: UserStatus.ACTIVE });
    return {
      ...fakes,
      resetTokens,
      emails,
      failures,
      user,
      /** Waits for the email the request leaves to finish on its own. */
      settle: () => Promise.all(pending),
      request: new RequestPasswordResetUseCase(fakes.users, resetTokens, emails, {
        frontendUrl: FRONTEND,
        defer: (work) => pending.push(work),
        onFailure: (error) => failures.push(error),
      }),
      reset: new ResetPasswordUseCase(
        fakes.users,
        resetTokens,
        fakes.hasher,
        fakes.revocations,
        () => new Date('2026-10-11T12:00:00Z'),
      ),
      login: new LoginWithPasswordUseCase(fakes.users, fakes.hasher, fakes.sessions),
      refresh: new RefreshSessionUseCase(fakes.users, fakes.tokens, fakes.revocations, fakes.sessions),
    };
  }

  it('emails a link that works for 15 minutes, with the token after the hash sign', async () => {
    const ctx = resetSetup();

    await ctx.request.execute('  Grace@Example.com ', 'en');
    await ctx.settle();

    expect(ctx.resetTokens.issued).toEqual([{ token: 'reset-token-1', userId: ctx.user.id, ttlSeconds: 900 }]);
    expect(ctx.emails.sent).toHaveLength(1);
    expect(ctx.emails.sent[0]).toMatchObject({ to: 'grace@example.com', subject: 'Restablece tu contraseña de Everlearn' });
    expect(ctx.emails.sent[0].text).toContain(`${FRONTEND}/en/reset-password#token=reset-token-1`);
    expect(ctx.emails.sent[0].text).toContain('vence en 15 minutos');
  });

  it('answers the same way for an address nobody has, and for a suspended account, and sends nothing', async () => {
    const ctx = resetSetup();
    ctx.users.seed({ email: 'out@example.com', status: UserStatus.SUSPENDED });

    await expect(ctx.request.execute('nobody@example.com')).resolves.toBeUndefined();
    await expect(ctx.request.execute('out@example.com')).resolves.toBeUndefined();
    await ctx.settle();

    expect(ctx.resetTokens.issued).toEqual([]);
    expect(ctx.emails.sent).toEqual([]);
  });

  it('does not wait for the email, and stays quiet when it cannot be sent', async () => {
    const ctx = resetSetup();
    ctx.emails.refused.add('grace@example.com');

    // Resolved before the email has been attempted: the answer cannot depend on it
    await expect(ctx.request.execute('grace@example.com')).resolves.toBeUndefined();
    await ctx.settle();

    expect(ctx.failures).toHaveLength(1);
    const down = resetSetup();
    down.resetTokens.failWith = new Error('redis down');
    await expect(down.request.execute('grace@example.com')).resolves.toBeUndefined();
    await down.settle();
    expect(down.emails.sent).toEqual([]);
    expect(down.failures).toHaveLength(1);
  });

  it('sets the new password, once', async () => {
    const ctx = resetSetup();
    await ctx.request.execute('grace@example.com');
    await ctx.settle();

    await ctx.reset.execute('reset-token-1', 'a-brand-new-password');

    await expect(ctx.login.execute({ email: 'grace@example.com', password: 'a-brand-new-password' })).resolves.toBeDefined();
    await expect(ctx.login.execute({ email: 'grace@example.com', password: TEST_PASSWORD })).rejects.toThrow();
    // The link is spent
    await expect(ctx.reset.execute('reset-token-1', 'yet-another-password')).rejects.toBeInstanceOf(
      InvalidResetTokenException,
    );
  });

  it('refuses a token that is unknown, expired, or replaced by a newer one', async () => {
    const ctx = resetSetup();
    await ctx.request.execute('grace@example.com');
    await ctx.request.execute('grace@example.com');
    await ctx.settle();

    await expect(ctx.reset.execute('made-up', 'a-brand-new-password')).rejects.toBeInstanceOf(InvalidResetTokenException);
    // Asking again made the first link stop working
    await expect(ctx.reset.execute('reset-token-1', 'a-brand-new-password')).rejects.toBeInstanceOf(
      InvalidResetTokenException,
    );
    ctx.resetTokens.expire('reset-token-2');
    await expect(ctx.reset.execute('reset-token-2', 'a-brand-new-password')).rejects.toBeInstanceOf(
      InvalidResetTokenException,
    );
    await expect(ctx.login.execute({ email: 'grace@example.com', password: TEST_PASSWORD })).resolves.toBeDefined();
  });

  it('ends a forced password change, and does not reopen an account suspended meanwhile', async () => {
    const ctx = resetSetup();
    ctx.users.patch(ctx.user.id, { mustChangePassword: true });
    await ctx.request.execute('grace@example.com');
    await ctx.settle();
    await ctx.reset.execute('reset-token-1', 'a-brand-new-password');
    expect(ctx.users.users.get(ctx.user.id)?.mustChangePassword).toBe(false);

    await ctx.request.execute('grace@example.com');
    await ctx.settle();
    ctx.users.patch(ctx.user.id, { status: UserStatus.SUSPENDED });
    await expect(ctx.reset.execute('reset-token-2', 'one-more-password')).rejects.toBeInstanceOf(
      InvalidResetTokenException,
    );
  });

  it('closes the sessions opened before the reset, and leaves later ones alone', async () => {
    const ctx = resetSetup();
    ctx.tokens.now = () => new Date('2026-10-11T11:00:00Z');
    const before = await ctx.login.execute({ email: 'grace@example.com', password: TEST_PASSWORD });
    await expect(ctx.refresh.execute(before.refreshToken)).resolves.toBeDefined();
    await ctx.request.execute('grace@example.com');
    await ctx.settle();

    await ctx.reset.execute('reset-token-1', 'a-brand-new-password');

    await expect(ctx.refresh.execute(before.refreshToken)).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    ctx.tokens.now = () => new Date('2026-10-11T12:00:05Z');
    const after = await ctx.login.execute({ email: 'grace@example.com', password: 'a-brand-new-password' });
    await expect(ctx.refresh.execute(after.refreshToken)).resolves.toBeDefined();
  });
});
