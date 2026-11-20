import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiService, GoogleAdsCreativeGapFill } from '../../ai/ai.service';
import { AppConfig } from '../../config/env';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAdsApiClient, GoogleAdsMutateOperation } from '../google-ads-api-client.service';
import { subcategoryLandingUrl } from '../google-ads-landing-url';
import {
  PexelsPhoto,
  PexelsProvider,
} from '../../website/builder/generator/image-provider/pexels.provider';
import { AgentActivity } from './google-ads-activity';
import { CampaignData, RsaAd } from './google-ads-account-data';
import { CampaignEvaluation } from './google-ads-campaign-evaluator';
import { CALLOUTS, RSA, SEARCH_IMAGES, SITELINKS, STRUCTURED_SNIPPETS } from './google-ads-specs';

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

type MappingWithCategory = Prisma.GoogleAdsSubcategoryCampaignGetPayload<{
  include: { category: { include: { parent: true } } };
}>;

export interface OptimizeOutcome {
  applied: number;
  proposed: number;
  costEstimateMinor: number;
}

const MAX_REPLACEMENTS_PER_CAMPAIGN_PER_CYCLE = 2;
/** Actions that change the RSA text itself (subject to the cooldown). */
const RSA_TEXT_ACTIONS = ['creative.rsa_gap_fill', 'creative.replace_text'];
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
  private readonly logger = new Logger(GoogleAdsOptimizerService.name);
  private readonly frontendOrigin: string;
  /** Stock photos for image assets (Pexels license: free commercial use). */
  private readonly pexels: PexelsProvider;

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly ai: AiService,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
    this.pexels = new PexelsProvider(config.get('pexelsApiKey', { infer: true }) ?? '');
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
    const pending = await this.prisma.googleAdsAgentAction.count({
      where: {
        googleCampaignId: c.googleCampaignId,
        action: { in: RSA_TEXT_ACTIONS },
        status: 'pending_approval',
      },
    });
    if (pending) return `are ${pending} propuneri creative în așteptarea aprobării`;
    const cooldownDays = await this.settings.googleAdsAgentCreativeCooldownDays();
    const last = await this.prisma.googleAdsAgentAction.findFirst({
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
  private async sitelinkDestinations(
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
    mapping: MappingWithCategory,
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
    const outcome = await this.fillTextGaps(c, ev, mapping, activity);
    outcome.applied += await this.fillImageGaps(c, ev, mapping, activity);
    if (outcome.applied) {
      await this.prisma.googleAdsCampaignSnapshot
        .update({
          where: { googleCampaignId: c.googleCampaignId },
          data: { lastOptimizedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return outcome;
  }

  /** Headlines/descriptions (cooldown-gated), sitelinks, callouts,
   *  structured snippet and business name. */
  private async fillTextGaps(
    c: CampaignData,
    ev: CampaignEvaluation,
    mapping: MappingWithCategory,
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
      businessName: !ev.assets.businessName,
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

    const landingUrl =
      rsa?.finalUrls[0] ?? subcategoryLandingUrl(mapping.category, this.frontendOrigin);
    const destinations = need.sitelinks
      ? await this.sitelinkDestinations(
          mapping,
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
                categoryName: plainName(mapping.category.nameI18n),
                parentCategoryName: mapping.category.parent
                  ? plainName(mapping.category.parent.nameI18n)
                  : undefined,
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

    // Local validation against Google's published limits.
    const h = acceptTexts(
      generated.headlines,
      rsa?.headlines.map((x) => x.text) ?? [],
      RSA.headlines.maxChars,
      'headline',
      need.headlines,
    );
    const d = acceptTexts(
      generated.descriptions,
      rsa?.descriptions.map((x) => x.text) ?? [],
      RSA.descriptions.maxChars,
      'other',
      need.descriptions,
    );
    const co = acceptTexts(
      generated.callouts,
      ev.assets.callouts.map((x) => x.text),
      CALLOUTS.maxChars,
      'other',
      need.callouts,
    );
    const sn = acceptTexts(
      generated.snippetValues ?? [],
      [],
      STRUCTURED_SNIPPETS.valueMaxChars,
      'other',
      need.snippetValues,
    );
    // Google requires at least 3 values; fewer means no snippet this time.
    const snippetValues = sn.accepted.length >= STRUCTURED_SNIPPETS.minValues ? sn.accepted : [];
    const existingLinkTexts = ev.assets.sitelinks.map((s) => s.linkText);
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
        mapping,
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
          assetOperation: { create: { resourceName: res, textAsset: { text: BUSINESS_NAME } } },
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
        need.businessName && `numele afacerii „${BUSINESS_NAME}”`,
      ].filter(Boolean) as string[];
      const ok = await this.executeChange({
        c,
        mapping,
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
            ...(need.businessName ? { businessName: BUSINESS_NAME } : {}),
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
            ...(need.businessName ? [BUSINESS_NAME] : []),
          ].filter((t) => !live.has(t));
          return missing.length ? `Lipsesc după aplicare: ${missing.join(', ')}` : null;
        },
      });
      if (ok) outcome.applied++;
    }

    return outcome;
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
    mapping: MappingWithCategory,
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
    const query = englishName(mapping.category.nameI18n).replace(/&/g, ' ').trim();

    const previous = await this.prisma.googleAdsAgentAction.findMany({
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
      mapping,
      activity,
      action: 'creative.images_gap_fill',
      label: `Adăugare ${picked.length} imagini (Pexels)`,
      ops: [...ops, ...links],
      before: { images: valid.map((i) => `${i.width}×${i.height}`) },
      after: { added: { images: added } },
      reasoning:
        `Campania are ${valid.length} imagini valide; Google recomandă 4 imagini unice, cel puțin una pătrată și una peisaj. ` +
        'Fotografii reale de pe Pexels (licență gratuită pentru uz comercial), decupate exact la dimensiunile recomandate de Google.',
      verify: async () => {
        const rows = await this.client.search(
          'SELECT campaign.id, asset.name, campaign_asset.field_type, campaign_asset.status FROM campaign_asset ' +
            `WHERE campaign.id = ${c.googleCampaignId} AND campaign_asset.field_type = 'AD_IMAGE' AND campaign_asset.status != 'REMOVED'`,
        );
        const live = new Set(rows.map((r) => (r.asset as { name?: string } | undefined)?.name));
        const missing = names.filter((n) => !live.has(n));
        return missing.length ? `Lipsesc după aplicare: ${missing.join(', ')}` : null;
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
    mapping: MappingWithCategory;
    activity: AgentActivity;
    action: string;
    label: string;
    ops: GoogleAdsMutateOperation[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    reasoning: string;
    verify: () => Promise<string | null>;
    /** The ad changed by this batch, for the Ad Strength read-back. */
    adId?: string;
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
      await p.activity.step({ ...meta, step: 'apply', message: p.label }, async () => {
        await this.client.mutate(p.ops);
        return { value: true, outcome: { result: 'Trimis la Google, răspuns de succes.' } };
      });
      const problem = await p.activity.step(
        { ...meta, step: 'verify', message: 'Verificare: recitire din Google după aplicare' },
        async () => {
          const prob = await p.verify();
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

    const created = await this.prisma.googleAdsAgentAction.create({
      data: {
        categoryId: p.mapping.categoryId,
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
    return !error;
  }

  /**
   * Builds approval proposals to replace headlines/descriptions Google
   * labelled LOW. Never applied here — see `approveProposal`.
   */
  async proposeReplacements(
    c: CampaignData,
    mapping: MappingWithCategory,
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
      const dup = await this.prisma.googleAdsAgentAction.findFirst({
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
              categoryName: plainName(mapping.category.nameI18n),
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
      await this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId: mapping.categoryId,
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
    mapping: MappingWithCategory,
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
            categoryName: plainName(mapping.category.nameI18n),
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
      const dup = await this.prisma.googleAdsAgentAction.findFirst({
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
      await this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId: mapping.categoryId,
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
          const row = await this.prisma.googleAdsAgentAction.findUnique({
            where: { id: actionId },
          });
          const note =
            ` Ad Strength citit din Google după modificare: ${a.adStrength ?? 'indisponibil'}` +
            (a.actionItems?.length ? ` (sugestii Google: ${a.actionItems.join(' | ')})` : '') +
            '.';
          await this.prisma.googleAdsAgentAction.update({
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
    const action = await this.prisma.googleAdsAgentAction.findUnique({ where: { id: actionId } });
    // `approved` = claimed for execution by the approval workflow.
    if (
      !action ||
      (action.status !== 'pending_approval' && action.status !== 'approved') ||
      action.action !== 'creative.replace_text'
    ) {
      throw new BadRequestException('No pending creative proposal with that id');
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
    await this.prisma.googleAdsAgentAction.update({
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
