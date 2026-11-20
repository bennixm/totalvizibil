import {
  CampaignData,
  LinkedAsset,
  PeriodMetrics,
  RsaAd,
  TextAsset,
} from './google-ads-account-data';
import {
  CALLOUTS,
  PMAX,
  RSA,
  SEARCH_IMAGES,
  SITELINKS,
  SOURCES,
  STRUCTURED_SNIPPETS,
  ratioMatches,
} from './google-ads-specs';
import { keywordCoverage, keywordsHurtAdStrength } from './google-ads-headline-keywords';

/**
 * Pure evaluation of ONE campaign from real Google Ads data: our own
 * optimization score (0-100) with a per-component breakdown, a prioritized
 * list of issues, and a summary of every asset for the admin detail page.
 *
 * Score rules, all deliberately simple and visible in the UI:
 *  - Each component has a fixed maximum (summing to 100 per campaign type)
 *    and earns points proportionally to how far it is from Google's
 *    published requirement (google-ads-specs.ts, each with a source URL).
 *  - A component that cannot be evaluated from real data (e.g. Ad Strength
 *    still PENDING, too few impressions to compare performance) is marked
 *    `na` and removed from BOTH earned and maximum, never guessed. The score
 *    is `earned / applicable maximum`, so "na" neither helps nor hurts.
 *  - Google's Ad Strength is ONE listed component, shown separately as well;
 *    it is never the score itself.
 */

export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
export type ComponentStatus = 'ok' | 'attention' | 'missing' | 'na';

export interface CampaignIssue {
  code: string;
  priority: IssuePriority;
  area: string;
  title: string;
  /** Why it matters (shown to the admin). */
  why: string;
  /** What should be done about it. */
  action: string;
  /** The optimizer can fix this automatically (managed campaigns only,
   *  and only the "fill a gap" kinds the admin authorized). */
  autoFixable: boolean;
  source?: string;
  /** 'account' = a problem of the whole account (shared asset), repeated on
   *  every campaign for visibility but counted once in account totals. */
  scope?: 'campaign' | 'account';
}

export interface ScoreComponent {
  key: string;
  label: string;
  max: number;
  earned: number;
  status: ComponentStatus;
  /** How the points were computed, in one sentence. */
  explanation: string;
  /** What is missing to reach the full points. */
  missing: string[];
  source?: string;
}

export interface UrlCheck {
  url: string;
  ok: boolean;
  status: number | null;
  error?: string;
}

export interface TextItem {
  text: string;
  length: number;
  performanceLabel?: string;
  approvalStatus?: string;
  pinnedField?: string;
}

export interface ImageItem {
  fieldType: string;
  level: string;
  width: number;
  height: number;
  fileSize: number;
  format: string;
  valid: boolean;
  problems: string[];
}

export interface AssetSummary {
  /** Search: the evaluated RSA. PMax: the evaluated asset group. */
  evaluatedOn: string | null;
  headlines: TextItem[];
  longHeadlines: TextItem[];
  descriptions: TextItem[];
  sitelinks: {
    linkText: string;
    description1?: string;
    description2?: string;
    finalUrl?: string;
    level: string;
  }[];
  callouts: { text: string; level: string }[];
  structuredSnippets: number;
  images: ImageItem[];
  logos: ImageItem[];
  videos: { youtubeVideoId: string; title?: string }[];
  businessName: string | null;
  finalUrls: string[];
  adsCount: number;
  /** Search only: which ad-group keywords appear in the headlines. */
  headlineKeywords?: { covered: string[]; missing: string[]; googleFlagged: boolean };
}

export interface PerformanceSummary {
  current: PeriodMetrics & {
    ctr: number | null;
    cpc: number | null;
    cpa: number | null;
    roas: number | null;
  };
  previous: PeriodMetrics & { ctr: number | null };
  ctrChange: number | null;
  clicksChange: number | null;
  comparable: boolean;
}

export interface CampaignEvaluation {
  score: number | null;
  components: ScoreComponent[];
  issues: CampaignIssue[];
  assets: AssetSummary;
  adStrength: string | null;
  performance: PerformanceSummary;
}

export interface EvaluationContext {
  /** Agent-managed campaign: issues it can fix itself are marked so. */
  managed: boolean;
  urlChecks: Map<string, UrlCheck>;
}

/** Minimum impressions in EACH period before comparing them; below this a
 *  CTR/clicks change is noise, not a trend. */
export const MIN_IMPRESSIONS_FOR_TREND = 100;
/** Clicks with zero conversions before flagging possible tracking issues. */
export const MIN_CLICKS_FOR_CONVERSION_CHECK = 50;

const PRIORITY_ORDER: Record<IssuePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const usable = (a: { approvalStatus?: string; primaryStatusReasons?: string[] }) =>
  a.approvalStatus !== 'DISAPPROVED' &&
  !(a.primaryStatusReasons ?? []).includes('ASSET_DISAPPROVED');

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

function change(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / prev;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function proportional(have: number, target: number, max: number): number {
  if (target <= 0) return max;
  return round1((Math.min(have, target) / target) * max);
}

function textItems(list: TextAsset[]): TextItem[] {
  return list.map((t) => ({
    text: t.text,
    length: [...t.text].length,
    performanceLabel: t.performanceLabel,
    approvalStatus: t.approvalStatus,
    pinnedField: t.pinnedField,
  }));
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Pairs of texts that are near-identical (same word set ≥ 80%) — Google's
 *  Ad Strength explicitly rewards asset diversity. */
function nearDuplicates(texts: string[]): [string, string][] {
  const words = texts.map(
    (t) =>
      new Set(
        fold(t)
          .split(/[^a-z0-9]+/)
          .filter(Boolean),
      ),
  );
  const out: [string, string][] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = words[i];
      const b = words[j];
      if (!a.size || !b.size) continue;
      const inter = [...a].filter((w) => b.has(w)).length;
      const union = new Set([...a, ...b]).size;
      if (inter / union >= 0.8) out.push([texts[i], texts[j]]);
    }
  }
  return out;
}

function classifyImage(
  a: LinkedAsset,
  specs: { name: string; ratio: number; minW: number; minH: number; recW: number; recH: number }[],
  maxFileBytes: number,
): ImageItem {
  const { width, height, fileSize } = a.image!;
  const spec = specs.find((sp) => ratioMatches(width, height, sp.ratio));
  const problems: string[] = [];
  if (!spec) problems.push(`raport ${width}×${height} nu corespunde niciunui format acceptat`);
  if (spec && (width < spec.minW || height < spec.minH)) {
    problems.push(`sub minimul de ${spec.minW}×${spec.minH} px`);
  }
  if (
    spec &&
    (width < spec.recW || height < spec.recH) &&
    !(width < spec.minW || height < spec.minH)
  ) {
    problems.push(`sub dimensiunea recomandată de ${spec.recW}×${spec.recH} px`);
  }
  if (fileSize > maxFileBytes)
    problems.push(`fișier de ${Math.round(fileSize / 1024)} KB, peste limita de 5120 KB`);
  if (!usable(a)) problems.push('respinsă de politica Google');
  const hardFail =
    !spec ||
    width < (spec?.minW ?? 0) ||
    height < (spec?.minH ?? 0) ||
    fileSize > maxFileBytes ||
    !usable(a);
  return {
    fieldType: a.fieldType,
    level: a.level,
    width,
    height,
    fileSize,
    format: spec?.name ?? 'necunoscut',
    valid: !hardFail,
    problems,
  };
}

function performanceSummary(c: CampaignData): PerformanceSummary {
  const cur = c.current;
  const prev = c.previous;
  const ctr = ratio(cur.clicks, cur.impressions);
  const prevCtr = ratio(prev.clicks, prev.impressions);
  const comparable =
    cur.impressions >= MIN_IMPRESSIONS_FOR_TREND && prev.impressions >= MIN_IMPRESSIONS_FOR_TREND;
  return {
    current: {
      ...cur,
      ctr,
      cpc: ratio(cur.costMicros / 1e6, cur.clicks),
      cpa: cur.conversions > 0 ? cur.costMicros / 1e6 / cur.conversions : null,
      roas:
        cur.costMicros > 0 && cur.conversionsValue > 0
          ? cur.conversionsValue / (cur.costMicros / 1e6)
          : null,
    },
    previous: { ...prev, ctr: prevCtr },
    ctrChange: comparable ? change(ctr, prevCtr) : null,
    clicksChange: comparable ? change(cur.clicks, prev.clicks) : null,
    comparable,
  };
}

// --- shared evaluation pieces -------------------------------------------

function performanceComponent(
  perf: PerformanceSummary,
  issues: CampaignIssue[],
  max: number,
): ScoreComponent {
  if (!perf.comparable) {
    return {
      key: 'performance',
      label: 'Evoluția performanței',
      max,
      earned: 0,
      status: 'na',
      explanation:
        `Comparăm ultimele 30 de zile cu cele 30 de dinainte doar când fiecare perioadă are cel puțin ` +
        `${MIN_IMPRESSIONS_FOR_TREND} afișări (acum: ${perf.current.impressions} / ${perf.previous.impressions}).`,
      missing: [],
    };
  }
  const ctrDrop = -(perf.ctrChange ?? 0);
  const clickDrop = -(perf.clicksChange ?? 0);
  const worst = Math.max(ctrDrop, clickDrop);
  const earned = worst < 0.2 ? max : worst < 0.5 ? max / 2 : 0;
  const pct = (v: number | null) =>
    v === null ? 'n/a' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  if (worst >= 0.5) {
    issues.push({
      code: 'performance_drop_major',
      priority: 'high',
      area: 'performance',
      title: 'Scădere puternică de performanță',
      why: `Față de perioada anterioară: CTR ${pct(perf.ctrChange)}, clicuri ${pct(perf.clicksChange)}.`,
      action:
        'Verifică modificările recente, concurența și termenii de căutare; nu înlocui reclamele înainte de a afla cauza.',
      autoFixable: false,
    });
  } else if (worst >= 0.2) {
    issues.push({
      code: 'performance_drop',
      priority: 'medium',
      area: 'performance',
      title: 'Performanța este în scădere',
      why: `Față de perioada anterioară: CTR ${pct(perf.ctrChange)}, clicuri ${pct(perf.clicksChange)}.`,
      action: 'Urmărește evoluția în următoarele zile și verifică relevanța reclamelor.',
      autoFixable: false,
    });
  }
  return {
    key: 'performance',
    label: 'Evoluția performanței',
    max,
    earned,
    status: earned === max ? 'ok' : 'attention',
    explanation: `CTR ${pct(perf.ctrChange)}, clicuri ${pct(perf.clicksChange)} față de cele 30 de zile anterioare. Punctaj complet sub 20% scădere, jumătate sub 50%.`,
    missing: earned === max ? [] : ['Oprirea scăderii de CTR / clicuri'],
  };
}

function conversionIssue(perf: PerformanceSummary, issues: CampaignIssue[]): void {
  if (perf.current.clicks >= MIN_CLICKS_FOR_CONVERSION_CHECK && perf.current.conversions === 0) {
    issues.push({
      code: 'no_conversions',
      priority: 'medium',
      area: 'performance',
      title: 'Nicio conversie înregistrată',
      why: `${perf.current.clicks} clicuri în 30 de zile și 0 conversii. Fără date de conversie, Google nu poate optimiza licitarea, iar costul pe rezultat nu poate fi măsurat.`,
      action: 'Verifică dacă tag-ul de conversie se declanșează pe pagina de destinație.',
      autoFixable: false,
    });
  }
}

function servingIssues(c: CampaignData, issues: CampaignIssue[]): void {
  if (c.status !== 'ENABLED') return;
  const reasons = c.primaryStatusReasons.filter((r) => !/PAUSED|REMOVED|ENDED/.test(r));
  if (c.primaryStatus === 'NOT_ELIGIBLE') {
    issues.push({
      code: 'not_serving',
      priority: 'critical',
      area: 'serving',
      title: 'Campania este activă, dar nu poate afișa reclame',
      why: `Google raportează: ${reasons.join(', ') || c.primaryStatus}. Bugetul nu produce nimic cât timp campania nu e eligibilă.`,
      action: 'Rezolvă cauza indicată de Google (în Google Ads, la starea campaniei).',
      autoFixable: false,
    });
  } else if (c.primaryStatus === 'LIMITED' && reasons.length) {
    issues.push({
      code: 'limited_serving',
      priority: 'high',
      area: 'serving',
      title: 'Afișare limitată',
      why: `Google raportează: ${reasons.join(', ')}.`,
      action: 'Verifică motivul limitării (buget, politică, licitare) în Google Ads.',
      autoFixable: false,
    });
  }
}

function policyComponent(
  label: string,
  disapproved: string[],
  limited: string[],
  issues: CampaignIssue[],
  max: number,
): ScoreComponent {
  if (disapproved.length) {
    issues.push({
      code: 'disapproved',
      priority: 'critical',
      area: 'policy',
      title: `${disapproved.length} element(e) respins(e) de Google`,
      why: 'Un element respins nu se afișează deloc; reclama pierde din acoperire și din Ad Strength.',
      action: `Înlocuiește sau corectează: ${disapproved.slice(0, 5).join('; ')}`,
      autoFixable: false,
    });
  }
  if (limited.length) {
    issues.push({
      code: 'approved_limited',
      priority: 'medium',
      area: 'policy',
      title: `${limited.length} element(e) aprobat(e) limitat`,
      why: 'Elementele aprobate limitat se afișează doar în unele situații sau țări.',
      action: `Verifică restricția pentru: ${limited.slice(0, 5).join('; ')}`,
      autoFixable: false,
    });
  }
  const earned = disapproved.length ? 0 : limited.length ? max / 2 : max;
  return {
    key: 'policy',
    label,
    max,
    earned,
    status: disapproved.length ? 'missing' : limited.length ? 'attention' : 'ok',
    explanation:
      'Punctaj complet fără elemente respinse; jumătate dacă există aprobări limitate; zero dacă ceva e respins.',
    missing: [...disapproved.map((d) => `Respins: ${d}`), ...limited.map((d) => `Limitat: ${d}`)],
  };
}

/** Account-level assets are shared by every campaign: a disapproved one is
 *  reported once per campaign as an account-level problem (it doesn't
 *  stop this campaign's ads, so it is not counted in its policy score). */
function accountAssetIssues(c: CampaignData, issues: CampaignIssue[]): void {
  const bad = c.assets.filter((a) => a.level === 'account' && !usable(a));
  if (!bad.length) return;
  issues.push({
    code: 'account_asset_disapproved',
    scope: 'account',
    priority: 'high',
    area: 'policy',
    title: `Element la nivel de cont respins: ${bad.map((a) => a.fieldType.toLowerCase()).join(', ')}`,
    why: 'Elementul respins nu se afișează în nicio campanie din cont (ex. logo-ul nu apare lângă reclame).',
    action: `Înlocuiește-l în Google Ads (Elemente la nivel de cont)${bad[0].image ? `; imaginea actuală are ${bad[0].image.width}×${bad[0].image.height} px` : ''}.`,
    autoFixable: false,
    source: SOURCES.businessInfo,
  });
}

function urlIssues(urls: string[], ctx: EvaluationContext, issues: CampaignIssue[]): void {
  const broken = urls.map((u) => ctx.urlChecks.get(u)).filter((r): r is UrlCheck => !!r && !r.ok);
  for (const b of broken) {
    issues.push({
      code: 'broken_url',
      priority: 'critical',
      area: 'landing_page',
      title: 'Pagina de destinație nu răspunde corect',
      why: `${b.url} a răspuns ${b.status ?? b.error ?? 'eroare'}. Clicurile plătite ajung pe o pagină care nu funcționează, iar Google poate respinge reclama.`,
      action: 'Repară pagina sau schimbă URL-ul final al reclamei.',
      autoFixable: false,
    });
  }
}

function recommendationsComponent(
  c: CampaignData,
  issues: CampaignIssue[],
  max: number,
): ScoreComponent {
  const count = c.openRecommendations.length;
  if (count) {
    issues.push({
      code: 'open_recommendations',
      priority: 'low',
      area: 'recommendations',
      title: `${count} recomandări Google deschise`,
      why: 'Google a identificat oportunități pentru această campanie; nu toate sunt potrivite, dar merită evaluate.',
      action:
        'Vezi tab-ul Propuneri: cele relevante sunt deja în coada de aprobare (pentru campaniile agentului).',
      autoFixable: false,
    });
  }
  const earned = count === 0 ? max : count <= 2 ? max / 2 : 0;
  return {
    key: 'recommendations',
    label: 'Recomandări Google rezolvate',
    max,
    earned,
    status: count === 0 ? 'ok' : 'attention',
    explanation: 'Punctaj complet fără recomandări deschise, jumătate cu 1-2, zero cu mai multe.',
    missing: [...new Set(c.openRecommendations.map((r) => r.type))],
  };
}

function adStrengthPoints(
  strength: string | undefined,
  max: number,
): { earned: number; status: ComponentStatus } {
  switch (strength) {
    case 'EXCELLENT':
      return { earned: max, status: 'ok' };
    case 'GOOD':
      return { earned: round1(max * 0.75), status: 'attention' };
    case 'AVERAGE':
      return { earned: round1(max * 0.4), status: 'attention' };
    case 'POOR':
      return { earned: round1(max * 0.1), status: 'missing' };
    default:
      return { earned: 0, status: 'na' };
  }
}

function adStrengthComponent(
  strength: string | undefined,
  max: number,
  issues: CampaignIssue[],
  managed: boolean,
): ScoreComponent {
  const { earned, status } = adStrengthPoints(strength, max);
  if (strength === 'POOR') {
    issues.push({
      code: 'ad_strength_poor',
      priority: 'high',
      area: 'ad_strength',
      title: 'Ad Strength: Slab (POOR)',
      why: 'Google recomandă cel puțin „Bun” (Good); Ad Strength reflectă numărul, diversitatea și relevanța elementelor reclamei.',
      action: 'Adaugă titluri/descrieri diferite între ele și cel puțin 6 sitelink-uri.',
      autoFixable: managed,
      source: SOURCES.adStrength,
    });
  } else if (strength === 'AVERAGE') {
    issues.push({
      code: 'ad_strength_average',
      priority: 'medium',
      area: 'ad_strength',
      title: 'Ad Strength: Mediu (AVERAGE)',
      why: 'Sub nivelul „Bun” recomandat de Google.',
      action: 'Completează titlurile, descrierile și sitelink-urile lipsă.',
      autoFixable: managed,
      source: SOURCES.adStrength,
    });
  }
  return {
    key: 'ad_strength',
    label: 'Ad Strength (Google)',
    max,
    earned,
    status,
    explanation:
      status === 'na'
        ? `Google nu a calculat încă Ad Strength (${strength ?? 'indisponibil'}); componenta nu intră în scor.`
        : 'Valoarea oficială Google: Excelent 100%, Bun 75%, Mediu 40%, Slab 10% din punctaj.',
    missing: strength === 'EXCELLENT' || status === 'na' ? [] : ['Ad Strength „Excelent”'],
    source: SOURCES.adStrength,
  };
}

function textCountComponent(opts: {
  key: string;
  label: string;
  have: number;
  target: number;
  max: number;
  explanation: string;
  missingLabel: (n: number) => string;
  source: string;
}): ScoreComponent {
  const earned = proportional(opts.have, opts.target, opts.max);
  const lacking = Math.max(0, opts.target - opts.have);
  return {
    key: opts.key,
    label: opts.label,
    max: opts.max,
    earned,
    status: lacking === 0 ? 'ok' : opts.have === 0 ? 'missing' : 'attention',
    explanation: opts.explanation,
    missing: lacking ? [opts.missingLabel(lacking)] : [],
    source: opts.source,
  };
}

function textQualityIssues(
  label: string,
  area: string,
  texts: TextItem[],
  managed: boolean,
  issues: CampaignIssue[],
): void {
  const lower = texts.map((t) => fold(t.text));
  const dupes = lower.filter((t, i) => lower.indexOf(t) !== i);
  if (dupes.length) {
    issues.push({
      code: `${area}_duplicates`,
      priority: 'medium',
      area,
      title: `${label}: texte identice`,
      why: 'Textele identice nu adaugă combinații noi; Google recompensă diversitatea.',
      action: 'Înlocuiește duplicatele cu variante diferite.',
      autoFixable: false,
    });
  }
  const near = nearDuplicates(texts.map((t) => t.text));
  if (near.length) {
    issues.push({
      code: `${area}_similar`,
      priority: 'low',
      area,
      title: `${label}: ${near.length} perechi aproape identice`,
      why: `Ex.: „${near[0][0]}” / „${near[0][1]}”. Variantele prea asemănătoare reduc diversitatea apreciată de Ad Strength.`,
      action: 'Reformulează una dintre ele cu un alt unghi (beneficiu, CTA, încredere).',
      autoFixable: false,
      source: SOURCES.adStrength,
    });
  }
  const low = texts.filter((t) => t.performanceLabel === 'LOW');
  if (low.length) {
    issues.push({
      code: `${area}_low_performers`,
      priority: 'medium',
      area,
      title: `${label}: ${low.length} cu performanță „Scăzută” (LOW) la Google`,
      why: `Google a evaluat deja aceste texte pe trafic real: ${low.map((t) => `„${t.text}”`).join(', ')}.`,
      action: managed
        ? 'Agentul propune înlocuiri (necesită aprobare).'
        : 'Înlocuiește-le cu variante noi.',
      autoFixable: false,
    });
  }
}

// --- Search ---------------------------------------------------------------

function pickRsa(ads: RsaAd[]): RsaAd | undefined {
  const enabled = ads.filter((a) => a.status === 'ENABLED');
  const pool = enabled.length ? enabled : ads;
  return [...pool].sort((a, b) => b.headlines.length - a.headlines.length)[0];
}

function commonAssetSummary(
  c: CampaignData,
): Omit<
  AssetSummary,
  | 'evaluatedOn'
  | 'headlines'
  | 'longHeadlines'
  | 'descriptions'
  | 'images'
  | 'logos'
  | 'finalUrls'
  | 'adsCount'
> {
  const active = c.assets.filter((a) => a.primaryStatus !== 'REMOVED');
  return {
    sitelinks: active
      .filter((a) => a.fieldType === 'SITELINK' && a.sitelink && usable(a))
      .map((a) => ({ ...a.sitelink!, level: a.level })),
    callouts: active
      .filter((a) => a.fieldType === 'CALLOUT' && a.text && usable(a))
      .map((a) => ({ text: a.text!, level: a.level })),
    structuredSnippets: active.filter((a) => a.fieldType === 'STRUCTURED_SNIPPET' && usable(a))
      .length,
    videos: active.filter((a) => a.video).map((a) => a.video!),
    businessName:
      active.find((a) => a.fieldType === 'BUSINESS_NAME' && a.text)?.text ??
      (active.some((a) => a.fieldType === 'BUSINESS_NAME') ? '(configurat)' : null),
  };
}

function extensionComponents(
  summary: ReturnType<typeof commonAssetSummary>,
  managed: boolean,
  issues: CampaignIssue[],
  weights: { sitelinks: number; callouts: number; snippets: number },
): ScoreComponent[] {
  const sl = summary.sitelinks.length;
  if (sl < SITELINKS.minToShow) {
    issues.push({
      code: 'sitelinks_missing',
      priority: 'high',
      area: 'sitelinks',
      title: sl === 0 ? 'Nu există sitelink-uri' : 'Sitelink-uri insuficiente ca să fie afișate',
      why: `Google afișează sitelink-uri doar de la ${SITELINKS.minToShow} în sus și cere 6+ pentru un Ad Strength bun (acum: ${sl}).`,
      action: `Adaugă ${SITELINKS.recommended - sl} sitelink-uri relevante.`,
      autoFixable: managed,
      source: SOURCES.sitelinks,
    });
  } else if (sl < SITELINKS.recommended) {
    issues.push({
      code: 'sitelinks_below_recommended',
      priority: 'medium',
      area: 'sitelinks',
      title: `Doar ${sl} din ${SITELINKS.recommended} sitelink-uri recomandate`,
      why: 'Google: „6 sau mai multe sitelink-uri îmbunătățesc scorul” Ad Strength.',
      action: `Adaugă încă ${SITELINKS.recommended - sl}.`,
      autoFixable: managed,
      source: SOURCES.adStrength,
    });
  }
  const co = summary.callouts.length;
  if (co < CALLOUTS.ourTarget) {
    issues.push({
      code: 'callouts_missing',
      priority: co === 0 ? 'medium' : 'low',
      area: 'callouts',
      title: co === 0 ? 'Nu există callout-uri' : `Doar ${co} callout-uri`,
      why: 'Callout-urile adaugă text de încredere/beneficiu sub reclamă și ocupă mai mult spațiu în rezultate.',
      action: `Adaugă ${CALLOUTS.ourTarget - co} callout-uri scurte (max ${CALLOUTS.maxChars} caractere).`,
      autoFixable: managed,
      source: SOURCES.callouts,
    });
  }
  if (!summary.structuredSnippets) {
    issues.push({
      code: 'snippets_missing',
      priority: 'low',
      area: 'snippets',
      title: 'Nu există structured snippets',
      why: `Listează tipurile de servicii (ex. antet „Service catalog”), minim ${STRUCTURED_SNIPPETS.minValues} valori.`,
      action: 'Adaugă un structured snippet cu serviciile principale.',
      autoFixable: managed,
      source: SOURCES.snippets,
    });
  }
  return [
    textCountComponent({
      key: 'sitelinks',
      label: 'Sitelink-uri',
      have: sl,
      target: SITELINKS.recommended,
      max: weights.sitelinks,
      explanation: `Proporțional cu ${SITELINKS.recommended} sitelink-uri (pragul Google pentru Ad Strength), la nivel de cont, campanie sau grup.`,
      missingLabel: (n) => `${n} sitelink-uri`,
      source: SOURCES.adStrength,
    }),
    textCountComponent({
      key: 'callouts',
      label: 'Callout-uri',
      have: co,
      target: CALLOUTS.ourTarget,
      max: weights.callouts,
      explanation: `Proporțional cu ${CALLOUTS.ourTarget} callout-uri (țintă proprie; Google nu publică un număr recomandat, afișează până la 10).`,
      missingLabel: (n) => `${n} callout-uri`,
      source: SOURCES.callouts,
    }),
    {
      key: 'snippets',
      label: 'Structured snippets',
      max: weights.snippets,
      earned: summary.structuredSnippets ? weights.snippets : 0,
      status: summary.structuredSnippets ? 'ok' : 'missing',
      explanation: 'Punctaj complet cu cel puțin un structured snippet.',
      missing: summary.structuredSnippets ? [] : ['1 structured snippet'],
      source: SOURCES.snippets,
    },
  ];
}

function evaluateSearch(c: CampaignData, ctx: EvaluationContext): CampaignEvaluation {
  const issues: CampaignIssue[] = [];
  const rsa = pickRsa(c.ads);
  const perf = performanceSummary(c);
  const common = commonAssetSummary(c);
  const headlines = textItems(rsa?.headlines ?? []);
  const descriptions = textItems(rsa?.descriptions ?? []);
  const active = c.assets.filter((a) => a.primaryStatus !== 'REMOVED');
  const images = active
    .filter((a) => a.image && a.fieldType === 'AD_IMAGE')
    .map((a) =>
      classifyImage(
        a,
        [
          { name: 'pătrat 1:1', ...SEARCH_IMAGES.square },
          { name: 'peisaj 1.91:1', ...SEARCH_IMAGES.landscape },
        ],
        SEARCH_IMAGES.maxFileBytes,
      ),
    );
  const logos = active
    .filter((a) => a.image && (a.fieldType === 'BUSINESS_LOGO' || a.fieldType === 'LOGO'))
    .map((a) =>
      classifyImage(
        a,
        [{ name: 'logo 1:1', ratio: 1, minW: 128, minH: 128, recW: 1200, recH: 1200 }],
        SEARCH_IMAGES.maxFileBytes,
      ),
    );

  servingIssues(c, issues);
  if (!rsa) {
    issues.push({
      code: 'no_rsa',
      priority: c.status === 'ENABLED' ? 'critical' : 'high',
      area: 'headlines',
      title: 'Nicio reclamă responsivă de căutare (RSA)',
      why: 'Fără o reclamă RSA campania de căutare nu are ce afișa.',
      action: 'Creează o reclamă RSA cu 15 titluri și 4 descrieri.',
      autoFixable: false,
      source: SOURCES.rsa,
    });
  }

  const components: ScoreComponent[] = [];
  components.push(
    textCountComponent({
      key: 'headlines',
      label: 'Titluri (RSA)',
      have: headlines.length,
      target: RSA.headlines.max,
      max: 15,
      explanation: `Proporțional cu ${RSA.headlines.max} titluri (maximul Google; „oferă cât mai multe titluri unice”), max ${RSA.headlines.maxChars} caractere.`,
      missingLabel: (n) => `${n} titluri`,
      source: SOURCES.rsa,
    }),
    textCountComponent({
      key: 'descriptions',
      label: 'Descrieri (RSA)',
      have: descriptions.length,
      target: RSA.descriptions.max,
      max: 10,
      explanation: `Proporțional cu ${RSA.descriptions.max} descrieri (maximul Google), max ${RSA.descriptions.maxChars} caractere.`,
      missingLabel: (n) => `${n} descrieri`,
      source: SOURCES.rsa,
    }),
  );
  if (rsa && headlines.length < RSA.headlines.max) {
    issues.push({
      code: 'headlines_below_max',
      priority: headlines.length < 8 ? 'high' : 'medium',
      area: 'headlines',
      title: `${headlines.length} din ${RSA.headlines.max} titluri`,
      why: 'Fiecare titlu în plus înseamnă mai multe combinații pe care Google le poate testa; numărul de combinații e un factor direct al Ad Strength.',
      action: `Adaugă ${RSA.headlines.max - headlines.length} titluri unice, cu unghiuri diferite.`,
      autoFixable: ctx.managed,
      source: SOURCES.rsa,
    });
  }
  if (rsa && descriptions.length < RSA.descriptions.max) {
    issues.push({
      code: 'descriptions_below_max',
      priority: 'medium',
      area: 'descriptions',
      title: `${descriptions.length} din ${RSA.descriptions.max} descrieri`,
      why: 'Google permite 4 descrieri; mai multe variante = mai multe combinații testate.',
      action: `Adaugă ${RSA.descriptions.max - descriptions.length} descrieri cu propunere de valoare și CTA.`,
      autoFixable: ctx.managed,
      source: SOURCES.rsa,
    });
  }
  const pinned = headlines.filter((h) => h.pinnedField).length;
  if (pinned > 3) {
    issues.push({
      code: 'over_pinned',
      priority: 'low',
      area: 'headlines',
      title: `${pinned} titluri fixate pe poziție`,
      why: 'Google: fixarea „nu e recomandată pentru majoritatea advertiserilor și poate afecta Ad Strength”.',
      action: 'Păstrează fixate doar 1-2 titluri esențiale.',
      autoFixable: false,
      source: SOURCES.rsa,
    });
  }
  textQualityIssues('Titluri', 'headlines', headlines, ctx.managed, issues);
  textQualityIssues('Descrieri', 'descriptions', descriptions, ctx.managed, issues);

  // Keywords in headlines: a direct Ad Strength factor ("Include popular
  // keywords in your headlines"). Monitored on every cycle.
  const kwCoverage = rsa
    ? keywordCoverage(
        headlines.map((h) => h.text),
        rsa.keywords ?? [],
        rsa.actionItems ?? [],
      )
    : null;
  if (rsa && kwCoverage && keywordsHurtAdStrength(rsa.adStrength, kwCoverage)) {
    const shown = kwCoverage.missing
      .slice(0, 6)
      .map((k) => `„${k}”`)
      .join(', ');
    issues.push({
      code: 'headlines_missing_keywords',
      priority: kwCoverage.googleFlagged ? 'high' : 'medium',
      area: 'headlines',
      title: `Titlurile nu conțin ${kwCoverage.missing.length} din ${kwCoverage.keywords.length} cuvinte cheie`,
      why:
        `Lipsesc din titluri: ${shown}${kwCoverage.missing.length > 6 ? ' …' : ''}. ` +
        (kwCoverage.googleFlagged
          ? 'Google indică explicit lipsa cuvintelor cheie din titluri ca motiv pentru care Ad Strength nu este „Excelent”.'
          : `Doar ${kwCoverage.headlinesWithKeyword} titluri conțin un cuvânt cheie; Ad Strength ține cont de relevanța titlurilor față de cuvintele cheie.`),
      action: ctx.managed
        ? 'Agentul adaugă sau rescrie titluri care conțin cuvintele cheie lipsă (verificat apoi în Google).'
        : 'Adaugă titluri care conțin cuvintele cheie lipsă, întregi, cuvânt cu cuvânt.',
      autoFixable: ctx.managed,
      source: SOURCES.adStrength,
    });
  }

  components.push(adStrengthComponent(rsa?.adStrength, 15, issues, ctx.managed));
  components.push(
    ...extensionComponents(common, ctx.managed, issues, {
      sitelinks: 12,
      callouts: 6,
      snippets: 4,
    }),
  );

  // Images: optional on Search, recommended 4 incl. ≥1 square + ≥1 landscape.
  const validImages = images.filter((i) => i.valid);
  const hasSquare = validImages.some((i) => i.format.startsWith('pătrat'));
  const hasLandscape = validImages.some((i) => i.format.startsWith('peisaj'));
  const imageEarned = round1(
    (hasSquare ? 2 : 0) +
      (hasLandscape ? 1 : 0) +
      proportional(validImages.length, SEARCH_IMAGES.recommendedCount, 3),
  );
  const imageMissing: string[] = [];
  if (!hasSquare) imageMissing.push('o imagine pătrată 1:1 (min 300×300, recomandat 1200×1200)');
  if (!hasLandscape)
    imageMissing.push('o imagine peisaj 1.91:1 (min 600×314, recomandat 1200×628)');
  if (validImages.length < SEARCH_IMAGES.recommendedCount)
    imageMissing.push(
      `${SEARCH_IMAGES.recommendedCount - validImages.length} imagini până la cele 4 recomandate`,
    );
  components.push({
    key: 'images',
    label: 'Imagini',
    max: 6,
    earned: imageEarned,
    status: imageMissing.length === 0 ? 'ok' : validImages.length ? 'attention' : 'missing',
    explanation:
      'Google recomandă 4 imagini unice, cel puțin una pătrată și una peisaj. Eligibilitatea depinde de istoricul contului (60+ zile, cheltuieli în ultimele 30).',
    missing: imageMissing,
    source: SOURCES.searchImages,
  });
  if (!validImages.length) {
    issues.push({
      code: 'images_missing',
      priority: 'medium',
      area: 'images',
      title: 'Nicio imagine validă',
      why: 'Imaginile fac reclama mai vizibilă pe căutare (dacă contul e eligibil).',
      action: 'Adaugă cel puțin o imagine pătrată 1200×1200 și una peisaj 1200×628 relevante.',
      autoFixable: ctx.managed,
      source: SOURCES.searchImages,
    });
  } else if (!hasSquare || !hasLandscape) {
    issues.push({
      code: 'image_format_missing',
      priority: 'low',
      area: 'images',
      title: `Lipsește formatul ${!hasSquare ? 'pătrat 1:1' : 'peisaj 1.91:1'}`,
      why: 'Google recomandă ambele formate ca să poată folosi imaginile în toate plasările.',
      action: imageMissing[0],
      autoFixable: ctx.managed,
      source: SOURCES.searchImages,
    });
  }
  for (const img of images.filter((i) => !i.valid || i.problems.length)) {
    issues.push({
      code: 'image_quality',
      priority: img.valid ? 'low' : 'medium',
      area: 'images',
      title: `Imagine ${img.width}×${img.height}: ${img.problems.join(', ')}`,
      why: img.valid
        ? 'Imaginile sub dimensiunea recomandată pot arăta neclar.'
        : 'Imaginea nu respectă cerințele Google și nu va fi folosită.',
      action: 'Înlocuiește-o cu o variantă la dimensiunea recomandată.',
      autoFixable: false,
      source: SOURCES.searchImages,
    });
  }

  const hasLogo = logos.some((l) => l.valid);
  const hasName = !!common.businessName;
  components.push({
    key: 'brand',
    label: 'Nume afacere și logo',
    max: 4,
    earned: (hasName ? 2 : 0) + (hasLogo ? 2 : 0),
    status: hasName && hasLogo ? 'ok' : hasName || hasLogo ? 'attention' : 'missing',
    explanation:
      'Câte 2 puncte pentru numele afacerii și pentru un logo valid (nivel cont sau campanie). Necesită verificarea advertiserului.',
    missing: [...(hasName ? [] : ['numele afacerii']), ...(hasLogo ? [] : ['logo'])],
    source: SOURCES.businessInfo,
  });
  if (!hasName || !hasLogo) {
    issues.push({
      code: 'brand_missing',
      priority: 'low',
      area: 'brand',
      title: `Lipsește ${[!hasName && 'numele afacerii', !hasLogo && 'logo-ul'].filter(Boolean).join(' și ')}`,
      why: 'Numele și logo-ul afacerii apar lângă reclamă și cresc încrederea.',
      action: hasName
        ? 'Încarcă un logo pătrat valid în Google Ads (Elemente la nivel de cont); necesită verificarea advertiserului.'
        : 'Agentul adaugă numele afacerii la campanie; logo-ul se încarcă manual în Google Ads.',
      // The agent can add the business name (a text asset); a logo needs
      // a real brand image uploaded by a person.
      autoFixable: ctx.managed && !hasName,
      source: SOURCES.businessInfo,
    });
  }

  const disapproved = [
    ...c.ads.filter((a) => a.approvalStatus === 'DISAPPROVED').map(() => 'reclamă'),
    ...[...headlines, ...descriptions]
      .filter((t) => t.approvalStatus === 'DISAPPROVED')
      .map((t) => `„${t.text}”`),
    ...active
      .filter((a) => a.level !== 'account' && !usable(a))
      .map((a) => `${a.fieldType.toLowerCase()} ${a.text ?? a.sitelink?.linkText ?? ''}`.trim()),
  ];
  accountAssetIssues(c, issues);
  const limited = [
    ...c.ads.filter((a) => a.approvalStatus === 'APPROVED_LIMITED').map(() => 'reclamă'),
    ...[...headlines, ...descriptions]
      .filter((t) => t.approvalStatus === 'APPROVED_LIMITED')
      .map((t) => `„${t.text}”`),
  ];
  components.push(
    policyComponent('Conformitate cu politicile Google', disapproved, limited, issues, 14),
  );
  components.push(performanceComponent(perf, issues, 10));
  components.push(recommendationsComponent(c, issues, 4));
  conversionIssue(perf, issues);

  const finalUrls = [...new Set(c.ads.flatMap((a) => a.finalUrls))];
  urlIssues(finalUrls, ctx, issues);

  return finish(
    components,
    issues,
    {
      evaluatedOn: rsa ? rsa.adResourceName : null,
      ...(kwCoverage
        ? {
            headlineKeywords: {
              covered: kwCoverage.covered,
              missing: kwCoverage.missing,
              googleFlagged: kwCoverage.googleFlagged,
            },
          }
        : {}),
      headlines,
      longHeadlines: [],
      descriptions,
      images,
      logos,
      finalUrls,
      adsCount: c.ads.length,
      ...common,
    },
    rsa?.adStrength ?? null,
    perf,
  );
}

// --- Performance Max --------------------------------------------------------

function evaluatePmax(c: CampaignData, ctx: EvaluationContext): CampaignEvaluation {
  const issues: CampaignIssue[] = [];
  const perf = performanceSummary(c);
  const common = commonAssetSummary(c);
  const group = c.assetGroups.find((g) => g.status === 'ENABLED') ?? c.assetGroups[0];
  const groupAssets = c.assets.filter(
    (a) => a.level === 'asset_group' && a.primaryStatus !== 'REMOVED',
  );
  // Brand guidelines put logo/business name at campaign level instead.
  const campaignAssets = c.assets.filter(
    (a) => a.level === 'campaign' && a.primaryStatus !== 'REMOVED',
  );
  const texts = (ft: string) =>
    textItems(
      groupAssets
        .filter((a) => a.fieldType === ft && a.text)
        .map((a) => ({ text: a.text!, approvalStatus: a.approvalStatus })),
    );
  const headlines = texts('HEADLINE');
  const longHeadlines = texts('LONG_HEADLINE');
  const descriptions = texts('DESCRIPTION');
  const imgSpecs = [
    { name: 'peisaj 1.91:1', ...PMAX.images.landscape },
    { name: 'pătrat 1:1', ...PMAX.images.square },
    { name: 'portret 4:5', ...PMAX.images.portrait },
  ];
  const images = groupAssets
    .filter((a) => a.image && /MARKETING_IMAGE$/.test(a.fieldType))
    .map((a) => classifyImage(a, imgSpecs, PMAX.maxFileBytes));
  const logos = [...groupAssets, ...campaignAssets]
    .filter(
      (a) =>
        a.image &&
        (a.fieldType === 'LOGO' ||
          a.fieldType === 'LANDSCAPE_LOGO' ||
          a.fieldType === 'BUSINESS_LOGO'),
    )
    .map((a) =>
      classifyImage(
        a,
        [
          { name: 'logo pătrat 1:1', ...PMAX.logos.square },
          { name: 'logo peisaj 4:1', ...PMAX.logos.landscape },
        ],
        PMAX.maxFileBytes,
      ),
    );
  const videos = groupAssets.filter((a) => a.video).map((a) => a.video!);

  servingIssues(c, issues);
  if (!group) {
    issues.push({
      code: 'no_asset_group',
      priority: 'critical',
      area: 'serving',
      title: 'Niciun grup de elemente (asset group)',
      why: 'O campanie Performance Max fără grup de elemente nu poate afișa nimic.',
      action: 'Creează un grup de elemente cu elementele minime cerute.',
      autoFixable: false,
      source: SOURCES.pmaxApiRequirements,
    });
  }

  const components: ScoreComponent[] = [];
  const shortHeadline = headlines.some((h) => h.length <= PMAX.headlines.shortMaxChars);
  components.push({
    key: 'headlines',
    label: 'Titluri',
    max: 13,
    earned: round1(
      proportional(headlines.length, PMAX.headlines.recommended, 11) + (shortHeadline ? 2 : 0),
    ),
    status:
      headlines.length >= PMAX.headlines.recommended && shortHeadline
        ? 'ok'
        : headlines.length
          ? 'attention'
          : 'missing',
    explanation: `Proporțional cu ${PMAX.headlines.recommended}+ titluri recomandate (max ${PMAX.headlines.max}, ${PMAX.headlines.maxChars} caractere) + 2 puncte pentru un titlu de max ${PMAX.headlines.shortMaxChars} caractere.`,
    missing: [
      ...(headlines.length < PMAX.headlines.recommended
        ? [`${PMAX.headlines.recommended - headlines.length} titluri`]
        : []),
      ...(shortHeadline ? [] : [`un titlu de max ${PMAX.headlines.shortMaxChars} caractere`]),
    ],
    source: SOURCES.pmaxSpecs,
  });
  components.push(
    textCountComponent({
      key: 'long_headlines',
      label: 'Titluri lungi',
      have: longHeadlines.length,
      target: PMAX.longHeadlines.recommended,
      max: 6,
      explanation: `Proporțional cu ${PMAX.longHeadlines.recommended}+ titluri lungi recomandate (max ${PMAX.longHeadlines.maxChars} caractere).`,
      missingLabel: (n) => `${n} titluri lungi`,
      source: SOURCES.pmaxSpecs,
    }),
    textCountComponent({
      key: 'descriptions',
      label: 'Descrieri',
      have: descriptions.length,
      target: PMAX.descriptions.recommended,
      max: 10,
      explanation: `Proporțional cu ${PMAX.descriptions.recommended}+ descrieri recomandate (max ${PMAX.descriptions.max}, ${PMAX.descriptions.maxChars} caractere).`,
      missingLabel: (n) => `${n} descrieri`,
      source: SOURCES.pmaxSpecs,
    }),
  );
  const minimums: [string, number, number][] = [
    ['titluri', headlines.length, PMAX.headlines.min],
    ['titluri lungi', longHeadlines.length, PMAX.longHeadlines.min],
    ['descrieri', descriptions.length, PMAX.descriptions.min],
  ];
  for (const [label, have, min] of minimums) {
    if (group && have < min) {
      issues.push({
        code: `pmax_min_${label}`,
        priority: 'critical',
        area: 'serving',
        title: `Sub minimul obligatoriu de ${label} (${have}/${min})`,
        why: 'Google cere acest minim pentru ca grupul de elemente să poată fi publicat.',
        action: `Adaugă ${min - have} ${label}.`,
        autoFixable: false,
        source: SOURCES.pmaxApiRequirements,
      });
    }
  }
  if (headlines.length < PMAX.headlines.recommended || !shortHeadline) {
    issues.push({
      code: 'pmax_headlines',
      priority: 'medium',
      area: 'headlines',
      title: `${headlines.length} titluri${shortHeadline ? '' : ', niciunul scurt'}`,
      why: `Google recomandă ${PMAX.headlines.recommended}+ titluri, dintre care cel puțin unul de max ${PMAX.headlines.shortMaxChars} caractere.`,
      action: 'Completează titlurile lipsă.',
      autoFixable: false,
      source: SOURCES.pmaxSpecs,
    });
  }
  if (descriptions.length < PMAX.descriptions.recommended) {
    issues.push({
      code: 'pmax_descriptions',
      priority: 'medium',
      area: 'descriptions',
      title: `${descriptions.length} din ${PMAX.descriptions.recommended}+ descrieri recomandate`,
      why: 'Mai multe descrieri = mai multe combinații pe toate plasările Performance Max.',
      action: 'Adaugă descrieri cu propunere de valoare și CTA.',
      autoFixable: false,
      source: SOURCES.pmaxSpecs,
    });
  }
  if (longHeadlines.length < PMAX.longHeadlines.recommended) {
    issues.push({
      code: 'pmax_long_headlines',
      priority: 'low',
      area: 'long_headlines',
      title: `${longHeadlines.length} din ${PMAX.longHeadlines.recommended}+ titluri lungi`,
      why: 'Titlurile lungi apar în plasările cu mai mult spațiu.',
      action: 'Adaugă titluri lungi (max 90 caractere).',
      autoFixable: false,
      source: SOURCES.pmaxSpecs,
    });
  }
  textQualityIssues('Titluri', 'headlines', headlines, false, issues);

  // Images
  const valid = images.filter((i) => i.valid);
  const count = (name: string) => valid.filter((i) => i.format === name).length;
  const land = count('peisaj 1.91:1');
  const sq = count('pătrat 1:1');
  const por = count('portret 4:5');
  const allValid = images.every((i) => i.valid);
  components.push({
    key: 'images',
    label: 'Imagini',
    max: 14,
    earned: round1(
      proportional(land, 4, 5) +
        proportional(sq, 4, 5) +
        proportional(por, 2, 2) +
        (images.length && allValid ? 2 : 0),
    ),
    status:
      land >= 4 && sq >= 4 && por >= 2 && allValid ? 'ok' : valid.length ? 'attention' : 'missing',
    explanation:
      'Peisaj 1.91:1 (4+), pătrat 1:1 (4+), portret 4:5 (2+, opțional) conform specificațiilor Google, + 2 puncte dacă toate imaginile respectă dimensiunile și limita de 5 MB.',
    missing: [
      ...(land < 4 ? [`${4 - land} imagini peisaj 1.91:1 (1200×628)`] : []),
      ...(sq < 4 ? [`${4 - sq} imagini pătrate 1:1 (1200×1200)`] : []),
      ...(por < 2 ? [`${2 - por} imagini portret 4:5 (960×1200)`] : []),
      ...(allValid ? [] : ['corectarea imaginilor invalide']),
    ],
    source: SOURCES.pmaxSpecs,
  });
  if (group && (land < 1 || sq < 1)) {
    issues.push({
      code: 'pmax_required_images',
      priority: 'critical',
      area: 'images',
      title: `Lipsește formatul obligatoriu ${land < 1 ? 'peisaj 1.91:1' : 'pătrat 1:1'}`,
      why: 'Google cere cel puțin o imagine peisaj și una pătrată pentru publicare.',
      action: 'Adaugă imaginea lipsă la dimensiunea recomandată.',
      autoFixable: false,
      source: SOURCES.pmaxApiRequirements,
    });
  } else if (land < 4 || sq < 4 || por < 2) {
    issues.push({
      code: 'pmax_images_coverage',
      priority: por < 2 && land >= 4 && sq >= 4 ? 'low' : 'medium',
      area: 'images',
      title: 'Acoperire incompletă a formatelor de imagine',
      why: `Acum: ${land} peisaj, ${sq} pătrate, ${por} portret. Google recomandă 4+ / 4+ / 2+.`,
      action: 'Adaugă imaginile lipsă.',
      autoFixable: false,
      source: SOURCES.pmaxSpecs,
    });
  }
  for (const img of images.filter((i) => i.problems.length)) {
    issues.push({
      code: 'image_quality',
      priority: img.valid ? 'low' : 'medium',
      area: 'images',
      title: `Imagine ${img.width}×${img.height}: ${img.problems.join(', ')}`,
      why: img.valid
        ? 'Sub dimensiunea recomandată poate arăta neclar.'
        : 'Nu respectă cerințele Google.',
      action: 'Înlocuiește-o cu o variantă la dimensiunea recomandată.',
      autoFixable: false,
      source: SOURCES.pmaxSpecs,
    });
  }

  // Logos + business name
  const squareLogo = logos.some((l) => l.valid && l.format === 'logo pătrat 1:1');
  components.push({
    key: 'logos',
    label: 'Logo',
    max: 5,
    earned: squareLogo ? 5 : 0,
    status: squareLogo ? 'ok' : 'missing',
    explanation:
      'Un logo pătrat 1:1 (min 128×128, recomandat 1200×1200) este obligatoriu; logo-ul peisaj 4:1 e opțional și nu intră în scor.',
    missing: squareLogo ? [] : ['logo pătrat 1:1'],
    source: SOURCES.pmaxSpecs,
  });
  if (!squareLogo) {
    issues.push({
      code: 'pmax_logo',
      priority: 'high',
      area: 'logos',
      title: 'Lipsește logo-ul pătrat',
      why: 'Logo-ul pătrat este obligatoriu (la nivel de grup sau de campanie, dacă sunt activate regulile de brand).',
      action: 'Încarcă un logo 1200×1200.',
      autoFixable: false,
      source: SOURCES.pmaxApiRequirements,
    });
  }
  const hasName = !!common.businessName;
  components.push({
    key: 'business_name',
    label: 'Nume afacere',
    max: 3,
    earned: hasName ? 3 : 0,
    status: hasName ? 'ok' : 'missing',
    explanation: `Obligatoriu, max ${PMAX.businessNameMaxChars} caractere.`,
    missing: hasName ? [] : ['numele afacerii'],
    source: SOURCES.pmaxSpecs,
  });

  // Videos
  components.push({
    key: 'videos',
    label: 'Videoclipuri',
    max: 10,
    earned: proportional(videos.length, PMAX.videos.recommended, 10),
    status:
      videos.length >= PMAX.videos.recommended ? 'ok' : videos.length ? 'attention' : 'missing',
    explanation:
      `Google recomandă câte un video pe fiecare orientare (16:9, 1:1, 9:16), min ${PMAX.videos.minSeconds} s. ` +
      'API-ul Google Ads nu expune durata sau orientarea, deci scorul numără videoclipurile (țintă 3); orientarea trebuie confirmată manual.',
    missing:
      videos.length < PMAX.videos.recommended
        ? [
            `${PMAX.videos.recommended - videos.length} videoclipuri (ideal: câte unul pe orientare)`,
          ]
        : [],
    source: SOURCES.pmaxSpecs,
  });
  if (!videos.length) {
    issues.push({
      code: 'pmax_no_video',
      priority: 'medium',
      area: 'videos',
      title: 'Niciun videoclip propriu',
      why: 'Fără video propriu, Google poate genera automat videoclipuri din imagini; acestea nu înlocuiesc un video real și împiedică Ad Strength „Excelent”.',
      action: 'Adaugă videoclipuri proprii (16:9, 1:1, 9:16, minim 10 s).',
      autoFixable: false,
      source: SOURCES.pmaxSpecs,
    });
  }

  components.push(adStrengthComponent(group?.adStrength, 12, issues, false));
  components.push(
    ...extensionComponents(common, false, issues, {
      sitelinks: 5,
      callouts: 3,
      snippets: 0,
    }).filter((comp) => comp.max > 0),
  );
  const disapproved = [
    ...groupAssets
      .filter((a) => !usable(a))
      .map((a) => `${a.fieldType.toLowerCase()} ${a.text ?? ''}`.trim()),
    ...campaignAssets
      .filter((a) => !usable(a))
      .map((a) => `${a.fieldType.toLowerCase()} ${a.text ?? a.sitelink?.linkText ?? ''}`.trim()),
  ];
  components.push(policyComponent('Conformitate cu politicile Google', disapproved, [], issues, 9));
  accountAssetIssues(c, issues);
  components.push(performanceComponent(perf, issues, 10));
  components.push(recommendationsComponent(c, issues, 5));
  conversionIssue(perf, issues);

  const finalUrls = [...new Set(c.assetGroups.flatMap((g) => g.finalUrls))];
  urlIssues(finalUrls, ctx, issues);

  return finish(
    components,
    issues,
    {
      evaluatedOn: group?.resourceName ?? null,
      headlines,
      longHeadlines,
      descriptions,
      images,
      logos,
      finalUrls,
      adsCount: c.assetGroups.length,
      ...common,
      videos,
    },
    group?.adStrength ?? null,
    perf,
  );
}

function finish(
  components: ScoreComponent[],
  issues: CampaignIssue[],
  assets: AssetSummary,
  adStrength: string | null,
  performance: PerformanceSummary,
): CampaignEvaluation {
  const applicable = components.filter((c) => c.status !== 'na');
  const max = applicable.reduce((s, c) => s + c.max, 0);
  const earned = applicable.reduce((s, c) => s + c.earned, 0);
  // De-duplicate identical codes from repeated checks, then order.
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const key = `${i.code}|${i.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  return {
    score: max > 0 ? Math.round((earned / max) * 100) : null,
    components,
    issues: unique,
    assets,
    adStrength,
    performance,
  };
}

/** Search and Performance Max have their own rubrics; any other channel
 *  type (not used in this account today) gets only the generic checks. */
export function evaluateCampaign(c: CampaignData, ctx: EvaluationContext): CampaignEvaluation {
  if (c.channelType === 'SEARCH') return evaluateSearch(c, ctx);
  if (c.channelType === 'PERFORMANCE_MAX') return evaluatePmax(c, ctx);
  const issues: CampaignIssue[] = [];
  const perf = performanceSummary(c);
  servingIssues(c, issues);
  const components = [
    performanceComponent(perf, issues, 10),
    recommendationsComponent(c, issues, 5),
  ];
  return finish(
    components,
    issues,
    {
      evaluatedOn: null,
      headlines: [],
      longHeadlines: [],
      descriptions: [],
      images: [],
      logos: [],
      finalUrls: [],
      adsCount: c.ads.length,
      ...commonAssetSummary(c),
    },
    null,
    perf,
  );
}
