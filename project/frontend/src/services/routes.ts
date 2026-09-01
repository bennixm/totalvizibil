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

/** `router-link` target for a company's public page. */
export function companyRoute(company: {
  slug: string
  category?: CrumbCategory | null
}): RouteLocationRaw {
  return { name: 'company', params: { crumbs: companyCrumbs(company) } }
}

/** `router-link` target for the category-filtered feed. */
export function feedCategoryRoute(groupSlug: string, nicheSlug?: string | null): RouteLocationRaw {
  return nicheSlug
    ? { name: 'feed-category', params: { group: groupSlug, niche: nicheSlug } }
    : { name: 'feed-category', params: { group: groupSlug } }
}
