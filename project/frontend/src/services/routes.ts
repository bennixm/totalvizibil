import type { RouteLocationRaw } from 'vue-router'

/** Minimal category shape needed to build an SEO path. */
export interface CrumbCategory {
  slug: string
  parent?: { slug: string } | null
}

/**
 * The SEO path segments for a company: `[group, niche, slug]` when it sits in a
 * child category, `[category, slug]` when it's directly under a group, `[slug]`
 * when it has no category. The company page canonicalises to this on load, so a
 * bare `[slug]` link still resolves — it just redirects once.
 */
export function companyCrumbs(company: {
  slug: string
  category?: CrumbCategory | null
}): string[] {
  const cat = company.category
  if (!cat) return [company.slug]
  return [cat.parent?.slug, cat.slug, company.slug].filter((s): s is string => !!s)
}

/**
 * Both the category feed and a company's public page now share one flat,
 * prefix-free path — `/group[/niche][/slug]` — resolved at runtime by
 * `BrowseView` (see its docblock for why: the segment count alone can't tell
 * a sub-category from a company slug, only the category tree can). Every
 * link into either page goes through the single `browse` route so the
 * generated `href` always matches what `BrowseView` will actually resolve.
 */
function browseRoute(seg1: string, seg2?: string | null, seg3?: string | null): RouteLocationRaw {
  const params: Record<string, string> = { seg1 }
  if (seg2) params.seg2 = seg2
  if (seg3) params.seg3 = seg3
  return { name: 'browse', params }
}

/** `router-link` target for a company's public page. */
export function companyRoute(company: {
  slug: string
  category?: CrumbCategory | null
}): RouteLocationRaw {
  const [seg1, seg2, seg3] = companyCrumbs(company)
  return browseRoute(seg1, seg2, seg3)
}

/** `router-link` target for the category-filtered feed. */
export function feedCategoryRoute(groupSlug: string, nicheSlug?: string | null): RouteLocationRaw {
  return browseRoute(groupSlug, nicheSlug)
}
