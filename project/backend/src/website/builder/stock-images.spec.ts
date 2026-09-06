import { SeedCtx } from './section-catalog';
import { keywordPlanDoc, seedFillEmptySections, skeletonToDoc } from './compose-advanced';
import { pickSkeleton } from './site-archetypes';
import { STOCK_POOLS, bucketFor, fillDocImages, hashInt } from './stock-images';

const ctx: SeedCtx = {
  businessName: 'Acme SRL',
  businessType: 'acoperișuri',
  city: 'Cluj-Napoca',
  services: ['Reparații', 'Montaj'],
  locale: 'ro',
};

const IMG_RE = /^https:\/\/images\.unsplash\.com\/photo-|^\/api\/v1\/website-assets\//;

function allImageUrls(doc: ReturnType<typeof keywordPlanDoc>): string[] {
  const out: string[] = [];
  for (const p of doc.pages) {
    for (const s of p.sections) {
      const c = s.content as Record<string, unknown>;
      if (typeof c.backgroundImage === 'string' && c.backgroundImage) out.push(c.backgroundImage);
      if (typeof c.imageUrl === 'string' && c.imageUrl) out.push(c.imageUrl);
      if (Array.isArray(c.items)) {
        for (const it of c.items as Record<string, unknown>[]) {
          if (typeof it.imageUrl === 'string' && it.imageUrl) out.push(it.imageUrl);
        }
      }
    }
  }
  return out;
}

describe('stock images', () => {
  it('every pool has ≥ 6 well-formed unsplash urls', () => {
    for (const [, urls] of Object.entries(STOCK_POOLS)) {
      expect(urls.length).toBeGreaterThanOrEqual(6);
      for (const u of urls) expect(u).toMatch(/^https:\/\/images\.unsplash\.com\/photo-[\w-]+\?/);
    }
  });

  it('bucketFor picks a sensible category', () => {
    expect(bucketFor(ctx)).toBe('construction');
    expect(bucketFor({ ...ctx, businessType: 'restaurant', services: [] })).toBe('food');
    expect(bucketFor({ ...ctx, businessType: 'clinică dentară', services: [] })).toBe('health');
    expect(bucketFor({ ...ctx, businessType: 'x', services: [] }, 'ceva neutru')).toBe('generic');
  });

  it('fillDocImages fills image slots with pool photos, no repeats', () => {
    const doc = skeletonToDoc(pickSkeleton('portfolio', 3), ctx); // gallery-heavy
    fillDocImages(doc, ctx, 'portofoliu de fotografie');
    const urls = allImageUrls(doc);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(IMG_RE);
    expect(new Set(urls).size).toBe(urls.length); // de-duped within the site
  });

  it('two different businesses get different image sets', () => {
    const a = keywordPlanDoc('acoperișuri și izolații', ctx);
    const b = keywordPlanDoc('acoperișuri și izolații', { ...ctx, businessName: 'Roof Masters' });
    const ua = new Set(allImageUrls(a));
    const ub = allImageUrls(b);
    // not byte-identical ordering/selection
    expect(ub.some((u) => !ua.has(u)) || ub.length !== ua.size).toBe(true);
  });

  it('seedFillEmptySections backfills blank sections', () => {
    const doc = skeletonToDoc(pickSkeleton('generic', 0), ctx);
    // wipe every section's content
    for (const p of doc.pages) for (const s of p.sections) s.content = {};
    const n = seedFillEmptySections(doc, ctx);
    expect(n).toBe(doc.pages.reduce((c, p) => c + p.sections.length, 0));
    // now nothing is empty
    expect(seedFillEmptySections(doc, ctx)).toBe(0);
  });

  it('hashInt is stable and non-negative', () => {
    expect(hashInt('abc')).toBe(hashInt('abc'));
    expect(hashInt('abc')).toBeGreaterThanOrEqual(0);
    expect(hashInt('abc')).not.toBe(hashInt('abd'));
  });
});
