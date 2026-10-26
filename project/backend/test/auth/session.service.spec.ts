import { createHash } from 'node:crypto';
import { SessionService } from 'src/auth/session.service';

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = { sessionTtlDays: 1 };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides })[k]) };
}

function makeSession(overrides = {}) {
  return {
    id: 'sess1',
    userId: 'u1',
    tokenHash: 'hash',
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    userAgent: null,
    ip: null,
    createdAt: new Date(),
    user: { id: 'u1', status: 'active', platformRoles: [] },
    ...overrides,
  };
}

function fakePrisma() {
  const sessions = new Map<string, ReturnType<typeof makeSession>>();
  return {
    session: {
      create: jest.fn(async ({ data }: any) => {
        const s = makeSession({ ...data, id: data.id ?? 'sess1' });
        sessions.set(s.tokenHash, s);
        return s;
      }),
      findUnique: jest.fn(async ({ where }: any) => sessions.get(where.tokenHash) ?? null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
    },
    __sessions: sessions,
    __seedSession: (data = {}) => {
      const s = makeSession(data);
      sessions.set(s.tokenHash, s);
      return s;
    },
  };
}

describe('SessionService', () => {
  describe('issue', () => {
    it('returns base64url token and future expiresAt', async () => {
      const prisma = fakePrisma();
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      const before = Date.now();
      const { token, expiresAt } = await svc.issue('u1', {
        userAgent: 'test-agent',
        ip: '127.0.0.1',
      });
      expect(token).toBeTruthy();
      expect(expiresAt.getTime()).toBeGreaterThan(before);
    });

    it('stores SHA-256 hash of token, not the raw token', async () => {
      const prisma = fakePrisma();
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      const { token } = await svc.issue('u1', {});
      const [{ data }] = (prisma.session.create as jest.Mock).mock.calls[0];
      expect(data.tokenHash).toBe(hash(token));
      expect(data.tokenHash).not.toBe(token);
    });
  });

  describe('resolve', () => {
    it('returns session for valid token', async () => {
      const prisma = fakePrisma();
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      const { token } = await svc.issue('u1', {});
      const session = await svc.resolve(token);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('u1');
    });

    it('returns null for unknown token', async () => {
      const prisma = fakePrisma();
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      const result = await svc.resolve('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when revokedAt is set', async () => {
      const prisma = fakePrisma();
      prisma.__seedSession({ tokenHash: hash('tok'), revokedAt: new Date() });
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      const result = await svc.resolve('tok');
      expect(result).toBeNull();
    });

    it('returns null when session is expired', async () => {
      const prisma = fakePrisma();
      prisma.__seedSession({ tokenHash: hash('tok'), expiresAt: new Date(Date.now() - 1000) });
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      const result = await svc.resolve('tok');
      expect(result).toBeNull();
    });

    it('returns null when user status is not active', async () => {
      const prisma = fakePrisma();
      prisma.__seedSession({
        tokenHash: hash('tok'),
        user: { id: 'u1', status: 'suspended', platformRoles: [] },
      });
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      const result = await svc.resolve('tok');
      expect(result).toBeNull();
    });
  });

  describe('revoke', () => {
    it('calls updateMany with hashed token', async () => {
      const prisma = fakePrisma();
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      await svc.revoke('mytoken');
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tokenHash: hash('mytoken') }),
        }),
      );
    });
  });

  describe('revokeAllForUser', () => {
    it('calls updateMany without id.not when no exceptSessionId', async () => {
      const prisma = fakePrisma();
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      await svc.revokeAllForUser('u1');
      const [{ where }] = (prisma.session.updateMany as jest.Mock).mock.calls[0];
      expect(where.id).toBeUndefined();
    });

    it('calls updateMany with id.not when exceptSessionId provided', async () => {
      const prisma = fakePrisma();
      const svc = new SessionService(prisma as any, fakeConfig() as any);
      await svc.revokeAllForUser('u1', 'keep-this');
      const [{ where }] = (prisma.session.updateMany as jest.Mock).mock.calls[0];
      expect(where.id).toEqual({ not: 'keep-this' });
    });
  });

  describe('maxAgeMs', () => {
    it('reflects sessionTtlDays from config', () => {
      const svc = new SessionService(fakePrisma() as any, fakeConfig({ sessionTtlDays: 7 }) as any);
      expect(svc.maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
