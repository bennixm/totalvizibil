import type {
  GoogleAdsMutateOperation,
  GoogleAdsSearchRow,
} from '../google-ads/google-ads-api-client.service';
import { CampaignData, RsaAd } from '../google-ads/optimization/google-ads-account-data';
import { textProblem } from '../google-ads/optimization/google-ads-optimizer.service';
import { CALLOUTS, RSA, SITELINKS } from '../google-ads/optimization/google-ads-specs';
import { ChangeUnits } from './chat-pricing';

/**
 * Changes the owner asks for in the agent chat. The AI only PREPARES them:
 * each one is checked locally against Google's limits, then by Google
 * (validateOnly), stored as a `pending_approval` action and applied only when
 * the owner approves exactly that content. Every operation is built here from
 * the stored content and scoped to the one campaign, never from raw AI output.
 */

export interface ChatAdsClient {
  readonly customerId: string;
  readonly writesAllowed: boolean;
  search(query: string): Promise<GoogleAdsSearchRow[]>;
  mutate(ops: GoogleAdsMutateOperation[], opts?: { validateOnly?: boolean }): Promise<unknown[]>;
}

interface AdText {
  text: string;
  pinnedField?: string;
}
export const MATCH_TYPES = ['EXACT', 'PHRASE', 'BROAD'] as const;
export interface Keyword {
  text: string;
  matchType: (typeof MATCH_TYPES)[number];
}
export interface KeywordRef {
  resourceName: string;
  text: string;
}
export interface Sitelink {
  linkText: string;
  url: string;
  description1?: string;
  description2?: string;
}

export type ChatChange =
  | {
      action: 'chat.ad_texts';
      before: { adResourceName: string; headlines: AdText[]; descriptions: AdText[] };
      after: { headlines: AdText[]; descriptions: AdText[] };
    }
  | {
      action: 'chat.ad_create';
      before: Record<string, never>;
      after: { adGroup: string; finalUrl: string; headlines: string[]; descriptions: string[] };
    }
  | {
      action: 'chat.keywords';
      before: Record<string, never>;
      after: {
        adGroup: string;
        campaign: string;
        add: Keyword[];
        negatives: Keyword[];
        pause: KeywordRef[];
      };
    }
  | {
      action: 'chat.extensions';
      before: Record<string, never>;
      after: { campaign: string; sitelinks: Sitelink[]; callouts: string[] };
    }
  | {
      action: 'chat.status';
      before: { campaign: string; status: string };
      after: { status: 'ENABLED' | 'PAUSED' };
    };

const ACTIONS = new Set<string>([
  'chat.ad_texts',
  'chat.ad_create',
  'chat.keywords',
  'chat.extensions',
  'chat.status',
]);
export const isChatChange = (action: string): boolean => ACTIONS.has(action);

/** A request the agent got wrong; the message goes back to it to correct. */
export class ChatChangeError extends Error {}

const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] =>
  list(v)
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function mainAd(c: CampaignData): RsaAd | undefined {
  return [...c.ads.filter((a) => a.status === 'ENABLED')].sort(
    (a, b) => b.headlines.length - a.headlines.length,
  )[0];
}

function checkTexts(texts: string[], kind: 'headline' | 'description'): void {
  const spec = kind === 'headline' ? RSA.headlines : RSA.descriptions;
  for (const t of texts) {
    const p = textProblem(t, spec.maxChars, kind === 'headline' ? 'headline' : 'other');
    if (p) throw new ChatChangeError(`„${t}” (${[...t].length} caractere): ${p}`);
  }
}

function checkSet(texts: string[], kind: 'headline' | 'description'): void {
  const spec = kind === 'headline' ? RSA.headlines : RSA.descriptions;
  if (texts.length < spec.min || texts.length > spec.max)
    throw new ChatChangeError(
      `Reclama ar avea ${texts.length} texte de tip ${kind}; Google cere între ${spec.min} și ${spec.max}.`,
    );
  if (new Set(texts.map(fold)).size !== texts.length)
    throw new ChatChangeError(`Texte duplicate de tip ${kind}.`);
}

/** Edits to the main ad. Pinning is kept; untouched texts stay as they are. */
export function planAdTexts(
  c: CampaignData,
  input: unknown,
): { change: ChatChange; units: ChangeUnits } {
  const ad = mainAd(c);
  if (!ad) throw new ChatChangeError('Campania nu are o reclamă activă; folosește propose_new_ad.');
  const i = rec(input);
  let units = 0;
  const edit = (current: AdText[], kind: 'headline' | 'description', key: string): AdText[] => {
    const e = rec(i[key]);
    const out = current.map((t) => ({ ...t }));
    const written: string[] = [];
    for (const r of list(e.replace).map(rec)) {
      const at = out.findIndex((t) => t.text === String(r.old ?? '').trim());
      if (at < 0)
        throw new ChatChangeError(`Textul „${String(r.old ?? '')}” nu există în reclamă.`);
      const text = String(r.new ?? '').trim();
      out[at] = { ...out[at], text };
      written.push(text);
    }
    for (const text of strings(e.remove)) {
      const at = out.findIndex((t) => t.text === text);
      if (at < 0) throw new ChatChangeError(`Textul „${text}” nu există în reclamă.`);
      out.splice(at, 1);
      units++;
    }
    for (const text of strings(e.add)) {
      out.push({ text });
      written.push(text);
    }
    checkTexts(written, kind);
    units += written.length;
    checkSet(
      out.map((t) => t.text),
      kind,
    );
    return out;
  };
  const slim = (t: AdText): AdText => ({
    text: t.text,
    ...(t.pinnedField ? { pinnedField: t.pinnedField } : {}),
  });
  const before = {
    adResourceName: ad.adResourceName,
    headlines: ad.headlines.map(slim),
    descriptions: ad.descriptions.map(slim),
  };
  const after = {
    headlines: edit(before.headlines, 'headline', 'headlines'),
    descriptions: edit(before.descriptions, 'description', 'descriptions'),
  };
  if (!units) throw new ChatChangeError('Nicio modificare de text cerută.');
  return { change: { action: 'chat.ad_texts', before, after }, units: { text: units } };
}

async function adGroupOf(client: ChatAdsClient, c: CampaignData): Promise<string> {
  const rows = await client.search(
    'SELECT campaign.id, ad_group.resource_name, ad_group.status FROM ad_group ' +
      `WHERE campaign.id = ${c.googleCampaignId} AND ad_group.status != 'REMOVED'`,
  );
  const groups = rows.map((r) => rec(r.adGroup));
  const adId = mainAd(c)?.adGroupAdResourceName.split('/').pop()?.split('~')[0];
  const pick =
    (adId && groups.find((g) => String(g.resourceName).endsWith(`/${adId}`))) ||
    groups.find((g) => g.status === 'ENABLED') ||
    groups[0];
  if (!pick?.resourceName) throw new ChatChangeError('Campania nu are niciun grup de anunțuri.');
  return String(pick.resourceName);
}

export async function planNewAd(
  client: ChatAdsClient,
  c: CampaignData,
  input: unknown,
  urlResponds: (url: string) => Promise<boolean>,
): Promise<{ change: ChatChange; units: ChangeUnits }> {
  if (mainAd(c))
    throw new ChatChangeError('Campania are deja o reclamă activă; folosește propose_ad_texts.');
  const i = rec(input);
  const headlines = strings(i.headlines);
  const descriptions = strings(i.descriptions);
  checkTexts(headlines, 'headline');
  checkTexts(descriptions, 'description');
  checkSet(headlines, 'headline');
  checkSet(descriptions, 'description');
  const finalUrl = String(i.final_url ?? '').trim();
  if (!/^https?:\/\//.test(finalUrl) || !(await urlResponds(finalUrl)))
    throw new ChatChangeError('Pagina de destinație nu răspunde; cere proprietarului adresa.');
  return {
    change: {
      action: 'chat.ad_create',
      before: {},
      after: { adGroup: await adGroupOf(client, c), finalUrl, headlines, descriptions },
    },
    units: { text: headlines.length + descriptions.length },
  };
}

const KEYWORD_MAX = 30;

function keywords(v: unknown): Keyword[] {
  return list(v)
    .map(rec)
    .map((k) => {
      const text = String(k.text ?? '')
        .trim()
        .replace(/\s+/g, ' ');
      const matchType = String(k.match_type ?? 'PHRASE') as Keyword['matchType'];
      if (!text || text.length > 80 || text.split(' ').length > 10)
        throw new ChatChangeError(
          `Cuvânt cheie invalid: „${text}” (max 80 caractere, 10 cuvinte).`,
        );
      if (/[!@%^*()={};~`<>?\\|,"[\]+]/.test(text))
        throw new ChatChangeError(`Cuvântul cheie „${text}” conține caractere nepermise.`);
      if (!MATCH_TYPES.includes(matchType))
        throw new ChatChangeError(`match_type trebuie să fie ${MATCH_TYPES.join(', ')}.`);
      return { text, matchType };
    });
}

export interface KeywordRow extends KeywordRef {
  matchType: string;
  status: string;
  negative: boolean;
}

/** The campaign's keywords, ad-group positives and campaign negatives. */
export async function campaignKeywords(
  client: ChatAdsClient,
  googleCampaignId: string,
): Promise<KeywordRow[]> {
  const [pos, neg] = await Promise.all([
    client.search(
      'SELECT campaign.id, ad_group_criterion.resource_name, ad_group_criterion.status, ' +
        'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion ' +
        `WHERE campaign.id = ${googleCampaignId} AND ad_group_criterion.type = 'KEYWORD' ` +
        "AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED' " +
        "AND ad_group.status != 'REMOVED'",
    ),
    client.search(
      'SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.keyword.text, ' +
        'campaign_criterion.keyword.match_type FROM campaign_criterion ' +
        `WHERE campaign.id = ${googleCampaignId} AND campaign_criterion.type = 'KEYWORD' ` +
        'AND campaign_criterion.negative = TRUE',
    ),
  ]);
  const row = (raw: unknown, negative: boolean): KeywordRow => {
    const x = rec(raw);
    const kw = rec(x.keyword);
    return {
      resourceName: String(x.resourceName ?? ''),
      text: String(kw.text ?? ''),
      matchType: String(kw.matchType ?? ''),
      status: String(x.status ?? 'ENABLED'),
      negative,
    };
  };
  return [
    ...pos.map((r) => row(r.adGroupCriterion, false)),
    ...neg.map((r) => row(r.campaignCriterion, true)),
  ].filter((k) => k.text);
}

export async function planKeywords(
  client: ChatAdsClient,
  c: CampaignData,
  input: unknown,
): Promise<{ change: ChatChange; units: ChangeUnits }> {
  const i = rec(input);
  const existing = await campaignKeywords(client, c.googleCampaignId);
  const has = (k: Keyword, negative: boolean) =>
    existing.some(
      (e) =>
        e.negative === negative && fold(e.text) === fold(k.text) && e.matchType === k.matchType,
    );
  const unique = (ks: Keyword[]) => [
    ...new Map(ks.map((k) => [`${fold(k.text)}|${k.matchType}`, k])).values(),
  ];
  const add = unique(keywords(i.add)).filter((k) => !has(k, false));
  const negatives = unique(keywords(i.add_negative)).filter((k) => !has(k, true));
  const pauseNames = new Set(strings(i.pause).map(fold));
  const pause = existing
    .filter((e) => !e.negative && e.status === 'ENABLED' && pauseNames.has(fold(e.text)))
    .map(({ resourceName, text }) => ({ resourceName, text }));
  const blocked = add.find((k) => negatives.some((n) => fold(n.text) === fold(k.text)));
  if (blocked)
    throw new ChatChangeError(`„${blocked.text}” nu poate fi și cuvânt cheie, și negativ.`);
  const total = add.length + negatives.length + pause.length;
  if (!total) throw new ChatChangeError('Nimic de schimbat: cuvintele există deja sau nu există.');
  if (total > KEYWORD_MAX)
    throw new ChatChangeError(`Cel mult ${KEYWORD_MAX} cuvinte cheie pe propunere.`);
  return {
    change: {
      action: 'chat.keywords',
      before: {},
      after: {
        adGroup: await adGroupOf(client, c),
        campaign: c.resourceName,
        add,
        negatives,
        pause,
      },
    },
    units: { keyword: total },
  };
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export async function planExtensions(
  c: CampaignData,
  input: unknown,
  landingUrl: string,
  urlResponds: (url: string) => Promise<boolean>,
): Promise<{ change: ChatChange; units: ChangeUnits }> {
  const i = rec(input);
  const taken = new Set(
    c.assets.map((a) => fold(a.sitelink?.linkText ?? a.text ?? '')).filter(Boolean),
  );
  const callouts = strings(i.callouts);
  for (const t of callouts) {
    const p = textProblem(t, CALLOUTS.maxChars, 'other');
    if (p) throw new ChatChangeError(`Callout „${t}”: ${p}`);
  }
  const sitelinks: Sitelink[] = [];
  for (const s of list(i.sitelinks).map(rec)) {
    const linkText = String(s.text ?? '').trim();
    const url = String(s.url ?? '').trim();
    const p = textProblem(linkText, SITELINKS.linkTextMaxChars, 'other');
    if (p) throw new ChatChangeError(`Sitelink „${linkText}”: ${p}`);
    if (!landingUrl || hostOf(url) !== hostOf(landingUrl))
      throw new ChatChangeError(`Sitelink-ul „${linkText}” trebuie să ducă pe site-ul campaniei.`);
    const [d1, d2] = [s.description1, s.description2].map((d) => String(d ?? '').trim());
    for (const d of [d1, d2].filter(Boolean)) {
      const dp = textProblem(d, SITELINKS.descriptionMaxChars, 'other');
      if (dp) throw new ChatChangeError(`Descriere sitelink „${d}”: ${dp}`);
    }
    if (!(await urlResponds(url))) throw new ChatChangeError(`Pagina ${url} nu răspunde.`);
    // Google accepts the two descriptions only together.
    sitelinks.push({ linkText, url, ...(d1 && d2 ? { description1: d1, description2: d2 } : {}) });
  }
  const names = [...callouts, ...sitelinks.map((s) => s.linkText)].map(fold);
  const dup = names.find((n, at) => taken.has(n) || names.indexOf(n) !== at);
  if (dup) throw new ChatChangeError(`Extensia „${dup}” există deja.`);
  if (!names.length || names.length > 20)
    throw new ChatChangeError('Între 1 și 20 de extensii pe propunere.');
  return {
    change: {
      action: 'chat.extensions',
      before: {},
      after: { campaign: c.resourceName, sitelinks, callouts },
    },
    units: { extension: names.length },
  };
}

export function planStatus(
  c: CampaignData,
  input: unknown,
): { change: ChatChange; units: ChangeUnits } {
  const status = rec(input).status;
  if (status !== 'ENABLED' && status !== 'PAUSED')
    throw new ChatChangeError('status trebuie să fie ENABLED sau PAUSED.');
  if (c.status === status) throw new ChatChangeError('Campania are deja această stare.');
  return {
    change: {
      action: 'chat.status',
      before: { campaign: c.resourceName, status: c.status },
      after: { status },
    },
    units: { status: 1 },
  };
}

/** The exact Google operations of a change (also used for validateOnly). */
export function changeOps(customerId: string, ch: ChatChange): GoogleAdsMutateOperation[] {
  switch (ch.action) {
    case 'chat.ad_texts':
      return [
        {
          adOperation: {
            update: {
              resourceName: ch.before.adResourceName,
              responsiveSearchAd: {
                headlines: ch.after.headlines,
                descriptions: ch.after.descriptions,
              },
            },
            updateMask: 'responsive_search_ad.headlines,responsive_search_ad.descriptions',
          },
        },
      ];
    case 'chat.ad_create':
      return [
        {
          adGroupAdOperation: {
            create: {
              adGroup: ch.after.adGroup,
              status: 'ENABLED',
              ad: {
                finalUrls: [ch.after.finalUrl],
                responsiveSearchAd: {
                  headlines: ch.after.headlines.map((text) => ({ text })),
                  descriptions: ch.after.descriptions.map((text) => ({ text })),
                },
              },
            },
          },
        },
      ];
    case 'chat.keywords':
      return [
        ...ch.after.add.map((keyword) => ({
          adGroupCriterionOperation: {
            create: { adGroup: ch.after.adGroup, status: 'ENABLED', keyword },
          },
        })),
        ...ch.after.negatives.map((keyword) => ({
          campaignCriterionOperation: {
            create: { campaign: ch.after.campaign, negative: true, keyword },
          },
        })),
        // Paused, never removed: the owner can turn them back on.
        ...ch.after.pause.map((k) => ({
          adGroupCriterionOperation: {
            update: { resourceName: k.resourceName, status: 'PAUSED' },
            updateMask: 'status',
          },
        })),
      ];
    case 'chat.extensions': {
      const assets: GoogleAdsMutateOperation[] = [];
      const links: GoogleAdsMutateOperation[] = [];
      let temp = -1;
      const push = (create: Record<string, unknown>, fieldType: string) => {
        const resourceName = `customers/${customerId}/assets/${temp--}`;
        assets.push({ assetOperation: { create: { resourceName, ...create } } });
        links.push({
          campaignAssetOperation: {
            create: { campaign: ch.after.campaign, asset: resourceName, fieldType },
          },
        });
      };
      for (const s of ch.after.sitelinks)
        push(
          {
            finalUrls: [s.url],
            sitelinkAsset: {
              linkText: s.linkText,
              ...(s.description1 && s.description2
                ? { description1: s.description1, description2: s.description2 }
                : {}),
            },
          },
          'SITELINK',
        );
      for (const calloutText of ch.after.callouts)
        push({ calloutAsset: { calloutText } }, 'CALLOUT');
      return [...assets, ...links];
    }
    case 'chat.status':
      return [
        {
          campaignOperation: {
            update: { resourceName: ch.before.campaign, status: ch.after.status },
            updateMask: 'status',
          },
        },
      ];
  }
}

async function liveTexts(client: ChatAdsClient, adResourceName: string) {
  const rows = await client.search(
    'SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines, ' +
      'ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad ' +
      `WHERE ad_group_ad.ad.id = ${adResourceName.split('/').pop()}`,
  );
  const rsa = rec(rec(rec(rows[0]?.adGroupAd).ad).responsiveSearchAd);
  const texts = (v: unknown) => list(v).map((t) => String(rec(t).text ?? ''));
  return { headlines: texts(rsa.headlines), descriptions: texts(rsa.descriptions) };
}
/** Google may return texts in another order: compared as sets. */
const sameTexts = (live: string[], want: AdText[]) =>
  [...live].sort().join('\n') ===
  want
    .map((t) => t.text)
    .sort()
    .join('\n');

/** Null when Google shows the change, else what is missing. */
async function verifyChange(
  client: ChatAdsClient,
  googleCampaignId: string,
  ch: ChatChange,
): Promise<string | null> {
  switch (ch.action) {
    case 'chat.ad_texts': {
      const live = await liveTexts(client, ch.before.adResourceName);
      return sameTexts(live.headlines, ch.after.headlines) &&
        sameTexts(live.descriptions, ch.after.descriptions)
        ? null
        : 'Google nu arată textele noi după aplicare.';
    }
    case 'chat.ad_create': {
      const rows = await client.search(
        'SELECT campaign.id, ad_group_ad.ad.responsive_search_ad.headlines FROM ad_group_ad ' +
          `WHERE campaign.id = ${googleCampaignId} AND ad_group_ad.status = 'ENABLED'`,
      );
      const found = rows.some((r) => {
        const rsa = rec(rec(rec(r.adGroupAd).ad).responsiveSearchAd);
        return sameTexts(
          list(rsa.headlines).map((t) => String(rec(t).text ?? '')),
          ch.after.headlines.map((text) => ({ text })),
        );
      });
      return found ? null : 'Google nu arată reclama nouă după aplicare.';
    }
    case 'chat.keywords': {
      const live = await campaignKeywords(client, googleCampaignId);
      const has = (k: Keyword, negative: boolean) =>
        live.some(
          (l) =>
            l.negative === negative && fold(l.text) === fold(k.text) && l.matchType === k.matchType,
        );
      const missing = [
        ...ch.after.add.filter((k) => !has(k, false)).map((k) => k.text),
        ...ch.after.negatives.filter((k) => !has(k, true)).map((k) => k.text),
        ...ch.after.pause
          .filter((p) =>
            live.some((l) => l.resourceName === p.resourceName && l.status === 'ENABLED'),
          )
          .map((p) => p.text),
      ];
      return missing.length ? `Neconfirmate după aplicare: ${missing.join(', ')}` : null;
    }
    case 'chat.extensions': {
      const rows = await client.search(
        'SELECT campaign.id, campaign_asset.status, asset.sitelink_asset.link_text, asset.callout_asset.callout_text ' +
          `FROM campaign_asset WHERE campaign.id = ${googleCampaignId} AND campaign_asset.status != 'REMOVED'`,
      );
      const live = new Set(
        rows.flatMap((r) => {
          const a = rec(r.asset);
          return [rec(a.sitelinkAsset).linkText, rec(a.calloutAsset).calloutText];
        }),
      );
      const missing = [...ch.after.sitelinks.map((s) => s.linkText), ...ch.after.callouts].filter(
        (t) => !live.has(t),
      );
      return missing.length ? `Neconfirmate după aplicare: ${missing.join(', ')}` : null;
    }
    case 'chat.status':
      return (await liveStatus(client, googleCampaignId)) === ch.after.status
        ? null
        : 'Google nu arată starea nouă după aplicare.';
  }
}

async function liveStatus(client: ChatAdsClient, googleCampaignId: string): Promise<string> {
  const rows = await client.search(
    `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = ${googleCampaignId}`,
  );
  return String(rec(rows[0]?.campaign).status ?? '');
}

/** Applies an approved change: the campaign must still be as it was when the
 *  change was prepared; validate, mutate, re-read. Throws with the reason. */
export async function applyChatChange(
  client: ChatAdsClient,
  googleCampaignId: string,
  row: { action: string; before: unknown; after: unknown },
): Promise<void> {
  const ch = { action: row.action, before: row.before, after: row.after } as ChatChange;
  if (ch.action === 'chat.ad_texts') {
    const live = await liveTexts(client, ch.before.adResourceName);
    if (
      !sameTexts(live.headlines, ch.before.headlines) ||
      !sameTexts(live.descriptions, ch.before.descriptions)
    )
      throw new Error('Reclama a fost modificată între timp; cere agentului o propunere nouă.');
  }
  if (ch.action === 'chat.status') {
    if ((await liveStatus(client, googleCampaignId)) !== ch.before.status)
      throw new Error('Starea campaniei s-a schimbat între timp.');
  }
  const ops = changeOps(client.customerId, ch);
  await client.mutate(ops, { validateOnly: true });
  await client.mutate(ops);
  const problem = await verifyChange(client, googleCampaignId, ch);
  if (problem) throw new Error(problem);
}

/** Whether an approved change is live in Google (null) or what is missing. */
export function verifyChatChange(
  client: ChatAdsClient,
  googleCampaignId: string,
  row: { action: string; before: unknown; after: unknown },
): Promise<string | null> {
  return verifyChange(client, googleCampaignId, {
    action: row.action,
    before: row.before,
    after: row.after,
  } as ChatChange);
}
