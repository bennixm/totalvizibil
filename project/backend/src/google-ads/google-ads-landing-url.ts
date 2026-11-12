/**
 * The public landing page for a subcategory's Google Ads ads (final URL of
 * the ads created in a later phase) — the exact same flat SEO path the
 * frontend's own `feedCategoryRoute()` (src/services/routes.ts) builds for
 * the category-filtered feed: `/group/niche` for a leaf under a parent
 * group, or `/group` for a top-level category used standalone. Kept here as
 * a tiny pure function, independent from the frontend bundle, so the
 * backend never has to guess at or duplicate-drift from that URL shape.
 */
export function subcategoryLandingPath(category: {
  slug: string;
  parent?: { slug: string } | null;
}): string {
  return category.parent ? `/${category.parent.slug}/${category.slug}` : `/${category.slug}`;
}

export function subcategoryLandingUrl(
  category: { slug: string; parent?: { slug: string } | null },
  frontendOrigin: string,
): string {
  return `${frontendOrigin}${subcategoryLandingPath(category)}`;
}
