import { loadConfig } from 'src/config/env';

/**
 * Only the session-cookie `Secure` safeguard is covered here: a production
 * deploy must never serve the session cookie without it, whatever `.env` says.
 */
describe('loadConfig — sessionCookieSecure', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { ...original };
    // Keep the production branch from tripping the other fail-fast checks.
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/tvz?schema=public';
    process.env.FRONTEND_ORIGIN = 'https://totalvizibil.ro';
  });

  afterAll(() => {
    process.env = original;
  });

  it('forces the Secure flag on in production even when the env var says false', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_COOKIE_SECURE = 'false';
    expect(loadConfig().sessionCookieSecure).toBe(true);
  });

  it('forces the Secure flag on in production even when the env var is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_COOKIE_SECURE;
    expect(loadConfig().sessionCookieSecure).toBe(true);
  });

  it('honours the env var outside production (plain-HTTP localhost dev)', () => {
    process.env.NODE_ENV = 'development';
    process.env.SESSION_COOKIE_SECURE = 'false';
    expect(loadConfig().sessionCookieSecure).toBe(false);

    process.env.SESSION_COOKIE_SECURE = 'true';
    expect(loadConfig().sessionCookieSecure).toBe(true);
  });
});
