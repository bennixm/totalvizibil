import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { TotpService } from 'src/auth/totp.service';
import { AccountService } from 'src/auth/account.service';

const totp = new TotpService();

function fakePasswords(knownHash = 'hashed:secret') {
  return {
    hash: jest.fn(async (p: string) => `hashed:${p}`),
    verify: jest.fn(async (hash: string, plain: string) => hash === `hashed:${plain}`),
    needsRehash: jest.fn(() => false),
  };
}

function fakeSessions() {
  return {
    revokeAllForUser: jest.fn().mockResolvedValue(2),
    listActiveForUser: jest.fn().mockResolvedValue([]),
  };
}

function fakeNotifications() {
  return { notify: jest.fn().mockResolvedValue(undefined) };
}

function fakeMail() {
  return { send: jest.fn().mockResolvedValue({ dispatched: true }) };
}

function makeUser(overrides = {}) {
  return {
    id: 'u1',
    email: 'user@example.com',
    name: 'Ion',
    passwordHash: 'hashed:password',
    status: 'active',
    totpSecret: null,
    totpEnabledAt: null,
    passwordChangedAt: null,
    emailVerifiedAt: null,
    platformRoles: [],
    ...overrides,
  };
}

function fakePrisma() {
  const users = new Map<string, ReturnType<typeof makeUser>>();
  return {
    user: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const u = users.get(where.id) ?? users.get(where.email);
        if (!u) throw Object.assign(new Error('Not found'), { code: 'P2025' });
        return u;
      }),
      findUnique: jest.fn(
        async ({ where }: any) => users.get(where.id) ?? users.get(where.email) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (u) Object.assign(u, data);
        return u ?? makeUser(data);
      }),
    },
    __seedUser: (data = {}) => {
      const u = makeUser(data);
      users.set(u.id, u);
      users.set(u.email, u);
      return u;
    },
  };
}

function makeService() {
  const prisma = fakePrisma();
  const passwords = fakePasswords();
  const sessions = fakeSessions();
  const notifications = fakeNotifications();
  const mail = fakeMail();
  const svc = new AccountService(
    prisma as any,
    passwords as any,
    sessions as any,
    totp,
    notifications as any,
    mail as any,
  );
  return { svc, prisma, passwords, sessions, notifications, mail };
}

const principal = {
  id: 'u1',
  sessionId: 'sess1',
  email: 'user@example.com',
  name: 'Ion',
  platformRoles: [],
  emailVerifiedAt: null,
};

describe('AccountService', () => {
  describe('updateProfile', () => {
    it('throws ForbiddenException when current password wrong for email change', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', email: 'a@example.com' });
      await expect(
        svc.updateProfile('u1', { email: 'new@example.com', currentPassword: 'wrongpassword' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when new email is already taken', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', email: 'a@example.com' });
      prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'u2', email: 'taken@example.com' }));
      await expect(
        svc.updateProfile('u1', { email: 'taken@example.com', currentPassword: 'password' }),
      ).rejects.toThrow(ConflictException);
    });

    it('happy path name change — no password required', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', name: 'Old Name' });
      await svc.updateProfile('u1', { name: 'New Name' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'New Name' } }),
      );
    });

    it('no-op when nothing changes', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', name: 'Same', email: 'same@example.com' });
      await svc.updateProfile('u1', { name: 'Same' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('throws ForbiddenException when current password is wrong', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1' });
      await expect(
        svc.changePassword(principal, { currentPassword: 'wrong', newPassword: 'newpass' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when new password is same as current', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', passwordHash: 'hashed:password' });
      await expect(
        svc.changePassword(principal, { currentPassword: 'password', newPassword: 'password' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('happy path updates hash and revokes other sessions', async () => {
      const { svc, prisma, sessions } = makeService();
      prisma.__seedUser({ id: 'u1', passwordHash: 'hashed:oldpass' });
      const result = await svc.changePassword(principal, {
        currentPassword: 'oldpass',
        newPassword: 'newpass',
      });
      expect(result).toEqual({ ok: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed:newpass' }),
        }),
      );
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u1', 'sess1');
    });
  });

  describe('totpSetup', () => {
    it('throws ConflictException when TOTP already enabled', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: new Date() });
      await expect(svc.totpSetup('u1')).rejects.toThrow(ConflictException);
    });

    it('happy path returns secret and otpauthUrl', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: null });
      const result = await svc.totpSetup('u1');
      expect(result.secret).toBeTruthy();
      expect(result.otpauthUrl).toContain('otpauth://');
    });
  });

  describe('totpEnable', () => {
    it('throws ConflictException when already enabled', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: new Date(), totpSecret: 'SEC' });
      await expect(svc.totpEnable('u1', '123456')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when no secret (setup not started)', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: null, totpSecret: null });
      await expect(svc.totpEnable('u1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for wrong TOTP code', async () => {
      const { svc, prisma } = makeService();
      const secret = totp.generateSecret();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: null, totpSecret: secret });
      await expect(svc.totpEnable('u1', '000000')).rejects.toThrow(BadRequestException);
    });

    it('happy path enables TOTP with correct code', async () => {
      const { svc, prisma } = makeService();
      const secret = totp.generateSecret();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: null, totpSecret: secret });
      const { authenticator } = await import('otplib');
      const code = authenticator.generate(secret);
      const result = await svc.totpEnable('u1', code);
      expect(result).toEqual({ ok: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totpEnabledAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('totpDisable', () => {
    it('throws BadRequestException when TOTP not enabled', async () => {
      const { svc, prisma } = makeService();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: null, totpSecret: null });
      await expect(svc.totpDisable('u1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for wrong code', async () => {
      const { svc, prisma } = makeService();
      const secret = totp.generateSecret();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: new Date(), totpSecret: secret });
      await expect(svc.totpDisable('u1', '000000')).rejects.toThrow(BadRequestException);
    });

    it('happy path disables TOTP with correct code', async () => {
      const { svc, prisma } = makeService();
      const secret = totp.generateSecret();
      prisma.__seedUser({ id: 'u1', totpEnabledAt: new Date(), totpSecret: secret });
      const { authenticator } = await import('otplib');
      const code = authenticator.generate(secret);
      const result = await svc.totpDisable('u1', code);
      expect(result).toEqual({ ok: true });
    });
  });
});
