import { loadAppConfig } from './app-config.js';

const BASE = {
  DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};
const ai = (env: Record<string, string>) => loadAppConfig({ ...BASE, ...env }).ai;

describe('the assistant\'s model', () => {
  it('is the mock by default, even with a key in the environment', () => {
    expect(ai({})).toMatchObject({ openai: null, realAiWithoutKey: false });
    expect(ai({ OPENAI_API_KEY: 'sk-test' }).openai).toBeNull();
    expect(ai({ USE_REAL_AI: 'false', OPENAI_API_KEY: 'sk-test' }).openai).toBeNull();
  });

  it('is OpenAI when it is switched on and has a key', () => {
    expect(ai({ USE_REAL_AI: 'true', OPENAI_API_KEY: ' sk-test ' })).toMatchObject({
      openai: { apiKey: 'sk-test', model: 'gpt-4o-mini' },
      realAiWithoutKey: false,
    });
    expect(ai({ USE_REAL_AI: 'TRUE', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-4o' }).openai?.model).toBe('gpt-4o');
  });

  it('falls back to the mock, and says so, when it is switched on without a key', () => {
    expect(ai({ USE_REAL_AI: 'true' })).toMatchObject({ openai: null, realAiWithoutKey: true });
    expect(ai({ USE_REAL_AI: 'true', OPENAI_API_KEY: '   ' })).toMatchObject({ openai: null, realAiWithoutKey: true });
  });

  it('refuses a switch that is neither true nor false', () => {
    expect(() => ai({ USE_REAL_AI: 'yes' })).toThrow('USE_REAL_AI must be true or false');
  });
});

describe('how emails are sent', () => {
  const email = (env: Record<string, string>) => loadAppConfig({ ...BASE, ...env }).email;

  it('logs them by default, without their text', () => {
    expect(email({})).toEqual({ resend: null, realEmailWithoutKey: false, logBodies: false });
    expect(email({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'Everlearn <a@b.co>' }).resend).toBeNull();
  });

  it('uses Resend when it is switched on with a key and a sender', () => {
    expect(email({ USE_REAL_EMAIL: 'true', RESEND_API_KEY: ' re_test ', EMAIL_FROM: ' Everlearn <a@b.co> ' })).toMatchObject({
      resend: { apiKey: 're_test', from: 'Everlearn <a@b.co>' },
      realEmailWithoutKey: false,
    });
  });

  it('falls back to the log, and says so, when the key or the sender is missing', () => {
    expect(email({ USE_REAL_EMAIL: 'true' })).toMatchObject({ resend: null, realEmailWithoutKey: true });
    expect(email({ USE_REAL_EMAIL: 'true', RESEND_API_KEY: 're_test' })).toMatchObject({
      resend: null,
      realEmailWithoutKey: true,
    });
  });

  it('logs the text of emails only when asked to', () => {
    expect(email({ EMAIL_LOG_BODIES: 'true' }).logBodies).toBe(true);
    expect(() => email({ EMAIL_LOG_BODIES: 'si' })).toThrow('EMAIL_LOG_BODIES must be true or false');
  });
});

describe('reverse proxies', () => {
  const proxies = (env: Record<string, string>) => loadAppConfig({ ...BASE, ...env }).trustedProxies;

  it('trusts none unless told how many stand in front of the server', () => {
    expect(proxies({})).toBe(0);
    expect(proxies({ TRUSTED_PROXIES: '1' })).toBe(1);
    expect(() => proxies({ TRUSTED_PROXIES: 'all' })).toThrow('TRUSTED_PROXIES must be a whole number, 0 or more');
  });
});

describe('recordings', () => {
  const recordings = (env: Record<string, string>) => loadAppConfig({ ...BASE, ...env }).recordings;

  it('are off and kept on local disk by default', () => {
    expect(recordings({})).toMatchObject({ enabled: false, storage: { kind: 'local' }, publicApiUrl: 'http://localhost:4000' });
  });

  it('go to an S3-compatible bucket, such as R2, when one is configured', () => {
    expect(
      recordings({
        RECORDINGS_ENABLED: 'true',
        RECORDINGS_STORAGE: 'S3',
        RECORDINGS_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
        RECORDINGS_S3_BUCKET: 'classes',
        RECORDINGS_S3_ACCESS_KEY_ID: 'id',
        RECORDINGS_S3_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toMatchObject({
      enabled: true,
      storage: { kind: 's3', endpoint: 'https://account.r2.cloudflarestorage.com', region: 'auto', bucket: 'classes' },
    });
  });

  it('refuse a bucket without its credentials, and an unknown storage', () => {
    expect(() => recordings({ RECORDINGS_STORAGE: 's3', RECORDINGS_S3_BUCKET: 'classes' })).toThrow(
      'RECORDINGS_S3_ACCESS_KEY_ID',
    );
    expect(() => recordings({ RECORDINGS_STORAGE: 'ftp' })).toThrow('RECORDINGS_STORAGE');
  });
});
