import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InMemoryRateLimiter } from '../../../../test/support/identity.fakes.js';
import { loadAppConfig } from '../../../config/app-config.js';
import { RateLimitExceededException } from '../../domain/rate-limit/rate-limiter.js';
import { RateLimit, RateLimitGuard, type RateLimitOptions } from './rate-limit.guard.js';

const config = loadAppConfig({
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  RATE_LIMIT_AUTH_MAX_ATTEMPTS: '3',
  RATE_LIMIT_AUTH_WINDOW_SECONDS: '60',
});

function setup(options: RateLimitOptions | null = { scope: 'auth-login', bodyField: 'email' }) {
  const limiter = new InMemoryRateLimiter();
  const guard = new RateLimitGuard(new Reflector(), limiter, config);
  const headers = new Map<string, string>();
  const handler = () => undefined;
  if (options) {
    RateLimit(options)(handler, 'handler', { value: handler });
  }
  const attempt = (ip: string, body: unknown = {}) =>
    guard.canActivate({
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ ip, body }),
        getResponse: () => ({ setHeader: (name: string, value: string) => headers.set(name, value) }),
      }),
    } as unknown as ExecutionContext);
  return { limiter, headers, attempt };
}

describe('RateLimitGuard', () => {
  it('allows attempts up to the limit, then blocks with a Retry-After header', async () => {
    const { attempt, headers } = setup();

    for (let i = 0; i < 3; i += 1) {
      await expect(attempt('10.0.0.1')).resolves.toBe(true);
    }

    await expect(attempt('10.0.0.1')).rejects.toBeInstanceOf(RateLimitExceededException);
    expect(headers.get('Retry-After')).toBe('60');
  });

  it('counts each IP separately', async () => {
    const { attempt } = setup();
    for (let i = 0; i < 3; i += 1) {
      await attempt('10.0.0.1');
    }

    await expect(attempt('10.0.0.2')).resolves.toBe(true);
  });

  it('blocks attacks on one account spread across many IPs, ignoring email case', async () => {
    const { attempt } = setup();
    await attempt('10.0.0.1', { email: 'ada@example.com' });
    await attempt('10.0.0.2', { email: 'ADA@example.com' });
    await attempt('10.0.0.3', { email: ' ada@example.com ' });

    await expect(attempt('10.0.0.4', { email: 'ada@example.com' })).rejects.toBeInstanceOf(
      RateLimitExceededException,
    );
    await expect(attempt('10.0.0.4', { email: 'grace@example.com' })).resolves.toBe(true);
  });

  it('namespaces the counter by scope, so endpoints do not share a budget', async () => {
    const login = setup({ scope: 'auth-login' });

    await login.attempt('10.0.0.1');

    const keys = [...login.limiter.attempts.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^auth-login:ip:/);
  });

  it('does not store the email or IP in clear text', async () => {
    const { attempt, limiter } = setup();

    await attempt('10.0.0.1', { email: 'ada@example.com' });

    const keys = [...limiter.attempts.keys()].join(' ');
    expect(keys).not.toContain('ada@example.com');
    expect(keys).not.toContain('10.0.0.1');
  });

  it('ignores a non-string body field instead of failing', async () => {
    const { attempt, limiter } = setup();

    await expect(attempt('10.0.0.1', { email: { $gt: '' } })).resolves.toBe(true);
    expect(limiter.attempts.size).toBe(1);
  });

  it('lets requests through when the limiter backend is down', async () => {
    const { attempt, limiter } = setup();
    limiter.failWith = new Error('redis unavailable');

    await expect(attempt('10.0.0.1')).resolves.toBe(true);
  });

  it('does nothing on routes without @RateLimit', async () => {
    const { attempt, limiter } = setup(null);

    await expect(attempt('10.0.0.1')).resolves.toBe(true);
    expect(limiter.attempts.size).toBe(0);
  });
});
