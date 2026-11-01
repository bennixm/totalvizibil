import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebsiteAssetService } from 'src/website/assets/website-asset.service';
import type { AssetOwner, AssetStorageProvider } from 'src/website/assets/asset-storage';

const PNG_DATA_URI =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** A fake, non-Postgres AssetStorageProvider — stands in for what a future
 *  cloud/CDN-backed provider would look like, to prove the service genuinely
 *  doesn't care where bytes end up. */
function fakeStorage(): AssetStorageProvider & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    put: jest.fn(async (bytes: Buffer, mime: string, kind: string, owner: AssetOwner) => {
      calls.push({ bytes, mime, kind, owner });
      return { id: 'cloud-asset-1', url: 'https://images.example-cdn.com/cloud-asset-1' };
    }),
    get: jest.fn(async () => ({ mime: 'image/png', bytes: Buffer.from('x') })),
  };
}

function fakePrisma(count = 0) {
  return { websiteAsset: { count: jest.fn().mockResolvedValue(count) } };
}

describe('WebsiteAssetService', () => {
  describe('addCompanyAsset', () => {
    it('rejects an unknown kind without touching storage', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma() as any, storage);

      await expect(svc.addCompanyAsset('c1', PNG_DATA_URI, 'banner')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects a malformed data URI', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma() as any, storage);

      await expect(svc.addCompanyAsset('c1', 'not-a-data-uri', 'hero')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects once a company is at the asset cap', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma(60) as any, storage);

      await expect(svc.addCompanyAsset('c1', PNG_DATA_URI, 'hero')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('decodes the image and delegates storage to the injected provider, owner-scoped by company', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma() as any, storage);

      const out = await svc.addCompanyAsset('c1', PNG_DATA_URI, 'hero');

      expect(out).toEqual({
        id: 'cloud-asset-1',
        url: 'https://images.example-cdn.com/cloud-asset-1',
      });
      expect(storage.calls).toEqual([
        expect.objectContaining({ mime: 'image/png', kind: 'hero', owner: { companyId: 'c1' } }),
      ]);
    });
  });

  describe('addDraftAsset', () => {
    it('rejects an unknown kind without touching storage', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma() as any, storage);

      await expect(svc.addDraftAsset('d1', PNG_DATA_URI, 'hero')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('enforces the portfolio cap but not for other kinds', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma(20) as any, storage);

      await expect(svc.addDraftAsset('d1', PNG_DATA_URI, 'portfolio')).rejects.toThrow(
        BadRequestException,
      );
      await expect(svc.addDraftAsset('d1', PNG_DATA_URI, 'logo')).resolves.toBeDefined();
    });

    it('delegates storage to the injected provider, owner-scoped by draft', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma() as any, storage);

      await svc.addDraftAsset('d1', PNG_DATA_URI, 'logo');

      expect(storage.calls).toEqual([
        expect.objectContaining({ kind: 'logo', owner: { draftId: 'd1' } }),
      ]);
    });
  });

  describe('get', () => {
    it('delegates to the provider and maps a miss to NotFoundException', async () => {
      const storage = fakeStorage();
      storage.get = jest.fn().mockResolvedValue(null);
      const svc = new WebsiteAssetService(fakePrisma() as any, storage);

      await expect(svc.get('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns whatever the provider hands back', async () => {
      const storage = fakeStorage();
      const svc = new WebsiteAssetService(fakePrisma() as any, storage);

      await expect(svc.get('a1')).resolves.toEqual({ mime: 'image/png', bytes: Buffer.from('x') });
    });
  });
});
