import { buildProposalPreview } from 'src/google-ads/google-ads-proposal-preview';

const reco = (type: string, recommendation: Record<string, unknown>, currencyCode = 'RON') => ({
  action: `recommendation.${type}`,
  before: null,
  after: { resourceName: 'customers/1/recommendations/2', type, currencyCode, recommendation },
});

describe('buildProposalPreview', () => {
  it('lists every sitelink with its texts and URL', () => {
    const p = buildProposalPreview(
      reco('SITELINK_ASSET', {
        sitelinkAssetRecommendation: {
          recommendedCampaignSitelinkAssets: [
            {
              sitelinkAsset: {
                linkText: 'Instalatori Cluj',
                description1: 'Firme verificate',
                description2: 'Cere ofertă',
              },
              finalUrls: ['https://totalvizibil.ro/servicii/instalatori'],
            },
            {
              sitelinkAsset: { linkText: 'Contact' },
              finalUrls: ['https://totalvizibil.ro/contact'],
            },
          ],
        },
      }),
    );
    expect(p.sections[0]).toEqual({
      kind: 'items',
      title: 'Sitelink-uri care vor fi adăugate',
      items: [
        {
          title: 'Instalatori Cluj',
          lines: ['Firme verificate', 'Cere ofertă'],
          url: 'https://totalvizibil.ro/servicii/instalatori',
        },
        { title: 'Contact', lines: [], url: 'https://totalvizibil.ro/contact' },
      ],
    });
  });

  it('lists callouts to add', () => {
    const p = buildProposalPreview(
      reco('CALLOUT_ASSET', {
        calloutAssetRecommendation: {
          recommendedCampaignCalloutAssets: [{ calloutAsset: { calloutText: 'Livrare rapidă' } }],
        },
      }),
    );
    expect(p.sections[0]).toMatchObject({
      kind: 'texts',
      items: [{ text: 'Livrare rapidă', status: 'added' }],
    });
  });

  it('RSA asset: marks only genuinely new texts as added, keeps current ones', () => {
    const p = buildProposalPreview(
      reco('RESPONSIVE_SEARCH_AD_ASSET', {
        responsiveSearchAdAssetRecommendation: {
          currentAd: {
            responsiveSearchAd: {
              headlines: [{ text: 'A' }, { text: 'B' }],
              descriptions: [{ text: 'D1' }],
            },
          },
          recommendedAssets: {
            responsiveSearchAd: {
              headlines: [{ text: 'B' }, { text: 'C', pinnedField: 'HEADLINE_1' }],
            },
          },
        },
      }),
    );
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0]).toMatchObject({
      kind: 'texts',
      items: [
        { text: 'C (fixat pe poziția 1)', status: 'added' },
        { text: 'A', status: 'existing' },
        { text: 'B', status: 'existing' },
      ],
    });
  });

  it('budget recommendation shows current → recommended in account currency, plus impact', () => {
    const p = buildProposalPreview(
      reco('CAMPAIGN_BUDGET', {
        campaignBudgetRecommendation: {
          currentBudgetAmountMicros: '25000000',
          recommendedBudgetAmountMicros: '40000000',
        },
        impact: {
          baseMetrics: { clicks: 120, impressions: 3000, costMicros: '175000000' },
          potentialMetrics: { clicks: 180, impressions: 4200, costMicros: '280000000' },
        },
      }),
    );
    expect(p.sections[0]).toEqual({
      kind: 'diff',
      title: 'Schimbare de buget',
      rows: [{ label: 'Buget zilnic', before: '25,00 RON', after: '40,00 RON' }],
    });
    expect(p.sections[1]).toMatchObject({
      title: 'Impact estimat de Google',
      rows: expect.arrayContaining([{ label: 'Clicuri', before: '120', after: '180' }]),
    });
  });

  it('keyword recommendation names the keyword, match type and bid', () => {
    const p = buildProposalPreview(
      reco('KEYWORD', {
        keywordRecommendation: {
          keyword: { text: 'instalator non stop', matchType: 'PHRASE' },
          recommendedCpcBidMicros: '1500000',
        },
      }),
    );
    expect(p.sections[0]).toMatchObject({
      items: [{ text: 'instalator non stop (potrivire de expresie)', status: 'added' }],
    });
    expect(p.sections[1]).toMatchObject({ rows: [{ label: 'CPC recomandat', after: '1,50 RON' }] });
  });

  it('falls back to Google values for an unknown type, then to an explicit note', () => {
    const generic = buildProposalPreview(
      reco('SOMETHING_NEW', { somethingNewRecommendation: { recommendedFooMicros: '2000000' } }),
    );
    expect(generic.sections[0]).toMatchObject({ kind: 'diff', rows: [{ after: '2,00 RON' }] });
    const empty = buildProposalPreview(reco('CAMPAIGN_BUDGET', {}));
    expect(empty.sections[0]).toMatchObject({ kind: 'note' });
  });

  it('budget/CPC increase proposal shows credits before → after', () => {
    const p = buildProposalPreview({
      action: 'budget.increase.proposed',
      before: { dailyBudgetCredits: 5, maxCpcCredits: 1 },
      after: { proposedDailyBudgetCredits: 8, proposedMaxCpcCredits: 1.2 },
    });
    expect(p.sections[0]).toEqual({
      kind: 'diff',
      title: 'Schimbări',
      rows: [
        { label: 'Buget zilnic', before: '5,00 credite', after: '8,00 credite' },
        { label: 'CPC maxim', before: '1,00 credite', after: '1,20 credite' },
      ],
    });
  });
});
