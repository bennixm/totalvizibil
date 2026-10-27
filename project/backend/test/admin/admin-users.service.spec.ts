import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
    companyMembers: [] as {
      role: string;
      company: {
        id: string;
        displayName: string;
        slug: string;
        status: string;
        ownerUserId: string;
        createdAt: Date;
        campaign: null;
        _count: { leads: number; adClicks: number };
      };
    }[],
    billingProfile: null as Record<string, unknown> | null,
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
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
          const u = users.get(where.id);
          if (u) Object.assign(u, data);
          return u ?? null;
        },
      ),
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
      // How many OTHER users still hold a given platform role — the
      // last-holder guards read this. Default: plenty.
      count: jest.fn(async () => 3),
    },
    walletTransaction: {
      groupBy: jest.fn(async () => []),
    },
    // Unassigned when the last support-staff role is dropped from a user.
    supportTicket: {
      updateMany: jest.fn(async () => ({ count: 0 })),
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
    adjust: jest.fn(async (_userId: string, credits: number) => ({
      requestedCredits: credits,
      appliedCredits: credits,
    })),
    consumedByCompanies: jest.fn(async () => new Map<string, number>()),
    requestRefund: jest.fn(async () => {}),
    cancelRefund: jest.fn(async () => {}),
  };
}

function fakeBilling() {
  return {
    listForUser: jest.fn(async () => []),
    getProfile: jest.fn(async () => null as Record<string, unknown> | null),
    upsertProfile: jest.fn(async (_userId: string, dto: Record<string, unknown>) => ({
      profile: { id: 'bp1', userId: _userId, ...dto },
      isComplete: true,
      invoicesIssued: 0,
    })),
  };
}

function fakeNotifications() {
  return {
    notify: jest.fn(async () => {}),
  };
}

function fakeMail() {
  return {
    send: jest.fn(async () => {}),
  };
}

function fakeAudit() {
  return { log: jest.fn(async () => undefined) };
}

function fakeConfig() {
  return { get: jest.fn(() => 'https://totalvizibil.ro') };
}

function makeService() {
  const prisma = fakePrisma();
  const sessions = fakeSessions();
  const passwords = fakePasswords();
  const wallet = fakeWallet();
  const billing = fakeBilling();
  const notifications = fakeNotifications();
  const mail = fakeMail();
  const audit = fakeAudit();
  const config = fakeConfig();
  const svc = new AdminUsersService(
    prisma as any,
    passwords as any,
    sessions as any,
    wallet as any,
    billing as any,
    notifications as any,
    mail as any,
    audit as any,
    config as any,
  );
  return { svc, prisma, sessions, passwords, wallet, billing, notifications, mail, audit };
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
      const or = callArg.where['OR'] as {
        email?: Record<string, string>;
        name?: Record<string, string>;
      }[];
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

    it('derives per-company consumed spend from wallet.consumedByCompanies, not a separate inline groupBy (regression: the old inline query omitted the CPC-only provider filter and disagreed with the Businesses list for the same company)', async () => {
      const { svc, prisma, wallet } = makeService();
      prisma.__seedUser({
        id: 'u1',
        companyMembers: [
          {
            role: 'owner',
            company: {
              id: 'co1',
              displayName: 'Co',
              slug: 'co',
              status: 'active',
              ownerUserId: 'u1',
              createdAt: new Date('2024-01-01'),
              campaign: null,
              _count: { leads: 0, adClicks: 0 },
            },
          },
        ],
      });
      wallet.consumedByCompanies.mockResolvedValue(new Map([['co1', 1234]]));

      const result = await svc.detail('u1');

      expect(wallet.consumedByCompanies).toHaveBeenCalledWith(['co1']);
      expect(prisma.walletTransaction.groupBy).not.toHaveBeenCalled();
      expect(result.companies[0].consumed.credits).toBeGreaterThan(0);
    });
  });

  describe('update — suspend', () => {
    it('sets status to suspended, revokes all sessions, and sends account_suspended notification', async () => {
      const { svc, prisma, sessions, notifications } = makeService();
      prisma.__seedUser({ id: 'u1', status: 'active' });
      // Stub detail so the complex read-side is skipped
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', { status: 'suspended' });

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

    it("revoking your OWN sessions keeps the current session alive (regression: the except-id must be a session id, not the caller's user id)", async () => {
      const { svc, prisma, sessions } = makeService();
      prisma.__seedUser({ id: 'admin1', status: 'active' });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'admin1', { revokeSessions: true });

      // Must except the CALLER'S SESSION id, never the caller's user id —
      // `revokeAllForUser`'s second arg is matched against `Session.id`, so
      // passing a user id there (the old bug) never excludes anything and
      // logs the admin out of the very request that triggered this.
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('admin1', 'admin1-session');
    });
  });

  describe('update — disableTotp', () => {
    it('regression: notifies the user when an admin disables their 2FA (this used to be silent — the self-service path already notified)', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: new Date(), totpSecret: 'secret' });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', { disableTotp: true });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'totp_disabled' }),
      );
    });

    it('does not notify when 2FA was never enabled (a no-op disableTotp flag)', async () => {
      const { svc, prisma, notifications } = makeService();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: null });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', { disableTotp: true });

      expect(notifications.notify).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'totp_disabled' }),
      );
    });
  });

  describe('update — email change', () => {
    it('notifies both the old and new address, and resets emailVerifiedAt so the new address must be re-confirmed', async () => {
      const { svc, prisma, mail, notifications } = makeService();
      prisma.__seedUser({ id: 'u1', email: 'old@example.com', status: 'active' });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', { email: 'new@example.com' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ email: 'new@example.com', emailVerifiedAt: null }),
        }),
      );
      // Old inbox gets a direct, one-off mail — it's no longer tied to the account.
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'old@example.com' }));
      // New address gets the standard notification channel.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'email_changed' }),
      );
    });

    it('does not touch email/verification or send mail when the email is unchanged', async () => {
      const { svc, prisma, mail } = makeService();
      prisma.__seedUser({ id: 'u1', email: 'same@example.com', status: 'active' });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', { name: 'New Name' });

      expect(mail.send).not.toHaveBeenCalled();
      const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
      expect(data.emailVerifiedAt).toBeUndefined();
    });
  });

  describe('adjustWallet', () => {
    it('passes the acting admin id through for attribution and surfaces the applied vs requested delta', async () => {
      const { svc, prisma, wallet } = makeService();
      prisma.__seedUser({ id: 'u1' });
      wallet.adjust.mockResolvedValue({ requestedCredits: -500, appliedCredits: -20 });
      jest.spyOn(svc, 'detail').mockResolvedValue({ id: 'u1' } as any);

      const result = await svc.adjustWallet(
        'u1',
        { credits: -500, reason: 'chargeback reversal' },
        {
          id: 'admin1',
          roles: ['finance'],
        },
      );

      expect(wallet.adjust).toHaveBeenCalledWith('u1', -500, 'chargeback reversal', {
        initiatedByAdminId: 'admin1',
        actorRoles: ['finance'],
      });
      expect(result.lastAdjustment).toEqual({ requestedCredits: -500, appliedCredits: -20 });
    });
  });

  describe('update — last finance-role holder guard (E5)', () => {
    it('refuses a role update that would leave the platform with zero finance users', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', platformRoles: [{ role: 'finance' }] });
      (prisma.platformRoleAssignment.count as jest.Mock).mockResolvedValue(0);

      await expect(
        svc.update('admin1', 'admin1-session', 'u1', { platformRoles: [] }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        svc.update('admin1', 'admin1-session', 'u1', { platformRoles: [] }),
      ).rejects.toThrow('cannot_remove_last_finance_role');

      // Nothing was written.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('counts only OTHER users, so the holder being edited cannot count as their own replacement', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', platformRoles: [{ role: 'finance' }] });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', { platformRoles: ['support'] });

      expect(prisma.platformRoleAssignment.count).toHaveBeenCalledWith({
        where: { role: 'finance', userId: { not: 'u1' } },
      });
    });

    it('allows the removal while another finance user remains', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', platformRoles: [{ role: 'finance' }] });
      (prisma.platformRoleAssignment.count as jest.Mock).mockResolvedValue(1);
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await expect(
        svc.update('admin1', 'admin1-session', 'u1', { platformRoles: [] }),
      ).resolves.toBeDefined();
      expect(prisma.platformRoleAssignment.deleteMany).toHaveBeenCalled();
    });

    it('does not run the guard when the target never held finance in the first place', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', platformRoles: [{ role: 'support' }] });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', { platformRoles: ['moderator'] });

      expect(prisma.platformRoleAssignment.count).not.toHaveBeenCalled();
    });

    it('does not run the guard when finance is being KEPT', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', platformRoles: [{ role: 'finance' }] });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.update('admin1', 'admin1-session', 'u1', {
        platformRoles: ['finance', 'support'],
      });

      expect(prisma.platformRoleAssignment.count).not.toHaveBeenCalled();
    });
  });

  describe('blockWallet', () => {
    it('threads the acting staff member down to WalletService so the block is attributable', async () => {
      const { svc, prisma, wallet } = makeService();
      prisma.__seedUser({ id: 'u1' });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.blockWallet(
        'u1',
        { blocked: true, reason: 'chargeback' },
        { id: 'staff1', roles: ['finance'] },
      );

      expect(wallet.setBlocked).toHaveBeenCalledWith('u1', true, 'chargeback', {
        id: 'staff1',
        roles: ['finance'],
      });
    });
  });

  describe('cancelRefund', () => {
    it('actually passes the acting staff id + roles to WalletService (regression: the param existed there but was never passed, so every admin-canceled refund looked customer-initiated)', async () => {
      const { svc, prisma, wallet } = makeService();
      prisma.__seedUser({ id: 'u1' });
      jest.spyOn(svc, 'detail').mockResolvedValue({} as any);

      await svc.cancelRefund('u1', 'r1', { id: 'staff1', roles: ['finance'] });

      expect(wallet.cancelRefund).toHaveBeenCalledWith('u1', 'r1', 'staff1', ['finance']);
    });

    it('throws NotFoundException for an unknown user', async () => {
      const { svc } = makeService();
      await expect(
        svc.cancelRefund('nope', 'r1', { id: 'staff1', roles: ['admin'] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('billing profile (C7)', () => {
    it('exposes the billing profile on the user-detail payload (it used to be omitted for everyone, admins included)', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({
        id: 'u1',
        billingProfile: {
          kind: 'company',
          name: 'ACME SRL',
          taxId: 'RO123',
          regCom: 'J40/1/2020',
          vatPayer: true,
          address: 'Str. Test 1',
          city: 'Cluj',
          county: 'Cluj',
          postalCode: '400000',
          country: 'RO',
          billingEmail: 'facturi@acme.ro',
          iban: 'RO49AAAA1B31007593840000',
          bankName: 'Banca Test',
        },
      });

      const result = await svc.detail('u1');

      expect(result.billingProfile).toMatchObject({
        kind: 'company',
        name: 'ACME SRL',
        taxId: 'RO123',
      });
    });

    it('reports a null profile for a user who never declared one', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1' });

      const result = await svc.detail('u1');

      expect(result.billingProfile).toBeNull();
    });

    it('delegates the write to the SAME BillingService.upsertProfile the self-service form uses, and audit-logs it', async () => {
      const { svc, prisma, billing, audit } = makeService();
      prisma.__seedUser({ id: 'u1' });
      const dto = {
        kind: 'company' as const,
        name: 'ACME SRL',
        taxId: 'RO123',
        regCom: 'J40/1/2020',
        address: 'Str. Test 1',
        city: 'Cluj',
      };

      const result = await svc.updateBillingProfile('u1', dto, {
        id: 'staff1',
        roles: ['finance'],
      });

      expect(billing.upsertProfile).toHaveBeenCalledWith('u1', dto);
      expect(result.isComplete).toBe(true);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'staff1',
          actorRoles: ['finance'],
          action: 'billing_profile.update',
          targetType: 'billing_profile',
          targetId: 'u1',
        }),
      );
      const entry = (audit.log as jest.Mock).mock.calls[0][0];
      // No profile existed beforehand.
      expect(entry.before).toBeNull();
      expect(entry.after).toMatchObject({ name: 'ACME SRL', taxId: 'RO123' });
    });

    it('throws NotFoundException for an unknown user', async () => {
      const { svc } = makeService();
      await expect(
        svc.updateBillingProfile(
          'nope',
          { kind: 'individual', name: 'X', address: 'a', city: 'b' } as any,
          { id: 'staff1', roles: ['admin'] },
        ),
      ).rejects.toThrow(NotFoundException);
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
