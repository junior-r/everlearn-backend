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
