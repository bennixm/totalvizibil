/**
 * Turns one `GoogleAdsAgentAction` into a human-readable description of the
 * EXACT change it makes (or proposes), so an admin approving "Adaugă
 * sitelink-uri" sees which sitelinks, with which texts and URLs, instead of
 * only the recommendation type.
 *
 * Built from the same `after` payload the approval call sends to Google
 * (`GoogleAdsAgentRecommendationsService.buildApplyOperation` reads the very
 * same fields), so what's shown is what gets applied, not a re-fetch that
 * could have changed in between.
 *
 * Google's per-type recommendation messages are read defensively: the API
 * reference confirms the message fields exist but not every sub-field name,
 * and an older proposal may predate a field being captured at all. Anything
 * missing degrades to "fewer rows", never to an error; a type with no
 * recognised content falls back to a generic dump of the plain values Google
 * sent, and only then to an explicit "no details" note.
 *
 * Pure function, no I/O: called per row by the admin list endpoints.
 */

export type ProposalPreviewSection =
  /** Value changes: "Buget zilnic: 5,00 → 8,00". `before` null = new value. */
  | { kind: 'diff'; title: string; rows: { label: string; before: string | null; after: string }[] }
  /** Structured items to add: sitelinks (title + descriptions + URL), etc. */
  | {
      kind: 'items';
      title: string;
      items: { title: string; lines: string[]; url?: string }[];
    }
  /** Plain text lines: callouts, headlines, keywords. `existing` = already
   *  in the ad and kept as-is (shown muted), `added` = new. */
  | { kind: 'texts'; title: string; items: { text: string; status: 'added' | 'existing' }[] }
  | { kind: 'note'; text: string; tone: 'info' | 'warning' };

export interface ProposalPreview {
  sections: ProposalPreviewSection[];
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Json => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const fmtNumber = (n: number, digits = 2) =>
  n.toLocaleString('ro-RO', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function fmtCredits(v: unknown): string | null {
  const n = num(v);
  return n === undefined ? null : `${fmtNumber(n)} credite`;
}

/** Google money is in micros of the ACCOUNT currency (RON/EUR). */
function fmtMicros(v: unknown, currency: string | undefined): string | null {
  const n = num(v);
  if (n === undefined) return null;
  return `${fmtNumber(n / 1_000_000)}${currency ? ` ${currency}` : ''}`;
}

const MATCH_TYPE_RO: Record<string, string> = {
  EXACT: 'potrivire exactă',
  PHRASE: 'potrivire de expresie',
  BROAD: 'potrivire largă',
};

const PINNED_RO: Record<string, string> = {
  HEADLINE_1: 'fixat pe poziția 1',
  HEADLINE_2: 'fixat pe poziția 2',
  HEADLINE_3: 'fixat pe poziția 3',
  DESCRIPTION_1: 'fixat pe poziția 1',
  DESCRIPTION_2: 'fixat pe poziția 2',
};

function keywordLabel(keyword: unknown): string | undefined {
  const k = obj(keyword);
  const text = str(k.text);
  if (!text) return undefined;
  const match = str(k.matchType);
  return match ? `${text} (${MATCH_TYPE_RO[match] ?? match.toLowerCase()})` : text;
}

function adTexts(list: unknown): { text: string; pinned?: string }[] {
  const out: { text: string; pinned?: string }[] = [];
  for (const a of arr(list)) {
    const text = str(obj(a).text);
    if (text) out.push({ text, pinned: str(obj(a).pinnedField) });
  }
  return out;
}

function withPin(a: { text: string; pinned?: string }): string {
  return a.pinned ? `${a.text} (${PINNED_RO[a.pinned] ?? a.pinned})` : a.text;
}

// --- per-type sections -----------------------------------------------------

function sitelinkSection(rec: Json): ProposalPreviewSection | null {
  const assets = arr(obj(rec.sitelinkAssetRecommendation).recommendedCampaignSitelinkAssets);
  const items = assets
    .map((a) => {
      const asset = obj(a);
      const s = obj(asset.sitelinkAsset);
      const title = str(s.linkText);
      if (!title) return null;
      const lines = [str(s.description1), str(s.description2)].filter((l): l is string => !!l);
      const url = str(arr(asset.finalUrls)[0]) ?? str(arr(asset.finalMobileUrls)[0]);
      return { title, lines, ...(url ? { url } : {}) };
    })
    .filter((i): i is { title: string; lines: string[]; url?: string } => !!i);
  return items.length ? { kind: 'items', title: 'Sitelink-uri care vor fi adăugate', items } : null;
}

function calloutSection(rec: Json): ProposalPreviewSection | null {
  const assets = arr(obj(rec.calloutAssetRecommendation).recommendedCampaignCalloutAssets);
  const items = assets
    .map((a) => str(obj(obj(a).calloutAsset).calloutText))
    .filter((t): t is string => !!t)
    .map((text) => ({ text, status: 'added' as const }));
  return items.length ? { kind: 'texts', title: 'Callout-uri care vor fi adăugate', items } : null;
}

/** RESPONSIVE_SEARCH_AD_ASSET: Google's suggestions are MERGED into the
 *  current ad on approval (see `mergeResponsiveSearchAdAssets`), so show
 *  the current texts as kept and only the genuinely new ones as added. */
function rsaAssetSections(rec: Json): ProposalPreviewSection[] {
  const r = obj(rec.responsiveSearchAdAssetRecommendation);
  const current = obj(obj(r.currentAd).responsiveSearchAd);
  const recommended = obj(obj(r.recommendedAssets).responsiveSearchAd);
  const build = (title: string, cur: unknown, add: unknown, max: number) => {
    const existing = adTexts(cur);
    const seen = new Set(existing.map((e) => e.text));
    const added = adTexts(add).filter((a) => !seen.has(a.text) && seen.add(a.text));
    const room = Math.max(0, max - existing.length);
    if (!added.length) return null;
    return {
      kind: 'texts' as const,
      title,
      items: [
        ...added.slice(0, room).map((a) => ({ text: withPin(a), status: 'added' as const })),
        ...existing.map((e) => ({ text: withPin(e), status: 'existing' as const })),
      ],
    };
  };
  return [
    build('Titluri (cele noi sunt marcate)', current.headlines, recommended.headlines, 15),
    build('Descrieri (cele noi sunt marcate)', current.descriptions, recommended.descriptions, 4),
  ].filter((s): s is NonNullable<typeof s> => !!s);
}

/** IMPROVE_AD_STRENGTH: `recommendedAd` REPLACES the ad's text on approval,
 *  so show the full resulting content, not a delta. */
function rsaImproveSections(rec: Json): ProposalPreviewSection[] {
  const ad = obj(
    obj(obj(rec.responsiveSearchAdImproveAdStrengthRecommendation).recommendedAd)
      .responsiveSearchAd,
  );
  const out: ProposalPreviewSection[] = [];
  const headlines = adTexts(ad.headlines);
  const descriptions = adTexts(ad.descriptions);
  if (headlines.length) {
    out.push({
      kind: 'texts',
      title: 'Titlurile reclamei după aplicare',
      items: headlines.map((h) => ({ text: withPin(h), status: 'added' })),
    });
  }
  if (descriptions.length) {
    out.push({
      kind: 'texts',
      title: 'Descrierile reclamei după aplicare',
      items: descriptions.map((d) => ({ text: withPin(d), status: 'added' })),
    });
  }
  if (out.length) {
    out.push({
      kind: 'note',
      tone: 'warning',
      text: 'La aprobare, textele de mai sus înlocuiesc integral titlurile și descrierile actuale ale reclamei.',
    });
  }
  return out;
}

function budgetSection(r: Json, currency: string | undefined): ProposalPreviewSection | null {
  const after = fmtMicros(r.recommendedBudgetAmountMicros, currency);
  if (!after) return null;
  return {
    kind: 'diff',
    title: 'Schimbare de buget',
    rows: [
      { label: 'Buget zilnic', before: fmtMicros(r.currentBudgetAmountMicros, currency), after },
    ],
  };
}

function keywordSections(
  rec: Json,
  type: string,
  currency: string | undefined,
): ProposalPreviewSection[] {
  if (type === 'KEYWORD') {
    const r = obj(rec.keywordRecommendation);
    const kw = keywordLabel(r.keyword);
    if (!kw) return [];
    const out: ProposalPreviewSection[] = [
      {
        kind: 'texts',
        title: 'Cuvânt cheie care va fi adăugat',
        items: [{ text: kw, status: 'added' }],
      },
    ];
    const bid = fmtMicros(r.recommendedCpcBidMicros, currency);
    if (bid)
      out.push({
        kind: 'diff',
        title: 'Licitare',
        rows: [{ label: 'CPC recomandat', before: null, after: bid }],
      });
    const terms = arr(r.searchTerms)
      .map((t) => str(obj(t).text))
      .filter((t): t is string => !!t);
    if (terms.length) {
      out.push({
        kind: 'texts',
        title: 'Căutări reale care au declanșat recomandarea',
        items: terms.map((text) => ({ text, status: 'existing' })),
      });
    }
    return out;
  }
  if (type === 'KEYWORD_MATCH_TYPE') {
    const r = obj(rec.keywordMatchTypeRecommendation);
    const keyword = obj(r.keyword);
    const text = str(keyword.text);
    const to = str(r.recommendedMatchType);
    if (!text || !to) return [];
    const from = str(keyword.matchType);
    return [
      {
        kind: 'diff',
        title: `Cuvântul cheie „${text}”`,
        rows: [
          {
            label: 'Tip de potrivire',
            before: from ? (MATCH_TYPE_RO[from] ?? from) : null,
            after: MATCH_TYPE_RO[to] ?? to,
          },
        ],
      },
    ];
  }
  return [];
}

const BIDDING_STRATEGY_RO: Record<string, string> = {
  MAXIMIZE_CLICKS_OPT_IN: 'Maximizare clicuri',
  MAXIMIZE_CONVERSIONS_OPT_IN: 'Maximizare conversii',
  MAXIMIZE_CONVERSION_VALUE_OPT_IN: 'Maximizare valoare conversii',
  TARGET_CPA_OPT_IN: 'Cost-țintă pe conversie',
  TARGET_ROAS_OPT_IN: 'ROAS-țintă',
  ENHANCED_CPC_OPT_IN: 'Enhanced CPC',
};

/** Maps a recommendation type to its payload key on the Recommendation
 *  message (camelCase JSON), for the bidding/target types. */
const BIDDING_PAYLOAD_KEY: Record<string, string> = {
  MAXIMIZE_CLICKS_OPT_IN: 'maximizeClicksOptInRecommendation',
  MAXIMIZE_CONVERSIONS_OPT_IN: 'maximizeConversionsOptInRecommendation',
  TARGET_CPA_OPT_IN: 'targetCpaOptInRecommendation',
  ENHANCED_CPC_OPT_IN: 'enhancedCpcOptInRecommendation',
  RAISE_TARGET_CPA: 'raiseTargetCpaRecommendation',
  RAISE_TARGET_CPA_BID_TOO_LOW: 'raiseTargetCpaBidTooLowRecommendation',
  SET_TARGET_CPA: 'setTargetCpaRecommendation',
  SET_TARGET_ROAS: 'setTargetRoasRecommendation',
  LOWER_TARGET_ROAS: 'lowerTargetRoasRecommendation',
  FORECASTING_SET_TARGET_CPA: 'forecastingSetTargetCpaRecommendation',
};

function biddingSections(
  rec: Json,
  type: string,
  currency: string | undefined,
): ProposalPreviewSection[] {
  const key = BIDDING_PAYLOAD_KEY[type];
  const r = key ? obj(rec[key]) : {};
  const rows: { label: string; before: string | null; after: string }[] = [];
  const strategy = BIDDING_STRATEGY_RO[type];
  if (strategy) rows.push({ label: 'Strategie de licitare', before: null, after: strategy });

  const budget = fmtMicros(
    r.recommendedBudgetAmountMicros ?? r.requiredCampaignBudgetAmountMicros,
    currency,
  );
  if (budget) rows.push({ label: 'Buget zilnic recomandat', before: null, after: budget });
  const cpa = fmtMicros(r.recommendedTargetCpaMicros ?? r.targetCpaMicros, currency);
  if (cpa) rows.push({ label: 'Cost-țintă pe conversie', before: null, after: cpa });
  const roas = num(r.recommendedTargetRoas ?? r.targetRoas);
  if (roas !== undefined)
    rows.push({ label: 'ROAS-țintă', before: null, after: `${fmtNumber(roas * 100, 0)}%` });
  const multiplier = num(
    r.targetMultiplier ?? r.targetCpaMultiplier ?? obj(r.targetAdjustment).targetMultiplier,
  );
  if (multiplier !== undefined) {
    const pct = Math.round((multiplier - 1) * 100);
    rows.push({ label: 'Ajustare țintă', before: null, after: `${pct >= 0 ? '+' : ''}${pct}%` });
  }
  return rows.length ? [{ kind: 'diff', title: 'Schimbare de licitare', rows }] : [];
}

/** Google's own estimate: metrics without vs with the recommendation. */
function impactSection(rec: Json, currency: string | undefined): ProposalPreviewSection | null {
  const impact = obj(rec.impact);
  const base = obj(impact.baseMetrics);
  const potential = obj(impact.potentialMetrics);
  if (!Object.keys(potential).length) return null;
  const rows: { label: string; before: string | null; after: string }[] = [];
  const count = (label: string, field: string) => {
    const after = num(potential[field]);
    if (after === undefined) return;
    const before = num(base[field]);
    rows.push({
      label,
      before: before === undefined ? null : fmtNumber(before, 0),
      after: fmtNumber(after, 0),
    });
  };
  count('Afișări', 'impressions');
  count('Clicuri', 'clicks');
  const costAfter = fmtMicros(potential.costMicros, currency);
  if (costAfter)
    rows.push({
      label: 'Cost',
      before: fmtMicros(base.costMicros, currency),
      after: costAfter,
    });
  return rows.length ? { kind: 'diff', title: 'Impact estimat de Google', rows } : null;
}

/** Last resort for a type this file doesn't know: list the plain scalar
 *  values Google attached, so the admin still sees *something* concrete. */
function genericSection(rec: Json, currency: string | undefined): ProposalPreviewSection | null {
  const IGNORE = new Set([
    'resourceName',
    'type',
    'campaign',
    'campaignBudget',
    'adGroup',
    'impact',
  ]);
  const rows: { label: string; before: string | null; after: string }[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (rows.length >= 12) return;
    if (isObj(value)) {
      for (const [k, v] of Object.entries(value)) if (!IGNORE.has(k)) walk(v, [...path, k]);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((v, i) => walk(v, [...path, String(i + 1)]));
      return;
    }
    const leaf = path[path.length - 1] ?? '';
    const shown = /Micros$/.test(leaf) ? fmtMicros(value, currency) : (str(value) ?? null);
    if (shown) rows.push({ label: path.slice(1).join(' › ') || leaf, before: null, after: shown });
  };
  walk(rec, []);
  return rows.length ? { kind: 'diff', title: 'Detalii trimise de Google', rows } : null;
}

const NO_DETAILS: ProposalPreviewSection = {
  kind: 'note',
  tone: 'info',
  text: 'Google nu a trimis detalii suplimentare pentru această recomandare. Verifică în contul Google Ads înainte de aprobare.',
};

function recommendationPreview(type: string, after: Json): ProposalPreview {
  const rec = obj(after.recommendation);
  const currency = str(after.currencyCode);
  const sections: ProposalPreviewSection[] = [];

  switch (type) {
    case 'SITELINK_ASSET': {
      const s = sitelinkSection(rec);
      if (s) sections.push(s);
      break;
    }
    case 'CALLOUT_ASSET': {
      const s = calloutSection(rec);
      if (s) sections.push(s);
      break;
    }
    case 'RESPONSIVE_SEARCH_AD_ASSET':
      sections.push(...rsaAssetSections(rec));
      break;
    case 'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH':
      sections.push(...rsaImproveSections(rec));
      break;
    case 'CAMPAIGN_BUDGET':
    case 'FORECASTING_CAMPAIGN_BUDGET':
    case 'MARGINAL_ROI_CAMPAIGN_BUDGET': {
      const key =
        type === 'CAMPAIGN_BUDGET'
          ? 'campaignBudgetRecommendation'
          : type === 'FORECASTING_CAMPAIGN_BUDGET'
            ? 'forecastingCampaignBudgetRecommendation'
            : 'marginalRoiCampaignBudgetRecommendation';
      const s = budgetSection(obj(rec[key]), currency);
      if (s) sections.push(s);
      break;
    }
    case 'KEYWORD':
    case 'KEYWORD_MATCH_TYPE':
      sections.push(...keywordSections(rec, type, currency));
      break;
    case 'OPTIMIZE_AD_ROTATION':
      sections.push({
        kind: 'diff',
        title: 'Rotația reclamelor',
        rows: [
          {
            label: 'Mod de rotație',
            before: 'Rotire egală',
            after: 'Optimizare (Google alege varianta mai bună)',
          },
        ],
      });
      break;
    case 'CALL_ASSET':
    case 'RESPONSIVE_SEARCH_AD':
      sections.push({
        kind: 'note',
        tone: 'warning',
        text: 'Google nu oferă conținutul necesar pentru acest tip, deci nu poate fi aplicat din panou. Configurează-l manual în Google Ads, apoi respinge propunerea.',
      });
      break;
    default:
      if (BIDDING_PAYLOAD_KEY[type] || BIDDING_STRATEGY_RO[type]) {
        sections.push(...biddingSections(rec, type, currency));
      }
  }

  if (!sections.length) {
    const generic = genericSection(rec, currency);
    sections.push(generic ?? NO_DETAILS);
  }
  const impact = impactSection(rec, currency);
  if (impact) sections.push(impact);
  return { sections };
}

/** Preview for any action row (proposal or history entry). */
export function buildProposalPreview(row: {
  action: string;
  before: unknown;
  after: unknown;
}): ProposalPreview {
  const before = obj(row.before);
  const after = obj(row.after);
  const action = typeof row.action === 'string' ? row.action : '';

  if (action.startsWith('recommendation.')) {
    return recommendationPreview(str(after.type) ?? action.replace('recommendation.', ''), after);
  }

  const budgetCpc = (budgetAfter: unknown, cpcAfter: unknown): ProposalPreview => {
    const rows: { label: string; before: string | null; after: string }[] = [];
    const b = fmtCredits(budgetAfter);
    if (b)
      rows.push({ label: 'Buget zilnic', before: fmtCredits(before.dailyBudgetCredits), after: b });
    const c = fmtCredits(cpcAfter);
    if (c) rows.push({ label: 'CPC maxim', before: fmtCredits(before.maxCpcCredits), after: c });
    return { sections: rows.length ? [{ kind: 'diff', title: 'Schimbări', rows }] : [] };
  };

  switch (action) {
    case 'creative.rsa_gap_fill': {
      const added = obj(after.added);
      const sections: ProposalPreviewSection[] = [];
      const block = (title: string, existing: unknown, add: unknown) => {
        const addedTexts = arr(add)
          .map(str)
          .filter((t): t is string => !!t);
        if (!addedTexts.length) return;
        const kept = arr(existing)
          .map(str)
          .filter((t): t is string => !!t);
        sections.push({
          kind: 'texts',
          title,
          items: [
            ...addedTexts.map((text) => ({ text, status: 'added' as const })),
            ...kept.map((text) => ({ text, status: 'existing' as const })),
          ],
        });
      };
      block('Titluri (cele noi sunt marcate)', before.headlines, added.headlines);
      block('Descrieri (cele noi sunt marcate)', before.descriptions, added.descriptions);
      if (str(after.adStrengthAfter)) {
        sections.push({
          kind: 'diff',
          title: 'Rezultat confirmat de Google',
          rows: [
            {
              label: 'Ad Strength după modificare',
              before: null,
              after: str(after.adStrengthAfter)!,
            },
          ],
        });
      }
      return { sections };
    }
    case 'keywords.updated': {
      // Campaign creation: the Ad Strength Google reported after each round
      // of the maximization loop (never an assumed value).
      const rounds = arr(after.adStrengthRounds).map(obj);
      if (!rounds.length && !str(after.adStrength)) return { sections: [] };
      const sections: ProposalPreviewSection[] = [
        {
          kind: 'diff',
          title: 'Ad Strength citit din Google',
          rows: rounds.map((r) => ({
            label:
              num(r.round) === 0
                ? 'Reclama inițială'
                : `Runda ${num(r.round)}${str(r.change) ? ` (${str(r.change)})` : ''}`,
            before: null,
            after: str(r.adStrength) ?? 'în calcul la Google',
          })),
        },
      ];
      const remaining = arr(after.adStrengthRemainingActionItems)
        .map(str)
        .filter((t): t is string => !!t);
      if (remaining.length) {
        sections.push({
          kind: 'texts',
          title: 'Sugestii Google rămase',
          items: remaining.map((text) => ({ text, status: 'existing' as const })),
        });
      }
      if (str(after.assetsError)) {
        sections.push({
          kind: 'note',
          tone: 'warning',
          text: `Sitelink-urile/callout-urile nu au putut fi adăugate: ${str(after.assetsError)}`,
        });
      }
      return { sections };
    }
    case 'creative.assets_gap_fill': {
      const added = obj(after.added);
      const sections: ProposalPreviewSection[] = [];
      const sitelinks = arr(added.sitelinks)
        .map(obj)
        .filter((x) => str(x.linkText))
        .map((x) => ({
          title: str(x.linkText)!,
          lines: [str(x.description1), str(x.description2)].filter((l): l is string => !!l),
          ...(str(x.url) ? { url: str(x.url) } : {}),
        }));
      if (sitelinks.length)
        sections.push({ kind: 'items', title: 'Sitelink-uri adăugate', items: sitelinks });
      const callouts = arr(added.callouts)
        .map(str)
        .filter((t): t is string => !!t);
      if (callouts.length) {
        sections.push({
          kind: 'texts',
          title: 'Callout-uri adăugate',
          items: callouts.map((text) => ({ text, status: 'added' })),
        });
      }
      const snippet = obj(added.structuredSnippet);
      const snippetValues = arr(snippet.values)
        .map(str)
        .filter((t): t is string => !!t);
      if (snippetValues.length) {
        sections.push({
          kind: 'texts',
          title: `Structured snippet adăugat (antet „${str(snippet.header) ?? 'Servicii'}”)`,
          items: snippetValues.map((text) => ({ text, status: 'added' })),
        });
      }
      const businessName = str(added.businessName);
      if (businessName) {
        sections.push({
          kind: 'diff',
          title: 'Numele afacerii',
          rows: [{ label: 'Nume', before: null, after: businessName }],
        });
      }
      return { sections };
    }
    case 'creative.images_gap_fill': {
      const images = arr(obj(after.added).images)
        .map(obj)
        .map((x) => ({
          title: `${str(x.format) ?? ''} ${str(x.alt) ? `„${str(x.alt)}”` : ''}`.trim(),
          lines: [str(x.photographer) ? `Foto: ${str(x.photographer)} (Pexels)` : null].filter(
            (l): l is string => !!l,
          ),
          ...(str(x.pexelsUrl) ? { url: str(x.pexelsUrl) } : {}),
        }));
      return images.length
        ? { sections: [{ kind: 'items', title: 'Imagini adăugate', items: images }] }
        : { sections: [] };
    }
    case 'creative.keyword_headlines': {
      const sections: ProposalPreviewSection[] = [];
      const kws = arr(after.missingKeywords)
        .map(str)
        .filter((t): t is string => !!t);
      if (kws.length)
        sections.push({
          kind: 'texts',
          title: 'Cuvinte cheie care lipseau din titluri',
          items: kws.map((text) => ({ text, status: 'existing' as const })),
        });
      const rows = arr(after.replaced)
        .map(obj)
        .filter((r) => str(r.newText))
        .map((r) => ({ label: 'Titlu', before: str(r.oldText) ?? null, after: str(r.newText)! }));
      if (rows.length) sections.push({ kind: 'diff', title: 'Titluri rescrise', rows });
      const added = arr(after.added)
        .map(str)
        .filter((t): t is string => !!t);
      if (added.length)
        sections.push({
          kind: 'texts',
          title: 'Titluri adăugate',
          items: added.map((text) => ({ text, status: 'added' as const })),
        });
      const strengthRows = [
        str(after.adStrengthAfter) && {
          label: 'Ad Strength',
          before: str(after.adStrengthBefore) ?? null,
          after: str(after.adStrengthAfter)!,
        },
      ].filter(Boolean) as { label: string; before: string | null; after: string }[];
      if (strengthRows.length)
        sections.push({ kind: 'diff', title: 'Rezultat confirmat de Google', rows: strengthRows });
      if (after.reverted === true)
        sections.push({
          kind: 'note',
          tone: 'warning',
          text: 'Google a evaluat varianta nouă mai slab, așa că titlurile anterioare au fost restaurate.',
        });
      return { sections };
    }
    case 'creative.replace_text': {
      const oldText = str(before.text);
      const newText = str(after.text);
      if (!newText) return { sections: [] };
      return {
        sections: [
          {
            kind: 'diff',
            title: before.kind === 'description' ? 'Înlocuire descriere' : 'Înlocuire titlu',
            rows: [{ label: 'Text', before: oldText ?? null, after: newText }],
          },
          {
            kind: 'note',
            tone: 'info',
            text: 'La aprobare, doar acest text se schimbă; celelalte titluri și descrieri ale reclamei rămân neatinse.',
          },
        ],
      };
    }
    case 'budget.increase.proposed':
      return budgetCpc(after.proposedDailyBudgetCredits, after.proposedMaxCpcCredits);
    case 'cpc.adjusted':
    case 'campaign.create':
      return budgetCpc(after.dailyBudgetCredits, after.maxCpcCredits);
    case 'campaign.pause':
    case 'campaign.resume':
      return { sections: [] };
    case 'geo_targeting.updated': {
      const target = str(after.targeting);
      return target
        ? {
            sections: [
              {
                kind: 'diff',
                title: 'Targetare',
                rows: [{ label: 'Zonă', before: null, after: target }],
              },
            ],
          }
        : { sections: [] };
    }
    default:
      return { sections: [] };
  }
}
