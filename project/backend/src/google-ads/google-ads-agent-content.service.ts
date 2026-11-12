import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { AppConfig } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { notifyAdminsOfFailedGoogleAdsAgentRun } from './google-ads-agent-alerts';
import { GoogleAdsApiClient } from './google-ads-api-client.service';
import { subcategoryLandingUrl } from './google-ads-landing-url';

/** Fixed, short poll period — only "is it time yet" is admin-configurable
 *  (`googleAdsAgentContentIntervalMinutes`, read live on every tick via
 *  `isDue()`), not this — same shape as the structural pass. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;

type MappingWithCategory = Prisma.GoogleAdsSubcategoryCampaignGetPayload<{
  include: { category: { include: { parent: true } } };
}>;

function resourceId(resourceName: string | undefined): string | null {
  if (!resourceName) return null;
  const id = resourceName.split('/').pop();
  return id || null;
}

/**
 * Faza 3 (docs/ai/GOOGLE-ADS-AGENT-PLAN.md), content half: turns a
 * `pending_creation` campaign skeleton (created by the structural pass,
 * already PAUSED with no ads) into a real, running campaign — generates
 * keywords + one Responsive Search Ad via Claude, writes them, and only
 * THEN flips the campaign to ENABLED and the local status to `active`.
 * There is no other path to `active`: a campaign the agent created can
 * never start spending before it actually has ad content.
 *
 * Runs on its own cadence (admin-configurable, default 6h — see `isDue()`),
 * separately from the structural pass, so that one stays Claude-free as the
 * plan requires. `OnModuleInit` + a short fixed poll, same shape as
 * `GoogleAdsAgentStructuralService` — see its doc comment for why not
 * `@nestjs/schedule`, and for why the interval itself isn't the thing
 * `setInterval` is given.
 */
@Injectable()
export class GoogleAdsAgentContentService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsAgentContentService.name);
  private readonly frontendOrigin: string;

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly ai: AiService,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  onModuleInit(): void {
    void this.tick();
    setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (!this.client.configured || !this.ai.configured) return;
    if (!(await this.settings.googleAdsAgentEnabled())) return;
    if (!(await this.isDue())) return;
    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        'Google Ads content pass crashed outside the per-campaign error handling.',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** Has at least `googleAdsAgentContentIntervalMinutes()` elapsed since the
   *  last content run (of any outcome)? A run with no prior history is
   *  always due. */
  private async isDue(): Promise<boolean> {
    const [intervalMinutes, lastRun] = await Promise.all([
      this.settings.googleAdsAgentContentIntervalMinutes(),
      this.prisma.googleAdsAgentRun.findFirst({
        where: { kind: 'content' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    if (!lastRun) return true;
    return Date.now() - lastRun.startedAt.getTime() >= intervalMinutes * 60_000;
  }

  /** Exposed for an admin "Run now" / "Regenerate" trigger (Faza 4). */
  async run(): Promise<void> {
    const existing = await this.prisma.googleAdsAgentRun.findFirst({
      where: { kind: 'content', status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      const ageMs = Date.now() - existing.startedAt.getTime();
      if (ageMs < STALE_LOCK_MS) {
        this.logger.warn('Content pass already in progress — skipping this tick.');
        return;
      }
      await this.prisma.googleAdsAgentRun.update({
        where: { id: existing.id },
        data: { status: 'failed', finishedAt: new Date(), errorSummary: 'stale lock — superseded' },
      });
    }

    const run = await this.prisma.googleAdsAgentRun.create({ data: { kind: 'content' } });
    let categoriesScanned = 0;
    let actionsTaken = 0;
    let claudeCostEstimateMinor = 0;
    let hadError = false;

    try {
      const pending = await this.prisma.googleAdsSubcategoryCampaign.findMany({
        where: { status: 'pending_creation' },
        include: { category: { include: { parent: true } } },
      });

      for (const mapping of pending) {
        categoriesScanned++;
        try {
          const result = await this.generateAndActivate(mapping);
          if (result.activated) actionsTaken++;
          claudeCostEstimateMinor += result.costEstimateMinor;
        } catch (err) {
          hadError = true;
          this.logger.error(
            `Content generation failed for category '${mapping.category.slug}' (${mapping.categoryId}).`,
            err instanceof Error ? err.stack : err,
          );
        }
      }

      await this.prisma.googleAdsAgentRun.update({
        where: { id: run.id },
        data: {
          status: hadError ? 'partial' : 'success',
          finishedAt: new Date(),
          categoriesScanned,
          actionsTaken,
          claudeCostEstimateMinor,
        },
      });
    } catch (err) {
      const errorSummary = err instanceof Error ? err.message : String(err);
      await this.prisma.googleAdsAgentRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          categoriesScanned,
          actionsTaken,
          claudeCostEstimateMinor,
          errorSummary,
        },
      });
      await notifyAdminsOfFailedGoogleAdsAgentRun(this.notifications, this.prisma, 'content', errorSummary);
      throw err;
    }
  }

  /** Returns whether the campaign was actually activated this run, and a
   *  rough Claude cost estimate for the one call made (0 if the call
   *  itself failed — no partial usage to estimate from). */
  private async generateAndActivate(
    mapping: MappingWithCategory,
  ): Promise<{ activated: boolean; costEstimateMinor: number }> {
    const category = mapping.category;
    const businessNames = (
      await this.prisma.company.findMany({
        where: { status: 'active', categoryAssignments: { some: { categoryId: category.id } } },
        select: { displayName: true },
        take: 5,
      })
    ).map((c) => c.displayName);

    const landingUrl = subcategoryLandingUrl(category, this.frontendOrigin);
    const categoryName = this.plainName(category.nameI18n);
    const parentCategoryName = category.parent ? this.plainName(category.parent.nameI18n) : undefined;

    const plan = await this.ai.googleAdsKeywordPlan({
      categoryName,
      parentCategoryName,
      landingUrl,
      businessNames,
    });
    if (!plan) {
      this.logger.warn(
        `No usable Google Ads keyword plan for category '${category.slug}' — leaving it pending_creation.`,
      );
      return { activated: false, costEstimateMinor: 0 };
    }

    if (!mapping.googleAdGroupId || !mapping.googleCampaignId) {
      throw new Error(`Mapping for category '${category.slug}' is pending_creation without IDs.`);
    }
    const adGroupResourceName = `customers/${this.client.customerId}/adGroups/${mapping.googleAdGroupId}`;
    const campaignResourceName = `customers/${this.client.customerId}/campaigns/${mapping.googleCampaignId}`;

    const keywordOps = plan.keywords.map((text) => ({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResourceName,
          status: 'ENABLED',
          keyword: { text, matchType: 'PHRASE' },
        },
      },
    }));

    const adOp = {
      adGroupAdOperation: {
        create: {
          adGroup: adGroupResourceName,
          status: 'ENABLED',
          ad: {
            finalUrls: [landingUrl],
            responsiveSearchAd: {
              headlines: plan.headlines.map((text) => ({ text })),
              descriptions: plan.descriptions.map((text) => ({ text })),
            },
          },
        },
      },
    };

    const enableOp = {
      campaignOperation: {
        update: { resourceName: campaignResourceName, status: 'ENABLED' },
        updateMask: 'status',
      },
    };

    await this.client.mutate([...keywordOps, adOp, enableOp]);

    await this.prisma.$transaction([
      this.prisma.googleAdsSubcategoryCampaign.update({
        where: { id: mapping.id },
        data: { status: 'active', lastStructuralCheckAt: new Date() },
      }),
      this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId: category.id,
          action: 'keywords.updated',
          status: 'applied',
          after: {
            keywordCount: plan.keywords.length,
            headlineCount: plan.headlines.length,
            descriptionCount: plan.descriptions.length,
            landingUrl,
          },
          reasoning:
            'Generat plan de cuvinte cheie + reclamă (Claude) și activat campania — ' +
            'prima dată când această subcategorie are reclame reale.',
        },
      }),
    ]);

    return { activated: true, costEstimateMinor: plan.costEstimateMinor };
  }

  private plainName(nameI18n: Prisma.JsonValue): string {
    if (nameI18n && typeof nameI18n === 'object' && !Array.isArray(nameI18n)) {
      const obj = nameI18n as Record<string, unknown>;
      const ro = obj.ro;
      if (typeof ro === 'string' && ro) return ro;
      const first = Object.values(obj).find((v) => typeof v === 'string' && v);
      if (typeof first === 'string') return first;
    }
    return '';
  }
}
