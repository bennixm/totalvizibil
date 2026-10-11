import { BadRequestException } from '@nestjs/common';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';

function fakePrisma() {
  const settings = new Map<string, { key: string; value: string }>();
  return {
    platformSetting: {
      findUnique: jest.fn(async ({ where }: any) => settings.get(where.key) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = settings.get(where.key);
        const row = existing
          ? { ...existing, ...update }
          : { key: where.key, ...create };
        settings.set(where.key, row);
        return row;
      }),
    },
    __settings: settings,
    __seedSetting: (key: string, value: string) => {
      settings.set(key, { key, value });
    },
  };
}

function fakeNotifications() {
  return {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyAll: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PlatformSettingsService', () => {
  describe('get / set caching', () => {
    it('caches value after first get — second call skips Prisma', async () => {
      const prisma = fakePrisma();
      prisma.__seedSetting('test_key', 'hello');
      const svc = new PlatformSettingsService(prisma as any, fakeNotifications() as any);

      await svc.get('test_key');
      await svc.get('test_key');

      expect(prisma.platformSetting.findUnique).toHaveBeenCalledTimes(1);
    });

    it('set calls upsert and updates cache', async () => {
      const prisma = fakePrisma();
      const svc = new PlatformSettingsService(prisma as any, fakeNotifications() as any);

      await svc.set('my_key', 'my_value');

      expect(prisma.platformSetting.upsert).toHaveBeenCalled();
      // Second get should hit cache, not Prisma
      await svc.get('my_key');
      expect(prisma.platformSetting.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('eurRonRate', () => {
    it('returns default 5.05 when no row', async () => {
      const svc = new PlatformSettingsService(fakePrisma() as any, fakeNotifications() as any);
      expect(await svc.eurRonRate()).toBe(5.05);
    });

    it('returns parsed value for valid setting', async () => {
      const prisma = fakePrisma();
      prisma.__seedSetting('eur_ron_rate', '4.97');
      const svc = new PlatformSettingsService(prisma as any, fakeNotifications() as any);
      expect(await svc.eurRonRate()).toBe(4.97);
    });

    it('returns default for invalid value "banana"', async () => {
      const prisma = fakePrisma();
      prisma.__seedSetting('eur_ron_rate', 'banana');
      const svc = new PlatformSettingsService(prisma as any, fakeNotifications() as any);
      expect(await svc.eurRonRate()).toBe(5.05);
    });

    it('throws BadRequestException for setEurRonRate(0)', async () => {
      const svc = new PlatformSettingsService(fakePrisma() as any, fakeNotifications() as any);
      await expect(svc.setEurRonRate(0)).rejects.toThrow(BadRequestException);
    });

    it('stores valid rate via setEurRonRate', async () => {
      const svc = new PlatformSettingsService(fakePrisma() as any, fakeNotifications() as any);
      const result = await svc.setEurRonRate(4.9200);
      expect(result).toBe(4.92);
    });
  });

  describe('affiliateEnabled', () => {
    it('returns false when not set', async () => {
      const svc = new PlatformSettingsService(fakePrisma() as any, fakeNotifications() as any);
      expect(await svc.affiliateEnabled()).toBe(false);
    });

    it('returns true when set to "true"', async () => {
      const prisma = fakePrisma();
      prisma.__seedSetting('affiliate_enabled', 'true');
      const svc = new PlatformSettingsService(prisma as any, fakeNotifications() as any);
      expect(await svc.affiliateEnabled()).toBe(true);
    });
  });

  describe('setCreditsDiscount', () => {
    it('notifyAll discount_updated when enabling from off', async () => {
      const notifications = fakeNotifications();
      const svc = new PlatformSettingsService(fakePrisma() as any, notifications as any);

      await svc.setCreditsDiscount({ enabled: true, pct: 10 });
      // notifyAll is called void/async — wait a tick
      await new Promise((r) => setTimeout(r, 10));

      expect(notifications.notifyAll).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'discount_updated' }),
      );
    });

    it('notifyAll discount_ended when disabling from on', async () => {
      const notifications = fakeNotifications();
      const prisma = fakePrisma();
      prisma.__seedSetting('credits_discount_enabled', 'true');
      prisma.__seedSetting('credits_discount_pct', '15');
      const svc = new PlatformSettingsService(prisma as any, notifications as any);

      await svc.setCreditsDiscount({ enabled: false });
      await new Promise((r) => setTimeout(r, 10));

      expect(notifications.notifyAll).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'discount_ended' }),
      );
    });

    it('does not call notifyAll when enabled=true but nothing changed', async () => {
      const notifications = fakeNotifications();
      const prisma = fakePrisma();
      prisma.__seedSetting('credits_discount_enabled', 'true');
      prisma.__seedSetting('credits_discount_pct', '10');
      const svc = new PlatformSettingsService(prisma as any, notifications as any);

      await svc.setCreditsDiscount({ enabled: true, pct: 10 });
      await new Promise((r) => setTimeout(r, 10));

      expect(notifications.notifyAll).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when pct is out of range', async () => {
      const svc = new PlatformSettingsService(fakePrisma() as any, fakeNotifications() as any);
      await expect(svc.setCreditsDiscount({ pct: 0 })).rejects.toThrow(BadRequestException);
      await expect(svc.setCreditsDiscount({ pct: 100 })).rejects.toThrow(BadRequestException);
    });
  });
});
