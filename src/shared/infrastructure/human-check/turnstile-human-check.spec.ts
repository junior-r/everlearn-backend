import { TurnstileHumanCheck } from './turnstile-human-check.js';

function checkAnswering(answer: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ url: input, body: init?.body as URLSearchParams });
    return answer();
  });
  const check = new TurnstileHumanCheck({
    secretKey: 'turnstile-secret',
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { check, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const request = { token: 'solved-token', action: 'login', remoteIp: '203.0.113.7' };

describe('TurnstileHumanCheck', () => {
  it('passes a token Siteverify accepts for the same action, sending the secret and the IP', async () => {
    const { check, calls } = checkAnswering(() => json({ success: true, action: 'login' }));

    await expect(check.verify(request)).resolves.toBe('passed');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(calls[0].body)).toEqual({
      secret: 'turnstile-secret',
      response: 'solved-token',
      remoteip: '203.0.113.7',
    });
  });

  it('fails a token solved for another form', async () => {
    const { check } = checkAnswering(() => json({ success: true, action: 'forgot-password' }));

    await expect(check.verify(request)).resolves.toBe('failed');
  });

  it('passes the answer of Cloudflare test keys, which carries no action', async () => {
    const { check } = checkAnswering(() => json({ success: true }));

    await expect(check.verify(request)).resolves.toBe('passed');
  });

  it('fails without asking when there is no token, or one too long to be real', async () => {
    const { check, calls } = checkAnswering(() => json({ success: true }));

    await expect(check.verify({ ...request, token: '' })).resolves.toBe('failed');
    await expect(check.verify({ ...request, token: 'x'.repeat(2049) })).resolves.toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('fails a token Siteverify refuses, such as a reused or expired one', async () => {
    const { check } = checkAnswering(() =>
      json({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );

    await expect(check.verify(request)).resolves.toBe('failed');
  });

  it('reports unavailable when Cloudflare cannot answer, so the caller is not blamed', async () => {
    const internal = checkAnswering(() => json({ success: false, 'error-codes': ['internal-error'] }));
    const serverError = checkAnswering(() => json({}, 503));
    const unreachable = checkAnswering(() => Promise.reject(new TypeError('fetch failed')));

    await expect(internal.check.verify(request)).resolves.toBe('unavailable');
    await expect(serverError.check.verify(request)).resolves.toBe('unavailable');
    await expect(unreachable.check.verify(request)).resolves.toBe('unavailable');
  });

  it('omits the IP when it is unknown', async () => {
    const { check, calls } = checkAnswering(() => json({ success: true }));

    await check.verify({ ...request, remoteIp: null });

    expect(calls[0].body.has('remoteip')).toBe(false);
  });
});
