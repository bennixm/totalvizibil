import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

type MockPrisma = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

function makePrisma(): MockPrisma {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('AuthService', () => {
  let prisma: MockPrisma;
  let passwords: PasswordService;
  let service: AuthService;

  beforeEach(() => {
    prisma = makePrisma();
    passwords = new PasswordService();
    service = new AuthService(prisma as never, passwords);
  });

  describe('register', () => {
    it('rejects a duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(
        service.register({ email: 'a@b.com', password: 'password123', name: 'A' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a user and returns a safe view (no hash)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        platformRoles: [],
      });

      const view = await service.register({
        email: 'a@b.com',
        password: 'password123',
        name: 'A',
      });

      expect(view).toEqual({ id: 'u1', email: 'a@b.com', name: 'A', platformRoles: [] });
      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.passwordHash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('validateCredentials', () => {
    it('throws for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.validateCredentials({ email: 'x@y.com', password: 'whatever12' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
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

    it('returns the user view and stamps lastLoginAt on success', async () => {
      const hash = await passwords.hash('the-real-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'x@y.com',
        name: 'X',
        status: 'active',
        passwordHash: hash,
        platformRoles: [{ role: 'admin' }],
      });
      prisma.user.update.mockResolvedValue({});

      const view = await service.validateCredentials({
        email: 'x@y.com',
        password: 'the-real-password',
      });

      expect(view).toEqual({ id: 'u1', email: 'x@y.com', name: 'X', platformRoles: ['admin'] });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });
  });
});
