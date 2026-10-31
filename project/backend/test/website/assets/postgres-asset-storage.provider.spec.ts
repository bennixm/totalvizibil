import { PostgresAssetStorageProvider } from 'src/website/assets/postgres-asset-storage.provider';

function fakePrisma() {
  return {
    websiteAsset: {
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      findUnique: jest.fn(),
    },
  };
}

describe('PostgresAssetStorageProvider', () => {
  it('writes bytes under the given owner/kind and returns the servable URL', async () => {
    const prisma = fakePrisma();
    const provider = new PostgresAssetStorageProvider(prisma as any);

    const out = await provider.put(Buffer.from('img'), 'image/png', 'hero', { companyId: 'c1' });

    expect(prisma.websiteAsset.create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        kind: 'hero',
        mime: 'image/png',
        bytes: Buffer.from('img'),
        size: 3,
      },
    });
    expect(out).toEqual({ id: 'a1', url: '/api/v1/website-assets/a1' });
  });

  it('returns null for a missing id instead of throwing', async () => {
    const prisma = fakePrisma();
    prisma.websiteAsset.findUnique.mockResolvedValue(null);
    const provider = new PostgresAssetStorageProvider(prisma as any);

    await expect(provider.get('missing')).resolves.toBeNull();
  });

  it('reads bytes back out for an existing row', async () => {
    const prisma = fakePrisma();
    prisma.websiteAsset.findUnique.mockResolvedValue({
      mime: 'image/png',
      bytes: Buffer.from('img'),
    });
    const provider = new PostgresAssetStorageProvider(prisma as any);

    await expect(provider.get('a1')).resolves.toEqual({
      mime: 'image/png',
      bytes: Buffer.from('img'),
    });
  });
});
