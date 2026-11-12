import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsApiClient } from './google-ads-api-client.service';

/**
 * Direction 1 of docs/ai/GOOGLE-ADS-AGENT-PLAN-RESEARCH.md ("Keyword
 * research și evitarea concurenței între campanii"): every leaf subcategory
 * campaign carries its OWN `NEGATIVE_KEYWORDS` SharedSet
 * (`GoogleAdsSubcategoryCampaign.negativeKeywordSetResourceId`), populated
 * with every SIBLING subcategory's (same parent category) distinguishing
 * terms — never its own. Two sibling campaigns can then never enter the
 * same Google Ads auction over each other's terms.
 *
 * Shared by the structural pass (creates/attaches the empty set, and
 * backfills an already-active campaign's own terms onto its siblings the
 * first time the set is created) and the content pass (pushes a
 * newly-generated subcategory's keywords onto its siblings' sets).
 */

/** Current negative members of a shared set, lower-cased for comparison. */
async function existingNegatives(
  client: GoogleAdsApiClient,
  sharedSetResourceName: string,
): Promise<Set<string>> {
  const rows = await client.search(
    'SELECT shared_criterion.keyword.text FROM shared_criterion ' +
      `WHERE shared_criterion.shared_set = '${sharedSetResourceName}'`,
  );
  return new Set(
    rows.map((r) => (r.sharedCriterion?.keyword?.text ?? '').toLowerCase()).filter(Boolean),
  );
}

/** A campaign's own positive keywords, lower-cased — never push one of
 *  these as a negative onto the SAME campaign (self-cancelling). */
async function ownPositiveKeywords(
  client: GoogleAdsApiClient,
  adGroupResourceName: string,
): Promise<Set<string>> {
  const rows = await client.search(
    'SELECT ad_group_criterion.keyword.text FROM ad_group_criterion ' +
      `WHERE ad_group_criterion.ad_group = '${adGroupResourceName}'`,
  );
  return new Set(
    rows.map((r) => r.adGroupCriterion?.keyword?.text?.toLowerCase() ?? '').filter(Boolean),
  );
}

/**
 * Pushes `terms` (the OWNING subcategory's own keywords) as NEGATIVE
 * criteria onto every SIBLING subcategory's shared set — i.e. every leaf
 * `Category` with the same `parentId`, excluding the owner itself. Never
 * touches the owner's own set. Best-effort per sibling: one sibling's
 * read/write failing is logged and skipped, never thrown — pushing
 * negatives is a quality improvement, not something that should block the
 * owner's own campaign from activating.
 */
export async function pushNegativesOntoSiblings(
  client: GoogleAdsApiClient,
  prisma: PrismaService,
  logger: Logger,
  params: { parentCategoryId: string; ownCategoryId: string; terms: string[] },
): Promise<void> {
  const { parentCategoryId, ownCategoryId, terms } = params;
  if (!terms.length) return;

  const siblings = await prisma.googleAdsSubcategoryCampaign.findMany({
    where: {
      negativeKeywordSetResourceId: { not: null },
      category: { parentId: parentCategoryId, id: { not: ownCategoryId } },
    },
    select: {
      negativeKeywordSetResourceId: true,
      googleAdGroupId: true,
      category: { select: { slug: true } },
    },
  });
  if (!siblings.length) return;

  const customerId = client.customerId;
  for (const sibling of siblings) {
    try {
      const sharedSetResourceName = `customers/${customerId}/sharedSets/${sibling.negativeKeywordSetResourceId}`;
      const [existing, ownTerms] = await Promise.all([
        existingNegatives(client, sharedSetResourceName),
        sibling.googleAdGroupId
          ? ownPositiveKeywords(
              client,
              `customers/${customerId}/adGroups/${sibling.googleAdGroupId}`,
            )
          : Promise.resolve(new Set<string>()),
      ]);

      const toAdd = terms.filter((t) => {
        const key = t.toLowerCase();
        return !existing.has(key) && !ownTerms.has(key);
      });
      if (!toAdd.length) continue;

      await client.mutate(
        toAdd.map((text) => ({
          sharedCriterionOperation: {
            create: { sharedSet: sharedSetResourceName, keyword: { text, matchType: 'PHRASE' } },
          },
        })),
      );
    } catch (err) {
      logger.warn(
        `Failed to push negative keywords onto sibling '${sibling.category.slug}' — skipping it.`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

/** Reads a category's OWN current positive keywords live from Google —
 *  used only for the one-time retroactive backfill (an already-`active`
 *  campaign whose shared set is being created for the first time has no
 *  locally-stored keyword list; its real keywords only ever existed on
 *  Google's side). */
export async function fetchOwnKeywords(
  client: GoogleAdsApiClient,
  adGroupResourceName: string,
): Promise<string[]> {
  const rows = await client.search(
    'SELECT ad_group_criterion.keyword.text FROM ad_group_criterion ' +
      `WHERE ad_group_criterion.ad_group = '${adGroupResourceName}'`,
  );
  return rows.map((r) => r.adGroupCriterion?.keyword?.text).filter((t): t is string => !!t);
}
