import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AuthService,
  EMAIL_NOT_VERIFIED,
  TOTP_INVALID,
  TOTP_REQUIRED,
} from 'src/auth/auth.service';
import { PasswordService } from 'src/auth/password.service';
import { TotpService } from 'src/auth/totp.service';

type MockPrisma = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

function makePrisma(): MockPrisma {
  return {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

/** Same digest the service stores for a pending-registration token. */
function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** `m=…,t=…,p=…` as embedded in an argon2 hash string. */
function costParams(hash: string): string {
  return hash.split('$')[3];
}

describe('AuthService', () => {
  let prisma: MockPrisma;
  let passwords: PasswordService;
  let totp: TotpService;
  let service: AuthService;

  beforeEach(() => {
    prisma = makePrisma();
    passwords = new PasswordService();
    totp = new TotpService();
    service = new AuthService(prisma as never, passwords, totp);
  });

  describe('register', () => {
    it('rejects a duplicate email once it is verified', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', emailVerifiedAt: new Date() });
      await expect(
        service.register({ email: 'a@b.com', password: 'password123', name: 'A' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates an existing still-unverified account in place when the pending-reg token matches', async () => {
      const token = 'raw-pending-token';
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'Old Name',
        emailVerifiedAt: null,
        pendingRegTokenHash: sha256(token),
        pendingRegExpiresAt: new Date(Date.now() + 60_000),
        platformRoles: [],
      });
      prisma.user.update.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'New Name',
        platformRoles: [],
        emailVerifiedAt: null,
      });

      const result = await service.register(
        { email: 'a@b.com', password: 'password123', name: 'New Name' },
        token,
      );

      expect(result.user.name).toBe('New Name');
      expect(result.didMutate).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' } }),
      );
      // Rotated: the token just spent is no longer the stored one.
      const updateData = prisma.user.update.mock.calls[0][0].data;
      expect(updateData.name).toBe('New Name');
      expect(updateData.passwordHash).toMatch(/^\$argon2id\$/);
      expect(updateData.pendingRegTokenHash).not.toBe(sha256(token));
      expect(updateData.pendingRegTokenHash).toBe(sha256(result.pendingRegToken));
      expect(updateData.pendingRegExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it.each([
      ['no token at all', undefined, { hash: sha256('issued'), expiresIn: 60_000 }],
      ['a wrong token', 'attacker-guess', { hash: sha256('issued'), expiresIn: 60_000 }],
      ['an expired token', 'issued', { hash: sha256('issued'), expiresIn: -1_000 }],
      ['no token ever issued', 'issued', { hash: null, expiresIn: null }],
    ])(
      'refuses to overwrite a stranger’s pending signup with %s',
      async (_label, submitted, stored) => {
        prisma.user.findUnique.mockResolvedValue({
          id: 'u1',
          email: 'a@b.com',
          name: 'Real Owner',
          emailVerifiedAt: null,
          pendingRegTokenHash: stored.hash,
          pendingRegExpiresAt:
            stored.expiresIn === null ? null : new Date(Date.now() + stored.expiresIn),
          platformRoles: [],
        });

        const result = await service.register(
          { email: 'a@b.com', password: 'attacker-password', name: 'Attacker' },
          submitted,
        );

        // Nothing written, and the caller sees the row exactly as it stands.
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(result.didMutate).toBe(false);
        expect(result.user).toEqual({
          id: 'u1',
          email: 'a@b.com',
          name: 'Real Owner',
          platformRoles: [],
          emailVerifiedAt: null,
        });
        // Response shape is identical to the legitimate branch, so the probe
        // learns nothing from what comes back.
        expect(result.pendingRegToken).toMatch(/^[\w-]{43}$/);
      },
    );

    it('creates a user and returns a safe view (no hash), unverified, with a stored token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        platformRoles: [],
        emailVerifiedAt: null,
      });

      const result = await service.register({
        email: 'a@b.com',
        password: 'password123',
        name: 'A',
      });

      expect(result.user).toEqual({
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        platformRoles: [],
        emailVerifiedAt: null,
      });
      expect(result.didMutate).toBe(true);
      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.passwordHash).toMatch(/^\$argon2id\$/);
      // Only the SHA-256 is persisted; the raw token goes to the cookie.
      expect(createArg.data.pendingRegTokenHash).toBe(sha256(result.pendingRegToken));
      expect(createArg.data.pendingRegTokenHash).not.toContain(result.pendingRegToken);
      expect(createArg.data.pendingRegExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('validateCredentials', () => {
    it('throws for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.validateCredentials({ email: 'x@y.com', password: 'whatever12' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('verifies the unknown-email path against a hash with the REAL cost parameters', async () => {
      // A dummy hash carrying different cost parameters than real hashes makes
      // the miss path do more/less argon2 work than a hit, which is a timing
      // oracle for "does this email exist". `argon2.verify` reads cost from
      // the hash string, so the parameters embedded in the compare target must
      // match the ones PasswordService actually produces.
      const realHash = await passwords.hash('any-password');
      const verifySpy = jest.spyOn(passwords, 'verify');

      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.validateCredentials({ email: 'nobody@y.com', password: 'whatever12' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const dummyUsed = verifySpy.mock.calls[0][0];
      expect(dummyUsed).toMatch(/^\$argon2id\$/);
      expect(costParams(dummyUsed)).toBe(costParams(realHash));
    });

    it('reuses the same cached dummy hash across unknown-email attempts', async () => {
      const verifySpy = jest.spyOn(passwords, 'verify');
      prisma.user.findUnique.mockResolvedValue(null);
      for (const email of ['a@y.com', 'b@y.com']) {
        await expect(
          service.validateCredentials({ email, password: 'whatever12' }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(verifySpy.mock.calls[0][0]).toBe(verifySpy.mock.calls[1][0]);
    });

    it('throws for a wrong password', async () => {
      const hash = await passwords.hash('the-real-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        status: 'active',
        passwordHash: hash,
        platformRoles: [],
      });
      await expect(
        service.validateCredentials({ email: 'x@y.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('tells a suspended user their account is suspended (password was right)', async () => {
      const hash = await passwords.hash('the-real-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        status: 'suspended',
        passwordHash: hash,
        platformRoles: [],
      });
      await expect(
        service.validateCredentials({ email: 'x@y.com', password: 'the-real-password' }),
      ).rejects.toMatchObject({ message: 'account_suspended' });
    });

    it('returns the user view and stamps lastLoginAt on success', async () => {
      const hash = await passwords.hash('the-real-password');
      const verifiedAt = new Date('2026-01-01T00:00:00Z');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        status: 'active',
        passwordHash: hash,
        totpEnabledAt: null,
        totpSecret: null,
        emailVerifiedAt: verifiedAt,
        platformRoles: [{ role: 'admin' }],
      });
      prisma.user.update.mockResolvedValue({});

      const view = await service.validateCredentials({
        email: 'x@y.com',
        password: 'the-real-password',
      });

      expect(view).toEqual({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        platformRoles: ['admin'],
        emailVerifiedAt: verifiedAt.toISOString(),
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('blocks login for an account that never verified its email (password is right)', async () => {
      const hash = await passwords.hash('the-real-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        status: 'active',
        passwordHash: hash,
        totpEnabledAt: null,
        totpSecret: null,
        emailVerifiedAt: null,
        platformRoles: [],
      });
      await expect(
        service.validateCredentials({ email: 'x@y.com', password: 'the-real-password' }),
      ).rejects.toMatchObject({ message: EMAIL_NOT_VERIFIED });
    });

    it('demands a TOTP code when 2FA is enabled', async () => {
      const hash = await passwords.hash('pw-123456');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        status: 'active',
        passwordHash: hash,
        totpEnabledAt: new Date(),
        totpSecret: totp.generateSecret(),
        emailVerifiedAt: new Date(),
        platformRoles: [],
      });
      await expect(
        service.validateCredentials({ email: 'x@y.com', password: 'pw-123456' }),
      ).rejects.toMatchObject({ message: TOTP_REQUIRED });
    });

    it('rejects a bad TOTP code', async () => {
      const hash = await passwords.hash('pw-123456');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        status: 'active',
        passwordHash: hash,
        totpEnabledAt: new Date(),
        totpSecret: totp.generateSecret(),
        emailVerifiedAt: new Date(),
        platformRoles: [],
      });
      await expect(
        service.validateCredentials({
          email: 'x@y.com',
          password: 'pw-123456',
          totpCode: '000000',
        }),
      ).rejects.toMatchObject({ message: TOTP_INVALID });
    });
  });
});
