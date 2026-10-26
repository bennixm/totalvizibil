import { SessionCookieService } from 'src/auth/session-cookie.service';

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    sessionCookieName: 'tvz_session',
    sessionCookieSecure: false,
  };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides })[k]) };
}

function fakeSessions(overrides: Partial<any> = {}) {
  return {
    issue: jest
      .fn()
      .mockResolvedValue({ token: 'tok123', expiresAt: new Date(Date.now() + 86400000) }),
    revoke: jest.fn().mockResolvedValue(undefined),
    get maxAgeMs() {
      return 86400000;
    },
    ...overrides,
  };
}

function fakeRes() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
}

function fakeReq(cookieValue?: string) {
  return {
    cookies: cookieValue !== undefined ? { tvz_session: cookieValue } : {},
    get: jest.fn().mockReturnValue('Mozilla/5.0'),
    ip: '127.0.0.1',
  } as any;
}

describe('SessionCookieService', () => {
  describe('start', () => {
    it('calls sessions.issue with userId and sets cookie', async () => {
      const sessions = fakeSessions();
      const svc = new SessionCookieService(sessions as any, fakeConfig() as any);
      const res = fakeRes();
      const req = fakeReq();

      await svc.start(req, res as any, 'u1');

      expect(sessions.issue).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ ip: '127.0.0.1' }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'tvz_session',
        'tok123',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
      );
    });

    it('passes secure: true when sessionCookieSecure is true', async () => {
      const sessions = fakeSessions();
      const svc = new SessionCookieService(
        sessions as any,
        fakeConfig({ sessionCookieSecure: true }) as any,
      );
      const res = fakeRes();

      await svc.start(fakeReq(), res as any, 'u1');

      expect(res.cookie).toHaveBeenCalledWith(
        'tvz_session',
        expect.any(String),
        expect.objectContaining({ secure: true }),
      );
    });
  });

  describe('clear', () => {
    it('revokes the token and clears cookie when cookie is present', async () => {
      const sessions = fakeSessions();
      const svc = new SessionCookieService(sessions as any, fakeConfig() as any);
      const res = fakeRes();

      await svc.clear(fakeReq('tok123'), res as any);

      expect(sessions.revoke).toHaveBeenCalledWith('tok123');
      expect(res.clearCookie).toHaveBeenCalledWith('tvz_session', expect.any(Object));
    });

    it('skips revoke but still clears cookie when no cookie in request', async () => {
      const sessions = fakeSessions();
      const svc = new SessionCookieService(sessions as any, fakeConfig() as any);
      const res = fakeRes();
      const req = { cookies: {}, get: jest.fn(), ip: '127.0.0.1' } as any;

      await svc.clear(req, res as any);

      expect(sessions.revoke).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });
});
