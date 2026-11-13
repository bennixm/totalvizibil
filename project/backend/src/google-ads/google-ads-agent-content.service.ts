import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { AppConfig } from '../config/env';
import { PexelsProvider } from '../website/builder/generator/image-provider/pexels.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { notifyAdminsOfFailedGoogleAdsAgentRun } from './google-ads-agent-alerts';
import { GoogleAdsApiClient } from './google-ads-api-client.service';
import { subcategoryLandingUrl } from './google-ads-landing-url';
import { pushNegativesOntoSiblings } from './google-ads-negative-keywords';

/** ValueTrack suffix appended to every ad's final URL (research doc,
 *  Direction 6) — `{loc_physical_ms}` is the geo-target id of the click's
 *  PHYSICAL location (not `{loc_interest_ms}`, which is the location of
 *  INTEREST that triggered the ad, a different signal); `{gclid}` is
 *  Google's own click id. The frontend resolves `loc` back to a județ via
 *  `GET /geo/resolve-google-ads-county` and auto-filters the feed. Written
 *  WITHOUT a leading `?`/`&` — Google Ads appends the right separator
 *  itself based on whether the final URL already has a query string. */
const FINAL_URL_SUFFIX = 'loc={loc_physical_ms}&gclid={gclid}';

/** Fixed, short poll period — only "is it time yet" is admin-configurable
 *  (`googleAdsAgentContentIntervalMinutes`, read live on every tick via
 *  `isDue()`), not this — same shape as the structural pass. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;

type MappingWithCategory = Prisma.GoogleAdsSubcategoryCampaignGetPayload<{
  include: { category: { include: { parent: true } } };
}>;

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
  private readonly pexels: PexelsProvider;

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly ai: AiService,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
    this.pexels = new PexelsProvider(config.get('pexelsApiKey', { infer: true }) ?? '');
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
    let claudeInputTokens = 0;
    let claudeOutputTokens = 0;
    let claudeCallCount = 0;
    let claudeModel: string | null = null;
    let hadError = false;

    try {
      // Direction 3 (research doc): the one account-wide conversion action,
      // created once and reused forever. Best-effort — a failure here must
      // never stop ad content from going live; it only means the frontend's
      // `/platform/google-ads-conversion-tag` stays `configured: false` for
      // one more cycle.
      await this.ensureConversionAction().catch((err) =>
        this.logger.warn(
          'ensureConversionAction() failed — continuing without conversion tracking this run.',
          err instanceof Error ? err.stack : String(err),
        ),
      );

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
          if (result.model) {
            claudeInputTokens += result.inputTokens;
            claudeOutputTokens += result.outputTokens;
            claudeCallCount += 1;
            claudeModel = result.model;
          }
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
          claudeModel,
          claudeInputTokens,
          claudeOutputTokens,
          claudeCallCount,
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
          claudeModel,
          claudeInputTokens,
          claudeOutputTokens,
          claudeCallCount,
          errorSummary,
        },
      });
      await notifyAdminsOfFailedGoogleAdsAgentRun(
        this.notifications,
        this.prisma,
        'content',
        errorSummary,
      );
      throw err;
    }
  }

  /** Returns whether the campaign was actually activated this run, and a
   *  rough Claude cost estimate for the one call made (0 if the call
   *  itself failed — no partial usage to estimate from). */
  private async generateAndActivate(mapping: MappingWithCategory): Promise<{
    activated: boolean;
    costEstimateMinor: number;
    inputTokens: number;
    outputTokens: number;
    model: string | null;
  }> {
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
    const parentCategoryName = category.parent
      ? this.plainName(category.parent.nameI18n)
      : undefined;

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
      return {
        activated: false,
        costEstimateMinor: 0,
        inputTokens: 0,
        outputTokens: 0,
        model: null,
      };
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
            // Direction 6 (research doc): carries the click's physical
            // județ + Google's own click id through to the feed, which
            // auto-filters to it — see `FINAL_URL_SUFFIX`.
            finalUrlSuffix: FINAL_URL_SUFFIX,
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

    // Direction 1 (research doc): push this subcategory's own keywords as
    // negatives onto every SIBLING subcategory's shared set. Best-effort —
    // never blocks this campaign from activating (it already did, above).
    if (category.parentId) {
      try {
        await pushNegativesOntoSiblings(this.client, this.prisma, this.logger, {
          parentCategoryId: category.parentId,
          ownCategoryId: category.id,
          terms: plan.keywords,
        });
      } catch (err) {
        this.logger.warn(
          `pushNegativesOntoSiblings failed for '${category.slug}' — its own campaign is live regardless.`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    // Direction 2 (research doc): optional ad assets — callouts + one stock
    // image (CTR/quality, don't move the Ad Strength meter itself) and
    // sitelinks (the one asset type that DOES — see `addOptionalAdAssets`'s
    // doc comment). A SEPARATE, best-effort mutate call, never one that can
    // block the keywords+ad+enable batch above from going out.
    await this.addOptionalAdAssets(
      campaignResourceName,
      landingUrl,
      plan.callouts,
      plan.sitelinkLabels,
      plan.imageSearchQuery,
    ).catch((err) =>
      this.logger.warn(
        `addOptionalAdAssets failed for '${category.slug}' — its ad is live regardless.`,
        err instanceof Error ? err.stack : String(err),
      ),
    );

    return {
      activated: true,
      costEstimateMinor: plan.costEstimateMinor,
      inputTokens: plan.inputTokens,
      outputTokens: plan.outputTokens,
      model: plan.model,
    };
  }

  /**
   * Three kinds of optional ad assets, all attached directly to the
   * campaign, best-effort:
   *
   * - Sitelinks (`sitelinkLabels`): the one asset type Google's own Ad
   *   Strength documentation names as a scored factor alongside headlines/
   *   descriptions — "6 or more sitelinks ... improves your score" — and
   *   it's sitelink QUANTITY that counts, not distinct destinations. Every
   *   subcategory has exactly one landing page, so all 6 point at the same
   *   `landingUrl` with different link text; that's still a real,
   *   documented Ad Strength lever, not a cosmetic one.
   * - Callouts (short trust/benefit phrases, no URL needed) and ONE stock
   *   image asset (via Pexels, already used by the website builder) —
   *   genuinely useful for CTR/ad quality, but NOT scored by Ad Strength
   *   itself (confirmed against Google's docs: only headlines,
   *   descriptions, and sitelinks are).
   *
   * No-ops quietly on whichever pieces are empty/unconfigured (empty
   * `callouts`/`sitelinkLabels`, no `imageSearchQuery`, or Pexels off).
   */
  private async addOptionalAdAssets(
    campaignResourceName: string,
    landingUrl: string,
    callouts: string[] | undefined,
    sitelinkLabels: string[] | undefined,
    imageSearchQuery: string | undefined,
  ): Promise<void> {
    type AssetOp = { assetOperation: { create: Record<string, unknown> } };
    type FieldType = 'CALLOUT' | 'SITELINK' | 'AD_IMAGE';
    const ops: { op: AssetOp; fieldType: FieldType }[] = [
      ...(callouts ?? []).map((text) => ({
        op: { assetOperation: { create: { calloutAsset: { calloutText: text } } } },
        fieldType: 'CALLOUT' as const,
      })),
      ...(sitelinkLabels ?? []).map((text) => ({
        op: {
          assetOperation: {
            create: { finalUrls: [landingUrl], sitelinkAsset: { linkText: text } },
          },
        },
        fieldType: 'SITELINK' as const,
      })),
    ];

    if (imageSearchQuery && this.pexels.configured) {
      const { photos } = await this.pexels.search(imageSearchQuery, {
        orientation: 'landscape',
        perPage: 1,
      });
      const photo = photos[0];
      if (photo) {
        const res = await fetch(photo.src.medium);
        if (res.ok) {
          const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
          ops.push({
            op: { assetOperation: { create: { imageAsset: { data: base64 } } } },
            fieldType: 'AD_IMAGE',
          });
        }
      }
    }

    if (!ops.length) return;
    const results = await this.client.mutate(ops.map((o) => o.op));

    const attachOps = results
      .map((r, i) => ({ resourceName: r.assetResult?.resourceName, fieldType: ops[i].fieldType }))
      .filter((r): r is { resourceName: string; fieldType: FieldType } => !!r.resourceName)
      .map(({ resourceName, fieldType }) => ({
        campaignAssetOperation: {
          create: { campaign: campaignResourceName, asset: resourceName, fieldType },
        },
      }));
    if (attachOps.length) await this.client.mutate(attachOps);
  }

  /** Direction 3 (research doc): creates the ONE account-wide conversion
   *  action the gtag-based click-through tracking needs, if it doesn't
   *  exist yet — never recreated once `googleAdsConversionActionResourceName`
   *  is set. `type: 'WEBPAGE'` + `category: 'DEFAULT'` is the plain
   *  website-conversion shape a client-side `gtag('event', 'conversion')`
   *  call fires against (not the now-closed server-side click-upload path
   *  — see the research doc, Direction 3, for why that path was rejected). */
  private async ensureConversionAction(): Promise<void> {
    if (await this.settings.googleAdsConversionActionResourceName()) return;
    const results = await this.client.mutate([
      {
        conversionActionOperation: {
          create: {
            name: 'TVZ Feed Click-Through',
            type: 'WEBPAGE',
            category: 'DEFAULT',
            status: 'ENABLED',
          },
        },
      },
    ]);
    const resourceName = results[0]?.conversionActionResult?.resourceName;
    if (!resourceName) {
      throw new Error('Conversion action creation returned no resource name.');
    }
    await this.settings.setGoogleAdsConversionActionResourceName(resourceName);
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
