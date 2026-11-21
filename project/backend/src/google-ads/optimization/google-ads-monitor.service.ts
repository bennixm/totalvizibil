import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { GoogleAdsAccountScopeService } from '../google-ads-account-scope.service';

import { Prisma } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { notifyAdminsOfFailedGoogleAdsAgentRun } from '../google-ads-agent-alerts';
import { GoogleAdsApiClient } from '../google-ads-api-client.service';
import { AgentActivity } from './google-ads-activity';
import { CampaignData, fetchAccountData } from './google-ads-account-data';
import { CampaignEvaluation, UrlCheck, evaluateCampaign } from './google-ads-campaign-evaluator';
import { GoogleAdsOptimizerService } from './google-ads-optimizer.service';
import { GoogleAdsProposalWorkflowService } from './google-ads-proposal-workflow.service';

/**
 * The continuous monitoring + optimization cycle. Every
 * `googleAdsAgentMonitorIntervalMinutes` (admin setting, default 6h):
 *
 *  1. Sync: 9 account-wide read queries (google-ads-account-data.ts).
 *  2. Check every distinct final URL actually responds.
 *  3. Evaluate each campaign (google-ads-campaign-evaluator.ts): score,
 *     prioritized issues, asset summary — one activity event per analysed
 *     area so the admin sees what was checked and what was found.
 *  4. Persist a snapshot per campaign (what the admin panel reads).
 *  5. Optimize the agent-managed campaigns that need it most (lowest score
 *     first, a few per cycle): fill gaps automatically, propose LOW-asset
 *     replacements for approval (GoogleAdsOptimizerService).
 *  6. Record the run; prune old activity.
 *
 * Read-only everywhere except the optimizer's writes, which the API client
 * blocks outside production. A SCHEDULED run in a read-only environment
 * also skips the AI text generation (it could never be applied there, and
 * would spend AI credits every cycle); a MANUAL run does it as a dry run,
 * so the full validate-only path can be watched from a dev machine.
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const STALE_LOCK_MS = 45 * 60 * 1000;
/** Safety bound on managed campaigns optimized per cycle (AI cost). High
 *  enough that every agent campaign with gaps is handled in one cycle; the
 *  per-campaign cooldown on ad text still paces what Google has to absorb. */
const MAX_OPTIMIZED_PER_CYCLE = 25;
const MAX_URLS_CHECKED = 40;
const URL_TIMEOUT_MS = 8_000;

type MappingWithCategory = Prisma.GoogleAdsSubcategoryCampaignGetPayload<{
  include: { category: { include: { parent: true } } };
}>;

export type MonitorTrigger = 'schedule' | 'manual';

const PRIORITY_RO: Record<string, string> = {
  critical: 'critice',
  high: 'importante',
  medium: 'medii',
  low: 'minore',
};

function fmtCount(ev: CampaignEvaluation): string {
  const by: Record<string, number> = {};
  for (const i of ev.issues) by[i.priority] = (by[i.priority] ?? 0) + 1;
  const parts = ['critical', 'high', 'medium', 'low']
    .filter((p) => by[p])
    .map((p) => `${by[p]} ${PRIORITY_RO[p]}`);
  return parts.length ? parts.join(', ') : 'nicio problemă';
}

@Injectable()
export class GoogleAdsMonitorService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsMonitorService.name);

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly optimizer: GoogleAdsOptimizerService,
    private readonly workflow: GoogleAdsProposalWorkflowService,
    @Optional() private readonly scope?: GoogleAdsAccountScopeService,
  ) {}

  onModuleInit(): void {
    // First check one poll after boot, not at boot: lets the API client
    // finish loading credentials and keeps restarts cheap.
    setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (!this.client.configured) return;
    if (!(await this.settings.googleAdsAgentEnabled())) return;
    if (!(await this.isDue())) return;
    try {
      await this.run('schedule');
    } catch (err) {
      this.logger.error(
        'Google Ads monitor cycle crashed.',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private async isDue(): Promise<boolean> {
    const [intervalMinutes, lastRun] = await Promise.all([
      this.settings.googleAdsAgentMonitorIntervalMinutes(),
      this.prisma.googleAdsAgentRun.findFirst({
        where: { kind: 'monitor' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    if (!lastRun) return true;
    return Date.now() - lastRun.startedAt.getTime() >= intervalMinutes * 60_000;
  }

  /** True while a monitor cycle holds the lock (for the admin panel). */
  async inProgress(): Promise<boolean> {
    const r = await this.prisma.googleAdsAgentRun.findFirst({
      where: {
        kind: 'monitor',
        status: 'in_progress',
        startedAt: { gte: new Date(Date.now() - STALE_LOCK_MS) },
      },
    });
    return !!r;
  }

  async run(trigger: MonitorTrigger): Promise<void> {
    if (!this.client.configured)
      throw new Error('Contul Google Ads nu este conectat (lipsesc datele de acces din Setări).');
    await this.scope?.ensure();
    const existing = await this.prisma.googleAdsAgentRun.findFirst({
      where: { kind: 'monitor', status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      if (Date.now() - existing.startedAt.getTime() < STALE_LOCK_MS) {
        this.logger.warn('Monitor cycle already in progress — skipping.');
        return;
      }
      await this.prisma.googleAdsAgentRun.update({
        where: { id: existing.id },
        data: { status: 'failed', finishedAt: new Date(), errorSummary: 'stale lock — superseded' },
      });
    }

    const run = await this.prisma.googleAdsAgentRun.create({ data: { kind: 'monitor' } });
    const activity = new AgentActivity(this.prisma, run.id);
    let scanned = 0;
    let applied = 0;
    let proposed = 0;
    let cost = 0;
    let hadError = false;
    /** Campaigns this cycle actually changed (applied + verified). */
    const changedIds = new Set<string>();

    try {
      await activity.record(
        {
          step: 'cycle',
          message:
            trigger === 'manual'
              ? 'Ciclu pornit manual de un administrator'
              : 'Ciclu programat de monitorizare pornit',
        },
        {
          result: this.client.writesAllowed
            ? 'Mod complet: analiză + aplicarea optimizărilor autorizate.'
            : 'Mod doar-citire (mediu non-producție): analiză completă, modificările sunt doar validate la Google, nu aplicate.',
        },
      );

      const data = await activity.step(
        { step: 'sync', message: 'Sincronizare date campanii din Google Ads' },
        async () => {
          const d = await fetchAccountData(this.client);
          return {
            value: d,
            outcome: {
              result: `${d.campaigns.length} campanii citite prin ${d.queriesRun} interogări (perioada ${d.period.current.from} – ${d.period.current.to}, comparată cu ${d.period.previous.from} – ${d.period.previous.to}).`,
            },
          };
        },
      );
      scanned = data.campaigns.length;

      const mappings = await this.prisma.googleAdsSubcategoryCampaign.findMany({
        where: { googleCampaignId: { not: null } },
        include: { category: { include: { parent: true } } },
      });
      const mappingByCampaign = new Map<string, MappingWithCategory>(
        mappings.map((m) => [m.googleCampaignId!, m]),
      );

      const urlChecks = await this.checkUrls(data.campaigns, activity);

      const evaluated: {
        c: CampaignData;
        ev: CampaignEvaluation;
        mapping?: MappingWithCategory;
      }[] = [];
      for (const c of data.campaigns) {
        const mapping = mappingByCampaign.get(c.googleCampaignId);
        try {
          const ev = evaluateCampaign(c, { managed: !!mapping, urlChecks });
          await this.recordAnalysis(c, ev, activity);
          await this.saveSnapshot(c, ev, mapping);
          evaluated.push({ c, ev, mapping });
        } catch (err) {
          hadError = true;
          this.logger.error(
            `Evaluation failed for campaign ${c.googleCampaignId}.`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
      await this.prisma.googleAdsCampaignSnapshot.deleteMany({
        where: { googleCampaignId: { notIn: data.campaigns.map((c) => c.googleCampaignId) } },
      });

      const generateAllowed = this.client.writesAllowed || trigger === 'manual';

      // Policy compliance first, for EVERY agent campaign: a disapproved
      // text, asset or keyword blocks serving, so it is fixed before any
      // other optimization (Google's validation feeds rejected rewrites
      // back to the AI). Fixed campaigns are re-read so the next steps work
      // on what is live now.
      if (generateAllowed) {
        const policyFixed = new Set<string>();
        for (const e of evaluated.filter((x) => x.mapping)) {
          try {
            const r = await this.optimizer.fixPolicyViolations(
              e.c,
              this.optimizer.platformTarget(e.mapping!),
              activity,
            );
            if (r.applied) {
              policyFixed.add(e.c.googleCampaignId);
              changedIds.add(e.c.googleCampaignId);
            }
            applied += r.applied;
            cost += r.costEstimateMinor;
          } catch (err) {
            hadError = true;
            this.logger.error(
              `Policy fix failed for ${e.c.googleCampaignId}.`,
              err instanceof Error ? err.stack : err,
            );
          }
        }
        if (policyFixed.size) {
          const fresh = await fetchAccountData(this.client);
          for (const c of fresh.campaigns.filter((x) => policyFixed.has(x.googleCampaignId))) {
            const i = evaluated.findIndex((e) => e.c.googleCampaignId === c.googleCampaignId);
            if (i >= 0)
              evaluated[i] = {
                ...evaluated[i],
                c,
                ev: evaluateCampaign(c, { managed: true, urlChecks }),
              };
          }
        }
      }

      // Optimize: managed, not removed, has something the agent may fix;
      // lowest score first.
      const candidates = evaluated
        .filter((e) => e.mapping && e.ev.issues.some((i) => i.autoFixable))
        .sort((a, b) => (a.ev.score ?? 100) - (b.ev.score ?? 100));
      const autoFillOn = await this.settings.googleAdsAgentAutoFillGapsEnabled();
      await activity.record(
        { step: 'prioritize', message: 'Prioritizare optimizări' },
        {
          result: candidates.length
            ? `${candidates.length} campanii ale agentului au lipsuri pe care le poate completa; în acest ciclu: ${Math.min(candidates.length, MAX_OPTIMIZED_PER_CYCLE)} (cele cu scorul cel mai mic).` +
              (generateAllowed
                ? ''
                : ' Generarea de texte este omisă în ciclurile programate în mod doar-citire.') +
              (autoFillOn
                ? ''
                : ' ATENȚIE: completarea automată este oprită din Setări, deci lipsurile NU se completează în acest ciclu (doar analiză și propuneri).')
            : 'Nicio campanie a agentului nu are lipsuri pe care să le poată completa automat.',
        },
      );
      if (generateAllowed) {
        for (const e of candidates.slice(0, MAX_OPTIMIZED_PER_CYCLE)) {
          try {
            const r = await this.optimizer.fillGaps(
              e.c,
              e.ev,
              this.optimizer.platformTarget(e.mapping!),
              activity,
            );
            if (r.applied) changedIds.add(e.c.googleCampaignId);
            applied += r.applied;
            cost += r.costEstimateMinor;
          } catch (err) {
            hadError = true;
            this.logger.error(
              `Optimization failed for ${e.c.googleCampaignId}.`,
              err instanceof Error ? err.stack : err,
            );
          }
        }
        // Headline keyword monitoring: missing ad-group keywords that hold
        // Ad Strength back are written into the headlines (automatic, same
        // policy as gap filling; Ad Strength read back, restored if worse).
        // Campaigns whose ad text changed this cycle wait for Google first.
        for (const e of evaluated.filter(
          (x) =>
            x.mapping &&
            !changedIds.has(x.c.googleCampaignId) &&
            x.ev.issues.some((i) => i.code === 'headlines_missing_keywords'),
        )) {
          try {
            const r = await this.optimizer.fixHeadlineKeywords(
              e.c,
              this.optimizer.platformTarget(e.mapping!),
              activity,
            );
            if (r.applied) changedIds.add(e.c.googleCampaignId);
            applied += r.applied;
            cost += r.costEstimateMinor;
          } catch (err) {
            hadError = true;
            this.logger.error(
              `Headline keyword fix failed for ${e.c.googleCampaignId}.`,
              err instanceof Error ? err.stack : err,
            );
          }
        }
        for (const e of evaluated.filter((x) => x.mapping)) {
          try {
            const r = await this.optimizer.proposeReplacements(
              e.c,
              this.optimizer.platformTarget(e.mapping!),
              activity,
            );
            proposed += r.proposed;
            cost += r.costEstimateMinor;
            // Complete ads still rated POOR/AVERAGE by Google: rewrite
            // proposals (approval required). Skipped for campaigns changed
            // in this cycle — Google re-evaluates them first.
            if (!changedIds.has(e.c.googleCampaignId)) {
              const s = await this.optimizer.proposeAdStrengthRewrite(
                e.c,
                this.optimizer.platformTarget(e.mapping!),
                activity,
              );
              proposed += s.proposed;
              cost += s.costEstimateMinor;
            }
          } catch (err) {
            hadError = true;
            this.logger.error(
              `Replacement proposals failed for ${e.c.googleCampaignId}.`,
              err instanceof Error ? err.stack : err,
            );
          }
        }
      }

      // Re-read the changed campaigns from Google so the score shown reflects
      // what is live now, not the state before this cycle's changes.
      if (changedIds.size) {
        await activity
          .step(
            { step: 'rescore', message: 'Recalculare scor după optimizări (recitire din Google)' },
            async () => {
              const fresh = await fetchAccountData(this.client);
              const before = new Map(evaluated.map((e) => [e.c.googleCampaignId, e.ev.score]));
              const lines: string[] = [];
              for (const c of fresh.campaigns.filter((x) => changedIds.has(x.googleCampaignId))) {
                const mapping = mappingByCampaign.get(c.googleCampaignId);
                const ev = evaluateCampaign(c, { managed: !!mapping, urlChecks });
                await this.saveSnapshot(c, ev, mapping);
                lines.push(
                  `${c.name}: ${before.get(c.googleCampaignId) ?? '–'} → ${ev.score ?? '–'}`,
                );
              }
              return {
                value: lines.length,
                outcome: {
                  result:
                    `Scor actualizat pentru ${lines.length} campanii: ${lines.join('; ')}.` +
                    ' Ad Strength poate apărea „în curs” câteva ore, cât timp Google reevaluează reclamele.',
                },
              };
            },
          )
          .catch(() => 0);
      }

      // Performance observation ~30 days after each executed change, from
      // the data synced in this very cycle (no extra Google request).
      await activity
        .step(
          {
            step: 'observe',
            message: 'Observare performanță după modificările executate (30 de zile)',
          },
          async () => {
            const n = await this.workflow.observePerformance(data.campaigns);
            return {
              value: n,
              outcome: {
                status: n ? 'completed' : 'skipped',
                result: n
                  ? `${n} modificări au acum o observație de performanță la 30 de zile după execuție.`
                  : 'Nicio modificare executată nu a ajuns încă la 30 de zile.',
              },
            };
          },
        )
        .catch(() => 0);

      const pruned = await AgentActivity.prune(this.prisma);
      await activity.record(
        { step: 'cycle', message: 'Ciclu încheiat' },
        {
          status: hadError ? 'failed' : 'completed',
          result:
            `${scanned} campanii analizate, ${applied} optimizări aplicate și verificate, ${proposed} propuneri noi pentru aprobare.` +
            (pruned ? ` ${pruned} evenimente mai vechi de 30 de zile șterse.` : '') +
            (hadError ? ' Unele campanii au avut erori (vezi jurnalul).' : '') +
            (autoFillOn
              ? ''
              : ' Completarea automată este oprită din Setări: activeaz-o ca agentul să rezolve lipsurile.'),
        },
      );
      await this.prisma.googleAdsAgentRun.update({
        where: { id: run.id },
        data: {
          status: hadError ? 'partial' : 'success',
          finishedAt: new Date(),
          categoriesScanned: scanned,
          actionsTaken: applied,
          actionsPendingApproval: proposed,
          claudeCostEstimateMinor: cost,
        },
      });
    } catch (err) {
      const errorSummary = err instanceof Error ? err.message : String(err);
      await activity.record(
        { step: 'cycle', message: 'Ciclu întrerupt' },
        { status: 'failed', result: errorSummary },
      );
      await this.prisma.googleAdsAgentRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          categoriesScanned: scanned,
          actionsTaken: applied,
          errorSummary,
        },
      });
      await notifyAdminsOfFailedGoogleAdsAgentRun(
        this.notifications,
        this.prisma,
        'monitor',
        errorSummary,
      );
      throw err;
    }
  }

  /** HEAD (GET fallback) on every distinct final URL, a few at a time. */
  private async checkUrls(
    campaigns: CampaignData[],
    activity: AgentActivity,
  ): Promise<Map<string, UrlCheck>> {
    const urls = [
      ...new Set(
        campaigns
          .filter((c) => c.status === 'ENABLED' || c.status === 'PAUSED')
          .flatMap((c) => [
            ...c.ads.flatMap((a) => a.finalUrls),
            ...c.assetGroups.flatMap((g) => g.finalUrls),
          ]),
      ),
    ].slice(0, MAX_URLS_CHECKED);
    const results = new Map<string, UrlCheck>();
    if (!urls.length) return results;
    return activity.step(
      { step: 'urls', message: `Verificare pagini de destinație (${urls.length} URL-uri)` },
      async () => {
        const queue = [...urls];
        const worker = async () => {
          for (let url = queue.shift(); url; url = queue.shift())
            results.set(url, await this.checkUrl(url));
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        const broken = [...results.values()].filter((r) => !r.ok);
        return {
          value: results,
          outcome: {
            result: broken.length
              ? `${broken.length} din ${urls.length} nu răspund corect: ${broken.map((b) => `${b.url} (${b.status ?? b.error})`).join(', ')}`
              : `Toate cele ${urls.length} pagini răspund corect.`,
            details: [...results.values()] as unknown as Prisma.InputJsonValue,
          },
        };
      },
    );
  }

  private async checkUrl(url: string): Promise<UrlCheck> {
    const attempt = async (method: 'HEAD' | 'GET') => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), URL_TIMEOUT_MS);
      try {
        return await fetch(url, {
          method,
          redirect: 'follow',
          signal: ctrl.signal,
          headers: { 'User-Agent': 'TotalvizibilAdsMonitor/1.0' },
        });
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      let res = await attempt('HEAD');
      // Some servers reject HEAD; only a GET failure counts as broken.
      if (res.status === 405 || res.status === 403 || res.status === 501)
        res = await attempt('GET');
      return { url, ok: res.status < 400, status: res.status };
    } catch (err) {
      return {
        url,
        ok: false,
        status: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** One activity event per analysed area, with what was actually found. */
  private async recordAnalysis(
    c: CampaignData,
    ev: CampaignEvaluation,
    activity: AgentActivity,
  ): Promise<void> {
    const meta = { googleCampaignId: c.googleCampaignId, campaignName: c.name };
    const comp = (key: string) => ev.components.find((x) => x.key === key);
    const issuesIn = (...areas: string[]) => ev.issues.filter((i) => areas.includes(i.area));
    const line = (key: string, label: string) => {
      const x = comp(key);
      if (!x) return null;
      return x.status === 'na' ? `${label}: neevaluabil` : `${label}: ${x.earned}/${x.max}`;
    };
    const statusOf = (areas: string[]) => {
      const list = issuesIn(...areas);
      return list.length
        ? `${list.length} probleme: ${list
            .slice(0, 3)
            .map((i) => i.title)
            .join('; ')}`
        : 'în regulă';
    };
    const p = ev.performance;
    const fmtPct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(2)}%`);

    await activity.record(
      { ...meta, step: 'performance', message: 'Verificare performanță (30 de zile)' },
      {
        result:
          `${p.current.impressions} afișări, ${p.current.clicks} clicuri, CTR ${fmtPct(p.current.ctr)}, ${p.current.conversions} conversii, cost ${(p.current.costMicros / 1e6).toFixed(2)} ${c.currencyCode ?? ''}. ` +
          (p.comparable
            ? `Față de perioada anterioară: CTR ${p.ctrChange === null ? 'n/a' : `${Math.round(p.ctrChange * 100)}%`}.`
            : 'Prea puține afișări pentru o comparație cu perioada anterioară.') +
          ` ${statusOf(['performance', 'serving'])}`,
      },
    );
    await activity.record(
      { ...meta, step: 'headlines', message: 'Analiză titluri și descrieri' },
      {
        result: [
          `${ev.assets.headlines.length} titluri, ${ev.assets.descriptions.length} descrieri` +
            (ev.assets.longHeadlines.length
              ? `, ${ev.assets.longHeadlines.length} titluri lungi`
              : '') +
            '.',
          line('headlines', 'Titluri'),
          line('descriptions', 'Descrieri'),
          statusOf(['headlines', 'descriptions', 'long_headlines']),
        ]
          .filter(Boolean)
          .join(' '),
      },
    );
    await activity.record(
      { ...meta, step: 'assets', message: 'Verificare sitelink-uri, callout-uri și snippets' },
      {
        result: `${ev.assets.sitelinks.length} sitelink-uri, ${ev.assets.callouts.length} callout-uri, ${ev.assets.structuredSnippets} snippets. ${statusOf(['sitelinks', 'callouts', 'snippets'])}`,
      },
    );
    await activity.record(
      {
        ...meta,
        step: 'images',
        message: 'Verificare imagini (format, dimensiuni, mărime fișier)',
      },
      {
        result: `${ev.assets.images.length} imagini (${ev.assets.images.filter((i) => i.valid).length} valide). ${statusOf(['images'])}`,
      },
    );
    if (c.channelType === 'PERFORMANCE_MAX') {
      await activity.record(
        { ...meta, step: 'videos', message: 'Verificare videoclipuri' },
        {
          result: `${ev.assets.videos.length} videoclipuri. Durata și orientarea nu sunt expuse de API-ul Google Ads. ${statusOf(['videos'])}`,
        },
      );
    }
    await activity.record(
      { ...meta, step: 'logos', message: 'Verificare logo și nume afacere' },
      {
        result: `${ev.assets.logos.length} logo-uri (${ev.assets.logos.filter((l) => l.valid).length} valide), nume afacere: ${ev.assets.businessName ?? 'lipsă'}. ${statusOf(['logos', 'brand'])}`,
      },
    );
    await activity.record(
      { ...meta, step: 'policy', message: 'Verificare aprobări Google și pagini de destinație' },
      { result: statusOf(['policy', 'landing_page']) },
    );
    await activity.record(
      { ...meta, step: 'score', message: 'Calcul scor de optimizare' },
      {
        result:
          `Scor ${ev.score ?? 'n/a'}${ev.score !== null ? '/100' : ''}` +
          `${ev.adStrength ? `, Ad Strength Google: ${ev.adStrength}` : ''}. Probleme: ${fmtCount(ev)}.`,
        details: { score: ev.score },
      },
    );
  }

  private async saveSnapshot(
    c: CampaignData,
    ev: CampaignEvaluation,
    mapping?: MappingWithCategory,
  ): Promise<void> {
    const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
    const data = {
      name: c.name,
      channelType: c.channelType,
      status: c.status,
      primaryStatus: c.primaryStatus ?? null,
      primaryStatusReasons: c.primaryStatusReasons,
      biddingStrategyType: c.biddingStrategyType ?? null,
      managed: !!mapping,
      categoryId: mapping?.categoryId ?? null,
      currencyCode: c.currencyCode ?? null,
      dailyBudgetMicros: c.dailyBudgetMicros ?? null,
      metrics: json({ ...ev.performance, periodDays: 30 }),
      adStrength: ev.adStrength,
      score: ev.score,
      scoreBreakdown: json(ev.components),
      issues: json(ev.issues),
      assets: json(ev.assets),
      syncedAt: new Date(),
    };
    await this.prisma.googleAdsCampaignSnapshot.upsert({
      where: { googleCampaignId: c.googleCampaignId },
      create: { googleCampaignId: c.googleCampaignId, ...data },
      update: data,
    });
  }
}
