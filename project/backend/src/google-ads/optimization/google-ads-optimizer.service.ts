import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AdvertiserContext, AiService, GoogleAdsCreativeGapFill } from '../../ai/ai.service';
import { AppConfig } from '../../config/env';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GoogleAdsApiClient,
  GoogleAdsMutateOperation,
  GoogleAdsMutateResult,
  policyFindingsOf,
} from '../google-ads-api-client.service';
import { subcategoryLandingUrl } from '../google-ads-landing-url';
import {
  PexelsPhoto,
  PexelsProvider,
} from '../../website/builder/generator/image-provider/pexels.provider';
import { AgentActivity } from './google-ads-activity';
import { CampaignData, LinkedAsset, RsaAd } from './google-ads-account-data';
import { CampaignEvaluation } from './google-ads-campaign-evaluator';
import { CALLOUTS, RSA, SEARCH_IMAGES, SITELINKS, STRUCTURED_SNIPPETS } from './google-ads-specs';
import {
  headlineHasKeyword,
  keywordCoverage,
  keywordsHurtAdStrength,
  replaceableHeadlines,
} from './google-ads-headline-keywords';

/**
 * Executes optimizations on AGENT-MANAGED campaigns only (the ones with a
 * GoogleAdsSubcategoryCampaign mapping); every other campaign in the account
 * is monitored but never modified. What it may do, per the admin's policy:
 *
 *  - Automatically (when `googleAdsAgentAutoFillGapsEnabled`): ADD missing
 *    headlines/descriptions to the existing Responsive Search Ad (up to
 *    Google's 15/4) and missing sitelinks/callouts (up to 6/4). Never
 *    removes or rewrites an existing asset; never touches budget, bidding,
 *    targeting or conversion goals.
 *  - Automatically (same setting): when the ad group's keywords are missing
 *    from the headlines and that holds Ad Strength back, add (or, in a full
 *    ad, rewrite the weakest keyword-less) headlines so they carry those
 *    keywords. Ad Strength is read back from Google afterwards and the
 *    previous headlines are restored if Google rates the new set lower.
 *  - Only with approval: replacing a headline/description Google itself
 *    labelled LOW (a `pending_approval` action, applied by `approveProposal`).
 *
 * Every write follows the same path: local validation against Google's
 * published limits → Google `validateOnly` pre-flight → real mutate (only
 * where writes are allowed, i.e. production) → a re-read from Google that
 * confirms the change is live → an action row in history with before/after.
 * A campaign gets at most one automatic creative change per cooldown
 * period, so Google has time to evaluate the new assets before the next.
 */

export type MappingWithCategory = Prisma.GoogleAdsSubcategoryCampaignGetPayload<{
  include: { category: { include: { parent: true } } };
}>;

/**
 * What the optimizer works FOR. The platform's own campaigns (one per
 * subcategory, see `platformTarget`) and a customer's own campaign
 * (GoogleAdsUserCampaign, see google-ads-user/) go through exactly the same
 * optimization logic; only these few facts differ between them.
 */
export interface OptimizationTarget {
  /** Stored on every action row this run writes. */
  owner: { categoryId: string } | { userCampaignId: string };
  /** Business/category name for AI prompts. */
  name: string;
  /** Set for a customer's own campaign: texts speak for that one business
   *  (absent = the platform marketplace framing). */
  advertiser?: AdvertiserContext;
  parentName?: string;
  /** English search terms for stock photos (Pexels). */
  imageQuery: string;
  /** Landing page used when the ad itself has no final URL. */
  landingFallback: string;
  /** BUSINESS_NAME asset text; null = the agent never adds one. */
  businessName: string | null;
  /** Real, distinct pages for sitelinks, most relevant first. */
  sitelinkDestinations(
    exclude: Set<string>,
    count: number,
  ): Promise<{ url: string; pageName: string }[]>;
  /** Called after at least one change was applied this run. */
  onOptimized?(googleCampaignId: string): Promise<void>;
}

/** Owner columns for an action row. Typed as the platform table's shape:
 *  for customer campaigns `actions` is the `google_ads_user_actions`
 *  delegate, whose rows carry `userCampaignId` instead (same other columns),
 *  so the value is correct at runtime for whichever table is in use. */
function ownerFields(t: OptimizationTarget): { categoryId: string } {
  return t.owner as { categoryId: string };
}

/** The slice of the Google Ads REST client the optimizer uses. A customer's
 *  OAuth client (GoogleAdsUserClient) implements the same surface. */
export interface AdsClient {
  readonly customerId: string;
  readonly writesAllowed: boolean;
  search: GoogleAdsApiClient['search'];
  mutate: GoogleAdsApiClient['mutate'];
}

/** The agent settings the optimizer reads (platform-wide or per customer). */
export interface OptimizerSettings {
  googleAdsAgentAutoFillGapsEnabled(): Promise<boolean>;
  googleAdsAgentCreativeCooldownDays(): Promise<number>;
}

/** Where action rows live: `google_ads_agent_actions` for the platform,
 *  `google_ads_user_actions` (same columns) for customers. */
export type ActionStore = PrismaService['googleAdsAgentAction'];

export interface OptimizeOutcome {
  applied: number;
  proposed: number;
  costEstimateMinor: number;
}

const MAX_REPLACEMENTS_PER_CAMPAIGN_PER_CYCLE = 2;
/** Actions that change the RSA text itself (subject to the cooldown). */
const RSA_TEXT_ACTIONS = [
  'creative.rsa_gap_fill',
  'creative.replace_text',
  'creative.keyword_headlines',
];
/** AI rewrites of disapproved texts per ad per run, each checked by Google
 *  (validateOnly); a policy rejection is fed back into the next attempt. */
const POLICY_FIX_ATTEMPTS = 3;
/** Disapproved by Google, as a text, an asset or its link. */
const isDisapproved = (x: { approvalStatus?: string; primaryStatusReasons?: string[] }) =>
  x.approvalStatus === 'DISAPPROVED' ||
  (x.primaryStatusReasons ?? []).includes('ASSET_DISAPPROVED');
/** Accounts where Google refused the business name asset for missing
 *  advertiser verification, with when; re-checked after a day. */
const UNVERIFIED_ACCOUNTS = new Map<string, number>();
const UNVERIFIED_RECHECK_MS = 24 * 3_600_000;
/** Keyword headlines added/rewritten per ad per run. */
const MAX_KEYWORD_HEADLINES = 4;
const STRENGTH_RANK: Record<string, number> = { POOR: 1, AVERAGE: 2, GOOD: 3, EXCELLENT: 4 };
const STRENGTH_PENDING = new Set(['PENDING', 'UNSPECIFIED', 'UNKNOWN', 'NO_ADS']);
/** Business name shown next to the ads (Google: max 25 characters). */
const BUSINESS_NAME = 'Totalvizibil';
/** Images the agent aims for per campaign: Google recommends 4 unique
 *  images with at least one square and one landscape. */
const IMAGE_TARGET = { landscape: 2, square: 2 } as const;
const IMAGE_CROPS = {
  landscape: { w: SEARCH_IMAGES.landscape.recW, h: SEARCH_IMAGES.landscape.recH },
  square: { w: SEARCH_IMAGES.square.recW, h: SEARCH_IMAGES.square.recH },
} as const;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/** English (Pexels searches best in English) name of a category. */
function englishName(nameI18n: Prisma.JsonValue | undefined): string {
  if (nameI18n && typeof nameI18n === 'object' && !Array.isArray(nameI18n)) {
    const en = (nameI18n as Record<string, unknown>).en;
    if (typeof en === 'string' && en) return en;
  }
  return plainName(nameI18n);
}

/** Ad Strength ratings the agent proposes rewrites for. */
const STRENGTH_TO_IMPROVE = new Set(['POOR', 'AVERAGE']);
/** Texts swapped per Ad Strength proposal round (each needs approval). */
const MAX_STRENGTH_SWAPS = { headline: 4, description: 2 } as const;
/** Predefined Google header (Romanian locale) for the services snippet. */
const SNIPPET_HEADER = 'Servicii';

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function plainName(nameI18n: Prisma.JsonValue | undefined): string {
  if (nameI18n && typeof nameI18n === 'object' && !Array.isArray(nameI18n)) {
    const o = nameI18n as Record<string, unknown>;
    if (typeof o.ro === 'string' && o.ro) return o.ro;
    const first = Object.values(o).find((v) => typeof v === 'string' && v);
    if (typeof first === 'string') return first;
  }
  return '';
}

/**
 * Local validation of a generated text against Google's limits and the
 * editorial rules Google enforces on ad text (no exclamation marks in
 * headlines, no excessive capitals, no phone numbers/URLs in the text).
 * Returns the reason a text is rejected, or null when it is acceptable.
 */
export function textProblem(
  text: string,
  maxChars: number,
  kind: 'headline' | 'other',
): string | null {
  const t = text.trim();
  if (!t) return 'gol';
  if ([...t].length > maxChars) return `peste ${maxChars} caractere`;
  if (kind === 'headline' && t.includes('!')) return 'semn de exclamare în titlu';
  if (/https?:|www\.|\.ro\b|\.com\b/i.test(t)) return 'conține un URL';
  if (/\d[\d\s.-]{6,}\d/.test(t)) return 'conține un număr de telefon';
  const letters = t.replace(/[^A-Za-zĂÂÎȘȚăâîșț]/g, '');
  if (letters.length >= 6 && letters === letters.toUpperCase())
    return 'scris integral cu majuscule';
  return null;
}

/** Keeps texts that pass `textProblem` and are not duplicates of `existing`
 *  or of each other (case/diacritics-insensitive). */
export function acceptTexts(
  candidates: string[],
  existing: string[],
  maxChars: number,
  kind: 'headline' | 'other',
  limit: number,
): { accepted: string[]; rejected: { text: string; reason: string }[] } {
  const seen = new Set(existing.map(fold));
  const accepted: string[] = [];
  const rejected: { text: string; reason: string }[] = [];
  for (const raw of candidates) {
    const text = raw.trim();
    const problem = textProblem(text, maxChars, kind);
    if (problem) rejected.push({ text, reason: problem });
    else if (seen.has(fold(text))) rejected.push({ text, reason: 'duplicat' });
    else if (accepted.length >= limit) rejected.push({ text, reason: 'peste numărul necesar' });
    else {
      accepted.push(text);
      seen.add(fold(text));
    }
  }
  return { accepted, rejected };
}

@Injectable()
export class GoogleAdsOptimizerService {
  protected readonly logger = new Logger(GoogleAdsOptimizerService.name);
  protected readonly frontendOrigin: string;
  /** Stock photos for image assets (Pexels license: free commercial use). */
  private readonly pexels: PexelsProvider;

  constructor(
    @Inject(GoogleAdsApiClient) protected readonly client: AdsClient,
    protected readonly ai: AiService,
    @Inject(PlatformSettingsService) protected readonly settings: OptimizerSettings,
    protected readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
    this.pexels = new PexelsProvider(config.get('pexelsApiKey', { infer: true }) ?? '');
  }

  /** Action rows table; overridden for customer campaigns. */
  protected get actions(): ActionStore {
    return this.prisma.googleAdsAgentAction;
  }

  /** The platform's own subcategory campaign as an optimization target. */
  platformTarget(mapping: MappingWithCategory): OptimizationTarget {
    return {
      owner: { categoryId: mapping.categoryId },
      name: plainName(mapping.category.nameI18n),
      parentName: mapping.category.parent ? plainName(mapping.category.parent.nameI18n) : undefined,
      imageQuery: englishName(mapping.category.nameI18n).replace(/&/g, ' ').trim(),
      landingFallback: subcategoryLandingUrl(mapping.category, this.frontendOrigin),
      businessName: BUSINESS_NAME,
      sitelinkDestinations: (exclude, count) =>
        this.platformSitelinkDestinations(mapping, exclude, count),
      onOptimized: async (googleCampaignId) => {
        await this.prisma.googleAdsCampaignSnapshot
          .update({ where: { googleCampaignId }, data: { lastOptimizedAt: new Date() } })
          .catch(() => undefined);
      },
    };
  }

  private pickRsa(c: CampaignData): RsaAd | undefined {
    return [...c.ads.filter((a) => a.status === 'ENABLED')].sort(
      (a, b) => b.headlines.length - a.headlines.length,
    )[0];
  }

  /**
   * Why the ad TEXT (RSA headlines/descriptions) of this campaign may not be
   * changed automatically right now, or null. The cooldown exists so Google
   * can evaluate new ad text before the next change; extensions (sitelinks,
   * callouts, snippets, business name) are filled whenever they are missing.
   */
  async rsaChangeBlocker(c: CampaignData): Promise<string | null> {
    const pending = await this.actions.count({
      where: {
        googleCampaignId: c.googleCampaignId,
        action: { in: RSA_TEXT_ACTIONS },
        status: 'pending_approval',
      },
    });
    if (pending) return `are ${pending} propuneri creative în așteptarea aprobării`;
    const cooldownDays = await this.settings.googleAdsAgentCreativeCooldownDays();
    const last = await this.actions.findFirst({
      where: {
        googleCampaignId: c.googleCampaignId,
        action: { in: RSA_TEXT_ACTIONS },
        status: 'applied',
        createdAt: { gte: new Date(Date.now() - cooldownDays * 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (last) {
      const next = new Date(last.createdAt.getTime() + cooldownDays * 86_400_000);
      return `ultima modificare creativă a fost pe ${last.createdAt.toLocaleDateString('ro-RO')}; Google are nevoie de timp să evalueze elementele noi (următoarea posibilă după ${next.toLocaleDateString('ro-RO')})`;
    }
    return null;
  }

  /** Real, distinct pages for sitelinks, most relevant first: parent group
   *  page, sibling subcategories, homepage, the business sign-up page, then
   *  the other service groups. Never the ad's own landing page twice. */
  private async platformSitelinkDestinations(
    mapping: MappingWithCategory,
    exclude: Set<string>,
    count: number,
  ): Promise<{ url: string; pageName: string }[]> {
    const out: { url: string; pageName: string }[] = [];
    const add = (url: string, pageName: string) => {
      if (out.length >= count || exclude.has(url) || out.some((o) => o.url === url) || !pageName)
        return;
      out.push({ url, pageName });
    };
    const cat = mapping.category;
    if (cat.parent) {
      add(
        `${this.frontendOrigin}/${cat.parent.slug}`,
        `Toate firmele din ${plainName(cat.parent.nameI18n)}`,
      );
      const siblings = await this.prisma.category.findMany({
        where: { parentId: cat.parentId, isActive: true, id: { not: cat.id } },
        include: { parent: true },
        take: 20,
      });
      for (const sib of siblings)
        add(subcategoryLandingUrl(sib, this.frontendOrigin), plainName(sib.nameI18n));
    }
    add(`${this.frontendOrigin}/`, 'Toate categoriile de servicii locale');
    add(`${this.frontendOrigin}/create`, 'Înscrie-ți firma pe platformă');
    if (out.length < count) {
      const groups = await this.prisma.category.findMany({
        where: { parentId: null, isActive: true, id: { not: cat.parentId ?? cat.id } },
        take: 20,
      });
      for (const g of groups)
        add(`${this.frontendOrigin}/${g.slug}`, `Firme din ${plainName(g.nameI18n)}`);
    }
    return out;
  }

  /**
   * Fills the creative gaps of one managed campaign, if allowed. Returns
   * what was applied (0 when nothing was needed or allowed).
   */
  async fillGaps(
    c: CampaignData,
    ev: CampaignEvaluation,
    target: OptimizationTarget,
    activity: AgentActivity,
  ): Promise<OptimizeOutcome> {
    if (!(await this.settings.googleAdsAgentAutoFillGapsEnabled())) {
      await activity.record(
        {
          googleCampaignId: c.googleCampaignId,
          campaignName: c.name,
          step: 'optimize',
          message: 'Completare automată a lipsurilor',
        },
        { status: 'skipped', result: 'Amânat: completarea automată este dezactivată din setări.' },
      );
      return { applied: 0, proposed: 0, costEstimateMinor: 0 };
    }
    const outcome = await this.fillTextGaps(c, ev, target, activity);
    outcome.applied += await this.fillImageGaps(c, ev, target, activity);
    if (outcome.applied) await target.onOptimized?.(c.googleCampaignId);
    return outcome;
  }

  /** Headlines/descriptions (cooldown-gated), sitelinks, callouts,
   *  structured snippet and business name. */
  private async fillTextGaps(
    c: CampaignData,
    ev: CampaignEvaluation,
    target: OptimizationTarget,
    activity: AgentActivity,
  ): Promise<OptimizeOutcome> {
    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const outcome: OptimizeOutcome = { applied: 0, proposed: 0, costEstimateMinor: 0 };
    const rsa = this.pickRsa(c);
    const need = {
      headlines: rsa ? Math.max(0, RSA.headlines.max - rsa.headlines.length) : 0,
      descriptions: rsa ? Math.max(0, RSA.descriptions.max - rsa.descriptions.length) : 0,
      callouts: Math.max(0, CALLOUTS.ourTarget - ev.assets.callouts.length),
      sitelinks: Math.max(0, SITELINKS.recommended - ev.assets.sitelinks.length),
      snippetValues: ev.assets.structuredSnippets ? 0 : STRUCTURED_SNIPPETS.recommendedValues,
      businessName: !!target.businessName && !ev.assets.businessName,
    };
    const total =
      need.headlines +
      need.descriptions +
      need.callouts +
      need.sitelinks +
      need.snippetValues +
      (need.businessName ? 1 : 0);
    if (!total) {
      await activity.record(
        { ...meta, step: 'optimize', message: 'Verificare lipsuri creative' },
        {
          result:
            'Nimic de completat: titluri, descrieri, sitelink-uri, callout-uri, structured snippets și numele afacerii sunt la nivelul recomandat.',
        },
      );
      return outcome;
    }
    if (need.headlines || need.descriptions) {
      const blocker = await this.rsaChangeBlocker(c);
      if (blocker) {
        await activity.record(
          { ...meta, step: 'optimize', message: 'Completare titluri și descrieri' },
          {
            status: 'skipped',
            result: `Amânat pentru textul reclamei: ${blocker}. Extensiile lipsă se completează acum.`,
            details: { headlines: need.headlines, descriptions: need.descriptions },
          },
        );
        need.headlines = 0;
        need.descriptions = 0;
      }
    }
    const needsAi =
      need.headlines + need.descriptions + need.callouts + need.sitelinks + need.snippetValues > 0;
    if (needsAi && !this.ai.configured) {
      await activity.record(
        { ...meta, step: 'optimize', message: 'Completare automată a lipsurilor' },
        {
          status: 'skipped',
          result: 'Serviciul AI nu este configurat; nu se pot genera texte noi.',
        },
      );
      return outcome;
    }

    const landingUrl = rsa?.finalUrls[0] ?? target.landingFallback;
    const destinations = need.sitelinks
      ? await target.sitelinkDestinations(
          new Set([landingUrl, ...ev.assets.sitelinks.map((s) => s.finalUrl ?? '')]),
          need.sitelinks,
        )
      : [];

    const empty: Pick<
      GoogleAdsCreativeGapFill,
      | 'headlines'
      | 'descriptions'
      | 'callouts'
      | 'snippetValues'
      | 'sitelinks'
      | 'costEstimateMinor'
    > = {
      headlines: [],
      descriptions: [],
      callouts: [],
      snippetValues: [],
      sitelinks: [],
      costEstimateMinor: 0,
    };
    const generated = !needsAi
      ? empty
      : await activity
          .step(
            { ...meta, step: 'generate', message: 'Generare texte pentru elementele lipsă' },
            async () => {
              const res = await this.ai.googleAdsCreativeGapFill({
                advertiser: target.advertiser,
                categoryName: target.name,
                parentCategoryName: target.parentName,
                landingUrl,
                existingHeadlines: rsa?.headlines.map((h) => h.text) ?? [],
                existingDescriptions: rsa?.descriptions.map((d) => d.text) ?? [],
                existingCallouts: ev.assets.callouts.map((x) => x.text),
                sitelinkDestinations: destinations,
                need: {
                  headlines: need.headlines,
                  descriptions: need.descriptions,
                  callouts: need.callouts,
                  snippetValues: need.snippetValues,
                },
              });
              if (!res) throw new Error('AI nu a returnat un răspuns utilizabil.');
              return {
                value: res,
                outcome: {
                  result: `Propuse: ${res.headlines.length} titluri, ${res.descriptions.length} descrieri, ${res.sitelinks.length} sitelink-uri, ${res.callouts.length} callout-uri, ${res.snippetValues.length} valori snippet.`,
                },
              };
            },
          )
          .catch(() => null);
    if (!generated) return outcome;
    outcome.costEstimateMinor += generated.costEstimateMinor;

    // Local validation against Google's published limits. Texts Google
    // disapproved here before count as taken, so they are never re-added.
    const policyBlocked = await this.policyBlockedTexts(c.googleCampaignId);
    const h = acceptTexts(
      generated.headlines,
      [...(rsa?.headlines.map((x) => x.text) ?? []), ...policyBlocked],
      RSA.headlines.maxChars,
      'headline',
      need.headlines,
    );
    const d = acceptTexts(
      generated.descriptions,
      [...(rsa?.descriptions.map((x) => x.text) ?? []), ...policyBlocked],
      RSA.descriptions.maxChars,
      'other',
      need.descriptions,
    );
    const co = acceptTexts(
      generated.callouts,
      [...ev.assets.callouts.map((x) => x.text), ...policyBlocked],
      CALLOUTS.maxChars,
      'other',
      need.callouts,
    );
    const sn = acceptTexts(
      generated.snippetValues ?? [],
      policyBlocked,
      STRUCTURED_SNIPPETS.valueMaxChars,
      'other',
      need.snippetValues,
    );
    // Google requires at least 3 values; fewer means no snippet this time.
    const snippetValues = sn.accepted.length >= STRUCTURED_SNIPPETS.minValues ? sn.accepted : [];
    const existingLinkTexts = [...ev.assets.sitelinks.map((s) => s.linkText), ...policyBlocked];
    const sl = generated.sitelinks.filter((s) => {
      if (textProblem(s.linkText, SITELINKS.linkTextMaxChars, 'other')) return false;
      if (
        [s.description1, s.description2].some(
          (x) => x && textProblem(x, SITELINKS.descriptionMaxChars, 'other'),
        )
      )
        return false;
      if (existingLinkTexts.some((e) => fold(e) === fold(s.linkText))) return false;
      existingLinkTexts.push(s.linkText);
      return true;
    });
    const rejected = [...h.rejected, ...d.rejected, ...co.rejected, ...sn.rejected];
    await activity.record(
      {
        ...meta,
        step: 'validate_local',
        message: 'Validare față de cerințele Google (lungime, duplicate, reguli editoriale)',
      },
      {
        result:
          `Acceptate: ${h.accepted.length} titluri, ${d.accepted.length} descrieri, ${sl.length} sitelink-uri, ${co.accepted.length} callout-uri, ${snippetValues.length} valori snippet` +
          (rejected.length
            ? `; respinse ${rejected.length} (${rejected
                .slice(0, 3)
                .map((r) => `„${r.text}”: ${r.reason}`)
                .join('; ')}).`
            : '.'),
        details: { rejected } as unknown as Prisma.InputJsonValue,
      },
    );

    const reasoning = ev.issues
      .filter((i) => i.autoFixable)
      .map((i) => i.title)
      .join('; ');

    // Batch 1: the RSA itself (only fields that actually change).
    if (rsa && (h.accepted.length || d.accepted.length)) {
      const before = {
        headlines: rsa.headlines.map((x) => x.text),
        descriptions: rsa.descriptions.map((x) => x.text),
      };
      const headlines = [
        ...rsa.headlines.map((x) => ({
          text: x.text,
          ...(x.pinnedField ? { pinnedField: x.pinnedField } : {}),
        })),
        ...h.accepted.map((text) => ({ text })),
      ];
      const descriptions = [
        ...rsa.descriptions.map((x) => ({
          text: x.text,
          ...(x.pinnedField ? { pinnedField: x.pinnedField } : {}),
        })),
        ...d.accepted.map((text) => ({ text })),
      ];
      const mask = [
        ...(h.accepted.length ? ['responsive_search_ad.headlines'] : []),
        ...(d.accepted.length ? ['responsive_search_ad.descriptions'] : []),
      ].join(',');
      const ops: GoogleAdsMutateOperation[] = [
        {
          adOperation: {
            update: {
              resourceName: rsa.adResourceName,
              responsiveSearchAd: {
                ...(h.accepted.length ? { headlines } : {}),
                ...(d.accepted.length ? { descriptions } : {}),
              },
            },
            updateMask: mask,
          },
        },
      ];
      const ok = await this.executeChange({
        c,
        target,
        activity,
        action: 'creative.rsa_gap_fill',
        adId: rsa.adResourceName.split('/').pop(),
        label: `Adăugare ${h.accepted.length} titluri și ${d.accepted.length} descrieri în reclama RSA`,
        ops,
        before,
        after: {
          headlines: [...before.headlines, ...h.accepted],
          descriptions: [...before.descriptions, ...d.accepted],
          added: { headlines: h.accepted, descriptions: d.accepted },
        },
        reasoning: `Completare automată a lipsurilor (${reasoning}). Textele existente rămân neschimbate.`,
        verify: async () => {
          const rows = await this.client.search(
            'SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions ' +
              `FROM ad_group_ad WHERE ad_group_ad.ad.id = ${rsa.adResourceName.split('/').pop()}`,
          );
          const ad = rows[0]?.adGroupAd as
            | {
                ad?: {
                  responsiveSearchAd?: {
                    headlines?: { text?: string }[];
                    descriptions?: { text?: string }[];
                  };
                };
              }
            | undefined;
          const live = new Set([
            ...(ad?.ad?.responsiveSearchAd?.headlines ?? []).map((x) => x.text),
            ...(ad?.ad?.responsiveSearchAd?.descriptions ?? []).map((x) => x.text),
          ]);
          const missing = [...h.accepted, ...d.accepted].filter((t) => !live.has(t));
          return missing.length ? `Lipsesc după aplicare: ${missing.join(', ')}` : null;
        },
      });
      if (ok) outcome.applied++;
    }

    // The business name asset needs Google's advertiser verification
    // (CUSTOMER_NOT_VERIFIED otherwise) and the batch below is atomic: one
    // refused asset would block every sitelink/callout/snippet with it.
    if (need.businessName && !(await this.businessNameAllowed(c, target.businessName!, activity))) {
      need.businessName = false;
    }

    // Batch 2: extensions (sitelinks, callouts, structured snippet, business
    // name), created and attached in one atomic call.
    if (sl.length || co.accepted.length || snippetValues.length || need.businessName) {
      const ops: GoogleAdsMutateOperation[] = [];
      const links: GoogleAdsMutateOperation[] = [];
      let tempId = -1;
      const customer = `customers/${this.client.customerId}`;
      for (const s of sl) {
        const res = `${customer}/assets/${tempId--}`;
        ops.push({
          assetOperation: {
            create: {
              resourceName: res,
              finalUrls: [s.url],
              sitelinkAsset: {
                linkText: s.linkText,
                ...(s.description1 && s.description2
                  ? { description1: s.description1, description2: s.description2 }
                  : {}),
              },
            },
          },
        });
        links.push({
          campaignAssetOperation: {
            create: { campaign: c.resourceName, asset: res, fieldType: 'SITELINK' },
          },
        });
      }
      for (const text of co.accepted) {
        const res = `${customer}/assets/${tempId--}`;
        ops.push({
          assetOperation: { create: { resourceName: res, calloutAsset: { calloutText: text } } },
        });
        links.push({
          campaignAssetOperation: {
            create: { campaign: c.resourceName, asset: res, fieldType: 'CALLOUT' },
          },
        });
      }
      if (snippetValues.length) {
        const res = `${customer}/assets/${tempId--}`;
        ops.push({
          assetOperation: {
            create: {
              resourceName: res,
              structuredSnippetAsset: { header: SNIPPET_HEADER, values: snippetValues },
            },
          },
        });
        links.push({
          campaignAssetOperation: {
            create: { campaign: c.resourceName, asset: res, fieldType: 'STRUCTURED_SNIPPET' },
          },
        });
      }
      if (need.businessName) {
        const res = `${customer}/assets/${tempId--}`;
        ops.push({
          assetOperation: {
            create: { resourceName: res, textAsset: { text: target.businessName! } },
          },
        });
        links.push({
          campaignAssetOperation: {
            create: { campaign: c.resourceName, asset: res, fieldType: 'BUSINESS_NAME' },
          },
        });
      }
      const parts = [
        sl.length && `${sl.length} sitelink-uri`,
        co.accepted.length && `${co.accepted.length} callout-uri`,
        snippetValues.length && `un structured snippet (${snippetValues.length} servicii)`,
        need.businessName && `numele afacerii „${target.businessName}”`,
      ].filter(Boolean) as string[];
      const ok = await this.executeChange({
        c,
        target,
        activity,
        action: 'creative.assets_gap_fill',
        label: `Adăugare ${parts.join(', ')}`,
        ops: [...ops, ...links],
        before: {
          sitelinks: ev.assets.sitelinks.map((s) => s.linkText),
          callouts: ev.assets.callouts.map((x) => x.text),
          structuredSnippets: ev.assets.structuredSnippets,
          businessName: ev.assets.businessName,
        },
        after: {
          added: {
            sitelinks: sl,
            callouts: co.accepted,
            ...(snippetValues.length
              ? { structuredSnippet: { header: SNIPPET_HEADER, values: snippetValues } }
              : {}),
            ...(need.businessName ? { businessName: target.businessName } : {}),
          },
        },
        reasoning: `Completare automată a lipsurilor (${reasoning}). Fiecare sitelink duce la o pagină reală diferită; extensiile existente rămân neschimbate.`,
        verify: async () => {
          const rows = await this.client.search(
            'SELECT campaign.id, campaign_asset.status, campaign_asset.field_type, asset.sitelink_asset.link_text, asset.callout_asset.callout_text, ' +
              'asset.structured_snippet_asset.values, asset.text_asset.text ' +
              `FROM campaign_asset WHERE campaign.id = ${c.googleCampaignId} AND campaign_asset.status != 'REMOVED'`,
          );
          const live = new Set(
            rows.flatMap((r) => {
              const a = r.asset as
                | {
                    sitelinkAsset?: { linkText?: string };
                    calloutAsset?: { calloutText?: string };
                    structuredSnippetAsset?: { values?: string[] };
                    textAsset?: { text?: string };
                  }
                | undefined;
              return [
                a?.sitelinkAsset?.linkText,
                a?.calloutAsset?.calloutText,
                a?.textAsset?.text,
                ...(a?.structuredSnippetAsset?.values ?? []),
              ];
            }),
          );
          const missing = [
            ...sl.map((s) => s.linkText),
            ...co.accepted,
            ...snippetValues,
            ...(need.businessName ? [target.businessName!] : []),
          ].filter((t) => !live.has(t));
          return missing.length ? `Lipsesc după aplicare: ${missing.join(', ')}` : null;
        },
      });
      if (ok) outcome.applied++;
    }

    return outcome;
  }

  /**
   * Whether Google accepts a BUSINESS_NAME asset on this account, checked
   * with a validateOnly call (nothing is created). Google refuses it with
   * CUSTOMER_NOT_VERIFIED until the advertiser verification is completed;
   * that answer is remembered per account for a day, so every campaign in
   * every cycle doesn't ask again. Any other error answers true, so the
   * normal path reports it.
   */
  private async businessNameAllowed(
    c: CampaignData,
    businessName: string,
    activity: AgentActivity,
  ): Promise<boolean> {
    const account = this.client.customerId;
    const refusedAt = UNVERIFIED_ACCOUNTS.get(account);
    let refused = refusedAt !== undefined && Date.now() - refusedAt < UNVERIFIED_RECHECK_MS;
    if (!refused) {
      const res = `customers/${account}/assets/-1`;
      try {
        await this.client.mutate(
          [
            {
              assetOperation: { create: { resourceName: res, textAsset: { text: businessName } } },
            },
            {
              campaignAssetOperation: {
                create: { campaign: c.resourceName, asset: res, fieldType: 'BUSINESS_NAME' },
              },
            },
          ],
          { validateOnly: true },
        );
        UNVERIFIED_ACCOUNTS.delete(account);
        return true;
      } catch (err) {
        if (!/CUSTOMER_NOT_VERIFIED/.test(err instanceof Error ? err.message : String(err)))
          return true;
        UNVERIFIED_ACCOUNTS.set(account, Date.now());
        refused = true;
      }
    }
    await activity.record(
      {
        googleCampaignId: c.googleCampaignId,
        campaignName: c.name,
        step: 'optimize',
        message: 'Extensia „nume afacere”',
      },
      {
        status: 'skipped',
        result:
          'Google cere verificarea advertiserului pentru numele afacerii (CUSTOMER_NOT_VERIFIED). ' +
          'Sitelink-urile, callout-urile și snippet-urile se adaugă normal; numele afacerii se adaugă automat după ce contul e verificat în Google Ads.',
      },
    );
    return false;
  }

  /**
   * Missing image assets (Search): real Pexels photos matching the
   * subcategory, cropped by the Pexels CDN to exactly Google's recommended
   * 1200×628 (landscape) and 1200×1200 (square), uploaded and attached to
   * the campaign in one atomic call, then verified by re-reading Google.
   * A photo is never reused for the same campaign. Returns 1 when applied.
   */
  private async fillImageGaps(
    c: CampaignData,
    ev: CampaignEvaluation,
    target: OptimizationTarget,
    activity: AgentActivity,
  ): Promise<number> {
    if (c.channelType !== 'SEARCH' || !this.pexels.configured) return 0;
    const valid = ev.assets.images.filter((i) => i.valid);
    const count = (prefix: string) => valid.filter((i) => i.format.startsWith(prefix)).length;
    const need = {
      landscape: Math.max(0, IMAGE_TARGET.landscape - count('peisaj')),
      square: Math.max(0, IMAGE_TARGET.square - count('pătrat')),
    };
    if (!need.landscape && !need.square) return 0;
    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const query = target.imageQuery;

    const previous = await this.actions.findMany({
      where: { googleCampaignId: c.googleCampaignId, action: 'creative.images_gap_fill' },
      select: { after: true },
    });
    const used = new Set<number>(
      previous.flatMap((a) =>
        (
          (a.after as { added?: { images?: { pexelsId?: number }[] } } | null)?.added?.images ?? []
        ).map((x) => x.pexelsId ?? 0),
      ),
    );

    const picked = await activity
      .step(
        {
          ...meta,
          step: 'generate',
          message: `Căutare imagini pe Pexels („${query}”)`,
        },
        async () => {
          const out: {
            photo: PexelsPhoto;
            format: 'landscape' | 'square';
            data: string;
          }[] = [];
          for (const format of ['landscape', 'square'] as const) {
            if (!need[format]) continue;
            const crop = IMAGE_CROPS[format];
            const { photos } = await this.pexels.search(query, {
              orientation: format,
              perPage: 30,
            });
            for (const photo of photos) {
              if (out.filter((o) => o.format === format).length >= need[format]) break;
              if (used.has(photo.id) || !photo.src.original) continue;
              // The original must be large enough to crop without upscaling.
              if (photo.width < crop.w || photo.height < crop.h) continue;
              const data = await this.downloadCrop(photo.src.original, crop.w, crop.h);
              if (!data) continue;
              used.add(photo.id);
              out.push({ photo, format, data });
            }
          }
          if (!out.length) throw new Error('Pexels nu a returnat imagini potrivite.');
          return {
            value: out,
            outcome: {
              result:
                `${out.length} imagini alese: ` +
                out
                  .map(
                    (o) =>
                      `${o.format === 'square' ? '1200×1200' : '1200×628'} „${o.photo.alt || o.photo.id}” (${o.photo.photographer})`,
                  )
                  .join('; ') +
                '.',
            },
          };
        },
      )
      .catch(() => null);
    if (!picked) return 0;

    const customer = `customers/${this.client.customerId}`;
    const ops: GoogleAdsMutateOperation[] = [];
    const links: GoogleAdsMutateOperation[] = [];
    const names: string[] = [];
    picked.forEach((p, i) => {
      const crop = IMAGE_CROPS[p.format];
      const res = `${customer}/assets/${-(i + 1)}`;
      const name = `TVZ ${c.googleCampaignId} Pexels ${p.photo.id} ${crop.w}x${crop.h}`;
      names.push(name);
      ops.push({
        assetOperation: { create: { resourceName: res, name, imageAsset: { data: p.data } } },
      });
      links.push({
        campaignAssetOperation: {
          create: { campaign: c.resourceName, asset: res, fieldType: 'AD_IMAGE' },
        },
      });
    });
    const added = picked.map((p) => ({
      pexelsId: p.photo.id,
      format: p.format === 'square' ? '1200×1200' : '1200×628',
      alt: p.photo.alt,
      photographer: p.photo.photographer,
      pexelsUrl: p.photo.url,
    }));
    const ok = await this.executeChange({
      c,
      target,
      activity,
      action: 'creative.images_gap_fill',
      label: `Adăugare ${picked.length} imagini (Pexels)`,
      ops: [...ops, ...links],
      before: { images: valid.map((i) => `${i.width}×${i.height}`) },
      after: { added: { images: added } },
      reasoning:
        `Campania are ${valid.length} imagini valide; Google recomandă 4 imagini unice, cel puțin una pătrată și una peisaj. ` +
        'Fotografii reale de pe Pexels (licență gratuită pentru uz comercial), decupate exact la dimensiunile recomandate de Google.',
      // By resource name, not asset name: Google deduplicates identical
      // image content and then keeps the EXISTING asset (and its old name).
      verify: async (results) => {
        const linked = results
          .map((r) => r.campaignAssetResult?.resourceName)
          .filter((x): x is string => !!x);
        if (linked.length < names.length)
          return 'Google nu a confirmat atașarea tuturor imaginilor.';
        const rows = await this.client.search(
          'SELECT campaign.id, campaign_asset.resource_name, campaign_asset.status FROM campaign_asset ' +
            `WHERE campaign.id = ${c.googleCampaignId} AND campaign_asset.field_type = 'AD_IMAGE' AND campaign_asset.status != 'REMOVED'`,
        );
        const live = new Set(
          rows.map((r) => (r.campaignAsset as { resourceName?: string } | undefined)?.resourceName),
        );
        const missing = linked.filter((n) => !live.has(n));
        return missing.length
          ? `${missing.length} imagini nu apar atașate la campanie după aplicare.`
          : null;
      },
    });
    return ok ? 1 : 0;
  }

  /** Downloads a Pexels photo cropped by its CDN to exactly w×h (JPEG),
   *  base64-encoded; null when it fails or exceeds Google's 5 MB limit. */
  private async downloadCrop(original: string, w: number, h: number): Promise<string | null> {
    try {
      const url = `${original}?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > SEARCH_IMAGES.maxFileBytes) return null;
      return buf.toString('base64');
    } catch {
      return null;
    }
  }

  /**
   * validateOnly → (writes allowed?) mutate → verify → history row.
   * Returns true only when the change was applied AND verified live.
   */
  private async executeChange(p: {
    c: CampaignData;
    target: OptimizationTarget;
    activity: AgentActivity;
    action: string;
    label: string;
    ops: GoogleAdsMutateOperation[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    reasoning: string;
    /** Gets Google's mutate results (resource names of what was created). */
    verify: (results: GoogleAdsMutateResult[]) => Promise<string | null>;
    /** The ad changed by this batch, for the Ad Strength read-back. */
    adId?: string;
    /** Called with the history row id once the change is applied + verified. */
    onApplied?: (actionId: string) => void;
  }): Promise<boolean> {
    const meta = { googleCampaignId: p.c.googleCampaignId, campaignName: p.c.name };
    const validated = await p.activity
      .step(
        {
          ...meta,
          step: 'validate_google',
          message: `Validare la Google (fără aplicare): ${p.label}`,
        },
        async () => {
          await this.client.mutate(p.ops, { validateOnly: true });
          return {
            value: true,
            outcome: { result: `Google a acceptat toate cele ${p.ops.length} operații.` },
          };
        },
      )
      .catch(() => false);
    if (!validated) return false;

    if (!this.client.writesAllowed) {
      await p.activity.record(
        { ...meta, step: 'apply', message: p.label },
        {
          status: 'skipped',
          result:
            'Mediu non-producție: scrierile în contul Google Ads sunt blocate. Modificarea a fost validată de Google, dar nu a fost aplicată.',
          details: { before: p.before, after: p.after } as Prisma.InputJsonValue,
        },
      );
      return false;
    }

    let error: string | null = null;
    try {
      const results = await p.activity.step(
        { ...meta, step: 'apply', message: p.label },
        async () => ({
          value: await this.client.mutate(p.ops),
          outcome: { result: 'Trimis la Google, răspuns de succes.' },
        }),
      );
      const problem = await p.activity.step(
        { ...meta, step: 'verify', message: 'Verificare: recitire din Google după aplicare' },
        async () => {
          const prob = await p.verify(results ?? []);
          if (prob) throw new Error(prob);
          return {
            value: null,
            outcome: { result: 'Confirmat: modificarea este vizibilă în contul Google Ads.' },
          };
        },
      );
      error = problem;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const created = await this.actions.create({
      data: {
        ...ownerFields(p.target),
        googleCampaignId: p.c.googleCampaignId,
        action: p.action,
        status: error ? 'failed' : 'applied',
        before: p.before as Prisma.InputJsonValue,
        after: p.after as Prisma.InputJsonValue,
        reasoning: p.reasoning,
        verifiedAt: error ? null : new Date(),
        errorMessage: error,
        executionResult: error ? null : `Confirmat în Google: ${p.label.toLowerCase()}.`,
        // Baseline for the 30-day performance observation (real synced data).
        metricsAtApply: { ...p.c.current } as Prisma.InputJsonValue,
      },
    });
    if (!error && created?.action === 'creative.rsa_gap_fill' && p.adId) {
      this.scheduleStrengthReadback(created.id, p.adId);
    }
    if (!error && created?.id) p.onApplied?.(created.id);
    return !error;
  }

  /**
   * Policy compliance, run BEFORE any other optimization of a campaign and
   * not subject to the creative cooldown (a disapproved element blocks
   * serving, so it is fixed right away):
   *  - ad texts (RSA headlines/descriptions) Google disapproved are rewritten
   *    by AI from the policy topics Google gave; Google's validation is the
   *    feedback loop: if it rejects the rewrite for policy too, the rejection
   *    is fed back and the texts are rewritten again (bounded); as a last
   *    resort a disapproved text is removed when the ad keeps Google's
   *    minimum (3 headlines, 2 descriptions);
   *  - disapproved campaign/ad-group assets (sitelinks, callouts, snippets,
   *    images…) are unlinked; gap filling, which already counts them as
   *    missing, adds compliant replacements and never reuses a text Google
   *    rejected;
   *  - disapproved keywords (they never serve) are removed;
   *  - what text cannot fix (a disapproved ad with approved texts, e.g. a
   *    destination problem; shared account-level assets) is reported.
   */
  async fixPolicyViolations(
    c: CampaignData,
    target: OptimizationTarget,
    activity: AgentActivity,
  ): Promise<OptimizeOutcome> {
    const outcome: OptimizeOutcome = { applied: 0, proposed: 0, costEstimateMinor: 0 };
    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const ads = c.ads.filter((a) => a.status === 'ENABLED');
    const adFixes = ads
      .map((ad) => ({
        ad,
        items: [
          ...ad.headlines.filter(isDisapproved).map((t) => ({
            kind: 'headline' as const,
            text: t.text,
            topics: t.policyTopics ?? [],
          })),
          ...ad.descriptions.filter(isDisapproved).map((t) => ({
            kind: 'description' as const,
            text: t.text,
            topics: t.policyTopics ?? [],
          })),
        ],
      }))
      .filter((f) => f.items.length);
    const badAssets = c.assets.filter(
      (a) =>
        (a.level === 'campaign' || a.level === 'ad_group') &&
        !!a.linkResourceName &&
        isDisapproved(a),
    );
    const accountBad = c.assets.filter((a) => a.level === 'account' && isDisapproved(a));
    const badKeywords = c.disapprovedKeywords ?? [];
    const adOnly = ads.filter(
      (a) => a.approvalStatus === 'DISAPPROVED' && !adFixes.some((f) => f.ad === a),
    );

    if (
      !adFixes.length &&
      !badAssets.length &&
      !badKeywords.length &&
      !adOnly.length &&
      !accountBad.length
    ) {
      await activity.record(
        { ...meta, step: 'policy_fix', message: 'Conformitate cu politicile Google' },
        { result: 'Niciun element respins de Google în această campanie.' },
      );
      return outcome;
    }

    for (const f of adFixes) {
      const r = await this.fixDisapprovedAdTexts(c, target, activity, f.ad, f.items);
      outcome.applied += r.applied;
      outcome.costEstimateMinor += r.costEstimateMinor;
    }

    if (badAssets.length) {
      const describe = (a: LinkedAsset) =>
        `${a.fieldType}${a.text ? ` „${a.text}”` : a.sitelink ? ` „${a.sitelink.linkText}”` : ''}` +
        (a.policyTopics?.length ? ` (${a.policyTopics.join(', ')})` : '');
      const removed = new Set(badAssets.map((a) => a.linkResourceName!));
      const ok = await this.executeChange({
        c,
        target,
        activity,
        action: 'policy.remove_asset',
        label: `Eliminare ${badAssets.length} extensii respinse de Google`,
        ops: badAssets.map((a) =>
          a.level === 'campaign'
            ? { campaignAssetOperation: { remove: a.linkResourceName } }
            : { adGroupAssetOperation: { remove: a.linkResourceName } },
        ),
        before: {
          assets: badAssets.map((a) => ({
            fieldType: a.fieldType,
            text: a.text ?? a.sitelink?.linkText ?? null,
            topics: a.policyTopics ?? [],
          })),
          // Only texts that were the problem are never reused: a rejection
          // for the destination alone (e.g. DESTINATION_NOT_WORKING while
          // the site was down) says nothing about the text.
          texts: badAssets
            .filter(
              (a) =>
                !a.policyTopics?.length || a.policyTopics.some((t) => !t.startsWith('DESTINATION')),
            )
            .map((a) => a.text ?? a.sitelink?.linkText)
            .filter((t): t is string => !!t),
        },
        after: { removed: badAssets.length },
        reasoning:
          `Google a respins (politici): ${badAssets.map(describe).join('; ')}. ` +
          'Extensiile respinse nu se afișează și pot limita campania; sunt înlocuite cu variante conforme la completarea lipsurilor.',
        verify: async () => {
          const still: string[] = [];
          for (const level of ['campaign_asset', 'ad_group_asset'] as const) {
            const rows = await this.client.search(
              `SELECT ${level}.resource_name FROM ${level} ` +
                `WHERE campaign.id = ${c.googleCampaignId} AND ${level}.status != 'REMOVED'`,
            );
            for (const r of rows) {
              const link = (level === 'campaign_asset' ? r.campaignAsset : r.adGroupAsset) as
                { resourceName?: string } | undefined;
              if (link?.resourceName && removed.has(link.resourceName))
                still.push(link.resourceName);
            }
          }
          return still.length ? `${still.length} extensii încă legate de campanie` : null;
        },
      });
      if (ok) outcome.applied++;
    }

    if (badKeywords.length) {
      const removed = new Set(badKeywords.map((k) => k.resourceName));
      const ok = await this.executeChange({
        c,
        target,
        activity,
        action: 'policy.remove_keyword',
        label: `Eliminare ${badKeywords.length} cuvinte cheie respinse de Google`,
        ops: badKeywords.map((k) => ({ adGroupCriterionOperation: { remove: k.resourceName } })),
        before: { keywords: badKeywords.map((k) => k.text), texts: [] },
        after: { removed: badKeywords.length },
        reasoning:
          `Google a respins cuvintele cheie: ${badKeywords.map((k) => `„${k.text}”`).join(', ')}. ` +
          'Un cuvânt cheie respins nu declanșează reclame; eliminarea lui nu reduce acoperirea.',
        verify: async () => {
          const rows = await this.client.search(
            'SELECT ad_group_criterion.resource_name FROM ad_group_criterion ' +
              `WHERE campaign.id = ${c.googleCampaignId} AND ad_group_criterion.status != 'REMOVED' ` +
              "AND ad_group_criterion.type = 'KEYWORD'",
          );
          const still = rows
            .map((r) => (r.adGroupCriterion as { resourceName?: string } | undefined)?.resourceName)
            .filter((n): n is string => !!n && removed.has(n));
          return still.length ? `${still.length} cuvinte cheie încă active` : null;
        },
      });
      if (ok) outcome.applied++;
    }

    if (adOnly.length || accountBad.length) {
      const topics = [
        ...new Set([
          ...adOnly.flatMap((a) => a.policyTopics ?? []),
          ...accountBad.flatMap((a) => a.policyTopics ?? []),
        ]),
      ];
      await activity.record(
        { ...meta, step: 'policy_fix', message: 'Probleme de politică ce nu țin de text' },
        {
          status: 'skipped',
          result:
            (adOnly.length
              ? `${adOnly.length} reclame respinse fără texte respinse (cauza e de obicei pagina de destinație sau contul). `
              : '') +
            (accountBad.length
              ? `${accountBad.length} extensii de cont respinse (comune tuturor campaniilor, nu sunt modificate automat). `
              : '') +
            (topics.length ? `Politici indicate de Google: ${topics.join(', ')}. ` : '') +
            'Necesită verificare manuală în Google Ads.',
        },
      );
    }
    return outcome;
  }

  /** Texts Google disapproved on this campaign in the last 90 days (from the
   *  agent's own policy fixes), so they are never written again. */
  async policyBlockedTexts(googleCampaignId: string): Promise<string[]> {
    // Best-effort: a history read failure must never stop the fix itself.
    const rows = await Promise.resolve()
      .then(() =>
        this.actions.findMany({
          where: {
            googleCampaignId,
            action: { in: ['policy.fix_text', 'policy.remove_asset'] },
            createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
          },
          select: { before: true },
          take: 100,
        }),
      )
      .catch(() => [] as { before: Prisma.JsonValue }[]);
    return rows.flatMap((r) => {
      const texts = (r.before as { texts?: unknown } | null)?.texts;
      return Array.isArray(texts) ? texts.filter((t): t is string => typeof t === 'string') : [];
    });
  }

  /** Rewrites (or, as a last resort, removes) the disapproved texts of one
   *  RSA, with Google's validation fed back to the AI on policy rejection. */
  private async fixDisapprovedAdTexts(
    c: CampaignData,
    target: OptimizationTarget,
    activity: AgentActivity,
    ad: RsaAd,
    items: { kind: 'headline' | 'description'; text: string; topics: string[] }[],
  ): Promise<OptimizeOutcome> {
    const outcome: OptimizeOutcome = { applied: 0, proposed: 0, costEstimateMinor: 0 };
    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const badSet = new Set(items.map((i) => i.text));
    const others = [...ad.headlines, ...ad.descriptions]
      .map((t) => t.text)
      .filter((t) => !badSet.has(t));
    const blocked = new Set(
      [...(await this.policyBlockedTexts(c.googleCampaignId)), ...badSet].map(fold),
    );
    const topics = [...new Set(items.flatMap((i) => i.topics))];

    /** The ad update replacing each bad text with `rep.get(text)`; a bad
     *  text with no replacement is dropped while the field stays at
     *  Google's minimum, otherwise kept. */
    const build = (rep: Map<string, string>) => {
      const removed: string[] = [];
      const field = (list: RsaAd['headlines'], min: number) => {
        let size = list.length;
        const out: { text: string; pinnedField?: string }[] = [];
        for (const x of list) {
          const pin = x.pinnedField ? { pinnedField: x.pinnedField } : {};
          if (!badSet.has(x.text)) out.push({ text: x.text, ...pin });
          else if (rep.has(x.text)) out.push({ text: rep.get(x.text)!, ...pin });
          else if (size > min) {
            size--;
            removed.push(x.text);
          } else out.push({ text: x.text, ...pin });
        }
        const changed = out.length !== list.length || out.some((o, i) => o.text !== list[i]?.text);
        return { out, changed };
      };
      const h = field(ad.headlines, RSA.headlines.min);
      const d = field(ad.descriptions, RSA.descriptions.min);
      const mask = [
        ...(h.changed ? ['responsive_search_ad.headlines'] : []),
        ...(d.changed ? ['responsive_search_ad.descriptions'] : []),
      ].join(',');
      const ops: GoogleAdsMutateOperation[] = mask
        ? [
            {
              adOperation: {
                update: {
                  resourceName: ad.adResourceName,
                  responsiveSearchAd: {
                    ...(h.changed ? { headlines: h.out } : {}),
                    ...(d.changed ? { descriptions: d.out } : {}),
                  },
                },
                updateMask: mask,
              },
            },
          ]
        : [];
      return { ops, removed };
    };

    let rep = new Map<string, string>();
    let feedback: string | undefined;
    let plan: { ops: GoogleAdsMutateOperation[]; removed: string[] } | null = null;
    for (let attempt = 1; attempt <= POLICY_FIX_ATTEMPTS && this.ai.configured; attempt++) {
      const gen = await activity
        .step(
          {
            ...meta,
            step: 'generate',
            message:
              attempt === 1
                ? `Rescriere ${items.length} texte respinse de Google (${topics.join(', ') || 'politici'})`
                : `Rescriere din nou după feedback-ul Google (încercarea ${attempt})`,
          },
          async () => {
            const r = await this.ai.googleAdsPolicyFixTexts({
              advertiser: target.advertiser,
              categoryName: target.name,
              landingUrl: ad.finalUrls[0] ?? target.landingFallback,
              items,
              otherTexts: others,
              googleFeedback: feedback,
            });
            if (!r) throw new Error('AI nu a returnat un răspuns utilizabil.');
            return {
              value: r,
              outcome: {
                result: items
                  .map(
                    (it, i) =>
                      `„${it.text}” → ${r.texts[i] ? `„${r.texts[i]}”` : '(fără variantă)'}`,
                  )
                  .join('; '),
              },
            };
          },
        )
        .catch(() => null);
      if (!gen) break;
      outcome.costEstimateMinor += gen.costEstimateMinor;
      rep = new Map();
      const used = new Set(others.map(fold));
      items.forEach((it, i) => {
        const t = gen.texts[i];
        if (!t) return;
        const max = it.kind === 'headline' ? RSA.headlines.maxChars : RSA.descriptions.maxChars;
        if (textProblem(t, max, it.kind === 'headline' ? 'headline' : 'other')) return;
        if (used.has(fold(t)) || blocked.has(fold(t))) return;
        used.add(fold(t));
        rep.set(it.text, t);
      });
      const candidate = build(rep);
      if (!candidate.ops.length) break;
      try {
        await this.client.mutate(candidate.ops, { validateOnly: true });
        plan = candidate;
        break;
      } catch (err) {
        const findings = policyFindingsOf(err);
        await activity.record(
          { ...meta, step: 'validate_google', message: 'Validare la Google a textelor rescrise' },
          { status: 'failed', result: err instanceof Error ? err.message : String(err) },
        );
        if (!findings.length) break;
        // The rewrite broke a policy too: never reuse it, tell the AI why.
        for (const t of rep.values()) blocked.add(fold(t));
        feedback = findings
          .map((f) => `${f.message}${f.topics.length ? ` (${f.topics.join(', ')})` : ''}`)
          .join('; ');
      }
    }
    // Last resort: drop what could not be rewritten, if the ad stays valid.
    if (!plan) {
      rep = new Map();
      const fallback = build(rep);
      if (fallback.ops.length) plan = fallback;
    }
    if (!plan) {
      await activity.record(
        { ...meta, step: 'policy_fix', message: 'Texte respinse de Google' },
        {
          status: 'failed',
          result:
            `Nu s-a găsit o variantă conformă pentru: ${items.map((i) => `„${i.text}”`).join(', ')}, ` +
            'iar eliminarea lor ar coborî reclama sub minimul Google. Necesită intervenție manuală.',
        },
      );
      return outcome;
    }
    const finalPlan = plan;
    const replaced = [...rep.entries()].map(([from, to]) => ({ from, to }));
    const expected = replaced.map((r) => r.to);
    const gone = [...replaced.map((r) => r.from), ...finalPlan.removed];
    const adId = ad.adResourceName.split('/').pop();
    const ok = await this.executeChange({
      c,
      target,
      activity,
      action: 'policy.fix_text',
      adId,
      label:
        `Corectare texte respinse de Google: ${replaced.length} rescrise` +
        (finalPlan.removed.length ? `, ${finalPlan.removed.length} eliminate` : ''),
      ops: finalPlan.ops,
      before: { adResourceName: ad.adResourceName, texts: items.map((i) => i.text), topics },
      after: { replaced, removed: finalPlan.removed },
      reasoning:
        `Google a respins (DISAPPROVED) ${items.length} texte ale reclamei pentru politicile: ${topics.join(', ') || 'nespecificate'}. ` +
        'Un text respins nu se afișează și poate bloca reclama, așa că este corectat imediat, fără așteptarea perioadei dintre modificări.',
      verify: async () => {
        const rows = await this.client.search(
          'SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions ' +
            `FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId}`,
        );
        const live = rows[0]?.adGroupAd as
          | {
              ad?: {
                responsiveSearchAd?: {
                  headlines?: { text?: string }[];
                  descriptions?: { text?: string }[];
                };
              };
            }
          | undefined;
        const texts = new Set([
          ...(live?.ad?.responsiveSearchAd?.headlines ?? []).map((x) => x.text),
          ...(live?.ad?.responsiveSearchAd?.descriptions ?? []).map((x) => x.text),
        ]);
        const missing = expected.filter((t) => !texts.has(t));
        const stuck = gone.filter((t) => texts.has(t));
        if (missing.length) return `Lipsesc după aplicare: ${missing.join(', ')}`;
        if (stuck.length) return `Încă prezente: ${stuck.join(', ')}`;
        return null;
      },
    });
    if (ok) outcome.applied++;
    return outcome;
  }

  /**
   * Headline keyword monitoring: checks whether the ad group's keywords
   * appear (whole, word for word) in the ad's headlines. When some are
   * missing AND that holds Ad Strength below EXCELLENT (Google's own action
   * item says so, or most keywords are absent), it writes headlines that
   * carry the missing keywords: added when the ad has room, otherwise
   * replacing the weakest headlines that have no keyword (never pinned,
   * never BEST/GOOD). Same safety path as every write (local validation →
   * validateOnly → mutate → re-read), then Ad Strength is read back from
   * Google and the previous headlines are restored if it got worse.
   */
  async fixHeadlineKeywords(
    c: CampaignData,
    target: OptimizationTarget,
    activity: AgentActivity,
  ): Promise<OptimizeOutcome> {
    const outcome: OptimizeOutcome = { applied: 0, proposed: 0, costEstimateMinor: 0 };
    if (c.channelType !== 'SEARCH') return outcome;
    const rsa = this.pickRsa(c);
    if (!rsa || !rsa.keywords?.length) return outcome;
    const cov = keywordCoverage(
      rsa.headlines.map((h) => h.text),
      rsa.keywords,
      rsa.actionItems ?? [],
    );
    if (!keywordsHurtAdStrength(rsa.adStrength, cov)) return outcome;

    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const message = `Cuvinte cheie lipsă din titluri (${cov.missing.length} din ${cov.keywords.length}, Ad Strength ${rsa.adStrength})`;
    const skip = (result: string) =>
      activity.record(
        { ...meta, step: 'optimize', message },
        {
          status: 'skipped',
          result,
          details: { missing: cov.missing, covered: cov.covered, googleFlagged: cov.googleFlagged },
        },
      );
    if (!(await this.settings.googleAdsAgentAutoFillGapsEnabled())) {
      await skip('Amânat: completarea automată este dezactivată din setări.');
      return outcome;
    }
    if (!this.ai.configured) {
      await skip('Serviciul AI nu este configurat; nu se pot genera titluri noi.');
      return outcome;
    }
    const blocker = await this.rsaChangeBlocker(c);
    if (blocker) {
      await skip(`Amânat pentru textul reclamei: ${blocker}.`);
      return outcome;
    }

    const room = Math.max(0, RSA.headlines.max - rsa.headlines.length);
    const swappable = room ? [] : replaceableHeadlines(rsa.headlines, cov.keywords);
    const slots = Math.min(cov.missing.length, MAX_KEYWORD_HEADLINES, room || swappable.length);
    if (!slots) {
      await skip(
        'Reclama are deja 15 titluri și niciunul nu poate fi înlocuit automat (fixate, evaluate BEST/GOOD de Google sau conțin deja un cuvânt cheie).',
      );
      return outcome;
    }
    const targets = cov.missing.slice(0, slots + 2);

    const generated = await activity
      .step(
        { ...meta, step: 'generate', message: `${message}: generare titluri cu cuvintele cheie` },
        async () => {
          const r = await this.ai.googleAdsKeywordHeadlines({
            advertiser: target.advertiser,
            categoryName: target.name,
            landingUrl: rsa.finalUrls[0] ?? '',
            missingKeywords: targets,
            existingHeadlines: rsa.headlines.map((h) => h.text),
            googleActionItems: rsa.actionItems ?? [],
            count: targets.length,
          });
          if (!r) throw new Error('AI nu a returnat un răspuns utilizabil.');
          return {
            value: r,
            outcome: {
              result: `Propuse ${r.headlines.length} titluri: ${r.headlines.join(' | ')}`,
            },
          };
        },
      )
      .catch(() => null);
    if (!generated) return outcome;
    outcome.costEstimateMinor += generated.costEstimateMinor;

    // Local validation: Google limits + editorial rules + no duplicates, and
    // each headline must really contain a still-missing keyword (one each).
    const valid = acceptTexts(
      generated.headlines,
      [...rsa.headlines.map((h) => h.text), ...rsa.descriptions.map((d) => d.text)],
      RSA.headlines.maxChars,
      'headline',
      RSA.headlines.max,
    ).accepted;
    const used = new Set<string>();
    const picked: { text: string; keyword: string }[] = [];
    for (const text of valid) {
      if (picked.length >= slots) break;
      const kw = targets.find((k) => !used.has(k) && headlineHasKeyword(text, k));
      if (!kw) continue;
      used.add(kw);
      picked.push({ text, keyword: kw });
    }
    await activity.record(
      { ...meta, step: 'validate_local', message: 'Validare titluri cu cuvinte cheie' },
      {
        status: picked.length ? 'completed' : 'failed',
        result: picked.length
          ? `Acceptate ${picked.length}: ${picked.map((p) => `„${p.text}” (${p.keyword})`).join(', ')}.`
          : 'Niciun titlu generat nu respectă regulile Google și nu conține întreg un cuvânt cheie lipsă.',
      },
    );
    if (!picked.length) return outcome;

    const previous = rsa.headlines.map((x) => ({
      text: x.text,
      ...(x.pinnedField ? { pinnedField: x.pinnedField } : {}),
    }));
    const replaced: { oldText: string; newText: string; keyword: string }[] = [];
    let headlines: { text: string; pinnedField?: string }[];
    if (room) {
      headlines = [...previous, ...picked.map((p) => ({ text: p.text }))];
    } else {
      const swap = new Map<string, (typeof picked)[number]>();
      picked.forEach((p, i) => swap.set(swappable[i].text, p));
      headlines = previous.map((h) => {
        const p = swap.get(h.text);
        if (!p) return h;
        replaced.push({ oldText: h.text, newText: p.text, keyword: p.keyword });
        return { ...h, text: p.text };
      });
    }
    const added = room ? picked.map((p) => p.text) : [];
    const newTexts = picked.map((p) => p.text);
    const adId = rsa.adResourceName.split('/').pop()!;
    const ok = await this.executeChange({
      c,
      target,
      activity,
      action: 'creative.keyword_headlines',
      adId,
      label: room
        ? `Adăugare ${picked.length} titluri cu cuvintele cheie lipsă`
        : `Rescriere ${picked.length} titluri fără cuvinte cheie`,
      ops: [
        {
          adOperation: {
            update: { resourceName: rsa.adResourceName, responsiveSearchAd: { headlines } },
            updateMask: 'responsive_search_ad.headlines',
          },
        },
      ],
      before: { headlines: previous.map((h) => h.text), adStrength: rsa.adStrength ?? null },
      after: {
        headlines: headlines.map((h) => h.text),
        added,
        replaced,
        missingKeywords: picked.map((p) => p.keyword),
        adStrengthBefore: rsa.adStrength ?? null,
      },
      reasoning:
        `Titlurile nu conțin ${cov.missing.length} din ${cov.keywords.length} cuvinte cheie ale grupului (${cov.missing.slice(0, 6).join(', ')}), ` +
        `iar Google evaluează reclama cu Ad Strength ${rsa.adStrength}` +
        (cov.googleFlagged ? ` și indică explicit: ${(rsa.actionItems ?? []).join(' | ')}` : '') +
        '. ' +
        (room
          ? 'Titlurile noi se adaugă; cele existente rămân neschimbate.'
          : 'Se rescriu doar titlurile fără cuvânt cheie, nefixate și neevaluate BEST/GOOD de Google.') +
        ' Dacă Google evaluează varianta nouă mai slab, titlurile anterioare sunt restaurate automat.',
      verify: async () => {
        const rows = await this.client.search(
          'SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines ' +
            `FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId}`,
        );
        const live = new Set(
          (
            (
              rows[0]?.adGroupAd as
                { ad?: { responsiveSearchAd?: { headlines?: { text?: string }[] } } } | undefined
            )?.ad?.responsiveSearchAd?.headlines ?? []
          ).map((x) => x.text),
        );
        const missing = newTexts.filter((t) => !live.has(t));
        const stale = replaced.map((r) => r.oldText).filter((t) => live.has(t));
        if (missing.length) return `Lipsesc după aplicare: ${missing.join(', ')}`;
        if (stale.length) return `Apar încă după aplicare: ${stale.join(', ')}`;
        return null;
      },
      onApplied: (actionId) =>
        this.scheduleKeywordReadback({
          actionId,
          adResourceName: rsa.adResourceName,
          previous,
          strengthBefore: rsa.adStrength ?? null,
        }),
    });
    if (ok) outcome.applied++;
    return outcome;
  }

  /**
   * After a keyword-headline change: reads the REAL Ad Strength back from
   * Google (retrying while it is still PENDING) and, if Google rates the new
   * headlines lower than before, restores the previous headlines. The
   * result is appended to the history row; nothing is assumed.
   */
  scheduleKeywordReadback(
    p: {
      actionId: string;
      adResourceName: string;
      previous: { text: string; pinnedField?: string }[];
      strengthBefore: string | null;
    },
    delayMs = 90_000,
    attempt = 1,
  ): void {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const adId = p.adResourceName.split('/').pop();
          const rows = await this.client.search(
            'SELECT ad_group_ad.ad.id, ad_group_ad.ad_strength, ad_group_ad.action_items ' +
              `FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId}`,
          );
          const a = rows[0]?.adGroupAd as
            { adStrength?: string; actionItems?: string[] } | undefined;
          if (!a) return;
          if (!a.adStrength || STRENGTH_PENDING.has(a.adStrength)) {
            if (attempt < 4) this.scheduleKeywordReadback(p, delayMs * 2, attempt + 1);
            return;
          }
          const worse =
            (STRENGTH_RANK[a.adStrength] ?? 0) < (STRENGTH_RANK[p.strengthBefore ?? ''] ?? 0);
          let note =
            ` Ad Strength citit din Google după modificare: ${a.adStrength}` +
            (a.actionItems?.length ? ` (sugestii Google: ${a.actionItems.join(' | ')})` : '') +
            '.';
          let reverted = false;
          if (worse && this.client.writesAllowed) {
            const ops: GoogleAdsMutateOperation[] = [
              {
                adOperation: {
                  update: {
                    resourceName: p.adResourceName,
                    responsiveSearchAd: { headlines: p.previous },
                  },
                  updateMask: 'responsive_search_ad.headlines',
                },
              },
            ];
            await this.client.mutate(ops, { validateOnly: true });
            await this.client.mutate(ops);
            reverted = true;
            note += ` Mai slab decât înainte (${p.strengthBefore}), așa că titlurile anterioare au fost restaurate.`;
          }
          const row = await this.actions.findUnique({
            where: { id: p.actionId },
          });
          await this.actions.update({
            where: { id: p.actionId },
            data: {
              executionResult: `${row?.executionResult ?? ''}${note}`.trim(),
              after: {
                ...((row?.after as Record<string, unknown> | null) ?? {}),
                adStrengthAfter: a.adStrength,
                ...(reverted ? { reverted: true } : {}),
              } as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          this.logger.warn(
            `Keyword-headline read-back failed for action ${p.actionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    }, delayMs);
    timer.unref?.();
  }

  /**
   * Builds approval proposals to replace headlines/descriptions Google
   * labelled LOW. Never applied here — see `approveProposal`.
   */
  async proposeReplacements(
    c: CampaignData,
    target: OptimizationTarget,
    activity: AgentActivity,
  ): Promise<OptimizeOutcome> {
    const outcome: OptimizeOutcome = { applied: 0, proposed: 0, costEstimateMinor: 0 };
    const rsa = this.pickRsa(c);
    if (!rsa || !this.ai.configured) return outcome;
    const lows = [
      ...rsa.headlines
        .filter((x) => x.performanceLabel === 'LOW')
        .map((x) => ({ kind: 'headline' as const, text: x.text })),
      ...rsa.descriptions
        .filter((x) => x.performanceLabel === 'LOW')
        .map((x) => ({ kind: 'description' as const, text: x.text })),
    ];
    if (!lows.length) return outcome;
    const cooldownDays = await this.settings.googleAdsAgentCreativeCooldownDays();
    const others = [...rsa.headlines, ...rsa.descriptions].map((x) => x.text);

    for (const low of lows.slice(0, MAX_REPLACEMENTS_PER_CAMPAIGN_PER_CYCLE)) {
      // Never re-propose the same text while a proposal is open, or soon
      // after an admin rejected one.
      const dup = await this.actions.findFirst({
        where: {
          googleCampaignId: c.googleCampaignId,
          action: 'creative.replace_text',
          OR: [
            { status: 'pending_approval' },
            {
              status: 'rejected',
              createdAt: { gte: new Date(Date.now() - cooldownDays * 86_400_000) },
            },
          ],
          before: { path: ['text'], equals: low.text },
        },
      });
      if (dup) continue;
      const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
      const replacement = await activity
        .step(
          {
            ...meta,
            step: 'generate',
            message: `Propunere de înlocuire pentru textul LOW „${low.text}”`,
          },
          async () => {
            const r = await this.ai.googleAdsReplacementText({
              advertiser: target.advertiser,
              categoryName: target.name,
              kind: low.kind,
              current: low.text,
              otherTexts: others,
              landingUrl: rsa.finalUrls[0] ?? '',
            });
            const maxChars =
              low.kind === 'headline' ? RSA.headlines.maxChars : RSA.descriptions.maxChars;
            const problem = r
              ? textProblem(r.text, maxChars, low.kind === 'headline' ? 'headline' : 'other')
              : 'fără răspuns';
            if (!r || problem || others.some((o) => fold(o) === fold(r.text))) {
              throw new Error(`Propunere respinsă la validare (${problem ?? 'duplicat'}).`);
            }
            return {
              value: r,
              outcome: {
                status: 'waiting_approval',
                result: `Propus: „${r.text}”. Așteaptă aprobarea unui administrator.`,
              },
            };
          },
        )
        .catch(() => null);
      if (!replacement) continue;
      outcome.costEstimateMinor += replacement.costEstimateMinor;
      await this.actions.create({
        data: {
          ...ownerFields(target),
          googleCampaignId: c.googleCampaignId,
          action: 'creative.replace_text',
          status: 'pending_approval',
          requiredApproval: true,
          before: { adResourceName: rsa.adResourceName, kind: low.kind, text: low.text },
          after: { text: replacement.text },
          reasoning:
            `Google a etichetat ${low.kind === 'headline' ? 'titlul' : 'descrierea'} „${low.text}” cu performanță scăzută (LOW), ` +
            'pe baza traficului real. Înlocuirea unui element existent necesită aprobare.',
        },
      });
      outcome.proposed++;
    }
    return outcome;
  }

  /**
   * When an ad is already complete (15 headlines, 4 descriptions) and Google
   * still rates it POOR/AVERAGE, the only way up is rewriting existing text,
   * which is never automatic. Builds `creative.replace_text` approval
   * proposals from Google's own action items for the ad and the ad group's
   * real keywords; each one goes through the normal approval workflow.
   */
  async proposeAdStrengthRewrite(
    c: CampaignData,
    target: OptimizationTarget,
    activity: AgentActivity,
  ): Promise<OptimizeOutcome> {
    const outcome: OptimizeOutcome = { applied: 0, proposed: 0, costEstimateMinor: 0 };
    const rsa = this.pickRsa(c);
    if (!rsa || !this.ai.configured) return outcome;
    // Adding missing text comes first (automatic); rewriting only after.
    if (rsa.headlines.length < RSA.headlines.max || rsa.descriptions.length < RSA.descriptions.max)
      return outcome;
    if (!rsa.adStrength || !STRENGTH_TO_IMPROVE.has(rsa.adStrength)) return outcome;
    // Open proposals or a recent ad-text change: let Google evaluate first.
    if (await this.rsaChangeBlocker(c)) return outcome;

    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const cooldownDays = await this.settings.googleAdsAgentCreativeCooldownDays();
    const generated = await activity
      .step(
        {
          ...meta,
          step: 'generate',
          message: `Propuneri pentru creșterea Ad Strength (acum: ${rsa.adStrength})`,
        },
        async () => {
          const adGroupId = rsa.adGroupAdResourceName.split('/').pop()?.split('~')[0];
          const [adRows, kwRows] = await Promise.all([
            this.client.search(
              'SELECT ad_group_ad.ad_strength, ad_group_ad.action_items FROM ad_group_ad ' +
                `WHERE ad_group_ad.resource_name = '${rsa.adGroupAdResourceName}'`,
            ),
            adGroupId
              ? this.client.search(
                  'SELECT ad_group.id, ad_group_criterion.keyword.text FROM ad_group_criterion ' +
                    `WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = 'KEYWORD' ` +
                    "AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED'",
                )
              : Promise.resolve([]),
          ]);
          const live = adRows[0]?.adGroupAd as
            { adStrength?: string; actionItems?: string[] } | undefined;
          const strength = live?.adStrength ?? rsa.adStrength!;
          if (!STRENGTH_TO_IMPROVE.has(strength)) {
            return {
              value: null,
              outcome: {
                status: 'skipped',
                result: `Google raportează acum Ad Strength ${strength}; nu e nevoie de rescriere.`,
              },
            };
          }
          const actionItems = live?.actionItems ?? [];
          const keywords = kwRows
            .map(
              (r) =>
                (r.adGroupCriterion as { keyword?: { text?: string } } | undefined)?.keyword?.text,
            )
            .filter((t): t is string => !!t);
          const current = {
            headlines: rsa.headlines.map((x) => x.text),
            descriptions: rsa.descriptions.map((x) => x.text),
          };
          const r = await this.ai.googleAdsImproveAdStrength({
            advertiser: target.advertiser,
            categoryName: target.name,
            landingUrl: rsa.finalUrls[0] ?? '',
            keywords,
            headlines: current.headlines,
            descriptions: current.descriptions,
            adStrength: strength,
            googleActionItems: actionItems,
          });
          if (!r) throw new Error('AI nu a returnat un răspuns utilizabil.');
          outcome.costEstimateMinor += r.costEstimateMinor;
          const all = [...current.headlines, ...current.descriptions];
          const pairs: {
            kind: 'headline' | 'description';
            oldText: string;
            newText: string;
          }[] = [];
          for (const kind of ['headline', 'description'] as const) {
            const isH = kind === 'headline';
            const cur = isH ? rsa.headlines : rsa.descriptions;
            const proposed = isH ? r.headlines : r.descriptions;
            const proposedSet = new Set(proposed.map(fold));
            // Texts Google keeps (pinned) are never swapped out.
            const removed = cur
              .filter((x) => !x.pinnedField && !proposedSet.has(fold(x.text)))
              .map((x) => x.text);
            const added = acceptTexts(
              proposed,
              all,
              isH ? RSA.headlines.maxChars : RSA.descriptions.maxChars,
              isH ? 'headline' : 'other',
              Math.min(removed.length, MAX_STRENGTH_SWAPS[kind]),
            ).accepted;
            added.forEach((newText, i) => pairs.push({ kind, oldText: removed[i], newText }));
          }
          if (!pairs.length) throw new Error('Nicio înlocuire validă propusă.');
          return {
            value: { pairs, actionItems, keywords, strength },
            outcome: {
              status: 'waiting_approval',
              result:
                `${pairs.length} înlocuiri propuse pe baza sugestiilor Google` +
                (actionItems.length ? ` (${actionItems.join(' | ')})` : '') +
                '. Așteaptă aprobarea unui administrator.',
            },
          };
        },
      )
      .catch(() => null);
    if (!generated) return outcome;

    for (const p of generated.pairs) {
      const dup = await this.actions.findFirst({
        where: {
          googleCampaignId: c.googleCampaignId,
          action: 'creative.replace_text',
          OR: [
            { status: 'pending_approval' },
            {
              status: 'rejected',
              createdAt: { gte: new Date(Date.now() - cooldownDays * 86_400_000) },
            },
          ],
          before: { path: ['text'], equals: p.oldText },
        },
      });
      if (dup) continue;
      await this.actions.create({
        data: {
          ...ownerFields(target),
          googleCampaignId: c.googleCampaignId,
          action: 'creative.replace_text',
          status: 'pending_approval',
          requiredApproval: true,
          before: { adResourceName: rsa.adResourceName, kind: p.kind, text: p.oldText },
          after: { text: p.newText },
          reasoning:
            `Reclama are deja numărul maxim de titluri și descrieri, iar Google o evaluează cu Ad Strength ${generated.strength}. ` +
            (generated.actionItems.length
              ? `Sugestiile Google: ${generated.actionItems.join(' | ')}. `
              : '') +
            (generated.keywords.length
              ? `Textul nou folosește cuvintele cheie reale ale grupului (${generated.keywords.slice(0, 6).join(', ')}). `
              : '') +
            'Înlocuirea unui text existent necesită aprobare.',
        },
      });
      outcome.proposed++;
    }
    return outcome;
  }

  /**
   * Builds the exact RSA update replacing `oldText` with `newText` in the
   * LIVE ad (re-read now, so only what Google currently holds is touched;
   * pinning is preserved). Throws when the old text is no longer in the ad
   * — the proposal no longer matches reality and must not be applied.
   * Shared by approval and by admin-requested revisions.
   */
  async buildReplaceOperation(
    adResourceName: string,
    kind: string | undefined,
    oldText: string,
    newText: string,
  ): Promise<{
    ops: GoogleAdsMutateOperation[];
    field: 'headlines' | 'descriptions';
    others: string[];
  }> {
    const adId = adResourceName.split('/').pop();
    const rows = await this.client.search(
      'SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions ' +
        `FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId}`,
    );
    const ad = (
      rows[0]?.adGroupAd as
        | {
            ad?: { responsiveSearchAd?: Record<string, { text?: string; pinnedField?: string }[]> };
          }
        | undefined
    )?.ad;
    const field = kind === 'description' ? 'descriptions' : 'headlines';
    const current = ad?.responsiveSearchAd?.[field] ?? [];
    if (!current.some((x) => x.text === oldText)) {
      throw new BadRequestException(
        'Textul vechi nu mai există în reclamă (a fost modificat între timp).',
      );
    }
    const updated = current.map((x) => ({
      text: x.text === oldText ? newText : x.text!,
      ...(x.pinnedField ? { pinnedField: x.pinnedField } : {}),
    }));
    const others = [
      ...(ad?.responsiveSearchAd?.headlines ?? []),
      ...(ad?.responsiveSearchAd?.descriptions ?? []),
    ]
      .map((x) => x.text ?? '')
      .filter((t) => t && t !== oldText);
    return {
      field,
      others,
      ops: [
        {
          adOperation: {
            update: { resourceName: adResourceName, responsiveSearchAd: { [field]: updated } },
            updateMask: `responsive_search_ad.${field}`,
          },
        },
      ],
    };
  }

  /**
   * After any change to an ad, Google recomputes Ad Strength asynchronously.
   * Reads it back (after a short delay, in the background so the approving
   * request isn't held) and appends the REAL value plus Google's remaining
   * suggestions to the action's execution result. Never assumed.
   */
  scheduleStrengthReadback(actionId: string, adId: string, delayMs = 60_000): void {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const rows = await this.client.search(
            'SELECT ad_group_ad.ad.id, ad_group_ad.ad_strength, ad_group_ad.action_items ' +
              `FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId}`,
          );
          const a = rows[0]?.adGroupAd as
            { adStrength?: string; actionItems?: string[] } | undefined;
          if (!a) return;
          const row = await this.actions.findUnique({
            where: { id: actionId },
          });
          const note =
            ` Ad Strength citit din Google după modificare: ${a.adStrength ?? 'indisponibil'}` +
            (a.actionItems?.length ? ` (sugestii Google: ${a.actionItems.join(' | ')})` : '') +
            '.';
          await this.actions.update({
            where: { id: actionId },
            data: {
              executionResult: `${row?.executionResult ?? ''}${note}`.trim(),
              after: {
                ...((row?.after as Record<string, unknown> | null) ?? {}),
                adStrengthAfter: a.adStrength ?? null,
              } as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          this.logger.warn(
            `Ad Strength read-back failed for action ${actionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      })();
    }, delayMs);
    timer.unref?.();
  }

  /** Applies an approved `creative.replace_text` proposal — exactly the
   *  approved text, nothing else — and verifies it in Google. */
  async approveProposal(actionId: string, approvedByUserId: string): Promise<void> {
    const action = await this.actions.findUnique({ where: { id: actionId } });
    // `approved` = claimed for execution by the approval workflow.
    if (
      !action ||
      (action.status !== 'pending_approval' && action.status !== 'approved') ||
      action.action !== 'creative.replace_text'
    ) {
      throw new BadRequestException(
        'Propunerea de text nu mai este în așteptare (a fost deja procesată sau ștearsă).',
      );
    }
    if (!this.client.writesAllowed) {
      throw new BadRequestException(
        'Scrierile în contul Google Ads sunt blocate în acest mediu (doar producția poate aplica modificări).',
      );
    }
    const before = action.before as {
      adResourceName?: string;
      kind?: string;
      text?: string;
    } | null;
    const after = action.after as { text?: string } | null;
    if (!before?.adResourceName || !before.text || !after?.text) {
      throw new BadRequestException('Propunere incompletă.');
    }
    const adId = before.adResourceName.split('/').pop()!;
    const stamp = {
      approvedByUserId: action.approvedByUserId ?? approvedByUserId,
      approvedAt: action.approvedAt ?? new Date(),
    };
    let error: string | null = null;
    try {
      const { ops, field } = await this.buildReplaceOperation(
        before.adResourceName,
        before.kind,
        before.text,
        after.text,
      );
      await this.client.mutate(ops, { validateOnly: true });
      await this.client.mutate(ops);
      const check = await this.client.search(
        `SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.${field} FROM ad_group_ad WHERE ad_group_ad.ad.id = ${adId}`,
      );
      const live = (
        (
          check[0]?.adGroupAd as
            { ad?: { responsiveSearchAd?: Record<string, { text?: string }[]> } } | undefined
        )?.ad?.responsiveSearchAd?.[field] ?? []
      ).map((x) => x.text);
      if (!live.includes(after.text)) error = 'Textul nou nu apare în reclamă după aplicare.';
      else if (live.includes(before.text))
        error = 'Textul vechi apare încă în reclamă după aplicare.';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    await this.actions.update({
      where: { id: actionId },
      data: {
        ...stamp,
        status: error ? 'failed' : 'applied',
        errorMessage: error,
        verifiedAt: error ? null : new Date(),
        executionResult: error
          ? null
          : `Confirmat în Google: „${before.text}” a fost înlocuit cu „${after.text}”.`,
      },
    });
    if (error) throw new BadRequestException(`Aplicarea a eșuat: ${error}`);
    this.scheduleStrengthReadback(actionId, adId);
  }
}
