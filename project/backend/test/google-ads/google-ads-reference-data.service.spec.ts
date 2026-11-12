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

  it('resolves every județ to its geoTargetConstant, keyed diacritic/case-insensitively, then caches it', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { geoTargetConstant: { name: 'Constanta', resourceName: 'geoTargetConstants/20899' } },
        { geoTargetConstant: { name: 'Cluj', resourceName: 'geoTargetConstants/20828' } },
      ]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    const map = await svc.getCountyGeoTargetConstants();
    // Looking up with the canonical (diacritic) spelling must still match
    // Google's own ASCII-only name.
    expect(map.get('constanța'.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())).toBe(
      'geoTargetConstants/20899',
    );
    expect(map.get('cluj')).toBe('geoTargetConstants/20828');

    await svc.getCountyGeoTargetConstants();
    expect(search).toHaveBeenCalledTimes(1); // second call hit the cache
    expect(search.mock.calls[0][0]).toContain("target_type = 'County'");
  });

  it('throws rather than guessing when the county lookup returns nothing', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    await expect(svc.getCountyGeoTargetConstants()).rejects.toThrow(/no result/i);
  });

  it('resolves a geo-target id (ValueTrack {loc_physical_ms}) back to our canonical județ spelling', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { geoTargetConstant: { id: '20899', name: 'Constanta' } },
        { geoTargetConstant: { id: '20828', name: 'Cluj' } },
      ]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    expect(await svc.getCountyByGeoTargetId('20899')).toBe('Constanța');
    expect(await svc.getCountyByGeoTargetId('20828')).toBe('Cluj');
    expect(await svc.getCountyByGeoTargetId('999999')).toBeNull(); // unknown id, not an error

    await svc.getCountyByGeoTargetId('20899');
    expect(search).toHaveBeenCalledTimes(1); // second+ lookups hit the cache
  });

  it('throws rather than guessing when the geo-target-id reverse lookup returns nothing', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const svc = new GoogleAdsReferenceDataService(fakeClient(search));

    await expect(svc.getCountyByGeoTargetId('20899')).rejects.toThrow(/no result/i);
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
