/**
 * Pure glue between resolved Pexels photos and the builder doc. No Nest / Prisma
 * imports so the pipeline and tests can use it directly.
 */
import type { BuilderDoc } from '../../compose-advanced';
import type { ImageIntent, ResolvedImage } from '../types';

/** Stable key for one image slot: `"<sectionId>|<field>|<itemIndex|->"`. */
export function intentKey(i: Pick<ImageIntent, 'sectionId' | 'field' | 'itemIndex'>): string {
  return `${i.sectionId}|${i.field}|${i.itemIndex ?? '-'}`;
}

/**
 * Write each resolved photo onto its slot in the doc. Returns the number of
 * slots filled + the list of applied photo ids (for logging / attribution).
 * A slot with no resolved entry is left untouched — `fillDocImages` already put
 * a curated pool photo there.
 */
export function applyResolvedImages(
  doc: BuilderDoc,
  intents: ImageIntent[],
  resolved: Map<string, ResolvedImage>,
): { applied: number; photoIds: string[]; anyPexels: boolean } {
  const sections = new Map(doc.pages.flatMap((p) => p.sections).map((s) => [s.id, s]));
  let applied = 0;
  const photoIds: string[] = [];
  let anyPexels = false;

  for (const intent of intents) {
    const hit = resolved.get(intentKey(intent));
    if (!hit || !hit.url) continue;
    const section = sections.get(intent.sectionId);
    if (!section) continue;
    const content = (section.content ?? {}) as Record<string, unknown>;

    if (intent.itemIndex != null) {
      const items = Array.isArray(content.items)
        ? (content.items as Record<string, unknown>[])
        : null;
      const item = items?.[intent.itemIndex];
      if (!item) continue;
      item[intent.field] = hit.url;
      if (typeof item.alt === 'string' && !item.alt.trim()) item.alt = hit.alt;
    } else {
      content[intent.field] = hit.url;
      // hero/showcase carry the alt on a sibling field when the schema has one
      if (typeof content.imageAlt === 'string' && !content.imageAlt.trim())
        content.imageAlt = hit.alt;
    }

    applied++;
    if (hit.photoId) photoIds.push(hit.photoId);
    if (hit.provider === 'pexels') anyPexels = true;
  }
  return { applied, photoIds, anyPexels };
}
