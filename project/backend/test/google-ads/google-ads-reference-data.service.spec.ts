import { GoogleAdsReferenceDataService } from 'src/google-ads/google-ads-reference-data.service';

function fakeClient(search: jest.Mock) {
  return { search } as never;
}

describe('GoogleAdsReferenceDataService', () => {
  it('resolves the RO geo target constant via a live lookup, then caches it', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([{ geoTargetConstant: { resourceName: 'geoTargetConstants/2642' } }]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    expect(await svc.getGeoTargetConstantRo()).toBe('geoTargetConstants/2642');
    expect(await svc.getGeoTargetConstantRo()).toBe('geoTargetConstants/2642');
    expect(search).toHaveBeenCalledTimes(1); // second call hit the cache
    expect(search.mock.calls[0][0]).toContain("country_code = 'RO'");
  });

  it('resolves the RO language constant via a live lookup', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([{ languageConstant: { resourceName: 'languageConstants/1032' } }]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    expect(await svc.getLanguageConstantRo()).toBe('languageConstants/1032');
    expect(search.mock.calls[0][0]).toContain("code = 'ro'");
  });

  it('resolves the account currency code via the customer resource', async () => {
    const search = jest.fn().mockResolvedValue([{ customer: { currencyCode: 'RON' } }]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    expect(await svc.getAccountCurrencyCode()).toBe('RON');
  });

  it('throws rather than guessing when the geo lookup returns nothing', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    await expect(svc.getGeoTargetConstantRo()).rejects.toThrow(/no result/i);
  });

  it('throws rather than guessing when the language lookup returns nothing', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    await expect(svc.getLanguageConstantRo()).rejects.toThrow(/no result/i);
  });

  it('throws rather than guessing when the currency lookup returns nothing', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    await expect(svc.getAccountCurrencyCode()).rejects.toThrow(/no result/i);
  });

  it('clearCache() forces a fresh lookup', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce([{ geoTargetConstant: { resourceName: 'geoTargetConstants/2642' } }])
      .mockResolvedValueOnce([{ geoTargetConstant: { resourceName: 'geoTargetConstants/2642' } }]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    await svc.getGeoTargetConstantRo();
    svc.clearCache();
    await svc.getGeoTargetConstantRo();

    expect(search).toHaveBeenCalledTimes(2);
  });
});
