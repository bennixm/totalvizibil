import { HealthController } from 'src/health/health.controller';

function fakePrisma() {
  return {
    $queryRaw: jest.fn(),
  };
}

describe('HealthController', () => {
  describe('check', () => {
    it('returns ok when DB query resolves', async () => {
      const prisma = fakePrisma();
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const ctrl = new HealthController(prisma as any);
      const result = await ctrl.check();
      expect(result.status).toBe('ok');
      expect(result.db).toBe(true);
      expect(typeof result.ts).toBe('string');
    });

    it('returns degraded when DB query throws', async () => {
      const prisma = fakePrisma();
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      const ctrl = new HealthController(prisma as any);
      const result = await ctrl.check();
      expect(result.status).toBe('degraded');
      expect(result.db).toBe(false);
    });
  });
});
