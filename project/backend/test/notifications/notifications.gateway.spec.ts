import { createHash } from 'node:crypto';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';

function fakeSessions() {
  return {
    resolve: jest.fn().mockResolvedValue(null),
  };
}

function fakePrisma() {
  return {
    session: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A live session row in the exact shape `revalidateSessions`'s batched
 *  `select` asks for. */
function liveSessionRow(token: string, overrides: Record<string, any> = {}) {
  return {
    tokenHash: hash(token),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { status: 'active' },
    ...overrides,
  };
}

/** Builds a gateway with its socket registry pre-populated, as if each token
 *  had already completed `handleConnection`. `clientsByToken` maps a raw token
 *  to the clientIds sharing it (i.e. one user's several open tabs). */
function makeGateway(clientsByToken: Record<string, string[]> = {}) {
  const sessions = fakeSessions();
  const prisma = fakePrisma();
  const gw = new NotificationsGateway(sessions as any, prisma as any, fakeConfig() as any);

  const sockets = new Map<string, { disconnect: jest.Mock }>();
  for (const [token, clientIds] of Object.entries(clientsByToken)) {
    for (const clientId of clientIds) {
      (gw as any).tokenByClientId.set(clientId, token);
      sockets.set(clientId, { disconnect: jest.fn() });
    }
  }
  (gw as any).server = { sockets: { sockets }, to: jest.fn(), emit: jest.fn() };

  return { gw, sessions, prisma, sockets };
}

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = { sessionCookieName: 'tvz_session' };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides })[k]) };
}

function fakeServer() {
  const srv: any = {
    emit: jest.fn(),
    to: jest.fn(),
  };
  srv.to.mockReturnValue(srv);
  return srv;
}

function fakeSocket(cookieHeader?: string) {
  return {
    handshake: { headers: { cookie: cookieHeader } },
    data: {} as Record<string, any>,
    disconnect: jest.fn(),
    join: jest.fn(),
  } as any;
}

describe('NotificationsGateway', () => {
  describe('handleConnection', () => {
    it('disconnects client when no Cookie header', async () => {
      const sessions = fakeSessions();
      const gw = new NotificationsGateway(
        sessions as any,
        fakePrisma() as any,
        fakeConfig() as any,
      );
      const client = fakeSocket(undefined);

      await gw.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects when sessions.resolve returns null', async () => {
      const sessions = fakeSessions();
      sessions.resolve.mockResolvedValue(null);
      const gw = new NotificationsGateway(
        sessions as any,
        fakePrisma() as any,
        fakeConfig() as any,
      );
      const client = fakeSocket('tvz_session=badtoken');

      await gw.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('joins userId room when session is valid', async () => {
      const sessions = fakeSessions();
      sessions.resolve.mockResolvedValue({ user: { id: 'u1', platformRoles: [] } });
      const gw = new NotificationsGateway(
        sessions as any,
        fakePrisma() as any,
        fakeConfig() as any,
      );
      const client = fakeSocket('tvz_session=validtoken');

      await gw.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.userId).toBe('u1');
      expect(client.join).toHaveBeenCalledWith('u1');
    });
  });

  describe('pushToUser', () => {
    it('calls server.to(userId).emit with notification payload', () => {
      const gw = new NotificationsGateway(
        fakeSessions() as any,
        fakePrisma() as any,
        fakeConfig() as any,
      );
      const server = fakeServer();
      gw.server = server;

      gw.pushToUser('u1', { type: 'test' });

      expect(server.to).toHaveBeenCalledWith('u1');
      expect(server.emit).toHaveBeenCalledWith('notification', { type: 'test' });
    });

    it('no-ops when server is undefined', () => {
      const gw = new NotificationsGateway(
        fakeSessions() as any,
        fakePrisma() as any,
        fakeConfig() as any,
      );
      (gw as any).server = undefined;
      expect(() => gw.pushToUser('u1', {})).not.toThrow();
    });
  });

  describe('broadcast', () => {
    it('calls server.emit with notification payload', () => {
      const gw = new NotificationsGateway(
        fakeSessions() as any,
        fakePrisma() as any,
        fakeConfig() as any,
      );
      const server = fakeServer();
      gw.server = server;

      gw.broadcast({ type: 'global' });

      expect(server.emit).toHaveBeenCalledWith('notification', { type: 'global' });
    });
  });

  // -------------------------------------------------------------------------
  // revalidateSessions — the 60s timer. Three separate failure modes guarded
  // here: it used to throw unhandled (killing the process, since this repo
  // registers no `unhandledRejection` handler), it had no re-entrancy guard,
  // and it issued one sequential DB query per connected SOCKET rather than per
  // distinct session token.
  // -------------------------------------------------------------------------
  describe('revalidateSessions', () => {
    it('keeps every socket whose token resolves to a live session', async () => {
      const { gw, prisma, sockets } = makeGateway({ 'tok-a': ['c1'], 'tok-b': ['c2'] });
      prisma.session.findMany.mockResolvedValue([liveSessionRow('tok-a'), liveSessionRow('tok-b')]);

      await (gw as any).revalidateSessions();

      expect(sockets.get('c1')!.disconnect).not.toHaveBeenCalled();
      expect(sockets.get('c2')!.disconnect).not.toHaveBeenCalled();
      expect((gw as any).tokenByClientId.size).toBe(2);
    });

    it('batches ONE query for a token shared by several tabs, not one per socket', async () => {
      // One user, four open tabs — the shape that made the old per-socket loop
      // resolve the identical token four times.
      const { gw, prisma, sessions } = makeGateway({ 'tok-a': ['c1', 'c2', 'c3', 'c4'] });
      prisma.session.findMany.mockResolvedValue([liveSessionRow('tok-a')]);

      await (gw as any).revalidateSessions();

      expect(prisma.session.findMany).toHaveBeenCalledTimes(1);
      // And never through the per-token resolve() path any more.
      expect(sessions.resolve).not.toHaveBeenCalled();
      // The `in` list is the DEDUPED token set — one hash, not four.
      expect(prisma.session.findMany.mock.calls[0][0].where.tokenHash.in).toEqual([hash('tok-a')]);
    });

    it('disconnects every clientId sharing a token that no longer resolves', async () => {
      const { gw, sockets } = makeGateway({ 'tok-a': ['c1', 'c2'] });
      // Default mock: findMany returns [] — the row is gone / revoked.

      await (gw as any).revalidateSessions();

      expect(sockets.get('c1')!.disconnect).toHaveBeenCalledWith(true);
      expect(sockets.get('c2')!.disconnect).toHaveBeenCalledWith(true);
      expect((gw as any).tokenByClientId.size).toBe(0);
    });

    it.each([
      ['revoked', { revokedAt: new Date() }],
      ['expired', { expiresAt: new Date(Date.now() - 1_000) }],
      ['user no longer active', { user: { status: 'suspended' } }],
    ])('disconnects when the session row is %s', async (_label, overrides) => {
      const { gw, prisma, sockets } = makeGateway({ 'tok-a': ['c1'] });
      prisma.session.findMany.mockResolvedValue([liveSessionRow('tok-a', overrides)]);

      await (gw as any).revalidateSessions();

      expect(sockets.get('c1')!.disconnect).toHaveBeenCalledWith(true);
    });

    it('chunks the token list so a large socket count cannot blow the Postgres bind-param cap', async () => {
      // 2_500 distinct tokens against a 1_000-per-query chunk ⇒ 3 queries.
      const clientsByToken: Record<string, string[]> = {};
      for (let i = 0; i < 2_500; i++) clientsByToken[`tok-${i}`] = [`c${i}`];
      const { gw, prisma } = makeGateway(clientsByToken);
      prisma.session.findMany.mockImplementation(async ({ where }: any) =>
        where.tokenHash.in.map((tokenHash: string) => ({
          tokenHash,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: { status: 'active' },
        })),
      );

      await (gw as any).revalidateSessions();

      expect(prisma.session.findMany).toHaveBeenCalledTimes(3);
      for (const [{ where }] of prisma.session.findMany.mock.calls) {
        expect(where.tokenHash.in.length).toBeLessThanOrEqual(1_000);
      }
      // Nothing got dropped by the chunking itself.
      expect((gw as any).tokenByClientId.size).toBe(2_500);
    });

    it('C1: swallows a DB failure instead of rejecting — an unhandled rejection would kill the process', async () => {
      const { gw, prisma, sockets } = makeGateway({ 'tok-a': ['c1'] });
      prisma.session.findMany.mockRejectedValue(new Error('pool timeout'));

      await expect((gw as any).revalidateSessions()).resolves.toBeUndefined();
      // A failed pass must not mass-disconnect everyone either — it just
      // leaves the registry alone for the next tick to retry.
      expect(sockets.get('c1')!.disconnect).not.toHaveBeenCalled();
      expect((gw as any).revalidating).toBe(false);
    });

    it('C2: a pass already in flight skips a concurrent call instead of stacking', async () => {
      const { gw, prisma } = makeGateway({ 'tok-a': ['c1'] });
      let release!: () => void;
      prisma.session.findMany.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve([]))),
      );

      const first = (gw as any).revalidateSessions();
      const second = (gw as any).revalidateSessions(); // must return at once

      await Promise.race([second, new Promise((r) => setTimeout(r, 50))]);
      expect(prisma.session.findMany).toHaveBeenCalledTimes(1);

      release();
      await first;
      expect((gw as any).revalidating).toBe(false);
    });

    it('C2: the guard is released after a throwing pass, so the next tick still runs', async () => {
      const { gw, prisma } = makeGateway({ 'tok-a': ['c1'] });
      prisma.session.findMany.mockRejectedValueOnce(new Error('pool timeout'));

      await (gw as any).revalidateSessions();
      prisma.session.findMany.mockResolvedValue([liveSessionRow('tok-a')]);
      await (gw as any).revalidateSessions();

      expect(prisma.session.findMany).toHaveBeenCalledTimes(2);
    });

    it('does not query at all when no sockets are connected', async () => {
      const { gw, prisma } = makeGateway();

      await (gw as any).revalidateSessions();

      expect(prisma.session.findMany).not.toHaveBeenCalled();
    });
  });

  describe('syncUser', () => {
    it('emits notification:sync to the user room', () => {
      const gw = new NotificationsGateway(
        fakeSessions() as any,
        fakePrisma() as any,
        fakeConfig() as any,
      );
      const server = fakeServer();
      gw.server = server;

      gw.syncUser('u1', { kind: 'read', id: 'n1' });

      expect(server.to).toHaveBeenCalledWith('u1');
      expect(server.emit).toHaveBeenCalledWith('notification:sync', { kind: 'read', id: 'n1' });
    });
  });
});
