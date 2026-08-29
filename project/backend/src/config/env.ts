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
}

function required(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'tvz_session',
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === 'true',
    frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  };
}

export const CONFIG = Symbol('APP_CONFIG');
