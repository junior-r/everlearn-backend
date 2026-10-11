import { RedisDashboardCache, type CacheStore } from './redis-dashboard-cache.js';

class FakeRedis implements CacheStore {
  readonly values = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  failGet = false;
  failSet = false;

  get(key: string): Promise<string | null> {
    return this.failGet ? Promise.reject(new Error('redis down')) : Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, _mode: 'EX', seconds: number): Promise<unknown> {
    if (this.failSet) {
      return Promise.reject(new Error('redis down'));
    }
    this.values.set(key, value);
    this.expiries.set(key, seconds);
    return Promise.resolve('OK');
  }
}

describe('RedisDashboardCache', () => {
  it('loads once, stores the value with its lifetime, and answers from the store after that', async () => {
    const redis = new FakeRedis();
    const cache = new RedisDashboardCache(redis);
    let loads = 0;
    const load = () => Promise.resolve({ totalUsers: 120 + (loads += 1) });

    const first = await cache.remember('platform', 30, load);
    const second = await cache.remember('platform', 30, load);

    expect(first).toEqual({ totalUsers: 121 });
    expect(second).toEqual({ totalUsers: 121 });
    expect(loads).toBe(1);
    expect(redis.expiries.get('dashboard:platform')).toBe(30);
  });

  it('keeps keys apart', async () => {
    const cache = new RedisDashboardCache(new FakeRedis());

    await cache.remember('institution:a', 30, () => Promise.resolve(1));

    expect(await cache.remember('institution:b', 30, () => Promise.resolve(2))).toBe(2);
  });

  it('does not touch Redis when the lifetime is 0', async () => {
    const redis = new FakeRedis();
    redis.failGet = true;

    expect(await new RedisDashboardCache(redis).remember('platform', 0, () => Promise.resolve(7))).toBe(7);
    expect(redis.values.size).toBe(0);
  });

  it('counts anyway when Redis cannot be read or written', async () => {
    const unreadable = new FakeRedis();
    unreadable.failGet = true;
    const unwritable = new FakeRedis();
    unwritable.failSet = true;

    expect(await new RedisDashboardCache(unreadable).remember('platform', 30, () => Promise.resolve(7))).toBe(7);
    expect(await new RedisDashboardCache(unwritable).remember('platform', 30, () => Promise.resolve(8))).toBe(8);
  });

  it('lets a failure of the count itself through, and stores nothing', async () => {
    const redis = new FakeRedis();

    await expect(
      new RedisDashboardCache(redis).remember('platform', 30, () => Promise.reject(new Error('database down'))),
    ).rejects.toThrow('database down');
    expect(redis.values.size).toBe(0);
  });
});
