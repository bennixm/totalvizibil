import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { notifyAdminsOfFailedGoogleAdsAgentRun } from './google-ads-agent-alerts';
import { GoogleAdsApiClient } from './google-ads-api-client.service';
import { creditsToAmountMicros } from './google-ads-money';
import { GoogleAdsReferenceDataService } from './google-ads-reference-data.service';

/** Fixed, short poll period — only "is it time yet" is admin-configurable
 *  (`googleAdsAgentStructuralIntervalMinutes`, read live on every tick via
 *  `isDue()`), not this. A short fixed poll + a DB-read due-check means an
 *  admin-changed interval takes effect on the very next tick, with no
 *  `setInterval` to tear down and recreate. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
/** A run stuck `in_progress` longer than this is treated as abandoned (e.g.
 *  the process crashed mid-run) rather than genuinely still running, so a
 *  dead lock can never wedge every future tick. */
const STALE_LOCK_MS = 30 * 60 * 1000;

type CategoryWithMapping = Prisma.CategoryGetPayload<{
  include: { parent: true; googleAdsCampaign: true };
}>;

/** Pulls the trailing numeric id off a Google Ads resource name, e.g.
 *  `customers/123/campaigns/456` → `456`. */
function resourceId(resourceName: string | undefined): string | null {
  if (!resourceName) return null;
  const id = resourceName.split('/').pop();
  return id || null;
}

/**
 * Structural pass (Faza 2 — see docs/ai/GOOGLE-ADS-AGENT-PLAN.md): purely
 * deterministic, no Claude call, runs every `googleAdsAgentStructuralIntervalMinutes`
 * (admin-settable, default 6h — see `isDue()`). Per leaf subcategory
 * (`Category` with a `parentId`):
 *  - 0 active companies, campaign currently active → pause it.
 *  - ≥1 active company, no campaign yet → create a skeleton (budget +
 *    campaign + geo/language targeting + ad group). The campaign is
 *    created PAUSED and the ad group has no keywords/ads — both are added
 *    by the budget-intelligence pass (Faza 3) — so this can never spend
 *    money on its own; that's what makes it safe to apply without admin
 *    approval, same as the pause/resume actions below.
 *  - ≥1 active company, campaign currently paused (and already had ads —
 *    i.e. not `pending_creation`) → resume it.
 *
 * `OnModuleInit` + a short fixed `setInterval` poll (`POLL_INTERVAL_MS`,
 * in-process, single instance) — the actual cadence is an admin-configurable
 * DB setting checked on every poll (`isDue()`), not baked into the interval
 * itself, so a change takes effect on the next tick with no restart. Locking
 * against overlapping runs is a separate app-level row in `GoogleAdsAgentRun`
 * (`status: in_progress`), not a DB constraint — good enough for this
 * single-instance deployment; see that model's doc comment.
 */
@Injectable()
export class GoogleAdsAgentStructuralService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAdsAgentStructuralService.name);

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly refData: GoogleAdsReferenceDataService,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    void this.tick();
    setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (!this.client.configured) return;
    if (!(await this.settings.googleAdsAgentEnabled())) return;
    if (!(await this.isDue())) return;
    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        'Google Ads structural pass crashed outside the per-run error handling.',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** Has at least `googleAdsAgentStructuralIntervalMinutes()` elapsed since
   *  the last structural run (of any outcome)? Reads both live from the DB
   *  on every tick — the only way this job's cadence is "admin-configurable
   *  without a restart". A run with no prior history is always due. */
  private async isDue(): Promise<boolean> {
    const [intervalMinutes, lastRun] = await Promise.all([
      this.settings.googleAdsAgentStructuralIntervalMinutes(),
      this.prisma.googleAdsAgentRun.findFirst({
        where: { kind: 'structural' },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    if (!lastRun) return true;
    return Date.now() - lastRun.startedAt.getTime() >= intervalMinutes * 60_000;
  }

  /** Runs one full structural pass. Exposed (not private) so the admin "Run
   *  now" endpoint can trigger it directly, outside its own cadence. */
  async run(): Promise<void> {
    const existing = await this.prisma.googleAdsAgentRun.findFirst({
      where: { kind: 'structural', status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      const ageMs = Date.now() - existing.startedAt.getTime();
      if (ageMs < STALE_LOCK_MS) {
        this.logger.warn('Structural pass already in progress — skipping this tick.');
        return;
      }
      this.logger.warn(
        `Structural run ${existing.id} has been in_progress for ${Math.round(ageMs / 60_000)}min — ` +
          'treating it as abandoned and starting a new one.',
      );
      await this.prisma.googleAdsAgentRun.update({
        where: { id: existing.id },
        data: { status: 'failed', finishedAt: new Date(), errorSummary: 'stale lock — superseded' },
      });
    }

    const run = await this.prisma.googleAdsAgentRun.create({ data: { kind: 'structural' } });
    let categoriesScanned = 0;
    let actionsTaken = 0;
    let hadError = false;

    try {
      const categories = await this.prisma.category.findMany({
        where: { parentId: { not: null }, isActive: true },
        include: { parent: true, googleAdsCampaign: true },
      });

      for (const category of categories) {
        categoriesScanned++;
        try {
          if (await this.reconcileCategory(category)) actionsTaken++;
        } catch (err) {
          hadError = true;
          this.logger.error(
            `Structural reconcile failed for category '${category.slug}' (${category.id}).`,
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
          errorSummary,
        },
      });
      await notifyAdminsOfFailedGoogleAdsAgentRun(
        this.notifications,
        this.prisma,
        'structural',
        errorSummary,
      );
      throw err;
    }
  }

  /** Returns true iff this category caused a real action (create/pause/resume). */
  private async reconcileCategory(category: CategoryWithMapping): Promise<boolean> {
    const activeCompanyCount = await this.prisma.companyCategory.count({
      where: { categoryId: category.id, company: { status: 'active' } },
    });
    const mapping = category.googleAdsCampaign;

    if (activeCompanyCount === 0) {
      if (mapping?.status === 'active') {
        await this.pauseCampaign(category.id, mapping);
        return true;
      }
      if (mapping) await this.touch(mapping.id);
      return false;
    }

    if (!mapping) {
      await this.createSkeleton(category);
      return true;
    }
    if (mapping.status === 'paused') {
      await this.resumeCampaign(category.id, mapping);
      return true;
    }
    await this.touch(mapping.id);
    return false;
  }

  private touch(mappingId: string) {
    return this.prisma.googleAdsSubcategoryCampaign.update({
      where: { id: mappingId },
      data: { lastStructuralCheckAt: new Date() },
    });
  }

  private async pauseCampaign(
    categoryId: string,
    mapping: NonNullable<CategoryWithMapping['googleAdsCampaign']>,
  ): Promise<void> {
    await this.client.mutate([
      {
        campaignOperation: {
          update: {
            resourceName: `customers/${this.client.customerId}/campaigns/${mapping.googleCampaignId}`,
            status: 'PAUSED',
          },
          updateMask: 'status',
        },
      },
    ]);

    await this.prisma.$transaction([
      this.prisma.googleAdsSubcategoryCampaign.update({
        where: { id: mapping.id },
        data: { status: 'paused', lastStructuralCheckAt: new Date() },
      }),
      this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId,
          action: 'campaign.pause',
          status: 'applied',
          before: { status: mapping.status },
          after: { status: 'paused' },
          reasoning: '0 firme active în subcategorie — campania Google Ads a fost pusă pe pauză.',
        },
      }),
    ]);
  }

  private async resumeCampaign(
    categoryId: string,
    mapping: NonNullable<CategoryWithMapping['googleAdsCampaign']>,
  ): Promise<void> {
    await this.client.mutate([
      {
        campaignOperation: {
          update: {
            resourceName: `customers/${this.client.customerId}/campaigns/${mapping.googleCampaignId}`,
            status: 'ENABLED',
          },
          updateMask: 'status',
        },
      },
    ]);

    await this.prisma.$transaction([
      this.prisma.googleAdsSubcategoryCampaign.update({
        where: { id: mapping.id },
        data: { status: 'active', lastStructuralCheckAt: new Date() },
      }),
      this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId,
          action: 'campaign.resume',
          status: 'applied',
          before: { status: mapping.status },
          after: { status: 'active' },
          reasoning: '≥1 firmă activă în subcategorie — campania Google Ads a fost reactivată.',
        },
      }),
    ]);
  }

  /**
   * Creates the real Google Ads objects (budget, campaign, geo + language
   * targeting, ad group) in ONE atomic mutate call, then writes the local
   * mapping row only once that call actually returns resource names — never
   * records a mapping for objects we're not sure exist. The campaign is
   * created PAUSED and the ad group gets no keywords/ads here (Faza 3) —
   * see the class doc comment for why that makes this safe to auto-apply.
   */
  private async createSkeleton(category: CategoryWithMapping): Promise<void> {
    const [
      geoResourceName,
      langResourceName,
      currencyCode,
      eurRonRate,
      dailyBudgetCredits,
      maxCpcCredits,
    ] = await Promise.all([
      this.refData.getGeoTargetConstantRo(),
      this.refData.getLanguageConstantRo(),
      this.refData.getAccountCurrencyCode(),
      this.settings.eurRonRate(),
      this.settings.googleAdsAgentDefaultDailyBudgetCredits(),
      this.settings.googleAdsAgentDefaultMaxCpcCredits(),
    ]);

    const budgetMicros = creditsToAmountMicros(dailyBudgetCredits, currencyCode, eurRonRate);
    const cpcMicros = creditsToAmountMicros(maxCpcCredits, currencyCode, eurRonRate);

    const customerId = this.client.customerId;
    const budgetTempId = `customers/${customerId}/campaignBudgets/-1`;
    const campaignTempId = `customers/${customerId}/campaigns/-2`;
    const adGroupTempId = `customers/${customerId}/adGroups/-3`;
    const label = category.parent ? `${category.parent.slug}/${category.slug}` : category.slug;
    const shortId = category.id.slice(0, 8);

    const results = await this.client.mutate([
      {
        campaignBudgetOperation: {
          create: {
            resourceName: budgetTempId,
            name: `TVZ Subcat Budget - ${label} - ${shortId}`,
            amountMicros: budgetMicros,
            deliveryMethod: 'STANDARD',
          },
        },
      },
      {
        campaignOperation: {
          create: {
            resourceName: campaignTempId,
            name: `TVZ Subcat - ${label} - ${shortId}`,
            advertisingChannelType: 'SEARCH',
            status: 'PAUSED',
            campaignBudget: budgetTempId,
            manualCpc: {},
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: false,
              targetContentNetwork: false,
              targetPartnerSearchNetwork: false,
            },
            // Required on every Campaign.create since Google's 2025-09-03 EU
            // political-advertising transparency enforcement (REQUIRED field
            // error otherwise) — this platform runs local-business listing
            // ads, never political content.
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
          },
        },
      },
      {
        campaignCriterionOperation: {
          create: { campaign: campaignTempId, location: { geoTargetConstant: geoResourceName } },
        },
      },
      {
        campaignCriterionOperation: {
          create: { campaign: campaignTempId, language: { languageConstant: langResourceName } },
        },
      },
      {
        adGroupOperation: {
          create: {
            resourceName: adGroupTempId,
            name: `TVZ Subcat AdGroup - ${label}`,
            campaign: campaignTempId,
            status: 'ENABLED',
            type: 'SEARCH_STANDARD',
            cpcBidMicros: cpcMicros,
          },
        },
      },
    ]);

    const budgetId = resourceId(results[0]?.campaignBudgetResult?.resourceName);
    const campaignId = resourceId(results[1]?.campaignResult?.resourceName);
    const adGroupId = resourceId(results[4]?.adGroupResult?.resourceName);

    if (!budgetId || !campaignId || !adGroupId) {
      throw new Error(
        `Google Ads mutate for category '${category.slug}' skeleton creation did not return all ` +
          'expected resource names — not recording a local mapping for objects we cannot identify.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.googleAdsSubcategoryCampaign.create({
        data: {
          categoryId: category.id,
          googleCampaignId: campaignId,
          googleAdGroupId: adGroupId,
          googleBudgetResourceId: budgetId,
          status: 'pending_creation',
          dailyBudgetMinor: Math.round(dailyBudgetCredits * 100),
          maxCpcMinor: Math.round(maxCpcCredits * 100),
          lastStructuralCheckAt: new Date(),
        },
      }),
      this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId: category.id,
          action: 'campaign.create',
          status: 'applied',
          after: {
            googleCampaignId: campaignId,
            googleAdGroupId: adGroupId,
            dailyBudgetCredits,
            maxCpcCredits,
          },
          reasoning:
            'Subcategorie cu ≥1 firmă activă fără campanie Google Ads — creat schelet ' +
            '(campanie PAUSED, fără reclame/cuvinte cheie — urmează în Faza 3).',
        },
      }),
    ]);
  }
}
