import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsApiClient } from './google-ads-api-client.service';
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
 */

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
      'SELECT recommendation.resource_name, recommendation.type FROM recommendation ' +
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

      if (!neverAutoApply && autoApplyTypes.has(type)) {
        try {
          await this.client.applyRecommendations([resourceName]);
          await this.prisma.googleAdsAgentAction.create({
            data: {
              categoryId,
              action,
              status: 'applied',
              after: { resourceName, type },
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
          after: { resourceName, type },
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
    const after = action.after as { resourceName?: string } | null;
    const resourceName = after?.resourceName;
    if (!resourceName) {
      throw new Error(`Action ${actionId} has a malformed 'after' payload.`);
    }
    await this.client.applyRecommendations([resourceName]);
    await this.prisma.googleAdsAgentAction.update({
      where: { id: actionId },
      data: { status: 'applied', approvedByUserId, approvedAt: new Date() },
    });
  }
}
