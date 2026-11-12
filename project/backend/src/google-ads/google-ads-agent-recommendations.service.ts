import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsApiClient } from './google-ads-api-client.service';

/**
 * Direction 4 of docs/ai/GOOGLE-ADS-AGENT-PLAN-RESEARCH.md ("Google Ads
 * Recommendations"). Google's own auto-apply-eligible set is maintenance-
 * only (removing non-serving keywords/conflicting negatives, etc.); budget/
 * bid recommendations are never in it, and these two are never safe to
 * auto-apply here regardless of what an admin's allowlist says — they would
 * directly undo the geo/keyword-cannibalization control the structural
 * pass itself enforces (Direction 1 and the earlier county-targeting work).
 * Everything else not explicitly allowlisted (see
 * `PlatformSettingsService.googleAdsAgentAutoApplyRecommendationTypes`,
 * which defaults to EMPTY — the exact `recommendation.type` enum strings
 * were not confirmed live during research) is queued as a normal
 * `pending_approval` `GoogleAdsAgentAction`, same shape as a budget/CPC
 * increase proposal.
 *
 * Called by `GoogleAdsAgentStructuralService.reconcileCategory()` for every
 * `active` campaign on each structural tick — not its own polling service,
 * since it needs no Claude call and piggybacks cleanly on a cadence that
 * already exists.
 */
const NEVER_AUTO_APPLY_TYPES = new Set([
  'TARGETING_EXPANSION_OPT_IN',
  'DISPLAY_EXPANSION_OPT_IN',
  'SEARCH_PARTNERS_OPT_IN',
  'USE_BROAD_MATCH_KEYWORD',
]);

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

      if (NEVER_AUTO_APPLY_TYPES.has(type)) continue; // never surfaced at all — see class doc comment

      if (autoApplyTypes.has(type)) {
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
