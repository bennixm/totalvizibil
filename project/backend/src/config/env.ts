/**
 * Environment validation. Fail fast on a bad config instead of at first request.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  sessionCookieName: string;
  sessionTtlDays: number;
  sessionCookieSecure: boolean;
  frontendOrigin: string;
  /** DeepSeek API key — powers the one Simple-site AI call (Services copy). Empty = deterministic fallback. */
  deepseekApiKey: string;
}

// Matches project/docker-compose.yml. Used only as a dev fallback when .env is
// missing (it lives in a OneDrive folder and sometimes disappears).
const DEV_DATABASE_URL = 'postgresql://tvz:tvz@localhost:5432/tvz?schema=public';

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  let databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (nodeEnv === 'production') {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    console.warn('[config] DATABASE_URL not set — falling back to the local dev database');
    databaseUrl = DEV_DATABASE_URL;
    // PrismaClient reads process.env directly, so make the fallback visible to it too.
    process.env.DATABASE_URL = databaseUrl;
  }

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    databaseUrl,
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'tvz_session',
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === 'true',
    frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
  };
}

export const CONFIG = Symbol('APP_CONFIG');
