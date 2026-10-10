import { JwtService } from '@nestjs/jwt';
import { loadAppConfig, type AppConfig } from '../../../../config/app-config.js';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { BcryptPasswordHasher } from './bcrypt-password-hasher.js';
import { JwtTokenService } from './jwt-token.service.js';

const env = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

const user: AuthenticatedUser = {
  userId: 'user-1',
  email: 'ada@example.com',
  isPlatformAdmin: false,
  mustChangePassword: false,
  memberships: [{ id: 'm-1', institutionId: 'inst-1', role: Role.TEACHER }],
};

function tokenService(overrides: Partial<AppConfig['jwt']> = {}): JwtTokenService {
  const config = loadAppConfig(env);
  return new JwtTokenService(new JwtService({}), {
    ...config,
    jwt: { ...config.jwt, ...overrides },
  });
}

describe('JwtTokenService', () => {
  it('round-trips the identity through an access token', async () => {
    const service = tokenService();

    const token = await service.issueAccessToken(user);

    await expect(service.verifyAccessToken(token)).resolves.toEqual(user);
  });

  it('round-trips the user id through a refresh token with a unique id and its expiry', async () => {
    const service = tokenService({ refreshTtlSeconds: 600 });

    const first = await service.verifyRefreshToken(await service.issueRefreshToken('user-1'));
    const second = await service.verifyRefreshToken(await service.issueRefreshToken('user-1'));

    expect(first?.userId).toBe('user-1');
    expect(first?.tokenId).not.toBe(second?.tokenId);
    const secondsLeft = ((first?.expiresAt.getTime() ?? 0) - Date.now()) / 1000;
    expect(secondsLeft).toBeGreaterThan(590);
    expect(secondsLeft).toBeLessThanOrEqual(600);
  });

  it('never accepts one token kind in place of the other', async () => {
    const service = tokenService();

    const access = await service.issueAccessToken(user);
    const refresh = await service.issueRefreshToken('user-1');

    await expect(service.verifyRefreshToken(access)).resolves.toBeNull();
    await expect(service.verifyAccessToken(refresh)).resolves.toBeNull();
  });

  it('rejects tokens signed with another secret, tampered tokens and garbage', async () => {
    const token = await tokenService({ accessSecret: 'c'.repeat(32) }).issueAccessToken(user);
    const service = tokenService();

    await expect(service.verifyAccessToken(token)).resolves.toBeNull();
    await expect(service.verifyAccessToken(`${token}x`)).resolves.toBeNull();
    await expect(service.verifyAccessToken('garbage')).resolves.toBeNull();
  });

  it('rejects expired tokens', async () => {
    const signer = new JwtService({});
    const expired = await signer.signAsync(
      { typ: 'access', email: user.email, isPlatformAdmin: false,
  mustChangePassword: false, memberships: [] },
      { subject: user.userId, secret: env.JWT_ACCESS_SECRET, expiresIn: -10 },
    );

    await expect(tokenService().verifyAccessToken(expired)).resolves.toBeNull();
  });
});

describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher();

  it('verifies the original password and rejects others', async () => {
    const hash = await hasher.hash('correct-password');

    expect(hash).not.toContain('correct-password');
    await expect(hasher.verify('correct-password', hash)).resolves.toBe(true);
    await expect(hasher.verify('wrong-password', hash)).resolves.toBe(false);
  });

  it('never matches when the user has no password, including the decoy password', async () => {
    await expect(hasher.verify('anything', null)).resolves.toBe(false);
    await expect(hasher.verify('decoy-password', null)).resolves.toBe(false);
  });
});

describe('loadAppConfig', () => {
  it('fails fast on a missing or weak secret', () => {
    expect(() => loadAppConfig({ ...env, JWT_ACCESS_SECRET: undefined })).toThrow(
      'JWT_ACCESS_SECRET',
    );
    expect(() => loadAppConfig({ ...env, JWT_REFRESH_SECRET: 'short' })).toThrow(
      'JWT_REFRESH_SECRET',
    );
  });

  it('treats Google OAuth as disabled until both credentials are set', () => {
    expect(loadAppConfig(env).google).toBeNull();
    expect(loadAppConfig({ ...env, GOOGLE_CLIENT_ID: 'id' }).google).toBeNull();
    expect(
      loadAppConfig({
        ...env,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:4000/auth/google/callback',
      }).google,
    ).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:4000/auth/google/callback',
    });
  });
});
