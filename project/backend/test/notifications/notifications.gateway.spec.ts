import { NotificationsGateway } from 'src/notifications/notifications.gateway';

function fakeSessions() {
  return {
    resolve: jest.fn().mockResolvedValue(null),
  };
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
      const gw = new NotificationsGateway(sessions as any, fakeConfig() as any);
      const client = fakeSocket(undefined);

      await gw.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects when sessions.resolve returns null', async () => {
      const sessions = fakeSessions();
      sessions.resolve.mockResolvedValue(null);
      const gw = new NotificationsGateway(sessions as any, fakeConfig() as any);
      const client = fakeSocket('tvz_session=badtoken');

      await gw.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('joins userId room when session is valid', async () => {
      const sessions = fakeSessions();
      sessions.resolve.mockResolvedValue({ user: { id: 'u1', platformRoles: [] } });
      const gw = new NotificationsGateway(sessions as any, fakeConfig() as any);
      const client = fakeSocket('tvz_session=validtoken');

      await gw.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.userId).toBe('u1');
      expect(client.join).toHaveBeenCalledWith('u1');
    });
  });

  describe('pushToUser', () => {
    it('calls server.to(userId).emit with notification payload', () => {
      const gw = new NotificationsGateway(fakeSessions() as any, fakeConfig() as any);
      const server = fakeServer();
      gw.server = server;

      gw.pushToUser('u1', { type: 'test' });

      expect(server.to).toHaveBeenCalledWith('u1');
      expect(server.emit).toHaveBeenCalledWith('notification', { type: 'test' });
    });

    it('no-ops when server is undefined', () => {
      const gw = new NotificationsGateway(fakeSessions() as any, fakeConfig() as any);
      (gw as any).server = undefined;
      expect(() => gw.pushToUser('u1', {})).not.toThrow();
    });
  });

  describe('broadcast', () => {
    it('calls server.emit with notification payload', () => {
      const gw = new NotificationsGateway(fakeSessions() as any, fakeConfig() as any);
      const server = fakeServer();
      gw.server = server;

      gw.broadcast({ type: 'global' });

      expect(server.emit).toHaveBeenCalledWith('notification', { type: 'global' });
    });
  });

  describe('syncUser', () => {
    it('emits notification:sync to the user room', () => {
      const gw = new NotificationsGateway(fakeSessions() as any, fakeConfig() as any);
      const server = fakeServer();
      gw.server = server;

      gw.syncUser('u1', { kind: 'read', id: 'n1' });

      expect(server.to).toHaveBeenCalledWith('u1');
      expect(server.emit).toHaveBeenCalledWith('notification:sync', { kind: 'read', id: 'n1' });
    });
  });
});
