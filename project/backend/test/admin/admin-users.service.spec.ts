import { NotFoundException } from '@nestjs/common';
import { AdminUsersService } from 'src/admin/admin-users.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user1',
    email: 'user@example.com',
    name: 'Test User',
    status: 'active' as const,
    platformRoles: [] as { role: string }[],
    wallet: null as { balanceMinor: number; blockedAt: Date | null } | null,
    companyMembers: [] as { role: string; company: { id: string; displayName: string; slug: string; status: string; ownerUserId: string; createdAt: Date; campaign: null; _count: { leads: number; adClicks: number } } }[],
    totpEnabledAt: null as Date | null,
    lastLoginAt: null as Date | null,
    passwordChangedAt: null as Date | null,
    passwordHash: 'stored-hash',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

type FakeUser = ReturnType<typeof makeUser>;

function fakePrisma() {
  const users = new Map<string, FakeUser>();

  return {
    user: {
      findMany: jest.fn(async () =>
        [...users.values()].map((u) => ({
          ...u,
          wallet: u.wallet ?? { balanceMinor: 0, blockedAt: null },
          _count: { companyMembers: 0, sessions: 0 },
        })),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) {
          const u = users.get(where.id);
          // Return a shallow copy so mutations inside the service (via user.update
          // sharing the same Map reference) don't corrupt the `target` snapshot.
          return u ? { ...u } : null;
        }
        if (where.email) {
          const u = [...users.values()].find((u) => u.email === where.email);
          return u ? { ...u } : null;
        }
        return null;
      }),
      count: jest.fn(async () => users.size),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const u = users.get(where.id);
        if (u) Object.assign(u, data);
        return u ?? null;
      }),
    },
    company: {
      findMany: jest.fn(async () => [] as { id: string }[]),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    campaign: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    website: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    platformRoleAssignment: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async (d: unknown) => d),
    },
    walletTransaction: {
      groupBy: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    // Test helpers
    __users: users,
    __seedUser: (data: Record<string, unknown> = {}): FakeUser => {
      const u = makeUser(data);
      users.set(u.id, u);
      return u;
    },
  };
}

function fakeSessions() {
  return {
    listActiveForUser: jest.fn(async () => []),
    revokeAllForUser: jest.fn(async () => 0),
  };
}

function fakePasswords() {
  return {
    hash: jest.fn(async (plain: string) => `hashed:${plain}`),
    verify: jest.fn(async () => true),
  };
}

function fakeWallet() {
  return {
    getSummary: jest.fn(async () => ({
      balance: 0,
      purchased: 0,
      spent: 0,
      currency: 'EUR',
      eurRonRate: 5,
      blocked: false,
      blockedAt: null,
      blockedReason: null,
      refundable: 0,
    })),
    listTransactions: jest.fn(async () => ({ items: [] })),
    setBlocked: jest.fn(async () => {}),
    adjust: jest.fn(async () => {}),
    requestRefund: jest.fn(async () => {}),
    cancelRefund: jest.fn(async () => {}),
  };
}

function fakeBilling() {
  return {
    listForUser: jest.fn(async () => []),
  };
}

function fakeNotifications() {
  return {
    notify: jest.fn(async () => {}),
  };
}

function makeService() {
  const prisma = fakePrisma();
  const sessions = fakeSessions();
  const passwords = fakePasswords();
  const wallet = fakeWallet();
  const billing = fakeBilling();
  const notifications = fakeNotifications();
  const svc = new AdminUsersService(
    prisma as any,
    passwords as any,
    sessions as any,
    wallet as any,
    billing as any,
    notifications as any,
  );
  return { svc, prisma, sessions, passwords, wallet, billing, notifications };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminUsersService', () => {
  describe('list', () => {
    it('calls user.findMany with OR contains condition when search is provided', async () => {
      const { svc, prisma } = makeService();

      await svc.list({ search: 'alice', page: 1, pageSize: 20 });

      expect(prisma.user.findMany).toHaveBeenCalled();
      const callArg = (prisma.user.findMany as jest.Mock).mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      const or = callArg.where['OR'] as { email?: Record<string, string>; name?: Record<string, string> }[];
      expect(or).toBeDefined();
      expect(or[0]?.email?.contains).toBe('alice');
      expect(or[1]?.name?.contains).toBe('alice');
    });

    it('includes platformRoles filter when staffOnly is true', async () => {
      const { svc, prisma } = makeService();

      await svc.list({ staffOnly: true, page: 1, pageSize: 20 });

      expect(prisma.user.findMany).toHaveBeenCalled();
      const callArg = (prisma.user.findMany as jest.Mock).mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      const platformRoles = callArg.where['platformRoles'] as { some: unknown } | undefined;
      expect(platformRoles).toBeDefined();
      expect(platformRoles?.some).toBeDefined();
    });

    it('returns paginated result shape', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', name: 'Alice' });

      const result = await svc.list({ page: 1, pageSize: 20 });

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total');
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });
  });

  describe('detail', () => {
    it('throws NotFoundException when user does not exist', async () => {
      const { svc } = makeService();

      await expect(svc.detail('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('returns user detail when user exists', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', email: 'u1@test.com', name: 'User One' });

      const result = await svc.detail('u1');

      expect(result.id).toBe('u1');
      expect(result.email).toBe('u1@test.com');
    });
  });

  describe('update — suspend', () => {
    it('sets status to suspended, revokes all sessions, and sends account_suspended notification', async () => {
      const { svc, prisma, sessions, notifications } = makeService();
      prisma.__seedUser({ id: 'u1', status: 'active' });
      // Stub detail so the complex read-side is skipped
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'u1', { status: 'suspended' });

      // user.update called with suspended status
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ status: 'suspended' }),
        }),
      );

      // sessions revoked (callerId !== id so no exceptSessionId)
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1', undefined);

      // notification fired (fire-and-forget, but the call must exist)
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'account_suspended' }),
      );
    });
  });

  describe('setPassword', () => {
    it('hashes the new password, updates the user record, and revokes all sessions', async () => {
      const { svc, prisma, sessions, passwords } = makeService();
      prisma.__seedUser({ id: 'u1' });

      const result = await svc.setPassword('u1', 'newpassword123');

      // password was hashed
      expect(passwords.hash).toHaveBeenCalledWith('newpassword123');

      // user updated with the hashed value
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ passwordHash: 'hashed:newpassword123' }),
        }),
      );

      // all sessions revoked
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1');

      // returns ok flag
      expect(result).toEqual({ ok: true });
    });

    it('throws NotFoundException when user does not exist', async () => {
      const { svc } = makeService();

      await expect(svc.setPassword('nonexistent', 'pass')).rejects.toThrow(NotFoundException);
    });
  });
});
