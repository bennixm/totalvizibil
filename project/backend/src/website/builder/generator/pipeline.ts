/**
 * The Advanced builder's generation pipeline orchestrator.
 *
 *   BRIEF → analyzeBusiness (profile + direction + DNA hints) → planIA
 *         → deriveDesignDNA + buildRecipe  [re-roll seed once if it repeats a
 *           recent generation]
 *         → writePageCopy → recipeToDoc
 *         → image intents → Pexels search → apply  (Phase 2; pool is the fallback)
 *         → VERIFY → FIX  (deterministic audit + model review, auto-repaired)
 *         → visual QA gate → targeted repair ×≤2  (Phase 3; opt-in, no-op without
 *           a screenshot service)
 *         → return
 *
 * Every stage degrades to a deterministic seeded fallback, so `generateSite`
 * ALWAYS returns a complete, tailored `BuilderDoc`.
 */
import type { SeedCtx } from '../section-catalog';
import type { BuilderDoc } from '../compose-advanced';
import { siteDigest } from '../site-audit';
import { structuralAudit } from '../site-audit';
import { hashInt } from '../stock-images';
import { fillDocImages, verifyDocImages } from '../stock-images';
import { analyzeBusiness } from './business-analysis';
import { deriveDesignDNA } from './design-dna';
import { planIA, reshuffleIA } from './information-architecture';
import { buildRecipe, recipeFieldKeys } from './layout-recipe';
import { recipeToDoc } from './compose';
import { repairGeneratedSite } from './repair';
import { deriveImageIntents } from './image-intent';
import { applyResolvedImages } from './image-provider/image-apply';
import { runVisualReview, type Screenshot } from './visual-qa';
import { applyTargetedFixes, gatePasses, runQualityGate } from './quality-gate';
import { fingerprintDoc, fingerprintRecipe, type Fingerprint } from './design-fingerprint';
import type {
  BusinessProfile,
  CreativeDirection,
  DesignDNA,
  GeneratorAi,
  ImageIntent,
  ImageSearchResolver,
  LayoutRecipe,
  QaReport,
  VisualQaConfig,
} from './types';

export interface GenerateInput {
  brief: string;
  ctx: SeedCtx;
  /** Explicit variant seed. Default: stable hash of company + brief. */
  seed?: number;
  /** Structural fingerprint HASHES of the company's recent generations. If the
   *  fresh structure matches one, the seed is bumped once (free re-roll) so a
   *  re-generate never lands on the same layout. */
  recentFingerprints?: string[];
  /** A text digest review from the model (advisory). Set false to skip. */
  runContentReview?: boolean;
  /** Phase 2 — real photo search. Omitted / unconfigured ⇒ curated pool only. */
  images?: ImageSearchResolver;
  /** Phase 3 — opt-in visual QA. Omitted / disabled ⇒ skipped entirely. */
  visualQa?: VisualQaConfig;
  /** Test seam for the screenshot fetch (Phase 3). */
  shoot?: (siteUrl: string, serviceUrl: string) => Promise<Screenshot | null>;
}

export interface GenerateResult {
  doc: BuilderDoc;
  /** Residual QA (server-side only — the client is never shown generation issues). */
  report: QaReport;
  /** What auto-repair + targeted repair fixed before returning (for logs). */
  repaired: string[];
  fingerprint: Fingerprint;
  /** Intermediate artifacts — surfaced for tests / debugging / the studio. */
  profile: BusinessProfile;
  direction: CreativeDirection;
  dna: DesignDNA;
  recipe: LayoutRecipe;
}

const MAX_REPAIR_ROUNDS = 2;

export async function generateSite(ai: GeneratorAi, input: GenerateInput): Promise<GenerateResult> {
  const { brief, ctx } = input;
  // An EXPLICIT seed (the "generate another variant" button, or a reproducible
  // run) is honoured as-is — the anti-collision re-roll only kicks in for the
  // auto-derived seed, where a plain "regenerate" would otherwise repeat.
  const explicitSeed = typeof input.seed === 'number';
  const seed = input.seed ?? hashInt(`${ctx.businessName}|${brief}`);
  const business = {
    name: ctx.businessName,
    type: ctx.businessType || undefined,
    city: ctx.city || undefined,
    services: ctx.services,
  };

  // 1–2 · business analysis + creative direction + AI design hints
  const { profile, direction, dnaHints } = await analyzeBusiness(ai, {
    brief,
    business,
    locale: ctx.locale,
    seed,
  });

  // 4 · information architecture (one AI call — reused across a re-roll)
  const baseIa = await planIA(ai, {
    brief,
    business,
    profile,
    direction,
    locale: ctx.locale,
    seed,
  });

  // 3 + 5 · design DNA + layout recipe. If the resulting structure repeats a
  // recent generation for this company, bump the seed AND restructure the IA
  // (drop one optional section, swap a pair, flip the page split) then rebuild —
  // still free (no extra AI call), but now a plain "regenerate" with the same
  // brief lands on a genuinely different layout, not a 1-section tweak.
  const buildFor = (s: number, ia = baseIa): { dna: DesignDNA; recipe: LayoutRecipe } => {
    const d = deriveDesignDNA(profile, direction, s, dnaHints);
    return { dna: d, recipe: buildRecipe({ ia, dna: d, profile, ctx, seed: s }) };
  };
  let usedSeed = seed;
  let { dna, recipe } = buildFor(usedSeed);
  if (!explicitSeed && (input.recentFingerprints ?? []).includes(fingerprintRecipe(recipe).hash)) {
    usedSeed = seed + 7919;
    ({ dna, recipe } = buildFor(usedSeed, reshuffleIA(baseIa, usedSeed)));
  }

  // 6 · copy
  const pageSpecs = recipe.pages.map((p) => ({
    title: p.title,
    purpose: p.purpose,
    sections: p.sections.map((s) => ({
      type: s.type,
      variant: s.variant,
      role: s.role,
      fieldKeys: recipeFieldKeys(s.type),
    })),
  }));
  const copy =
    (await ai
      .writePageCopy({ brief, business, profile, dna, locale: ctx.locale, pages: pageSpecs })
      .catch(() => null)) ?? recipe.pages.map(() => [] as Record<string, unknown>[]);

  // 9 · compose the doc (empty sections seed-fill deterministically)
  let doc = recipeToDoc({ recipe, copy, ctx, seed: usedSeed });

  // 7–8 · images. The curated pool fills every slot first (nothing is ever
  // blank) and `verifyDocImages` HEAD-checks those. THEN, if a Pexels resolver
  // is wired, real search RESULTS overwrite the slots it resolved — those URLs
  // come straight from a validated 200 API response (`images.pexels.com` host,
  // real photo id) so they are not re-fetched here.
  fillDocImages(doc, ctx, brief);
  await verifyDocImages(doc, ctx, brief).catch(() => 0);

  // 8 + 10a · the Pexels image search and the model's text review touch nothing
  // in common (images write content fields, the review reads a captured text
  // digest), so run them CONCURRENTLY — the ~15–20s review overlaps the photo
  // search instead of stacking after it.
  const reviewDigest = siteDigest(doc);
  let intents: ImageIntent[] = [];
  const [, initialFindings] = await Promise.all([
    (async () => {
      if (!input.images?.configured) return;
      intents = await deriveImageIntents(ai, {
        doc,
        profile,
        dna,
        business,
        locale: ctx.locale,
        seed: usedSeed,
      }).catch(() => []);
      if (!intents.length) return;
      const resolved = await input.images
        .resolve({ intents, seed: usedSeed, dna, profile })
        .catch(() => new Map());
      applyResolvedImages(doc, intents, resolved);
    })(),
    input.runContentReview === false
      ? Promise.resolve<QaReport['findings']>([])
      : ai
          .reviewSite({ brief, digest: reviewDigest, locale: ctx.locale })
          .catch(() => [] as QaReport['findings']),
  ]);

  // 10b · VERIFY → FIX. The site is checked (deterministic `structuralAudit` +
  // the model's `reviewSite`) and the problems are RESOLVED here, before we
  // return — the studio only ever gets the finished, corrected result.
  const rep = await repairGeneratedSite({
    ai,
    doc,
    brief,
    ctx,
    business,
    initialFindings: initialFindings ?? [],
  });
  doc = rep.doc;
  const repaired = [...rep.repaired];

  // 11 · Phase 3 — visual QA gate + targeted repair (≤2 rounds). A pure no-op
  // unless VISUAL_QA is on AND a screenshot of `siteUrl` comes back.
  let residualChecks = rep.residual.checks;
  const residualFindings = rep.residual.findings;
  const visual = input.visualQa
    ? await runVisualReview({
        ai,
        cfg: input.visualQa,
        brief,
        digest: siteDigest(doc, 4000, { sectionIds: true }),
        locale: ctx.locale,
        shoot: input.shoot,
      }).catch(() => null)
    : null;

  let scores: QaReport['scores'];
  if (visual) {
    for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
      const checks = structuralAudit(doc, brief);
      const gate = runQualityGate({
        doc,
        structuralChecks: checks,
        findings: residualFindings,
        visual,
        diversityDistance: minDistance(fingerprintDoc(doc, recipe), input.recentFingerprints),
        imageSlots: countImageSlots(doc),
      });
      scores = gate.scores;
      if (gatePasses(gate.scores) || !gate.fixes.length) break;
      const applied = await applyTargetedFixes({
        doc,
        fixes: gate.fixes,
        ctx,
        ai,
        dna,
        profile,
        business,
        brief,
        seed: usedSeed + round * 131,
        images: input.images,
      });
      doc = applied.doc;
      repaired.push(...applied.applied);
      if (!applied.applied.length) break;
    }
    const finalChecks = structuralAudit(doc, brief)
      .filter((c) => !c.ok)
      .map((c) => (c.detail ? `${c.id}: ${c.detail}` : c.id));
    residualChecks = finalChecks;
  }

  const fingerprint = fingerprintDoc(doc, recipe);
  const report: QaReport = {
    checks: residualChecks,
    findings: residualFindings,
    repaired,
    ...(scores ? { scores } : {}),
    ...(visual
      ? {
          visual: {
            score: visual.score,
            criticalIssues: visual.criticalIssues,
            warnings: visual.warnings,
            strengths: visual.strengths,
          },
        }
      : {}),
  };

  return { doc, report, repaired, fingerprint, profile, direction, dna, recipe };
}

/** Min structural distance from `fp` to any recent fingerprint hash (1 = none / all different). */
function minDistance(fp: Fingerprint, recent: string[] | undefined): number {
  if (!recent?.length) return 1;
  // We only have the recent HASHES, not full fingerprints — treat an exact hash
  // match as distance 0, otherwise assume "structurally apart".
  return recent.includes(fp.hash) ? 0 : 1;
}

function countImageSlots(doc: BuilderDoc): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  const check = (v: unknown): void => {
    total++;
    if (typeof v === 'string' && v.trim()) filled++;
  };
  for (const p of doc.pages) {
    if (p.system) continue;
    for (const s of p.sections) {
      const c = (s.content ?? {}) as Record<string, unknown>;
      if (s.type === 'hero' || s.type === 'showcase') check(c.backgroundImage);
      if (s.type === 'caseStudy') check(c.imageUrl);
      if (s.type === 'about' && ['imageRight', 'imageLeft', 'twoCol'].includes(s.variant)) {
        check(c.imageUrl);
      }
      if (['gallery', 'featureSplit', 'bento', 'tabs'].includes(s.type) && Array.isArray(c.items)) {
        for (const it of c.items as Record<string, unknown>[]) check(it.imageUrl);
      }
    }
  }
  return { filled, total };
}
