/**
 * Feed resolution — deciding exactly which atomic (județ, subcategorie) Feed
 * a company's sponsored impression belongs to, and who else competes there.
 *
 * Never picks whichever Feed would score the company highest: the leaf is
 * always the company's own first (isPrimary desc, createdAt asc) category
 * assignment that intersects what was searched, and the county follows the
 * same own-order rule — falling back to the search's own canonical
 * (`RO_COUNTIES`) order only for a nationwide company matched by named
 * counties it has no ordering preference among.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { RO_COUNTIES } from '../geo/ro-cities';
import { FeedMarginConfig, feedCpcMinMinor } from './feed-pricing';

/** Pseudo-county used for the "Toată țara" arena — a real, distinct Feed, not a hack. */
export const NATIONWIDE_FEED_COUNTY = 'nationwide';

export interface FeedId {
  leafId: string;
  /** A canonical RO_COUNTIES value, or `NATIONWIDE_FEED_COUNTY`. */
  county: string;
}

export type SearchCountyMode =
  | { kind: 'any' } // "Orice locație" — no filter, every județ (+ nationwide) is in scope
  | { kind: 'nationwideOnly' } // "Toată țara" sentinel — only nationwide companies match
  | { kind: 'named'; counties: string[] };

interface CategoryAssignmentLike {
  categoryId: string;
  isPrimary: boolean;
  createdAt: Date;
}
interface LocationLike {
  county: string | null;
  nationwide: boolean;
  isPrimary: boolean;
  createdAt: Date;
}
export interface FeedCompanyLike {
  categoryAssignments: CategoryAssignmentLike[];
  locations: LocationLike[];
}

const byOwnOrder = <T extends { isPrimary: boolean; createdAt: Date }>(a: T, b: T): number =>
  a.isPrimary !== b.isPrimary
    ? a.isPrimary
      ? -1
      : 1
    : a.createdAt.getTime() - b.createdAt.getTime();

/**
 * The one Feed a company's impression is attributed to for a given search —
 * used identically for eligibility, ranking and click billing. `null` when
 * the company doesn't actually compete on anything the search asked for
 * (shouldn't happen if the caller already filtered by the same criteria, but
 * defensive since this is the function billing correctness hinges on).
 */
export function resolveCompanyFeed(
  company: FeedCompanyLike,
  searchLeafIds: string[],
  countyMode: SearchCountyMode,
): FeedId | null {
  const leaf = [...company.categoryAssignments]
    .sort(byOwnOrder)
    .find((a) => searchLeafIds.includes(a.categoryId));
  if (!leaf) return null;

  const isNationwide = company.locations.some((l) => l.nationwide);

  if (countyMode.kind === 'nationwideOnly') {
    return isNationwide ? { leafId: leaf.categoryId, county: NATIONWIDE_FEED_COUNTY } : null;
  }

  if (isNationwide) {
    if (countyMode.kind === 'named') {
      const first = RO_COUNTIES.find((c) => countyMode.counties.includes(c));
      return first ? { leafId: leaf.categoryId, county: first } : null;
    }
    return { leafId: leaf.categoryId, county: NATIONWIDE_FEED_COUNTY };
  }

  const requested = countyMode.kind === 'named' ? countyMode.counties : null;
  const match = [...company.locations]
    .filter((l): l is LocationLike & { county: string } => !l.nationwide && !!l.county)
    .sort(byOwnOrder)
    .find((l) => requested == null || requested.includes(l.county));
  return match ? { leafId: leaf.categoryId, county: match.county } : null;
}

/** The company's own primary Feed — its identity with no search constraint (dashboard/self-rank/click fallback). */
export function primaryFeedOf(company: FeedCompanyLike): FeedId | null {
  const leaf =
    company.categoryAssignments.find((a) => a.isPrimary) ?? company.categoryAssignments[0];
  if (!leaf) return null;
  if (company.locations.some((l) => l.nationwide)) {
    return { leafId: leaf.categoryId, county: NATIONWIDE_FEED_COUNTY };
  }
  const loc =
    company.locations.find((l) => l.isPrimary && l.county) ??
    company.locations.find((l) => !!l.county);
  return loc?.county ? { leafId: leaf.categoryId, county: loc.county } : null;
}

/** Every distinct atomic Feed a company is eligible to compete in — its own leaves × its own counties. */
export function enumerateCompanyFeeds(company: FeedCompanyLike): FeedId[] {
  const leafIds = Array.from(new Set(company.categoryAssignments.map((a) => a.categoryId)));
  if (!leafIds.length) return [];
  const isNationwide = company.locations.some((l) => l.nationwide);
  const counties = isNationwide
    ? [NATIONWIDE_FEED_COUNTY]
    : Array.from(new Set(company.locations.map((l) => l.county).filter((c): c is string => !!c)));
  const out: FeedId[] = [];
  for (const leafId of leafIds) for (const county of counties) out.push({ leafId, county });
  return out;
}

/** `where` fragment matching every company physically present in one atomic Feed (status + category + area). */
export function feedWhere(feedId: FeedId): Prisma.CompanyWhereInput {
  return {
    status: 'active',
    categoryAssignments: { some: { categoryId: feedId.leafId } },
    locations:
      feedId.county === NATIONWIDE_FEED_COUNTY
        ? { some: { nationwide: true } }
        : { some: { OR: [{ county: feedId.county }, { nationwide: true }] } },
  };
}

export interface FeedPeerBid {
  companyId: string;
  cpcMinor: number;
}

/**
 * Companies actually eligible to compete in one atomic Feed right now: an
 * active campaign, physically present there, bidding at or above that Feed's
 * CPC minim. `excludeCompanyId` removes one company (used to compute "my
 * rivals" for a recommendation preview, without double-counting myself).
 */
export async function feedEligiblePeers(
  prisma: PrismaClient | Prisma.TransactionClient,
  feedId: FeedId,
  cfg: FeedMarginConfig,
  opts: { excludeCompanyId?: string } = {},
): Promise<FeedPeerBid[]> {
  const companies = await prisma.company.findMany({
    where: {
      ...feedWhere(feedId),
      ...(opts.excludeCompanyId ? { id: { not: opts.excludeCompanyId } } : {}),
      campaign: { is: { status: 'active' } },
    },
    select: { id: true, campaign: { select: { cpcMinor: true } } },
  });
  const minMinor = feedCpcMinMinor(cfg);
  return companies
    .filter((c) => (c.campaign?.cpcMinor ?? 0) >= minMinor)
    .map((c) => ({ companyId: c.id, cpcMinor: c.campaign!.cpcMinor }));
}
