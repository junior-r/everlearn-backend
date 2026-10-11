import request from 'supertest';
import { UserStatus } from '../src/modules/identity/domain/entities/user.entity.js';
import { TEST_PASSWORD } from './support/identity.fakes.js';
import { createTestApp, TEST_FRONTEND_URL, TEST_RATE_LIMIT, type TestApp } from './support/test-app.js';

const EMAIL = 'grace@example.com';
const NEW_PASSWORD = 'a-brand-new-password';

describe('Password reset (HTTP)', () => {
  let ctx: TestApp;

  const forgot = (email: string, extra: object = {}) =>
    request(ctx.server).post('/auth/forgot-password').send({ email, ...extra });
  const reset = (token: string, newPassword: string) =>
    request(ctx.server).post('/auth/reset-password').send({ token, newPassword });
  const login = (password: string) => request(ctx.server).post('/auth/login').send({ email: EMAIL, password });

  /** The token of the reset link in the latest email, once the email has gone out. */
  async function emailedToken(): Promise<string> {
    await expect.poll(() => ctx.emails.sent.length).toBeGreaterThan(0);
    const { text } = ctx.emails.sent[ctx.emails.sent.length - 1];
    const link = /https?:\/\/\S+/.exec(text)?.[0] ?? '';
    expect(link.startsWith(`${TEST_FRONTEND_URL}/es/reset-password#token=`)).toBe(true);
    return link.split('#token=')[1];
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    ctx.users.seed({ email: EMAIL, firstName: 'Grace', status: UserStatus.ACTIVE });
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('takes a member from "forgot my password" to signing in with a new one', async () => {
    const browser = request.agent(ctx.server);
    await browser.post('/auth/login').send({ email: EMAIL, password: TEST_PASSWORD }).expect(200);
    await browser.post('/auth/refresh').expect(200);

    const signedIn = await login(TEST_PASSWORD).expect(200);
    const oldAccessToken = signedIn.body.accessToken as string;
    const me = (token: string) => request(ctx.server).get('/auth/me').set('Authorization', `Bearer ${token}`);
    await me(oldAccessToken).expect(200);
    // Tokens carry whole seconds: let one pass, so the reset clearly comes after these sessions
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await forgot(EMAIL).expect(204);
    const token = await emailedToken();
    expect(ctx.emails.sent[0]).toMatchObject({ to: EMAIL, subject: 'Restablece tu contraseña de Everlearn' });
    await reset(token, NEW_PASSWORD).expect(204);

    // Every session open before the reset is over at once: the access token and the refresh cookie
    await me(oldAccessToken).expect(401);
    await browser.post('/auth/refresh').expect(401);
    // And the owner is told
    expect(ctx.emails.sent[1]).toMatchObject({ to: EMAIL, subject: 'Tu contraseña de Everlearn fue cambiada' });
    expect(ctx.emails.sent[1].text).not.toContain(NEW_PASSWORD);

    const fresh = await login(NEW_PASSWORD).expect(200);
    await me(fresh.body.accessToken as string).expect(200);
    await login(TEST_PASSWORD).expect(401);
    // The link worked once
    const again = await reset(token, 'yet-another-password').expect(400);
    expect(again.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('answers the same for an address nobody has, and emails nobody', async () => {
    const known = await forgot(EMAIL).expect(204);
    const unknown = await forgot('nobody@example.com').expect(204);

    expect(unknown.body).toEqual(known.body);
    await emailedToken();
    expect(ctx.emails.sent.map((email) => email.to)).toEqual([EMAIL]);
  });

  it('needs no session, and refuses what is not an address or a usable password', async () => {
    await forgot('not-an-address').expect(400);
    await forgot(EMAIL, { locale: 'fr' }).expect(400);
    await forgot(EMAIL, { locale: 'en' }).expect(204);
    await expect.poll(() => ctx.emails.sent.length).toBe(1);
    // The English screen is linked when asked for
    expect(ctx.emails.sent[0].text).toContain(`${TEST_FRONTEND_URL}/en/reset-password#token=`);
    const englishToken = ctx.emails.sent[0].text.split('#token=')[1].split(/\s/)[0];

    // A password too short is refused before the link is spent
    await reset(englishToken, 'short').expect(400);
    await reset(englishToken, 'x'.repeat(73)).expect(400);
    await reset('', NEW_PASSWORD).expect(400);
    await reset('made-up-token', NEW_PASSWORD).expect(400);
    await reset(englishToken, NEW_PASSWORD).expect(204);
  });

  it('limits how often a reset can be asked for', async () => {
    for (let attempt = 0; attempt < TEST_RATE_LIMIT; attempt += 1) {
      await forgot(`someone${attempt}@example.com`).expect(204);
    }

    const refused = await forgot('one-more@example.com').expect(429);

    expect(refused.body.code).toBe('RATE_LIMITED');
  });
});
