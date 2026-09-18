/**
 * Finds the first real image URL used in a published bundle, so the feed
 * card can show what the site actually looks like. PRO V2 never writes
 * `Website.content`/`theme` (see feed.service.ts's `heroBillboard`), so
 * there's no structured "hero image" field to read for these sites — this
 * is the pragmatic alternative: every image reference in the generated
 * Vue project is either a Pexels URL (search_images) or an uploaded-asset
 * URL (/api/v1/website-assets/…, see pro-v2.ts uploadAsset), and both
 * survive into the BUILT output as plain string literals (Vite's compiler
 * inlines an <img src="…"> as a string in the render function; minification
 * doesn't change the string contents). A simple text scan across the built
 * HTML/JS/CSS is enough — no HTML/JS parsing needed.
 */

const IMAGE_URL_RE = /https:\/\/images\.pexels\.com\/[^\s"'`)]+|\/api\/v1\/website-assets\/[a-f0-9-]+/i;
const TEXT_EXTENSIONS = new Set(['html', 'js', 'mjs', 'css']);

function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.has(ext);
}

/** Scans in a stable order (index.html first, then the rest as given) so
 *  the same bundle always yields the same result. Returns null if nothing
 *  recognizable is found — callers should leave any existing value alone
 *  rather than clobber a good image with null on an edit that happens not
 *  to touch the hero. */
export function extractHeroImageUrl(files: { path: string; bytes: Buffer }[]): string | null {
  const candidates = files
    .filter((f) => isTextFile(f.path))
    .sort((a, b) => (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : 0));
  for (const f of candidates) {
    const match = IMAGE_URL_RE.exec(f.bytes.toString('utf8'));
    if (match) return match[0];
  }
  return null;
}
