import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/** Minimal in-memory Prisma double covering exactly what NotificationsService touches. */
function fakePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  const users = new Map<string, { id: string; email: string }>();
  let seq = 0;

  return {
    notification: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `n_${++seq}`,
          readAt: null,
          dismissedAt: null,
          emailSentAt: null,
          createdAt: new Date(Date.now() + seq),
          ...data,
        };
        rows.set(row.id, row);
        return { ...row };
      }),
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) {
          const row = {
            id: `n_${++seq}`,
            readAt: null,
            dismissedAt: null,
            emailSentAt: null,
            createdAt: new Date(Date.now() + seq),
            ...d,
          };
          rows.set(row.id, row);
        }
        return { count: data.length };
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const r = rows.get(where.id);
        return r ? { ...r } : null;
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          take,
          cursor,
          skip,
        }: {
          where: {
            userId?: string;
            channels?: { has: string };
            readAt?: null;
            dismissedAt?: null;
          };
          orderBy?: { createdAt: 'asc' | 'desc' };
          take?: number;
          cursor?: { id: string };
          skip?: number;
        }) => {
          let list = [...rows.values()].filter((r) => {
            if (where.userId && r.userId !== where.userId) return false;
            if (where.channels?.has && !(r.channels as string[]).includes(where.channels.has)) {
              return false;
            }
            if (where.dismissedAt === null && r.dismissedAt != null) return false;
            return true;
          });
          list.sort((a, b) => {
            const d = (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime();
            return orderBy?.createdAt === 'asc' ? -d : d;
          });
          if (cursor) {
            const idx = list.findIndex((r) => r.id === cursor.id);
            list = idx === -1 ? [] : list.slice(idx + (skip ?? 0));
          }
          if (take != null) list = list.slice(0, take);
          return list.map((r) => ({ ...r }));
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: { userId: string; channels?: { has: string }; readAt?: null; dismissedAt?: null };
        }) => {
          return [...rows.values()].filter((r) => {
            if (r.userId !== where.userId) return false;
            if (where.channels?.has && !(r.channels as string[]).includes(where.channels.has)) {
              return false;
            }
            if (where.readAt === null && r.readAt != null) return false;
            if (where.dismissedAt === null && r.dismissedAt != null) return false;
            return true;
          }).length;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const r = rows.get(where.id) as Record<string, unknown>;
          Object.assign(r, data);
          return { ...r };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string; channels?: { has: string }; readAt?: null };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const r of rows.values()) {
            if (r.userId !== where.userId) continue;
            if (where.channels?.has && !(r.channels as string[]).includes(where.channels.has)) {
              continue;
            }
            if (where.readAt === null && r.readAt != null) continue;
            Object.assign(r, data);
            count++;
          }
          return { count };
        },
      ),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const u = users.get(where.id);
        return u ? { ...u } : null;
      }),
      findMany: jest.fn(async () => [...users.values()].map((u) => ({ ...u }))),
    },
    __rows: rows,
    __seedUser(id: string, email: string) {
      users.set(id, { id, email });
    },
  };
}

function fakeMail() {
  return { send: jest.fn(async () => ({ dispatched: true })) };
}
function fakeGateway() {
  return { pushToUser: jest.fn(), broadcast: jest.fn(), syncUser: jest.fn() };
}

function makeService() {
  const prisma = fakePrisma();
  const mail = fakeMail();
  const gateway = fakeGateway();
  const service = new NotificationsService(prisma as never, mail as never, gateway as never);
  return { service, prisma, mail, gateway };
}

describe('NotificationsService', () => {
  const USER = 'user-1';

  it('notify() creates a row, pushes only when panel is requested, emails only when email is requested', async () => {
    const { service, prisma, mail, gateway } = makeService();
    prisma.__seedUser(USER, 'u@example.com');

    await service.notify({
      userId: USER,
      type: 'lead_received',
      title: 'T',
      body: 'B',
      channels: { panel: true },
    });

    expect(gateway.pushToUser).toHaveBeenCalledTimes(1);
    expect(mail.send).not.toHaveBeenCalled();

    await service.notify({
      userId: USER,
      type: 'password_changed',
      title: 'T2',
      body: 'B2',
      channels: { email: true },
    });

    expect(gateway.pushToUser).toHaveBeenCalledTimes(1); // still just the first
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('notify() no-ops when neither channel is requested', async () => {
    const { service, prisma, gateway, mail } = makeService();
    await service.notify({ userId: USER, type: 'x', title: 'T', body: 'B', channels: {} });
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(gateway.pushToUser).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('list() and unreadCount() exclude dismissed rows', async () => {
    const { service } = makeService();
    await service.notify({
      userId: USER,
      type: 'a',
      title: 'A',
      body: 'a',
      channels: { panel: true },
    });
    const second = await service.notify({
      userId: USER,
      type: 'b',
      title: 'B',
      body: 'b',
      channels: { panel: true },
    });
    void second;
    const before = await service.list(USER);
    expect(before.items).toHaveLength(2);
    expect(await service.unreadCount(USER)).toBe(2);

    const dismissedId = before.items[0].id;
    await service.dismiss(USER, dismissedId);

    const after = await service.list(USER);
    expect(after.items).toHaveLength(1);
    expect(after.items.find((i) => i.id === dismissedId)).toBeUndefined();
    expect(await service.unreadCount(USER)).toBe(1);
  });

  it('markRead() is idempotent and syncs every device via the gateway', async () => {
    const { service, prisma, gateway } = makeService();
    await service.notify({
      userId: USER,
      type: 'a',
      title: 'A',
      body: 'a',
      channels: { panel: true },
    });
    const { items } = await service.list(USER);
    const id = items[0].id;

    await service.markRead(USER, id);
    expect((await prisma.notification.findUnique({ where: { id } }))!.readAt).not.toBeNull();
    expect(gateway.syncUser).toHaveBeenCalledWith(USER, { kind: 'read', id });

    const firstReadAt = (await prisma.notification.findUnique({ where: { id } }))!.readAt;
    await service.markRead(USER, id); // second call — must not throw or re-stamp
    expect((await prisma.notification.findUnique({ where: { id } }))!.readAt).toBe(firstReadAt);
  });

  it('markRead() rejects a notification that belongs to someone else', async () => {
    const { service } = makeService();
    await service.notify({
      userId: 'someone-else',
      type: 'a',
      title: 'A',
      body: 'a',
      channels: { panel: true },
    });
    await expect(service.markRead(USER, 'n_1')).rejects.toThrow(NotFoundException);
  });

  it('dismiss() is idempotent and syncs every device via the gateway', async () => {
    const { service, prisma, gateway } = makeService();
    await service.notify({
      userId: USER,
      type: 'a',
      title: 'A',
      body: 'a',
      channels: { panel: true },
    });
    const { items } = await service.list(USER);
    const id = items[0].id;

    await service.dismiss(USER, id);
    expect((await prisma.notification.findUnique({ where: { id } }))!.dismissedAt).not.toBeNull();
    expect(gateway.syncUser).toHaveBeenCalledWith(USER, { kind: 'dismissed', id });

    await service.dismiss(USER, id); // second call — must not throw
    expect(gateway.syncUser).toHaveBeenCalledTimes(2);
  });

  it('markAllRead() marks every panel row read and syncs once', async () => {
    const { service, prisma, gateway } = makeService();
    await service.notify({
      userId: USER,
      type: 'a',
      title: 'A',
      body: 'a',
      channels: { panel: true },
    });
    await service.notify({
      userId: USER,
      type: 'b',
      title: 'B',
      body: 'b',
      channels: { panel: true },
    });

    await service.markAllRead(USER);

    expect(await service.unreadCount(USER)).toBe(0);
    expect(gateway.syncUser).toHaveBeenCalledWith(USER, { kind: 'read-all' });
    void prisma;
  });

  it('notifyAll() broadcasts once and creates one row per active user', async () => {
    const { service, prisma, gateway } = makeService();
    prisma.__seedUser('u1', 'a@example.com');
    prisma.__seedUser('u2', 'b@example.com');

    const count = await service.notifyAll({
      type: 'maintenance',
      title: 'T',
      body: 'B',
      channels: { panel: true, email: true },
    });

    expect(count).toBe(2);
    expect(gateway.broadcast).toHaveBeenCalledTimes(1);
    expect(await service.unreadCount('u1')).toBe(1);
    expect(await service.unreadCount('u2')).toBe(1);
  });
});
