import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GoogleAdsAgentAction, Prisma } from '@prisma/client';
import { AiService } from '../../ai/ai.service';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAdsAgentIntelligenceService } from '../google-ads-agent-intelligence.service';
import { GoogleAdsAgentRecommendationsService } from '../google-ads-agent-recommendations.service';
import { GoogleAdsApiClient, GoogleAdsMutateOperation } from '../google-ads-api-client.service';
import { CampaignData } from './google-ads-account-data';
import { GoogleAdsOptimizerService, textProblem } from './google-ads-optimizer.service';
import { CALLOUTS, RSA, SITELINKS } from './google-ads-specs';

/**
 * The approval workflow for every proposal the agent queues (Google
 * recommendations, budget/CPC increases, creative replacements):
 *
 *  - approve: refuses a proposal whose content changed since the admin saw
 *    it (content hash), atomically claims it (pending_approval → approved)
 *    so it can never execute twice, runs the type's executor — which applies
 *    exactly the stored content and verifies it through Google — and records
 *    the campaign's metrics at execution for a later observation.
 *  - revise ("Recomandă manual"): turns an admin's instructions into a
 *    CORRECTED proposal of the same kind, re-validated (locally and, where
 *    the API allows, with Google validateOnly), stored as a NEW
 *    pending_approval row linked to the old one, which becomes superseded.
 *    Instructions never execute anything by themselves.
 *  - observePerformance: ~30 days after an execution, records the same
 *    30-day metrics window again from real synced data (observational, not
 *    a causal claim).
 */

const MIN_OBSERVATION_DAYS = 30;

type ActionRow = GoogleAdsAgentAction;

export function proposalContentHash(row: {
  action: string;
  before: unknown;
  after: unknown;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([row.action, row.before ?? null, row.after ?? null]))
    .digest('hex')
    .slice(0, 16);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

interface RevisionPlan {
  kindDescription: string;
  current: unknown;
  outputSpec: string;
  /** Validates the AI output and returns the new before/after. Throws
   *  BadRequestException with the reason when the revision is not valid. */
  build: (data: Json) => Promise<{ before: unknown; after: unknown }>;
}

/** Recommendation types whose content the agent can rewrite and still apply
 *  through Google (their apply parameters carry the content). */
const REVISABLE_RECOMMENDATIONS = new Set([
  'SITELINK_ASSET',
  'CALLOUT_ASSET',
  'RESPONSIVE_SEARCH_AD_ASSET',
  'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH',
]);

@Injectable()
export class GoogleAdsProposalWorkflowService {
  private readonly logger = new Logger(GoogleAdsProposalWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: GoogleAdsApiClient,
    private readonly ai: AiService,
    private readonly settings: PlatformSettingsService,
    private readonly recommendations: GoogleAdsAgentRecommendationsService,
    private readonly intelligence: GoogleAdsAgentIntelligenceService,
    private readonly optimizer: GoogleAdsOptimizerService,
  ) {}

  // --- approve ---------------------------------------------------------------

  async approve(actionId: string, userId: string, expectedHash?: string): Promise<ActionRow> {
    const row = await this.prisma.googleAdsAgentAction.findUnique({ where: { id: actionId } });
    if (!row) throw new NotFoundException('Propunerea nu există.');
    if (row.status === 'superseded') {
      throw new ConflictException(
        'Propunerea a fost înlocuită de o versiune revizuită; aprobă versiunea nouă.',
      );
    }
    if (row.status !== 'pending_approval') {
      throw new ConflictException(`Propunerea a fost deja procesată (stare: ${row.status}).`);
    }
    if (expectedHash && expectedHash !== proposalContentHash(row)) {
      throw new ConflictException(
        'Propunerea s-a schimbat de când ai deschis-o. Reîncarcă lista și verific-o din nou înainte de aprobare.',
      );
    }
    // Atomic claim: only one approval can ever move it out of pending.
    const claimed = await this.prisma.googleAdsAgentAction.updateMany({
      where: { id: actionId, status: 'pending_approval' },
      data: {
        status: 'approved',
        approvedByUserId: userId,
        approvedAt: new Date(),
        requiredApproval: true,
      },
    });
    if (claimed.count !== 1)
      throw new ConflictException('Propunerea a fost deja aprobată de altcineva.');

    const googleCampaignId = row.googleCampaignId ?? (await this.campaignIdFor(row.categoryId));
    const metricsAtApply = await this.currentMetrics(googleCampaignId);

    try {
      if (row.action.startsWith('recommendation.')) {
        await this.recommendations.approveProposal(actionId, userId);
      } else if (row.action.startsWith('creative.')) {
        await this.optimizer.approveProposal(actionId, userId);
      } else if (row.action === 'budget.increase.proposed') {
        await this.intelligence.approveProposal(actionId, userId);
      } else {
        throw new BadRequestException(`Tip de propunere necunoscut: ${row.action}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // An executor that already recorded `failed` keeps its own message.
      await this.prisma.googleAdsAgentAction.updateMany({
        where: { id: actionId, status: 'approved' },
        data: { status: 'failed', errorMessage: message },
      });
      await this.prisma.googleAdsAgentAction.update({
        where: { id: actionId },
        data: { googleCampaignId },
      });
      throw err instanceof BadRequestException || err instanceof ConflictException
        ? err
        : new BadRequestException(`Execuția a eșuat: ${message}`);
    }

    return this.prisma.googleAdsAgentAction.update({
      where: { id: actionId },
      data: {
        googleCampaignId,
        ...(metricsAtApply ? { metricsAtApply: metricsAtApply as Prisma.InputJsonValue } : {}),
      },
    });
  }

  private async campaignIdFor(categoryId: string): Promise<string | null> {
    const m = await this.prisma.googleAdsSubcategoryCampaign.findUnique({ where: { categoryId } });
    return m?.googleCampaignId ?? null;
  }

  private async currentMetrics(googleCampaignId: string | null): Promise<unknown> {
    if (!googleCampaignId) return null;
    const snap = await this.prisma.googleAdsCampaignSnapshot.findUnique({
      where: { googleCampaignId },
    });
    const current = obj(snap?.metrics).current;
    return current ? { ...obj(current), syncedAt: snap?.syncedAt } : null;
  }

  // --- revise (manual instructions) --------------------------------------

  async revise(actionId: string, userId: string, instructions: string): Promise<ActionRow> {
    const text = instructions.trim();
    if (text.length < 5)
      throw new BadRequestException(
        'Scrie instrucțiunile pentru agent (cel puțin câteva cuvinte).',
      );
    const row = await this.prisma.googleAdsAgentAction.findUnique({
      where: { id: actionId },
      include: { category: { include: { parent: true } } },
    });
    if (!row) throw new NotFoundException('Propunerea nu există.');
    if (row.status !== 'pending_approval') {
      throw new ConflictException(
        `Doar o propunere în așteptare poate fi ajustată (stare: ${row.status}).`,
      );
    }
    if (!this.ai.configured) throw new BadRequestException('Serviciul AI nu este configurat.');

    const plan = await this.revisionPlan(row);
    const context =
      `Subcategorie: ${this.name(row.category?.nameI18n)}` +
      (row.category?.parent ? ` (grup: ${this.name(row.category.parent.nameI18n)})` : '') +
      `. Motivul propunerii originale: ${row.reasoning ?? '-'}`;
    const res = await this.ai.googleAdsReviseProposal({
      kindDescription: plan.kindDescription,
      context,
      current: plan.current,
      instructions: text,
      outputSpec: plan.outputSpec,
    });
    if (!res)
      throw new BadRequestException(
        'Agentul nu a putut pregăti o propunere corectată. Încearcă din nou.',
      );
    const unsupported = str(res.data.unsupported);
    if (unsupported)
      throw new BadRequestException(`Agentul nu poate aplica aceste instrucțiuni: ${unsupported}`);
    const { before, after } = await plan.build(res.data);

    const created = await this.prisma.$transaction(async (tx) => {
      const sup = await tx.googleAdsAgentAction.updateMany({
        where: { id: actionId, status: 'pending_approval' },
        data: { status: 'superseded' },
      });
      if (sup.count !== 1) throw new ConflictException('Propunerea a fost procesată între timp.');
      const content = { action: row.action, before, after };
      return tx.googleAdsAgentAction.create({
        data: {
          categoryId: row.categoryId,
          googleCampaignId: row.googleCampaignId,
          action: row.action,
          status: 'pending_approval',
          requiredApproval: true,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
          revisionOfId: row.id,
          manualInstructions: text,
          contentHash: proposalContentHash(content),
          reasoning: `Revizuită de agent după instrucțiunile unui administrator. Necesită aprobare din nou. Propunerea inițială: ${row.reasoning ?? '-'}`,
        },
      });
    });
    this.logger.log(`Proposal ${actionId} revised by ${userId} → ${created.id}`);
    return created;
  }

  private name(n: unknown): string {
    const o = obj(n);
    return str(o.ro) || str(Object.values(o).find((v) => typeof v === 'string'));
  }

  private async validateWithGoogle(ops: GoogleAdsMutateOperation[]): Promise<void> {
    try {
      await this.client.mutate(ops, { validateOnly: true });
    } catch (err) {
      throw new BadRequestException(
        `Google a respins propunerea corectată la validare: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async urlResponds(url: string): Promise<boolean> {
    const attempt = async (method: string) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        return await fetch(url, { method, redirect: 'follow', signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    };
    try {
      let r = await attempt('HEAD');
      if (r.status === 405 || r.status === 403 || r.status === 501) r = await attempt('GET');
      return r.status < 400;
    } catch {
      return false;
    }
  }

  private texts(
    v: unknown,
    max: number,
    kind: 'headline' | 'other',
    limit: number,
    label: string,
  ): string[] {
    const list = arr(v).map(str).filter(Boolean);
    if (!list.length) throw new BadRequestException(`Propunerea corectată nu conține ${label}.`);
    if (list.length > limit) throw new BadRequestException(`Prea multe ${label} (max ${limit}).`);
    const seen = new Set<string>();
    for (const t of list) {
      const p = textProblem(t, max, kind);
      if (p) throw new BadRequestException(`„${t}”: ${p}.`);
      const k = t.toLowerCase();
      if (seen.has(k)) throw new BadRequestException(`„${t}” apare de două ori.`);
      seen.add(k);
    }
    return list;
  }

  private async revisionPlan(row: ActionRow): Promise<RevisionPlan> {
    const before = obj(row.before);
    const after = obj(row.after);

    if (row.action === 'creative.replace_text') {
      const kind = str(before.kind) === 'description' ? 'description' : 'headline';
      const max = kind === 'headline' ? RSA.headlines.maxChars : RSA.descriptions.maxChars;
      return {
        kindDescription: `înlocuirea unui ${kind === 'headline' ? 'titlu' : 'text de descriere'} cu performanță scăzută într-o reclamă RSA`,
        current: { textVechi: before.text, inlocuirePropusa: after.text },
        outputSpec: `{"text": string (max ${max} caractere)}`,
        build: async (data) => {
          const t = str(data.text);
          const p = textProblem(t, max, kind === 'headline' ? 'headline' : 'other');
          if (p) throw new BadRequestException(`„${t}”: ${p}.`);
          const { ops, others } = await this.optimizer
            .buildReplaceOperation(
              str(before.adResourceName),
              str(before.kind),
              str(before.text),
              t,
            )
            .catch((err) => {
              throw new BadRequestException(err instanceof Error ? err.message : String(err));
            });
          if (others.some((o) => o.toLowerCase() === t.toLowerCase())) {
            throw new BadRequestException(`„${t}” există deja în reclamă.`);
          }
          await this.validateWithGoogle(ops);
          return { before, after: { text: t } };
        },
      };
    }

    if (row.action === 'budget.increase.proposed') {
      const [budgetCap, cpcCap] = await Promise.all([
        this.settings.googleAdsAgentMaxDailyBudgetCapCredits(),
        this.settings.googleAdsAgentMaxCpcCapCredits(),
      ]);
      return {
        kindDescription: 'modificare de buget zilnic și CPC maxim pentru o campanie (în credite)',
        current: {
          actual: before,
          propus: after,
          limite: { bugetZilnicMax: budgetCap, cpcMax: cpcCap },
        },
        outputSpec: `{"proposedDailyBudgetCredits": number (0 < x ≤ ${budgetCap}), "proposedMaxCpcCredits": number (0.01 ≤ x ≤ ${cpcCap})}`,
        build: async (data) => {
          const b = Number(data.proposedDailyBudgetCredits);
          const c = Number(data.proposedMaxCpcCredits);
          if (!Number.isFinite(b) || !Number.isFinite(c) || b <= 0 || c <= 0) {
            throw new BadRequestException('Valori de buget/CPC invalide în propunerea corectată.');
          }
          if (b > budgetCap || c > cpcCap) {
            throw new BadRequestException(
              `Propunerea depășește limitele din setări (buget max ${budgetCap}, CPC max ${cpcCap} credite).`,
            );
          }
          const round2 = (n: number) => Math.round(n * 100) / 100;
          return {
            before,
            after: {
              proposedDailyBudgetCredits: round2(b),
              proposedMaxCpcCredits: round2(Math.max(c, 0.01)),
            },
          };
        },
      };
    }

    if (row.action.startsWith('recommendation.')) {
      const type = str(after.type) || row.action.replace('recommendation.', '');
      if (!REVISABLE_RECOMMENDATIONS.has(type)) {
        throw new BadRequestException(
          'Pentru acest tip de recomandare Google nu permite trimiterea unui conținut modificat la aplicare ' +
            '(se aplică doar exact cum a propus-o Google). Aprobă sau respinge propunerea.',
        );
      }
      const rec = obj(after.recommendation);
      const withRec = (patch: Json) => ({
        before,
        after: { ...after, recommendation: { ...rec, ...patch } },
      });

      if (type === 'SITELINK_ASSET') {
        const current = arr(
          obj(rec.sitelinkAssetRecommendation).recommendedCampaignSitelinkAssets,
        ).map((a) => {
          const x = obj(a);
          const sl = obj(x.sitelinkAsset);
          return {
            linkText: sl.linkText,
            description1: sl.description1,
            description2: sl.description2,
            url: arr(x.finalUrls)[0],
          };
        });
        return {
          kindDescription: 'sitelink-uri de adăugat la nivel de campanie',
          current,
          outputSpec:
            `{"sitelinks": [{"linkText": string (max ${SITELINKS.linkTextMaxChars}), "description1": string (max ${SITELINKS.descriptionMaxChars}), ` +
            `"description2": string (max ${SITELINKS.descriptionMaxChars}), "url": string (URL complet https://, pagină reală)}] (1-20)}`,
          build: async (data) => {
            const list = arr(data.sitelinks).map(obj);
            if (!list.length || list.length > 20)
              throw new BadRequestException(
                'Numărul de sitelink-uri trebuie să fie între 1 și 20.',
              );
            const assets: Json[] = [];
            for (const s of list) {
              const linkText = str(s.linkText);
              const d1 = str(s.description1);
              const d2 = str(s.description2);
              const url = str(s.url);
              for (const [t, max] of [
                [linkText, SITELINKS.linkTextMaxChars],
                [d1, SITELINKS.descriptionMaxChars],
                [d2, SITELINKS.descriptionMaxChars],
              ] as const) {
                if (t) {
                  const p = textProblem(t, max, 'other');
                  if (p) throw new BadRequestException(`„${t}”: ${p}.`);
                }
              }
              if (!linkText)
                throw new BadRequestException('Fiecare sitelink trebuie să aibă un text.');
              if (!/^https?:\/\//i.test(url))
                throw new BadRequestException(
                  `URL invalid pentru „${linkText}”: ${url || '(lipsă)'}`,
                );
              if (!(await this.urlResponds(url)))
                throw new BadRequestException(`Pagina ${url} nu răspunde corect.`);
              assets.push({
                sitelinkAsset: {
                  linkText,
                  ...(d1 && d2 ? { description1: d1, description2: d2 } : {}),
                },
                finalUrls: [url],
              });
            }
            await this.validateWithGoogle(
              assets.map((a, i) => ({
                assetOperation: {
                  create: {
                    resourceName: `customers/${this.client.customerId}/assets/-${i + 1}`,
                    ...a,
                  },
                },
              })),
            );
            return withRec({
              sitelinkAssetRecommendation: {
                ...obj(rec.sitelinkAssetRecommendation),
                recommendedCampaignSitelinkAssets: assets,
              },
            });
          },
        };
      }

      if (type === 'CALLOUT_ASSET') {
        const current = arr(
          obj(rec.calloutAssetRecommendation).recommendedCampaignCalloutAssets,
        ).map((a) => obj(obj(a).calloutAsset).calloutText);
        return {
          kindDescription: 'callout-uri (fraze scurte) de adăugat la nivel de campanie',
          current,
          outputSpec: `{"callouts": string[] (1-20, max ${CALLOUTS.maxChars} caractere fiecare)}`,
          build: async (data) => {
            const list = this.texts(data.callouts, CALLOUTS.maxChars, 'other', 20, 'callout-uri');
            const assets = list.map((calloutText) => ({ calloutAsset: { calloutText } }));
            await this.validateWithGoogle(
              assets.map((a, i) => ({
                assetOperation: {
                  create: {
                    resourceName: `customers/${this.client.customerId}/assets/-${i + 1}`,
                    ...a,
                  },
                },
              })),
            );
            return withRec({
              calloutAssetRecommendation: {
                ...obj(rec.calloutAssetRecommendation),
                recommendedCampaignCalloutAssets: assets,
              },
            });
          },
        };
      }

      if (type === 'RESPONSIVE_SEARCH_AD_ASSET') {
        const r = obj(rec.responsiveSearchAdAssetRecommendation);
        const cur = obj(obj(r.currentAd).responsiveSearchAd);
        const add = obj(obj(r.recommendedAssets).responsiveSearchAd);
        const t = (v: unknown) =>
          arr(v)
            .map((x) => str(obj(x).text))
            .filter(Boolean);
        return {
          kindDescription:
            'titluri/descrieri NOI de adăugat la reclama RSA existentă (cele existente rămân)',
          current: {
            existente: { titluri: t(cur.headlines), descrieri: t(cur.descriptions) },
            deAdaugat: { titluri: t(add.headlines), descrieri: t(add.descriptions) },
          },
          outputSpec: `{"headlines": string[] (titluri noi, max ${RSA.headlines.maxChars} caractere), "descriptions": string[] (descrieri noi, max ${RSA.descriptions.maxChars} caractere)}`,
          build: async (data) => {
            const h = arr(data.headlines).length
              ? this.texts(
                  data.headlines,
                  RSA.headlines.maxChars,
                  'headline',
                  RSA.headlines.max,
                  'titluri',
                )
              : [];
            const d = arr(data.descriptions).length
              ? this.texts(
                  data.descriptions,
                  RSA.descriptions.maxChars,
                  'other',
                  RSA.descriptions.max,
                  'descrieri',
                )
              : [];
            if (!h.length && !d.length)
              throw new BadRequestException('Propunerea corectată nu adaugă niciun text.');
            return withRec({
              responsiveSearchAdAssetRecommendation: {
                ...r,
                recommendedAssets: {
                  ...obj(r.recommendedAssets),
                  responsiveSearchAd: {
                    headlines: h.map((text) => ({ text })),
                    descriptions: d.map((text) => ({ text })),
                  },
                },
              },
            });
          },
        };
      }

      // RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH: the full resulting ad.
      const r = obj(rec.responsiveSearchAdImproveAdStrengthRecommendation);
      const ad = obj(r.recommendedAd);
      const rsa = obj(ad.responsiveSearchAd);
      const t = (v: unknown) =>
        arr(v)
          .map((x) => str(obj(x).text))
          .filter(Boolean);
      return {
        kindDescription:
          'setul COMPLET de titluri și descrieri al reclamei RSA după aplicare (înlocuiește setul actual)',
        current: { titluri: t(rsa.headlines), descrieri: t(rsa.descriptions) },
        outputSpec: `{"headlines": string[] (${RSA.headlines.min}-${RSA.headlines.max}, max ${RSA.headlines.maxChars} caractere), "descriptions": string[] (${RSA.descriptions.min}-${RSA.descriptions.max}, max ${RSA.descriptions.maxChars} caractere)}`,
        build: async (data) => {
          const h = this.texts(
            data.headlines,
            RSA.headlines.maxChars,
            'headline',
            RSA.headlines.max,
            'titluri',
          );
          const d = this.texts(
            data.descriptions,
            RSA.descriptions.maxChars,
            'other',
            RSA.descriptions.max,
            'descrieri',
          );
          if (h.length < RSA.headlines.min || d.length < RSA.descriptions.min) {
            throw new BadRequestException(
              `Minim ${RSA.headlines.min} titluri și ${RSA.descriptions.min} descrieri.`,
            );
          }
          if (str(ad.resourceName)) {
            await this.validateWithGoogle([
              {
                adOperation: {
                  update: {
                    resourceName: str(ad.resourceName),
                    responsiveSearchAd: {
                      headlines: h.map((text) => ({ text })),
                      descriptions: d.map((text) => ({ text })),
                    },
                  },
                  updateMask: 'responsive_search_ad.headlines,responsive_search_ad.descriptions',
                },
              },
            ]);
          }
          return withRec({
            responsiveSearchAdImproveAdStrengthRecommendation: {
              ...r,
              recommendedAd: {
                ...ad,
                responsiveSearchAd: {
                  ...rsa,
                  headlines: h.map((text) => ({ text })),
                  descriptions: d.map((text) => ({ text })),
                },
              },
            },
          });
        },
      };
    }

    throw new BadRequestException('Acest tip de propunere nu poate fi ajustat manual.');
  }

  // --- performance observation -------------------------------------------

  /** Called by the monitor with freshly synced data. Records, once per
   *  action, the campaign's 30-day metrics ~30 days after execution. */
  async observePerformance(campaigns: CampaignData[]): Promise<number> {
    const cutoff = new Date(Date.now() - MIN_OBSERVATION_DAYS * 86_400_000);
    const due = await this.prisma.googleAdsAgentAction.findMany({
      where: {
        status: 'applied',
        observedAt: null,
        metricsAtApply: { not: Prisma.DbNull },
        googleCampaignId: { not: null },
        OR: [{ approvedAt: { lte: cutoff } }, { approvedAt: null, createdAt: { lte: cutoff } }],
      },
      take: 200,
    });
    const byId = new Map(campaigns.map((c) => [c.googleCampaignId, c]));
    let n = 0;
    for (const a of due) {
      const c = byId.get(a.googleCampaignId!);
      if (!c) continue;
      await this.prisma.googleAdsAgentAction.update({
        where: { id: a.id },
        data: {
          metricsObserved: {
            ...c.current,
            measuredAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
          observedAt: new Date(),
        },
      });
      n++;
    }
    return n;
  }
}
