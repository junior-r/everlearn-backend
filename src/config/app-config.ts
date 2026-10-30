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
  /**
   * Reverse proxies in front of the server whose `X-Forwarded-For` is believed.
   * 0 (no proxy) ignores the header, so a caller cannot choose the address they are limited by.
   */
  trustedProxies: number;
  uploadsDir: string;
  jwt: JwtConfig;
  google: GoogleOAuthConfig | null;
  rateLimit: RateLimitConfig;
  /** Credentials of the first Platform Admin, created on start if missing. Null disables this. */
  platformAdmin: PlatformAdminConfig | null;
  /** The ocr-server microservice. Null uses the built-in mock, for running without Docker. */
  ocr: OcrServiceConfig | null;
  /** Credentials for signing LiveKit access tokens. Null makes video classes unavailable. */
  livekit: LiveKitConfig | null;
  /** Shared with our microservices. Null refuses every call to the internal API. */
  internalServiceSecret: string | null;
  /** Cloudflare Turnstile, the bot check of the public forms. Null lets every request through. */
  turnstile: { secretKey: string } | null;
  ai: AiConfig;
  /** How long the platform and institution dashboards keep their figures. 0 counts them on every request. */
  analyticsCacheSeconds: number;
  reminders: RemindersConfig;
  messaging: MessagingConfig;
  email: EmailConfig;
  recordings: RecordingsConfig;
}

/** Any S3-compatible bucket: Cloudflare R2, AWS S3, MinIO. */
export interface S3StorageConfig {
  kind: 's3';
  /** Null for AWS S3 itself; R2 and MinIO give their own address. */
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface RecordingsConfig {
  /** Whether Teachers may record their classes. Needs Egress running beside LiveKit. */
  enabled: boolean;
  /** Where Egress leaves finished recordings until they are stored. */
  spoolDir: string;
  /** `local` keeps them under the uploads directory and serves them through this API. */
  storage: { kind: 'local' } | S3StorageConfig;
  /** Where browsers reach this API, for the links of recordings kept on local disk. */
  publicApiUrl: string;
  /** Whether this server moves finished recordings into storage. Off by default in tests. */
  archiveEnabled: boolean;
}

export interface EmailConfig {
  /** The real email service. Null writes emails to the log instead of sending them. */
  resend: { apiKey: string; from: string } | null;
  /** True when real email was asked for but is not fully configured, so the log is used instead. */
  realEmailWithoutKey: boolean;
  /** Whether the log also gets the text of each email. For a developer's own machine only. */
  logBodies: boolean;
}

export interface RemindersConfig {
  /** Whether this server runs the reminder job. On by default outside tests. */
  enabled: boolean;
  /** When the job runs, as a cron expression. */
  cron: string;
}

export interface MessagingConfig {
  /** Direct messages one member may send per window. */
  maxMessages: number;
  windowSeconds: number;
}

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

export interface AiConfig {
  /** The real model behind the assistant. Null runs the built-in mock. */
  openai: OpenAIConfig | null;
  /** True when a real model was asked for but no key was given, so the mock runs instead. */
  realAiWithoutKey: boolean;
  /** Questions one member may ask the assistant per window. */
  chatMaxQuestions: number;
  chatWindowSeconds: number;
}

export interface LiveKitConfig {
  apiKey: string;
  apiSecret: string;
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

function nonNegativeInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a whole number, 0 or more`);
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

function liveKitConfig(env: Env): LiveKitConfig | null {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return null;
  }
  return { apiKey: env.LIVEKIT_API_KEY, apiSecret: secret(env, 'LIVEKIT_API_SECRET') };
}

function flag(env: Env, key: string): boolean {
  const raw = (env[key] ?? '').trim().toLowerCase();
  if (raw !== '' && raw !== 'true' && raw !== 'false') {
    throw new Error(`${key} must be true or false`);
  }
  return raw === 'true';
}

/** Emails go through Resend only when it is switched on and has both a key and a sender. */
function emailConfig(env: Env): EmailConfig {
  const useRealEmail = flag(env, 'USE_REAL_EMAIL');
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  const isConfigured = Boolean(apiKey && from);
  return {
    resend: useRealEmail && apiKey && from ? { apiKey, from } : null,
    realEmailWithoutKey: useRealEmail && !isConfigured,
    logBodies: flag(env, 'EMAIL_LOG_BODIES'),
  };
}

/** The assistant runs on OpenAI only when it is switched on and has a key; otherwise on the mock. */
function aiConfig(env: Env): AiConfig {
  const useRealAi = flag(env, 'USE_REAL_AI');
  const apiKey = env.OPENAI_API_KEY?.trim();
  return {
    openai: useRealAi && apiKey ? { apiKey, model: env.OPENAI_MODEL?.trim() || 'gpt-4o-mini' } : null,
    realAiWithoutKey: useRealAi && !apiKey,
    chatMaxQuestions: positiveInt(env, 'AI_CHAT_MAX_QUESTIONS', 20),
    chatWindowSeconds: positiveInt(env, 'AI_CHAT_WINDOW_SECONDS', 60),
  };
}

function recordingStorage(env: Env): RecordingsConfig['storage'] {
  const kind = (env.RECORDINGS_STORAGE ?? '').trim().toLowerCase() || 'local';
  if (kind === 'local') {
    return { kind };
  }
  if (kind !== 's3') {
    throw new Error('RECORDINGS_STORAGE must be local or s3');
  }
  return {
    kind,
    endpoint: env.RECORDINGS_S3_ENDPOINT?.trim() || null,
    region: env.RECORDINGS_S3_REGION?.trim() || 'auto',
    bucket: required(env, 'RECORDINGS_S3_BUCKET'),
    accessKeyId: required(env, 'RECORDINGS_S3_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'RECORDINGS_S3_SECRET_ACCESS_KEY'),
  };
}

function recordingsConfig(env: Env, port: number): RecordingsConfig {
  return {
    enabled: flag(env, 'RECORDINGS_ENABLED'),
    spoolDir: env.RECORDINGS_SPOOL_DIR?.trim() || './recordings-spool',
    storage: recordingStorage(env),
    publicApiUrl: (env.PUBLIC_API_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, ''),
    archiveEnabled:
      (env.RECORDINGS_ARCHIVE_ENABLED ?? '').trim() === ''
        ? env.NODE_ENV !== 'test'
        : flag(env, 'RECORDINGS_ARCHIVE_ENABLED'),
  };
}

/**
 * Builds the typed configuration from the environment and fails fast on
 * missing or weak values. Google OAuth is optional and null when unset.
 */
export function loadAppConfig(env: Env): AppConfig {
  const port = positiveInt(env, 'PORT', 4000);
  return {
    port,
    isProduction: env.NODE_ENV === 'production',
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    frontendUrl: env.FRONTEND_URL ?? 'http://localhost:3000',
    trustedProxies: nonNegativeInt(env, 'TRUSTED_PROXIES', 0),
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
    livekit: liveKitConfig(env),
    internalServiceSecret: env.INTERNAL_SERVICE_SECRET || null,
    turnstile: env.TURNSTILE_SECRET_KEY?.trim() ? { secretKey: env.TURNSTILE_SECRET_KEY.trim() } : null,
    ai: aiConfig(env),
    analyticsCacheSeconds: nonNegativeInt(env, 'ANALYTICS_CACHE_SECONDS', 30),
    reminders: {
      enabled: (env.REMINDERS_ENABLED ?? '').trim() === '' ? env.NODE_ENV !== 'test' : flag(env, 'REMINDERS_ENABLED'),
      cron: env.REMINDERS_CRON?.trim() || '*/5 * * * *',
    },
    email: emailConfig(env),
    messaging: {
      maxMessages: positiveInt(env, 'MESSAGES_MAX_PER_WINDOW', 30),
      windowSeconds: positiveInt(env, 'MESSAGES_WINDOW_SECONDS', 60),
    },
    recordings: recordingsConfig(env, port),
  };
}
