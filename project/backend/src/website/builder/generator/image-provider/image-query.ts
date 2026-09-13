/**
 * Turn a typed `ImageIntent` into a concrete Pexels query string.
 *
 * The rule: a query names a SUBJECT and a SCENE from the business's own world,
 * plus 1–2 photography-style keywords. It never contains the filler the model
 * (and lazy stock searches) reach for — "business", "company", "professional",
 * "team", "office", "corporate" — those return the exact generic photos this
 * whole pipeline exists to avoid.
 */
import type { BusinessProfile, DesignDNA, ImageIntent } from '../types';

const BANNED =
  /\b(business|company|professional|corporate|team|office|meeting|workplace|entrepreneur|developer|real estate|realtor)\b/gi;

/** A few photography-direction phrases distilled to search-friendly keywords. */
function styleKeywords(dna: DesignDNA): string {
  const s = dna.photographyStyle.toLowerCase();
  const hits: string[] = [];
  if (/warm|golden|cozy|inviting/.test(s)) hits.push('warm light');
  if (/bright|airy|clean|minimal/.test(s)) hits.push('bright natural light');
  if (/moody|dramatic|dark|cinematic/.test(s)) hits.push('moody');
  if (/candid|documentary|reportage|real/.test(s)) hits.push('candid');
  if (/editorial|magazine|styled/.test(s)) hits.push('editorial');
  if (/macro|detail|close/.test(s)) hits.push('close-up detail');
  if (/architect|structural|geometr/.test(s)) hits.push('architectural');
  return hits.slice(0, 2).join(' ');
}

function clean(s: string): string {
  return s.replace(BANNED, ' ').replace(/\s+/g, ' ').replace(/[",]/g, ' ').trim();
}

/**
 * Build the search string. `subject` + `scene` come from the intent (which the
 * AI enrich step or the deterministic derivation filled); this only assembles
 * and de-fluffs them, and appends the style + an orientation cue.
 */
export function imageQuery(intent: ImageIntent, dna: DesignDNA, profile: BusinessProfile): string {
  const subject = clean(intent.subject) || clean(profile.businessType);
  const scene = clean(intent.scene);
  const style = styleKeywords(dna);

  // hero shots benefit from a "wide" cue; portrait slots from "vertical".
  const framing =
    intent.orientation === 'portrait'
      ? 'vertical'
      : intent.role === 'hero' || intent.orientation === 'landscape'
        ? 'wide'
        : '';

  const parts = [subject, scene, style, framing].map((p) => p.trim()).filter(Boolean);
  // de-dup words while keeping order, cap length (Pexels ignores very long queries)
  const seen = new Set<string>();
  const words: string[] = [];
  for (const w of parts.join(' ').split(' ')) {
    const k = w.toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      words.push(w);
    }
  }
  return words.slice(0, 10).join(' ');
}
