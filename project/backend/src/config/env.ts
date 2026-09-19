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
  /** Anthropic (Claude) API key — the only AI provider for both website builders. Empty ⇒ deterministic fallback. */
  anthropicApiKey: string;
  /** Claude model id for the builders (e.g. `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`). */
  anthropicModel: string;
  /** Optional faster/cheaper model for the mechanical generator calls (copy, image intents, review). Empty ⇒ `anthropicModel`. */
  anthropicModelFast: string;
  /** Pexels API key — primary stock-photo provider for the Advanced generator. Empty ⇒ curated pool fallback. */
  pexelsApiKey: string;
  /** DeepSeek API key — PRO V2's cheaper-tier provider only. Empty ⇒ PRO V2's router uses Claude for everything. */
  deepseekApiKey: string;
  /** Cheap/fast DeepSeek tier for simple edits and boilerplate. */
  deepseekModelFlash: string;
  /** Stronger/pricier DeepSeek tier for harder multi-file work. */
  deepseekModelPro: string;
  /** `on` enables the opt-in post-generation visual (screenshot + vision) QA pass. */
  visualQa: boolean;
  /** Dev-only URL of a screenshot service (`?url=` → PNG). Empty ⇒ visual QA no-ops. */
  screenshotUrl: string;
  /** Stripe secret key (test mode, `sk_test_...`). Empty ⇒ purchases keep using
   *  the dev stub confirm flow and refunds are unavailable (nothing real to
   *  refund). */
  stripeSecretKey: string;
  /** Gmail SMTP, for testing real outbound mail. Empty user/pass ⇒ MailService
   *  keeps its dev-log-only fallback (nothing is ever faked as sent). */
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
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
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? '',
    anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5',
    anthropicModelFast: process.env.ANTHROPIC_MODEL_FAST?.trim() ?? '',
    pexelsApiKey: process.env.PEXELS_API_KEY?.trim() ?? '',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
    deepseekModelFlash: process.env.DEEPSEEK_MODEL_FLASH?.trim() || 'deepseek-chat',
    deepseekModelPro: process.env.DEEPSEEK_MODEL_PRO?.trim() || 'deepseek-reasoner',
    visualQa: (process.env.VISUAL_QA?.trim().toLowerCase() ?? '') === 'on',
    screenshotUrl: process.env.SCREENSHOT_URL?.trim() ?? '',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() ?? '',
    smtpHost: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER?.trim() ?? '',
    smtpPass: process.env.SMTP_PASS?.trim() ?? '',
    smtpFrom: process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || '',
  };
}

export const CONFIG = Symbol('APP_CONFIG');
