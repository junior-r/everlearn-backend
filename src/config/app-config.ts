export const APP_CONFIG = Symbol('AppConfig');

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface RateLimitConfig {
  authMaxAttempts: number;
  authWindowSeconds: number;
}

export interface AppConfig {
  port: number;
  isProduction: boolean;
  databaseUrl: string;
  redisUrl: string;
  frontendUrl: string;
  uploadsDir: string;
  jwt: JwtConfig;
  google: GoogleOAuthConfig | null;
  rateLimit: RateLimitConfig;
  /** Credentials of the first Platform Admin, created on start if missing. Null disables this. */
  platformAdmin: PlatformAdminConfig | null;
  /** The ocr-server microservice. Null uses the built-in mock, for running without Docker. */
  ocr: OcrServiceConfig | null;
}

export interface OcrServiceConfig {
  url: string;
  internalSecret: string;
}

export interface PlatformAdminConfig {
  email: string;
  password: string;
}

type Env = Record<string, string | undefined>;

const MIN_SECRET_LENGTH = 32;

function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function secret(env: Env, key: string): string {
  const value = required(env, key);
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${key} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return value;
}

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function googleConfig(env: Env): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri: required(env, 'GOOGLE_REDIRECT_URI'),
  };
}

const MIN_ADMIN_PASSWORD_LENGTH = 12;

function platformAdminConfig(env: Env): PlatformAdminConfig | null {
  const email = env.PLATFORM_ADMIN_EMAIL;
  const password = env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) {
    return null;
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `PLATFORM_ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
    );
  }
  return { email, password };
}

/**
 * Builds the typed configuration from the environment and fails fast on
 * missing or weak values. Google OAuth is optional and null when unset.
 */
export function loadAppConfig(env: Env): AppConfig {
  return {
    port: positiveInt(env, 'PORT', 4000),
    isProduction: env.NODE_ENV === 'production',
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    frontendUrl: env.FRONTEND_URL ?? 'http://localhost:3000',
    uploadsDir: env.UPLOADS_DIR ?? './uploads',
    jwt: {
      accessSecret: secret(env, 'JWT_ACCESS_SECRET'),
      refreshSecret: secret(env, 'JWT_REFRESH_SECRET'),
      accessTtlSeconds: positiveInt(env, 'JWT_ACCESS_TTL_SECONDS', 900),
      refreshTtlSeconds: positiveInt(env, 'JWT_REFRESH_TTL_SECONDS', 604800),
    },
    google: googleConfig(env),
    rateLimit: {
      authMaxAttempts: positiveInt(env, 'RATE_LIMIT_AUTH_MAX_ATTEMPTS', 10),
      authWindowSeconds: positiveInt(env, 'RATE_LIMIT_AUTH_WINDOW_SECONDS', 60),
    },
    platformAdmin: platformAdminConfig(env),
    ocr: env.OCR_SERVICE_URL
      ? { url: env.OCR_SERVICE_URL, internalSecret: required(env, 'INTERNAL_SERVICE_SECRET') }
      : null,
  };
}
