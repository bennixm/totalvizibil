import { GoogleAdsApiClient, GoogleAdsSearchRow } from '../google-ads-api-client.service';

/**
 * Reads everything the monitor needs from the live account in a FIXED,
 * small number of account-wide GAQL queries (9 per cycle, regardless of how
 * many campaigns exist) instead of per-campaign calls, which keeps every
 * cycle far inside Google Ads API quotas. Every query and field here was
 * run against the real account (read-only) before being written.
 *
 * Output is normalized into one `CampaignData` per non-removed campaign, so
 * the evaluator is a pure function over plain data and testable without
 * Google.
 */

export interface PeriodMetrics {
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionsValue: number;
}

export interface TextAsset {
  text: string;
  /** Google's own asset performance label (BEST/GOOD/LOW/LEARNING/PENDING…). */
  performanceLabel?: string;
  approvalStatus?: string;
  pinnedField?: string;
}

export interface RsaAd {
  adResourceName: string;
  adGroupAdResourceName: string;
  status: string;
  adStrength?: string;
  primaryStatus?: string;
  primaryStatusReasons: string[];
  approvalStatus?: string;
  finalUrls: string[];
  headlines: TextAsset[];
  descriptions: TextAsset[];
  path1?: string;
  path2?: string;
}

export type AssetLevel = 'campaign' | 'ad_group' | 'account' | 'asset_group';

export interface LinkedAsset {
  level: AssetLevel;
  fieldType: string;
  assetType?: string;
  assetResourceName?: string;
  primaryStatus?: string;
  primaryStatusReasons: string[];
  approvalStatus?: string;
  source?: string;
  text?: string;
  sitelink?: { linkText: string; description1?: string; description2?: string; finalUrl?: string };
  image?: { width: number; height: number; fileSize: number };
  video?: { youtubeVideoId: string; title?: string };
}

export interface AssetGroupData {
  resourceName: string;
  name: string;
  status: string;
  adStrength?: string;
  primaryStatus?: string;
  primaryStatusReasons: string[];
  finalUrls: string[];
}

export interface CampaignData {
  googleCampaignId: string;
  resourceName: string;
  name: string;
  channelType: string;
  status: string;
  primaryStatus?: string;
  primaryStatusReasons: string[];
  biddingStrategyType?: string;
  dailyBudgetMicros?: string;
  currencyCode?: string;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  ads: RsaAd[];
  /** Campaign-, ad-group- and account-level assets that serve with this
   *  campaign (account-level ones are shared by every campaign). */
  assets: LinkedAsset[];
  assetGroups: AssetGroupData[];
  openRecommendations: { type: string; resourceName: string }[];
}

export const PERIOD_DAYS = 30;

const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const arr = <T = Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function metricsOf(row: GoogleAdsSearchRow): PeriodMetrics {
  const m = obj(row.metrics);
  return {
    impressions: n(m.impressions),
    clicks: n(m.clicks),
    costMicros: n(m.costMicros),
    conversions: n(m.conversions),
    conversionsValue: n(m.conversionsValue),
  };
}

const emptyMetrics = (): PeriodMetrics => ({
  impressions: 0,
  clicks: 0,
  costMicros: 0,
  conversions: 0,
  conversionsValue: 0,
});

function addMetrics(a: PeriodMetrics, b: PeriodMetrics): PeriodMetrics {
  return {
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    costMicros: a.costMicros + b.costMicros,
    conversions: a.conversions + b.conversions,
    conversionsValue: a.conversionsValue + b.conversionsValue,
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function textAssets(list: unknown): TextAsset[] {
  return arr(list)
    .map((h) => ({
      text: s(h.text) ?? '',
      performanceLabel: s(h.assetPerformanceLabel),
      approvalStatus: s(obj(h.policySummaryInfo).approvalStatus),
      pinnedField: s(h.pinnedField),
    }))
    .filter((h) => h.text);
}

function linkedAssetFrom(
  level: AssetLevel,
  link: Record<string, unknown>,
  asset: Record<string, unknown>,
): LinkedAsset {
  const sl = obj(asset.sitelinkAsset);
  const img = obj(asset.imageAsset);
  const size = obj(img.fullSize);
  const yt = obj(asset.youtubeVideoAsset);
  return {
    level,
    fieldType: s(link.fieldType) ?? 'UNKNOWN',
    assetType: s(asset.type),
    assetResourceName: s(asset.resourceName),
    primaryStatus: s(link.primaryStatus),
    primaryStatusReasons: arr<string>(link.primaryStatusReasons),
    approvalStatus: s(obj(asset.policySummary).approvalStatus),
    source: s(link.source),
    text: s(obj(asset.calloutAsset).calloutText) ?? s(obj(asset.textAsset).text),
    ...(s(sl.linkText)
      ? {
          sitelink: {
            linkText: s(sl.linkText)!,
            description1: s(sl.description1),
            description2: s(sl.description2),
            finalUrl: s(arr<string>(asset.finalUrls)[0]),
          },
        }
      : {}),
    ...(size.widthPixels
      ? {
          image: {
            width: n(size.widthPixels),
            height: n(size.heightPixels),
            fileSize: n(img.fileSize),
          },
        }
      : {}),
    ...(s(yt.youtubeVideoId)
      ? { video: { youtubeVideoId: s(yt.youtubeVideoId)!, title: s(yt.youtubeVideoTitle) } }
      : {}),
  };
}

const ASSET_FIELDS =
  'asset.resource_name, asset.type, asset.policy_summary.approval_status, asset.final_urls, ' +
  'asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, ' +
  'asset.callout_asset.callout_text, asset.text_asset.text, ' +
  'asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels, asset.image_asset.file_size, ' +
  'asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title';

/** The labelled list of queries, so the activity feed can say exactly what
 *  was read. Returned with the data for that purpose. */
export interface AccountData {
  campaigns: CampaignData[];
  queriesRun: number;
  period: { current: { from: string; to: string }; previous: { from: string; to: string } };
}

export async function fetchAccountData(
  client: GoogleAdsApiClient,
  now = new Date(),
): Promise<AccountData> {
  // Two adjacent, equal-length windows ending yesterday (today is partial).
  const day = 86_400_000;
  const curTo = new Date(now.getTime() - day);
  const curFrom = new Date(curTo.getTime() - (PERIOD_DAYS - 1) * day);
  const prevTo = new Date(curFrom.getTime() - day);
  const prevFrom = new Date(prevTo.getTime() - (PERIOD_DAYS - 1) * day);
  const between = (a: Date, b: Date) => `segments.date BETWEEN '${ymd(a)}' AND '${ymd(b)}'`;

  const [
    campaignRows,
    previousRows,
    adRows,
    campaignAssetRows,
    adGroupAssetRows,
    customerAssetRows,
    assetGroupRows,
    assetGroupAssetRows,
    recommendationRows,
  ] = await Promise.all([
    client.search(
      'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
        'campaign.primary_status, campaign.primary_status_reasons, campaign.bidding_strategy_type, ' +
        'campaign_budget.amount_micros, customer.currency_code, ' +
        'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
        `FROM campaign WHERE campaign.status != 'REMOVED' AND ${between(curFrom, curTo)}`,
    ),
    client.search(
      'SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
        'metrics.conversions, metrics.conversions_value ' +
        `FROM campaign WHERE campaign.status != 'REMOVED' AND ${between(prevFrom, prevTo)}`,
    ),
    client.search(
      'SELECT campaign.id, ad_group_ad.resource_name, ad_group_ad.ad.resource_name, ad_group_ad.status, ' +
        'ad_group_ad.ad_strength, ad_group_ad.primary_status, ad_group_ad.primary_status_reasons, ' +
        'ad_group_ad.policy_summary.approval_status, ad_group_ad.ad.final_urls, ad_group_ad.ad.type, ' +
        'ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ' +
        'ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2 ' +
        "FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'",
    ),
    client.search(
      'SELECT campaign.id, campaign.status, campaign_asset.field_type, campaign_asset.status, ' +
        'campaign_asset.primary_status, campaign_asset.primary_status_reasons, campaign_asset.source, ' +
        `${ASSET_FIELDS} FROM campaign_asset ` +
        "WHERE campaign.status != 'REMOVED' AND campaign_asset.status != 'REMOVED'",
    ),
    client.search(
      'SELECT campaign.id, campaign.status, ad_group.status, ad_group_asset.field_type, ad_group_asset.status, ' +
        'ad_group_asset.primary_status, ad_group_asset.primary_status_reasons, ad_group_asset.source, ' +
        `${ASSET_FIELDS} FROM ad_group_asset ` +
        "WHERE campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND ad_group_asset.status != 'REMOVED'",
    ),
    client.search(
      'SELECT customer_asset.field_type, customer_asset.status, customer_asset.primary_status, ' +
        'customer_asset.primary_status_reasons, customer_asset.source, ' +
        `${ASSET_FIELDS} FROM customer_asset WHERE customer_asset.status != 'REMOVED'`,
    ),
    client.search(
      'SELECT campaign.id, asset_group.resource_name, asset_group.name, asset_group.status, ' +
        'asset_group.ad_strength, asset_group.primary_status, asset_group.primary_status_reasons, ' +
        "asset_group.final_urls FROM asset_group WHERE asset_group.status != 'REMOVED'",
    ),
    client.search(
      'SELECT campaign.id, asset_group.status, asset_group_asset.field_type, asset_group_asset.status, ' +
        'asset_group_asset.primary_status, asset_group_asset.primary_status_reasons, asset_group_asset.source, ' +
        `${ASSET_FIELDS} FROM asset_group_asset ` +
        "WHERE asset_group.status != 'REMOVED' AND asset_group_asset.status != 'REMOVED'",
    ),
    client.search(
      'SELECT recommendation.resource_name, recommendation.type, recommendation.campaign FROM recommendation',
    ),
  ]);

  const byId = new Map<string, CampaignData>();
  for (const row of campaignRows) {
    const c = obj(row.campaign);
    const id = s(c.id);
    if (!id) continue;
    const existing = byId.get(id);
    // Without segments.date in SELECT Google returns one aggregated row per
    // campaign; summing defensively in case a future change segments it.
    if (existing) {
      existing.current = addMetrics(existing.current, metricsOf(row));
      continue;
    }
    byId.set(id, {
      googleCampaignId: id,
      resourceName: s(c.resourceName) ?? '',
      name: s(c.name) ?? id,
      channelType: s(c.advertisingChannelType) ?? 'UNKNOWN',
      status: s(c.status) ?? 'UNKNOWN',
      primaryStatus: s(c.primaryStatus),
      primaryStatusReasons: arr<string>(c.primaryStatusReasons),
      biddingStrategyType: s(c.biddingStrategyType),
      dailyBudgetMicros: s(obj(row.campaignBudget).amountMicros),
      currencyCode: s(obj(row.customer).currencyCode),
      current: metricsOf(row),
      previous: emptyMetrics(),
      ads: [],
      assets: [],
      assetGroups: [],
      openRecommendations: [],
    });
  }
  const campaignOf = (row: GoogleAdsSearchRow) => byId.get(s(obj(row.campaign).id) ?? '');

  for (const row of previousRows) {
    const c = campaignOf(row);
    if (c) c.previous = addMetrics(c.previous, metricsOf(row));
  }

  for (const row of adRows) {
    const c = campaignOf(row);
    const aga = obj(row.adGroupAd);
    const ad = obj(aga.ad);
    if (!c || s(ad.type) !== 'RESPONSIVE_SEARCH_AD') continue;
    const rsa = obj(ad.responsiveSearchAd);
    c.ads.push({
      adResourceName: s(ad.resourceName) ?? '',
      adGroupAdResourceName: s(aga.resourceName) ?? '',
      status: s(aga.status) ?? 'UNKNOWN',
      adStrength: s(aga.adStrength),
      primaryStatus: s(aga.primaryStatus),
      primaryStatusReasons: arr<string>(aga.primaryStatusReasons),
      approvalStatus: s(obj(aga.policySummary).approvalStatus),
      finalUrls: arr<string>(ad.finalUrls),
      headlines: textAssets(rsa.headlines),
      descriptions: textAssets(rsa.descriptions),
      path1: s(rsa.path1),
      path2: s(rsa.path2),
    });
  }

  for (const row of campaignAssetRows) {
    const c = campaignOf(row);
    if (c) c.assets.push(linkedAssetFrom('campaign', obj(row.campaignAsset), obj(row.asset)));
  }
  for (const row of adGroupAssetRows) {
    const c = campaignOf(row);
    if (c) c.assets.push(linkedAssetFrom('ad_group', obj(row.adGroupAsset), obj(row.asset)));
  }
  const accountAssets = customerAssetRows.map((row) =>
    linkedAssetFrom('account', obj(row.customerAsset), obj(row.asset)),
  );
  for (const c of byId.values()) c.assets.push(...accountAssets);

  for (const row of assetGroupRows) {
    const c = campaignOf(row);
    const g = obj(row.assetGroup);
    if (!c) continue;
    c.assetGroups.push({
      resourceName: s(g.resourceName) ?? '',
      name: s(g.name) ?? '',
      status: s(g.status) ?? 'UNKNOWN',
      adStrength: s(g.adStrength),
      primaryStatus: s(g.primaryStatus),
      primaryStatusReasons: arr<string>(g.primaryStatusReasons),
      finalUrls: arr<string>(g.finalUrls),
    });
  }
  for (const row of assetGroupAssetRows) {
    const c = campaignOf(row);
    if (c) c.assets.push(linkedAssetFrom('asset_group', obj(row.assetGroupAsset), obj(row.asset)));
  }

  for (const row of recommendationRows) {
    const r = obj(row.recommendation);
    const campaignId = s(r.campaign)?.split('/').pop();
    const c = campaignId ? byId.get(campaignId) : undefined;
    if (c && s(r.type))
      c.openRecommendations.push({ type: s(r.type)!, resourceName: s(r.resourceName) ?? '' });
  }

  return {
    campaigns: [...byId.values()],
    queriesRun: 9,
    period: {
      current: { from: ymd(curFrom), to: ymd(curTo) },
      previous: { from: ymd(prevFrom), to: ymd(prevTo) },
    },
  };
}
