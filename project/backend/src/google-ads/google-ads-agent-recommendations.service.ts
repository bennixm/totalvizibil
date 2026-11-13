import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  GoogleAdsApiClient,
  GoogleAdsApplyRecommendationOperation,
  GoogleAdsRecommendedAd,
  GoogleAdsSearchRow,
} from './google-ads-api-client.service';
import {
  NEVER_AUTO_APPLY_RECOMMENDATION_TYPES,
  SILENTLY_IGNORED_RECOMMENDATION_TYPES,
} from './google-ads-recommendation-catalog';

/**
 * Direction 4 of docs/ai/GOOGLE-ADS-AGENT-PLAN-RESEARCH.md ("Google Ads
 * Recommendations"). Budget/bid/targeting/keyword recommendations are
 * never safe to auto-apply here regardless of what an admin's allowlist
 * says — they would directly undo the geo/keyword-cannibalization control
 * the structural pass itself enforces (Direction 1 and the earlier
 * county-targeting work) — see `NEVER_AUTO_APPLY_RECOMMENDATION_TYPES` and
 * the catalog's own doc comment for exactly which types and why. Everything
 * else not explicitly allowlisted (see
 * `PlatformSettingsService.googleAdsAgentAutoApplyRecommendationTypes`,
 * which defaults to EMPTY) is queued as a normal `pending_approval`
 * `GoogleAdsAgentAction`, same shape as a budget/CPC increase proposal.
 *
 * Called by `GoogleAdsAgentStructuralService.reconcileCategory()` for every
 * `active` campaign on each structural tick — not its own polling service,
 * since it needs no Claude call and piggybacks cleanly on a cadence that
 * already exists.
 *
 * Several `ad_quality` types Google exposes are NOT a bare `{resourceName}`
 * apply — confirmed against the API reference — and sending them that way
 * 400s (surfaced as an "Internal Server Error" to the admin before this
 * fix): `SITELINK_ASSET` and `CALLOUT_ASSET` require the suggested assets
 * echoed back as `apply_parameters`, `RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH`
 * and `RESPONSIVE_SEARCH_AD_ASSET` require the resulting ad content.
 * `buildApplyOperation()` is the one place that builds the correct shape
 * per type, from the recommendation content captured in `after` at queue
 * time (re-fetching live at approval time would risk the recommendation
 * having gone stale in between). `CALL_ASSET` (needs a phone number this
 * platform has no source for) and `RESPONSIVE_SEARCH_AD` (a brand-new ad,
 * not an update) have no content this agent can safely build at all —
 * those stay queued for visibility but fail approval with a clear message
 * instead of attempting a doomed apply call.
 */

const CAMPAIGN_SCOPE_TYPES = new Set(['SITELINK_ASSET', 'CALLOUT_ASSET']);
const NO_BUILDABLE_CONTENT_TYPES = new Set(['CALL_ASSET', 'RESPONSIVE_SEARCH_AD']);
const RSA_MAX_HEADLINES = 15;
const RSA_MAX_DESCRIPTIONS = 4;

type RecommendationPayload = GoogleAdsSearchRow['recommendation'];

@Injectable()
export class GoogleAdsAgentRecommendationsService {
  private readonly logger = new Logger(GoogleAdsAgentRecommendationsService.name);

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly settings: PlatformSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Returns true iff anything was applied or newly queued this call. */
  async reconcile(categoryId: string, campaignResourceName: string): Promise<boolean> {
    const rows = await this.client.search(
      'SELECT recommendation.resource_name, recommendation.type, ' +
        'recommendation.sitelink_asset_recommendation.recommended_campaign_sitelink_assets, ' +
        'recommendation.callout_asset_recommendation.recommended_campaign_callout_assets, ' +
        'recommendation.responsive_search_ad_asset_recommendation.current_ad, ' +
        'recommendation.responsive_search_ad_asset_recommendation.recommended_assets, ' +
        'recommendation.responsive_search_ad_improve_ad_strength_recommendation.recommended_ad ' +
        'FROM recommendation ' +
        `WHERE recommendation.campaign = '${campaignResourceName}'`,
    );
    if (!rows.length) return false;

    const autoApplyTypes = new Set(
      await this.settings.googleAdsAgentAutoApplyRecommendationTypes(),
    );
    let changed = false;

    for (const row of rows) {
      const resourceName = row.recommendation?.resourceName;
      const type = row.recommendation?.type;
      if (!resourceName || !type) continue;

      const action = `recommendation.${type}`;
      const already = await this.prisma.googleAdsAgentAction.findFirst({
        where: { categoryId, action, status: { in: ['pending_approval', 'applied'] } },
      });
      if (already) continue; // already handled (applied or awaiting a human) — don't re-queue every tick

      // Dropped entirely — never reaches the "Propuneri" queue at all. A
      // small subset of never-auto-apply types (pure reach-expansion
      // opt-ins with no real decision for a directory-site campaign to
      // make) — see the catalog's doc comment. Everything ELSE that's
      // never-auto-apply (budget/bid/keyword/audience/lead-form) still
      // falls through to the queue below; it just skips the allowlist
      // check entirely, so it can never be auto-applied even if an
      // admin's setting mistakenly includes it.
      if (SILENTLY_IGNORED_RECOMMENDATION_TYPES.has(type)) continue;
      const neverAutoApply = NEVER_AUTO_APPLY_RECOMMENDATION_TYPES.has(type);

      // Captured once per row and reused for both the auto-apply attempt
      // and the queued action's `after` payload, so `approveProposal` can
      // rebuild the exact same operation later without a second live
      // fetch (the recommendation may have gone stale by then).
      const operation = this.buildApplyOperation(resourceName, type, row.recommendation);
      const recommendationJson = toInputJson(row.recommendation);

      if (!neverAutoApply && autoApplyTypes.has(type) && operation) {
        try {
          await this.client.applyRecommendations([operation]);
          await this.prisma.googleAdsAgentAction.create({
            data: {
              categoryId,
              action,
              status: 'applied',
              after: { resourceName, type, recommendation: recommendationJson },
              reasoning:
                `Recomandare Google Ads de tip '${type}' aplicată automat — tip inclus explicit ` +
                'în lista admin de recomandări sigure de auto-aplicat.',
            },
          });
          changed = true;
          continue;
        } catch (err) {
          this.logger.warn(
            `Auto-apply of recommendation '${resourceName}' (type ${type}) failed — queuing for ` +
              'manual approval instead.',
            err instanceof Error ? err.stack : String(err),
          );
          // falls through to the manual-approval queue below
        }
      }

      await this.prisma.googleAdsAgentAction.create({
        data: {
          categoryId,
          action,
          status: 'pending_approval',
          after: { resourceName, type, recommendation: recommendationJson },
          reasoning:
            `Recomandare Google Ads de tip '${type}' necesită aprobare manuală — fie afectează ` +
            'buget/licitare/targetare, fie nu e (încă) confirmată ca sigură de auto-aplicat.',
        },
      });
      changed = true;
    }

    return changed;
  }

  /** Admin approves a pending recommendation (Faza 4-style endpoint). */
  async approveProposal(actionId: string, approvedByUserId: string): Promise<void> {
    const action = await this.prisma.googleAdsAgentAction.findUnique({ where: { id: actionId } });
    if (
      !action ||
      action.status !== 'pending_approval' ||
      !action.action.startsWith('recommendation.')
    ) {
      throw new BadRequestException('No pending recommendation proposal with that id');
    }
    const after = action.after as {
      resourceName?: string;
      type?: string;
      recommendation?: RecommendationPayload;
    } | null;
    const resourceName = after?.resourceName;
    const type = after?.type ?? action.action.replace('recommendation.', '');
    if (!resourceName) {
      throw new Error(`Action ${actionId} has a malformed 'after' payload.`);
    }
    if (NO_BUILDABLE_CONTENT_TYPES.has(type)) {
      throw new BadRequestException(
        'Acest tip de recomandare nu poate fi aplicat din acest panou — Google nu oferă ' +
          'conținutul necesar (ex: un număr de telefon) pentru a-l construi automat. ' +
          'Configurează-o manual direct în interfața Google Ads, apoi respinge propunerea de aici.',
      );
    }
    const operation = this.buildApplyOperation(resourceName, type, after?.recommendation) ?? {
      resourceName,
    };
    await this.client.applyRecommendations([operation]);
    await this.prisma.googleAdsAgentAction.update({
      where: { id: actionId },
      data: { status: 'applied', approvedByUserId, approvedAt: new Date() },
    });
  }

  /**
   * Builds the exact `applyRecommendation` operation for one recommendation
   * type, from the content Google attached to the recommendation itself.
   * Returns `null` when the type needs content Google didn't provide (an
   * emptied-out suggestion, or a type this agent can't safely build at all
   * — see `NO_BUILDABLE_CONTENT_TYPES`) — callers fall back to a bare
   * `{resourceName}` for auto-apply-safe types, or surface a clear error
   * instead of guessing for the rest.
   */
  private buildApplyOperation(
    resourceName: string,
    type: string,
    recommendation: RecommendationPayload | null | undefined,
  ): GoogleAdsApplyRecommendationOperation | null {
    switch (type) {
      case 'SITELINK_ASSET': {
        const newAssets =
          recommendation?.sitelinkAssetRecommendation?.recommendedCampaignSitelinkAssets;
        if (!newAssets?.length) return null;
        return {
          resourceName,
          sitelinkAsset: { adAssetApplyParameters: { newAssets, scope: 'CAMPAIGN' } },
        };
      }
      case 'CALLOUT_ASSET': {
        const newAssets =
          recommendation?.calloutAssetRecommendation?.recommendedCampaignCalloutAssets;
        if (!newAssets?.length) return null;
        return {
          resourceName,
          calloutAsset: { adAssetApplyParameters: { newAssets, scope: 'CAMPAIGN' } },
        };
      }
      case 'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH': {
        const updatedAd =
          recommendation?.responsiveSearchAdImproveAdStrengthRecommendation?.recommendedAd;
        if (!updatedAd?.responsiveSearchAd) return null;
        return { resourceName, responsiveSearchAdImproveAdStrength: { updatedAd } };
      }
      case 'RESPONSIVE_SEARCH_AD_ASSET': {
        const rec = recommendation?.responsiveSearchAdAssetRecommendation;
        const updatedAd = mergeResponsiveSearchAdAssets(rec?.currentAd, rec?.recommendedAssets);
        if (!updatedAd) return null;
        return { resourceName, responsiveSearchAdAsset: { updatedAd } };
      }
      case 'CALL_ASSET':
      case 'RESPONSIVE_SEARCH_AD':
        // No ready-to-apply content Google gives us here — see the class
        // doc comment and `NO_BUILDABLE_CONTENT_TYPES`.
        return null;
      default:
        if (CAMPAIGN_SCOPE_TYPES.has(type)) return null; // defensive — shouldn't happen
        return { resourceName }; // maintenance-only types need no parameters
    }
  }
}

/** Prisma's `InputJsonValue` rejects `Record<string, unknown>` structurally
 *  (no index signature) even though the actual values are plain JSON — a
 *  round-trip through `JSON.stringify`/`parse` is the simplest way to get
 *  a type Prisma accepts without littering call sites with casts. */
function toInputJson(
  value: RecommendationPayload | null | undefined,
): Prisma.InputJsonValue | null {
  return value ? (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue) : null;
}

/**
 * Merges Google's suggested new headlines/descriptions into the ad's
 * current ones — never a bare replacement, since `updated_ad` REPLACES the
 * ad's content and sending only the new assets would drop the existing
 * ones (lowering Ad Strength, the opposite of the point of this
 * recommendation type). Clamped to the RSA 15-headline/4-description caps
 * so a merge can never produce a payload Google would reject outright.
 */
function mergeResponsiveSearchAdAssets(
  currentAd: GoogleAdsRecommendedAd | undefined,
  recommendedAssets: GoogleAdsRecommendedAd | undefined,
): GoogleAdsRecommendedAd | null {
  const current = currentAd?.responsiveSearchAd;
  if (!current) return null;
  const recommended = recommendedAssets?.responsiveSearchAd;

  const mergeTexts = (
    base: { text?: string; pinnedField?: string }[] | undefined,
    additions: { text?: string; pinnedField?: string }[] | undefined,
    max: number,
  ): { text?: string; pinnedField?: string }[] => {
    const merged = [...(base ?? [])];
    const seen = new Set(merged.map((a) => a.text));
    for (const item of additions ?? []) {
      if (!item.text || seen.has(item.text) || merged.length >= max) continue;
      merged.push(item);
      seen.add(item.text);
    }
    return merged;
  };

  const headlines = mergeTexts(current.headlines, recommended?.headlines, RSA_MAX_HEADLINES);
  const descriptions = mergeTexts(
    current.descriptions,
    recommended?.descriptions,
    RSA_MAX_DESCRIPTIONS,
  );
  const addedNothing =
    headlines.length === (current.headlines?.length ?? 0) &&
    descriptions.length === (current.descriptions?.length ?? 0);
  if (addedNothing) return null;

  return {
    resourceName: currentAd?.resourceName,
    responsiveSearchAd: { headlines, descriptions, path1: current.path1, path2: current.path2 },
  };
}
