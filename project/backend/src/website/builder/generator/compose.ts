/**
 * Stage 9: assemble a `BuilderDoc` from the `LayoutRecipe` + the copy pass
 * output (+ resolved images, Phase 2). Deterministic — the model never decides
 * structure here, only supplied the prose. `normalizeDoc` is the final clamp.
 */
import { randomUUID } from 'node:crypto';
import { slugify } from '../../../common/slug';
import {
  coerceContent,
  seedSectionContent,
  snapAnimation,
  snapVariant,
  type SeedCtx,
} from '../section-catalog';
import {
  normalizeDoc,
  seedFillEmptySections,
  type BuilderDoc,
  type DocSection,
  type PageSpec,
} from '../compose-advanced';
import type { LayoutRecipe, RecipePage, RecipeSection } from './types';

/** Align a page's returned copy blocks to its recipe sections by type (a short
 *  / reordered model response still maps), like the legacy Phase-B aligner. */
function alignCopy(
  sections: RecipeSection[],
  returned: Record<string, unknown>[],
): Record<string, unknown>[] {
  const pool = returned.map((x, k) => ({ x, k, used: false }));
  return sections.map((s) => {
    const hit = pool.find(
      (e) => !e.used && String((e.x as { type?: string }).type ?? '') === s.type,
    );
    const slot = hit ?? pool.find((e) => !e.used);
    if (slot) slot.used = true;
    const raw = slot?.x as { content?: unknown } | undefined;
    return raw && typeof raw.content === 'object' && raw.content
      ? (raw.content as Record<string, unknown>)
      : {};
  });
}

function toDocSection(
  rs: RecipeSection,
  content: Record<string, unknown>,
  ctx: SeedCtx,
): DocSection {
  // Merge the model's copy over the deterministic seed so a section that came
  // back partial (e.g. only `headline`) still ships a complete block; fully
  // empty ones are caught again by `seedFillEmptySections` after normalize.
  const merged = { ...seedSectionContent(rs.type, ctx), ...stripBlank(content) };
  const anim = snapAnimation(rs.animation);
  return {
    id: randomUUID(),
    type: rs.type,
    variant: snapVariant(rs.type, rs.variant),
    visible: true,
    ...(anim ? { animation: anim } : {}),
    ...(rs.style ? { style: rs.style } : {}),
    ...(rs.overrides ? { overrides: rs.overrides } : {}),
    content: coerceContent(rs.type, merged),
  };
}

/** Drop keys whose value carries no real content (empty string, empty array, or
 *  an array whose rows are all blank) so they don't clobber the seed in the
 *  merge. */
function stripBlank(c: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c ?? {})) {
    if (typeof v === 'string' && !v.trim()) continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      const anyReal = v.some((row) => {
        if (typeof row === 'string') return row.trim().length > 0;
        if (row && typeof row === 'object') {
          return Object.values(row as Record<string, unknown>).some(
            (rv) => typeof rv === 'string' && rv.trim().length > 0,
          );
        }
        return false;
      });
      if (!anyReal) continue;
    }
    out[k] = v;
  }
  return out;
}

export interface RecipeToDocInput {
  recipe: LayoutRecipe;
  /** Per-page arrays of `{ type, content }` blocks from the copy pass (or []). */
  copy: Record<string, unknown>[][];
  ctx: SeedCtx;
  seed: number;
}

export function recipeToDoc(input: RecipeToDocInput): BuilderDoc {
  const { recipe, copy, ctx } = input;
  const usedSlugs = new Set<string>();

  const pages: PageSpec[] = recipe.pages.map((rp: RecipePage, pi) => {
    const returned = copy[pi] ?? [];
    const aligned = alignCopy(rp.sections, returned);
    let slug = slugify(rp.slug || rp.title) || `page-${pi + 1}`;
    while (usedSlugs.has(slug)) slug = `${slug}-${usedSlugs.size + 1}`;
    usedSlugs.add(slug);
    return {
      id: randomUUID(),
      title: rp.title.slice(0, 60),
      slug,
      isHome: pi === 0,
      nav: pi === 0 ? true : rp.nav !== false,
      sections: rp.sections.map((rs, si) => toDocSection(rs, aligned[si] ?? {}, ctx)),
    };
  });

  const raw = {
    v: 2 as const,
    mode: 'ai' as const,
    theme: recipe.theme as unknown,
    pages,
  };
  // normalizeDoc clamps, appends legal + contact pages, re-checks slugs.
  const doc = normalizeDoc(raw, ctx);
  // Final safety net: any section still with no user-visible copy → seed it.
  seedFillEmptySections(doc, ctx);
  return doc;
}
