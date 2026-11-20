import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiService } from '../../ai/ai.service';
import { AppConfig } from '../../config/env';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAdsApiClient, GoogleAdsMutateOperation } from '../google-ads-api-client.service';
import { subcategoryLandingUrl } from '../google-ads-landing-url';
import { AgentActivity } from './google-ads-activity';
import { CampaignData, RsaAd } from './google-ads-account-data';
import { CampaignEvaluation } from './google-ads-campaign-evaluator';
import { CALLOUTS, RSA, SITELINKS } from './google-ads-specs';

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

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly ai: AiService,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  private pickRsa(c: CampaignData): RsaAd | undefined {
    return [...c.ads.filter((a) => a.status === 'ENABLED')].sort(
      (a, b) => b.headlines.length - a.headlines.length,
    )[0];
  }

  /** Why this campaign may not be changed automatically right now, or null. */
  async autoChangeBlocker(c: CampaignData): Promise<string | null> {
    if (!(await this.settings.googleAdsAgentAutoFillGapsEnabled())) {
      return 'completarea automată este dezactivată din setări';
    }
    const pending = await this.prisma.googleAdsAgentAction.count({
      where: {
        googleCampaignId: c.googleCampaignId,
        action: { startsWith: 'creative.' },
        status: 'pending_approval',
      },
    });
    if (pending) return `are ${pending} propuneri creative în așteptarea aprobării`;
    const cooldownDays = await this.settings.googleAdsAgentCreativeCooldownDays();
    const last = await this.prisma.googleAdsAgentAction.findFirst({
      where: {
        googleCampaignId: c.googleCampaignId,
        action: { startsWith: 'creative.' },
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

  /** Real, distinct pages for sitelinks: parent group page, sibling
   *  subcategories, homepage — never the ad's own landing page twice. */
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
    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const outcome: OptimizeOutcome = { applied: 0, proposed: 0, costEstimateMinor: 0 };
    const rsa = this.pickRsa(c);
    const need = {
      headlines: rsa ? Math.max(0, RSA.headlines.max - rsa.headlines.length) : 0,
      descriptions: rsa ? Math.max(0, RSA.descriptions.max - rsa.descriptions.length) : 0,
      callouts: Math.max(0, CALLOUTS.ourTarget - ev.assets.callouts.length),
      sitelinks: Math.max(0, SITELINKS.recommended - ev.assets.sitelinks.length),
    };
    const total = need.headlines + need.descriptions + need.callouts + need.sitelinks;
    if (!total) {
      await activity.record(
        { ...meta, step: 'optimize', message: 'Verificare lipsuri creative' },
        {
          result:
            'Nimic de completat: titluri, descrieri, sitelink-uri și callout-uri sunt la nivelul recomandat.',
        },
      );
      return outcome;
    }
    const blocker = await this.autoChangeBlocker(c);
    if (blocker) {
      await activity.record(
        { ...meta, step: 'optimize', message: 'Completare automată a lipsurilor' },
        { status: 'skipped', result: `Amânat: ${blocker}.`, details: need },
      );
      return outcome;
    }
    if (!this.ai.configured) {
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

    const generated = await activity
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
            },
          });
          if (!res) throw new Error('AI nu a returnat un răspuns utilizabil.');
          return {
            value: res,
            outcome: {
              result: `Propuse: ${res.headlines.length} titluri, ${res.descriptions.length} descrieri, ${res.sitelinks.length} sitelink-uri, ${res.callouts.length} callout-uri.`,
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
    const rejected = [...h.rejected, ...d.rejected, ...co.rejected];
    await activity.record(
      {
        ...meta,
        step: 'validate_local',
        message: 'Validare față de cerințele Google (lungime, duplicate, reguli editoriale)',
      },
      {
        result:
          `Acceptate: ${h.accepted.length} titluri, ${d.accepted.length} descrieri, ${sl.length} sitelink-uri, ${co.accepted.length} callout-uri` +
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

    // Batch 2: sitelinks + callouts, created and attached in one atomic call.
    if (sl.length || co.accepted.length) {
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
      const ok = await this.executeChange({
        c,
        mapping,
        activity,
        action: 'creative.assets_gap_fill',
        label: `Adăugare ${sl.length} sitelink-uri și ${co.accepted.length} callout-uri`,
        ops: [...ops, ...links],
        before: {
          sitelinks: ev.assets.sitelinks.map((s) => s.linkText),
          callouts: ev.assets.callouts.map((x) => x.text),
        },
        after: { added: { sitelinks: sl, callouts: co.accepted } },
        reasoning: `Completare automată a lipsurilor (${reasoning}). Fiecare sitelink duce la o pagină reală diferită.`,
        verify: async () => {
          const rows = await this.client.search(
            'SELECT campaign.id, campaign_asset.status, campaign_asset.field_type, asset.sitelink_asset.link_text, asset.callout_asset.callout_text ' +
              `FROM campaign_asset WHERE campaign.id = ${c.googleCampaignId} AND campaign_asset.status != 'REMOVED'`,
          );
          const live = new Set(
            rows.map((r) => {
              const a = r.asset as
                | { sitelinkAsset?: { linkText?: string }; calloutAsset?: { calloutText?: string } }
                | undefined;
              return a?.sitelinkAsset?.linkText ?? a?.calloutAsset?.calloutText;
            }),
          );
          const missing = [...sl.map((s) => s.linkText), ...co.accepted].filter(
            (t) => !live.has(t),
          );
          return missing.length ? `Lipsesc după aplicare: ${missing.join(', ')}` : null;
        },
      });
      if (ok) outcome.applied++;
    }

    if (outcome.applied && mapping) {
      await this.prisma.googleAdsCampaignSnapshot
        .update({
          where: { googleCampaignId: c.googleCampaignId },
          data: { lastOptimizedAt: new Date() },
        })
        .catch(() => undefined);
    }
    return outcome;
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
