import { Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { GoogleAdsApiClient } from '../google-ads-api-client.service';
import { acceptTexts } from './google-ads-optimizer.service';
import { RSA } from './google-ads-specs';

/**
 * Drives a NEW responsive search ad toward the highest Ad Strength Google
 * will actually grant, using only Google's own signals:
 *
 *  1. Read `ad_group_ad.ad_strength` and `ad_group_ad.action_items` (Google's
 *     own improvement suggestions, e.g. "Try including more keywords in
 *     your headlines") straight from the API — polled while Google still
 *     reports PENDING, after a settle delay following every change.
 *  2. If not EXCELLENT: rewrite the text set from those suggestions and the
 *     ad group's real keywords, validate it locally, then with Google
 *     (`validateOnly`), apply it, and go back to 1.
 *  3. Stop at EXCELLENT, when a round brings no improvement (the best
 *     version so far is restored), or after MAX_ROUNDS.
 *
 * The reported result is always the value last READ from Google, never an
 * assumed one; when the target is not reached the remaining Google action
 * items are returned as the explanation.
 */

export const STRENGTH_ORDER: Record<string, number> = {
  POOR: 1,
  AVERAGE: 2,
  GOOD: 3,
  EXCELLENT: 4,
};
const UNSETTLED = new Set([
  'PENDING',
  'UNSPECIFIED',
  'UNKNOWN',
  'NO_ADS',
  undefined as unknown as string,
]);

export interface StrengthReading {
  adStrength: string | null;
  actionItems: string[];
  headlines: string[];
  descriptions: string[];
}

export interface StrengthRound {
  round: number;
  adStrength: string | null;
  actionItems: string[];
  change?: string;
}

export interface StrengthResult {
  finalAdStrength: string | null;
  reachedExcellent: boolean;
  rounds: StrengthRound[];
  remainingActionItems: string[];
  explanation: string;
  costEstimateMinor: number;
}

const MAX_ROUNDS = 3;
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 15_000;
/** Wait after an applied change before the first read, so Google has a
 *  chance to recompute Ad Strength for the new text. */
const SETTLE_DELAY_MS = 30_000;

export class AdStrengthMaximizer {
  private readonly logger = new Logger(AdStrengthMaximizer.name);
  /** Overridable in tests. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly client: GoogleAdsApiClient,
    private readonly ai: AiService,
  ) {}

  /** One Google read of the ad (no polling). */
  async read(adGroupAdResourceName: string): Promise<StrengthReading | null> {
    const rows = await this.client.search(
      'SELECT ad_group_ad.ad_strength, ad_group_ad.action_items, ' +
        'ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions ' +
        `FROM ad_group_ad WHERE ad_group_ad.resource_name = '${adGroupAdResourceName}'`,
    );
    const a = rows[0]?.adGroupAd as
      | {
          adStrength?: string;
          actionItems?: string[];
          ad?: {
            responsiveSearchAd?: {
              headlines?: { text?: string }[];
              descriptions?: { text?: string }[];
            };
          };
        }
      | undefined;
    if (!a) return null;
    return {
      adStrength: a.adStrength ?? null,
      actionItems: a.actionItems ?? [],
      headlines: (a.ad?.responsiveSearchAd?.headlines ?? [])
        .map((h) => h.text ?? '')
        .filter(Boolean),
      descriptions: (a.ad?.responsiveSearchAd?.descriptions ?? [])
        .map((d) => d.text ?? '')
        .filter(Boolean),
    };
  }

  /** Reads until Google reports a settled Ad Strength (or attempts run out). */
  async readSettled(
    adGroupAdResourceName: string,
    initialDelayMs = 0,
  ): Promise<StrengthReading | null> {
    if (initialDelayMs) await this.sleep(initialDelayMs);
    let last: StrengthReading | null = null;
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      last = await this.read(adGroupAdResourceName);
      if (last && !UNSETTLED.has(last.adStrength as string)) return last;
      await this.sleep(POLL_INTERVAL_MS);
    }
    return last;
  }

  private async keywords(adGroupAdResourceName: string): Promise<string[]> {
    const adGroupId = adGroupAdResourceName.split('/').pop()?.split('~')[0];
    if (!adGroupId) return [];
    const rows = await this.client.search(
      'SELECT ad_group.id, ad_group_criterion.keyword.text, ad_group_criterion.status FROM ad_group_criterion ' +
        `WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE ` +
        "AND ad_group_criterion.status != 'REMOVED'",
    );
    return rows
      .map(
        (r) => (r.adGroupCriterion as { keyword?: { text?: string } } | undefined)?.keyword?.text,
      )
      .filter((t): t is string => !!t);
  }

  private async applyTexts(
    adResourceName: string,
    headlines: string[],
    descriptions: string[],
  ): Promise<void> {
    const ops = [
      {
        adOperation: {
          update: {
            resourceName: adResourceName,
            responsiveSearchAd: {
              headlines: headlines.map((text) => ({ text })),
              descriptions: descriptions.map((text) => ({ text })),
            },
          },
          updateMask: 'responsive_search_ad.headlines,responsive_search_ad.descriptions',
        },
      },
    ];
    await this.client.mutate(ops, { validateOnly: true });
    await this.client.mutate(ops);
  }

  async maximize(p: {
    adGroupAdResourceName: string;
    categoryName: string;
    landingUrl: string;
  }): Promise<StrengthResult> {
    const adId = p.adGroupAdResourceName.split('~').pop();
    const customer = p.adGroupAdResourceName.split('/adGroupAds/')[0];
    const adResourceName = `${customer}/ads/${adId}`;
    const rounds: StrengthRound[] = [];
    let cost = 0;

    let reading = await this.readSettled(p.adGroupAdResourceName);
    rounds.push({
      round: 0,
      adStrength: reading?.adStrength ?? null,
      actionItems: reading?.actionItems ?? [],
    });
    let best = reading;
    const keywords = await this.keywords(p.adGroupAdResourceName).catch(() => [] as string[]);

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (
        !reading ||
        reading.adStrength === 'EXCELLENT' ||
        UNSETTLED.has(reading.adStrength as string)
      )
        break;
      if (!this.ai.configured) break;
      const improved = await this.ai.googleAdsImproveAdStrength({
        categoryName: p.categoryName,
        landingUrl: p.landingUrl,
        keywords,
        headlines: reading.headlines,
        descriptions: reading.descriptions,
        adStrength: reading.adStrength ?? 'UNKNOWN',
        googleActionItems: reading.actionItems,
      });
      if (!improved) break;
      cost += improved.costEstimateMinor;
      const h = acceptTexts(
        improved.headlines,
        [],
        RSA.headlines.maxChars,
        'headline',
        RSA.headlines.max,
      ).accepted;
      const d = acceptTexts(
        improved.descriptions,
        [],
        RSA.descriptions.maxChars,
        'other',
        RSA.descriptions.max,
      ).accepted;
      // Never shrink the ad: a rewrite that drops below the current counts
      // would lower Ad Strength by itself.
      if (
        h.length < reading.headlines.length ||
        d.length < reading.descriptions.length ||
        h.length < RSA.headlines.min
      ) {
        rounds.push({
          round,
          adStrength: reading.adStrength,
          actionItems: reading.actionItems,
          change: 'rescriere respinsă la validarea locală (prea puține texte valide)',
        });
        break;
      }
      try {
        await this.applyTexts(adResourceName, h, d);
      } catch (err) {
        rounds.push({
          round,
          adStrength: reading.adStrength,
          actionItems: reading.actionItems,
          change: `Google a respins rescrierea: ${err instanceof Error ? err.message : String(err)}`,
        });
        break;
      }
      const next = await this.readSettled(p.adGroupAdResourceName, SETTLE_DELAY_MS);
      rounds.push({
        round,
        adStrength: next?.adStrength ?? null,
        actionItems: next?.actionItems ?? [],
        change: `${h.length} titluri, ${d.length} descrieri rescrise pe baza sugestiilor Google`,
      });
      const before = STRENGTH_ORDER[best?.adStrength ?? ''] ?? 0;
      const after = STRENGTH_ORDER[next?.adStrength ?? ''] ?? 0;
      if (next && after > before) {
        best = next;
        reading = next;
        continue;
      }
      // No improvement: restore the best version Google has rated and stop.
      if (best && after < before) {
        try {
          await this.applyTexts(adResourceName, best.headlines, best.descriptions);
          const restored = await this.readSettled(p.adGroupAdResourceName, SETTLE_DELAY_MS);
          rounds.push({
            round,
            adStrength: restored?.adStrength ?? null,
            actionItems: restored?.actionItems ?? [],
            change: 'versiunea anterioară (mai bine evaluată) a fost restaurată',
          });
          reading = restored ?? best;
        } catch (err) {
          this.logger.warn(
            `Restoring the best RSA version failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        reading = next ?? reading;
      }
      break;
    }

    const last = rounds[rounds.length - 1];
    const finalAdStrength = last.adStrength;
    const reachedExcellent = finalAdStrength === 'EXCELLENT';
    const remaining = last.actionItems;
    const explanation = reachedExcellent
      ? 'Google a confirmat Ad Strength „Excelent” pentru reclamă.'
      : finalAdStrength === null || UNSETTLED.has(finalAdStrength)
        ? 'Google nu a finalizat încă evaluarea Ad Strength (PENDING) în timpul de așteptare; următorul ciclu de monitorizare îl va citi din nou.'
        : `Nivelul maxim obținut, confirmat de Google: ${finalAdStrength}. ` +
          (remaining.length
            ? `Sugestiile rămase de la Google: ${remaining.join(' | ')}`
            : 'Google nu a mai returnat sugestii de îmbunătățire.');
    return {
      finalAdStrength,
      reachedExcellent,
      rounds,
      remainingActionItems: remaining,
      explanation,
      costEstimateMinor: cost,
    };
  }
}
