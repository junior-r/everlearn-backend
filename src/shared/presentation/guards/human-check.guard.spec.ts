import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeHumanCheck } from '../../../../test/support/identity.fakes.js';
import { HumanCheckFailedException } from '../../domain/human-check/human-check.js';
import { HumanCheckGuard, RequireHumanCheck } from './human-check.guard.js';

function setup(action: string | null = 'login') {
  const humanCheck = new FakeHumanCheck();
  const guard = new HumanCheckGuard(new Reflector(), humanCheck);
  const handler = () => undefined;
  if (action) {
    RequireHumanCheck(action)(handler, 'handler', { value: handler });
  }
  const attempt = (headers: Record<string, string | string[]> = {}) =>
    guard.canActivate({
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ ip: '203.0.113.7', headers }) }),
    } as unknown as ExecutionContext);
  return { humanCheck, attempt };
}

describe('HumanCheckGuard', () => {
  it('lets a route without the decorator through without asking', async () => {
    const { humanCheck, attempt } = setup(null);

    await expect(attempt()).resolves.toBe(true);
    expect(humanCheck.requests).toHaveLength(0);
  });

  it('asks about the header token for the route action and the caller IP', async () => {
    const { humanCheck, attempt } = setup();

    await expect(attempt({ 'x-human-check': 'solved-token' })).resolves.toBe(true);
    expect(humanCheck.requests).toEqual([
      { token: 'solved-token', action: 'login', remoteIp: '203.0.113.7' },
    ]);
  });

  it('refuses when the check fails', async () => {
    const { humanCheck, attempt } = setup();
    humanCheck.outcome = 'failed';

    await expect(attempt({ 'x-human-check': 'bad' })).rejects.toBeInstanceOf(
      HumanCheckFailedException,
    );
  });

  it('sends an empty token when the header is missing or repeated', async () => {
    const { humanCheck, attempt } = setup();

    await attempt();
    await attempt({ 'x-human-check': ['a', 'b'] });

    expect(humanCheck.requests.map((request) => request.token)).toEqual(['', '']);
  });

  it('lets the request through when the check is unavailable', async () => {
    const { humanCheck, attempt } = setup();
    humanCheck.outcome = 'unavailable';

    await expect(attempt({ 'x-human-check': 'solved-token' })).resolves.toBe(true);
  });
});
