import { GoogleAdsCpcSyncService } from 'src/google-ads/google-ads-cpc-sync.service';

/**
 * Behavioral-regression coverage for the Phase 1 refactor that moved all
 * auth/HTTP out of this service and into `GoogleAdsApiClient` — this file
 * exists to prove that extraction changed nothing observable: same query,
 * same cost booking, same CPC conversion, same silent-failure shape.
 */
function fakeConfig(campaignId = '') {
  return { get: () => campaignId } as never;
}

function fakeClient(
  overrides: { configured?: boolean; customerId?: string; search?: jest.Mock } = {},
) {
  return {
    configured: overrides.configured ?? true,
    customerId: overrides.customerId ?? '1234567890',
    search: overrides.search ?? jest.fn(),
  } as never;
}

function fakeSettings(eurRonRate = 5, dbCampaignId = '') {
  return {
    eurRonRate: jest.fn().mockResolvedValue(eurRonRate),
    setGoogleAdsAvgCpc: jest.fn().mockResolvedValue(undefined),
    googleAdsCampaignId: jest.fn().mockResolvedValue(dbCampaignId),
  } as never;
}

function fakePrisma() {
  return { platformExpense: { upsert: jest.fn().mockResolvedValue({}) } } as never;
}

describe('GoogleAdsCpcSyncService', () => {
  it('does nothing when the Google Ads client is not configured', async () => {
    const client = fakeClient({ configured: false });
    const settings = fakeSettings();
    const prisma = fakePrisma();
    const svc = new GoogleAdsCpcSyncService(fakeConfig(), client, settings, prisma);

    await (svc as any).sync();

    expect((client as any).search).not.toHaveBeenCalled();
    expect((settings as any).setGoogleAdsAvgCpc).not.toHaveBeenCalled();
  });

  it('books daily cost and syncs avg CPC in EUR, with clicks today', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { customer: { currencyCode: 'EUR' }, metrics: { costMicros: '10000000', clicks: '2' } },
      ]);
    const client = fakeClient({ search });
    const settings = fakeSettings();
    const prisma = fakePrisma();
    const svc = new GoogleAdsCpcSyncService(fakeConfig(), client, settings, prisma);

    await (svc as any).sync();

    expect(search).toHaveBeenCalledWith(
      expect.stringContaining('SELECT customer.currency_code, metrics.cost_micros, metrics.clicks'),
    );
    // costMicros 10_000_000 => 10 EUR, booked as 1000 minor units (cents).
    expect((prisma as any).platformExpense.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalRef: expect.stringMatching(/^google_ads_daily:1234567890:\d{4}-\d{2}-\d{2}$/),
        },
        update: { amountMinor: 1000 },
        create: expect.objectContaining({
          category: 'google_ads',
          amountMinor: 1000,
          currency: 'EUR',
          source: 'google_ads_api',
        }),
      }),
    );
    // avg cost = 10 EUR / 2 clicks = 5 EUR = 5 credits (1 credit ≡ 1 EUR).
    expect((settings as any).setGoogleAdsAvgCpc).toHaveBeenCalledWith(5);
  });

  it('includes the campaign filter in the query, falling back to the env var when no DB value is set', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const client = fakeClient({ search });
    const svc = new GoogleAdsCpcSyncService(
      fakeConfig('999'),
      client,
      fakeSettings(),
      fakePrisma(),
    );

    await (svc as any).sync();

    expect(search).toHaveBeenCalledWith(expect.stringContaining('AND campaign.id = 999'));
  });

  it('prefers the DB-configured campaign id over the env var', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const client = fakeClient({ search });
    const svc = new GoogleAdsCpcSyncService(
      fakeConfig('999'),
      client,
      fakeSettings(5, '777'),
      fakePrisma(),
    );

    await (svc as any).sync();

    expect(search).toHaveBeenCalledWith(expect.stringContaining('AND campaign.id = 777'));
  });

  it('converts RON cost/CPC through the live EUR/RON rate', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { customer: { currencyCode: 'RON' }, metrics: { costMicros: '50000000', clicks: '1' } },
      ]);
    const client = fakeClient({ search });
    const settings = fakeSettings(5); // 1 EUR = 5 RON
    const prisma = fakePrisma();
    const svc = new GoogleAdsCpcSyncService(fakeConfig(), client, settings, prisma);

    await (svc as any).sync();

    // 50 RON / 5 = 10 EUR credits, for both the expense row and the avg CPC.
    expect((prisma as any).platformExpense.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { amountMinor: 1000 } }),
    );
    expect((settings as any).setGoogleAdsAvgCpc).toHaveBeenCalledWith(10);
  });

  it('books cost but skips the CPC average when there are no clicks today', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { customer: { currencyCode: 'EUR' }, metrics: { costMicros: '3000000', clicks: '0' } },
      ]);
    const client = fakeClient({ search });
    const settings = fakeSettings();
    const prisma = fakePrisma();
    const svc = new GoogleAdsCpcSyncService(fakeConfig(), client, settings, prisma);

    await (svc as any).sync();

    expect((prisma as any).platformExpense.upsert).toHaveBeenCalled();
    expect((settings as any).setGoogleAdsAvgCpc).not.toHaveBeenCalled();
  });

  it('skips the write (no crash) on an unconvertible currency', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { customer: { currencyCode: 'USD' }, metrics: { costMicros: '3000000', clicks: '1' } },
      ]);
    const client = fakeClient({ search });
    const settings = fakeSettings();
    const prisma = fakePrisma();
    const svc = new GoogleAdsCpcSyncService(fakeConfig(), client, settings, prisma);

    await (svc as any).sync();

    expect((prisma as any).platformExpense.upsert).not.toHaveBeenCalled();
    expect((settings as any).setGoogleAdsAvgCpc).not.toHaveBeenCalled();
  });

  it('swallows a search failure and keeps the previous cached value', async () => {
    const search = jest.fn().mockRejectedValue(new Error('Google Ads API 500: boom'));
    const client = fakeClient({ search });
    const settings = fakeSettings();
    const prisma = fakePrisma();
    const svc = new GoogleAdsCpcSyncService(fakeConfig(), client, settings, prisma);

    await expect((svc as any).sync()).resolves.toBeUndefined();
    expect((settings as any).setGoogleAdsAvgCpc).not.toHaveBeenCalled();
  });
});
