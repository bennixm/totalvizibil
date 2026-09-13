/**
 * Shared artifact types for the Advanced builder's generation pipeline.
 *
 *   BRIEF → BusinessProfile + CreativeDirection → DesignDNA → IASpec
 *         → LayoutRecipe → copy → ImageIntent[] → images → BuilderDoc → QaReport
 *
 * Each stage produces one typed artifact that DETERMINISTICALLY drives the next.
 * Nothing here calls an LLM — see `ai.service.ts` for the AI transports and
 * `pipeline.ts` for the orchestration.
 */
import type { SectionType, WebsiteTheme } from '../../website.types';
import type { SectionStyle, ElementStyle } from '../compose-advanced';
import type { SiteFinding } from '../site-audit';
import type { Archetype } from '../site-archetypes';
import type { StudioLocale } from '../section-catalog';

// --- Stage 0: brief refinement -------------------------------------------

export interface SuggestedPage {
  title: string;
  purpose: string;
}

/** An option the client can pick for a `kind:'choice'` clarify question. */
export interface ClarifyOption {
  /** The literal id `"ai_decide"` marks the "let the AI decide" option — every
   *  choice question must include exactly one. Detected by this exact id, not
   *  by matching label text, so downstream code can filter it out reliably
   *  regardless of phrasing/locale. */
  id: string;
  label: string;
  /** ONLY for a page-structure question: the concrete pages THIS option
   *  prescribes. Absent/empty ⇒ this option does not commit to a structure
   *  (always true for the `ai_decide` option). Structured on purpose — the
   *  page count/split becomes a hard downstream requirement, not something
   *  re-parsed out of prose the model could phrase inconsistently. */
  pages?: SuggestedPage[];
}

/** A single follow-up question the clarification step wants the client to answer. */
export interface ClarifyQuestion {
  id: string;
  kind: 'choice' | 'text';
  /** The question itself, in the client's locale. */
  prompt: string;
  /** Only for `kind:'choice'`. Always includes an `id:"ai_decide"` option. */
  options?: ClarifyOption[];
}

/** One answered question — free text, or the id/label of the chosen option. */
export interface ClarifyAnswer {
  questionId: string;
  value: string;
}

export interface EnrichedBrief {
  /** The rewritten, richer brief — feeds analyzeBusiness/planIA/writePageCopy and
   *  every other internal AI call. NEVER shown to the client and NEVER replaces
   *  `doc.ai.brief` (which stays exactly what the client typed). */
  brief: string;
  /** Recommended page split — a strong signal for `planIA`, not a command. */
  suggestedPages: SuggestedPage[];
  /** Concrete content angles to emphasize, drawn from what the client actually said. */
  emphasize: string[];
  /** Assumptions made explicit, for logs/audit — never injected into copy as fact. */
  clarifications: string[];
}

// --- Stage 1: business analysis --------------------------------------------

export type PurchaseIntent = 'impulse' | 'considered' | 'high-trust';
export type BusinessMaturity = 'new' | 'established' | 'premium';
export type ImageIntensity = 'minimal' | 'medium' | 'high' | 'gallery-led';

export interface BusinessProfile {
  /** Concrete trade, e.g. "residential construction company". */
  businessType: string;
  audience: string;
  purchaseIntent: PurchaseIntent;
  trustDrivers: string[];
  primaryConversion: string;
  secondaryConversion: string;
  maturity: BusinessMaturity;
  positioning: string;
  emotionalTone: string;
  /** What is worth photographing for this business (feeds image queries). */
  visualOpportunities: string[];
  /** Ordered — what the site must communicate first. */
  contentPriorities: string[];
  imageIntensity: ImageIntensity;
  /** The cheap keyword classification, carried for the deterministic paths. */
  archetype: Archetype;
}

// --- Stage 2: creative direction -----------------------------------------

export interface CreativeDirection {
  /** Free text — e.g. "architectural", "warm-local", "editorial", "clinical-calm". */
  family: string;
  rationale: string;
  referencePoints: string[];
}

// --- Stage 3: design DNA ------------------------------------------------

export type CompositionStyle = 'centered' | 'asymmetric' | 'editorial' | 'grid';
export type CompositionMode =
  'full' | 'split' | 'asymmetric' | 'centered' | 'editorial' | 'grid' | 'image-led' | 'compact';
export type ImageTreatment = 'full-bleed' | 'inset' | 'framed' | 'duotone' | 'none';
export type SpacingScale = 'compact' | 'standard' | 'spacious';

export interface DnaTypography {
  headingFont: NonNullable<WebsiteTheme['headingFont']>;
  headingScale: NonNullable<WebsiteTheme['headingScale']>;
  headingWeight: NonNullable<WebsiteTheme['headingWeight']>;
  headingAlign: NonNullable<WebsiteTheme['headingAlign']>;
  bodyScale: NonNullable<WebsiteTheme['bodyScale']>;
  lineHeight: NonNullable<WebsiteTheme['lineHeight']>;
  letterSpacing: NonNullable<WebsiteTheme['letterSpacing']>;
  textWidth: NonNullable<WebsiteTheme['textWidth']>;
}

export interface DesignDNA {
  visualStyle: string;
  compositionStyle: CompositionStyle;
  typography: DnaTypography;
  spacing: SpacingScale;
  radius: WebsiteTheme['radius'];
  imageTreatment: ImageTreatment;
  /** Preferred `hero` variant id. */
  heroStyle: string;
  navStyle: 'text' | 'pill';
  cardStyle: 'flat' | 'bordered' | 'raised' | 'editorial';
  buttonStyle: NonNullable<WebsiteTheme['buttonStyle']>;
  contentDensity: WebsiteTheme['density'];
  /** Target sequence of composition modes down the home page. */
  sectionRhythm: CompositionMode[];
  decorativeStyle: 'none' | 'subtle' | 'expressive';
  /** Photography direction — literal keywords appended to image queries. */
  photographyStyle: string;
  colorStrategy: {
    background: NonNullable<WebsiteTheme['background']>;
    palette: WebsiteTheme['palette'];
    accentHex?: string;
  };
}

/**
 * Optional per-business overrides the AI proposes in Stage 1 (same call as the
 * profile) — merged OVER the family-table DNA in `deriveDesignDNA` so the look is
 * bespoke to this brand, not just the direction family's default. Every field is
 * validated; anything missing / invalid falls through to the deterministic base.
 */
export interface DnaHints {
  headingFont?: NonNullable<WebsiteTheme['headingFont']>;
  headingScale?: NonNullable<WebsiteTheme['headingScale']>;
  headingAlign?: NonNullable<WebsiteTheme['headingAlign']>;
  spacing?: SpacingScale;
  radius?: WebsiteTheme['radius'];
  heroStyle?: string;
  cardStyle?: DesignDNA['cardStyle'];
  decorativeStyle?: DesignDNA['decorativeStyle'];
  background?: NonNullable<WebsiteTheme['background']>;
  palette?: WebsiteTheme['palette'];
  /** `#rrggbb` brand colour. */
  accentHex?: string;
  photographyStyle?: string;
}

// --- Stage 4: information architecture ---------------------------------

export type SectionRole =
  | 'hero'
  | 'trustBar'
  | 'services'
  | 'work'
  | 'process'
  | 'about'
  | 'story'
  | 'team'
  | 'credentials'
  | 'stats'
  | 'testimonials'
  | 'faq'
  | 'pricing'
  | 'gallery'
  | 'hours'
  | 'comparisonTable'
  | 'featuredProject'
  | 'specialties'
  | 'serviceArea'
  | 'primaryCTA'
  | 'secondaryCTA'
  | 'contact';

export interface IARole {
  role: SectionRole;
  required: boolean;
  /** Lower = earlier on the page. */
  priority: number;
  rationale?: string;
  /** AI's suggested visual weight for THIS section's actual content — a hint
   *  layered onto the deterministic rhythm engine, not a structural decision.
   *  Ignored when invalid/absent; `assignRhythm` falls back to its own rotation. */
  emphasis?: CompositionMode;
}

export interface IASpec {
  roles: IARole[];
  omitted: SectionRole[];
  pageStrategy: 'one-page' | 'multi-page';
  pageCount: number;
}

// --- Stage 5: layout recipe ------------------------------------------

export interface ImageSlotSpec {
  needed: boolean;
  orientation: 'landscape' | 'portrait' | 'square';
  /** e.g. "hero", "about-environment", "service-visual", "project". */
  role: string;
  /** Composition hint for the search, e.g. "wide, subject left, negative space right". */
  focal: string;
}

export interface RecipeSection {
  role: SectionRole;
  type: SectionType;
  variant: string;
  composition: CompositionMode;
  animation?: string;
  imageSlot: ImageSlotSpec;
  style?: SectionStyle;
  overrides?: Record<string, ElementStyle>;
}

export interface RecipePage {
  title: string;
  slug: string;
  purpose: string;
  nav: boolean;
  sections: RecipeSection[];
}

export interface LayoutRecipe {
  pages: RecipePage[];
  theme: WebsiteTheme;
}

// --- Stage 7: image intent ----------------------------------------

export interface ImageIntent {
  /** Doc section id the resolved photo lands on. */
  sectionId: string;
  /** Which image field on the section (`backgroundImage` / `imageUrl` / item idx). */
  field: string;
  itemIndex?: number;
  role: string;
  /** DETERMINISTIC, business-derived — builds the search query + cache key. */
  subject: string;
  scene: string;
  /** Optional AI-refined phrasing — used only to RANK results and as alt text,
   *  NEVER in the query, so the Pexels cache stays hot across re-generations. */
  refinedSubject?: string;
  refinedScene?: string;
  mood: string;
  composition: string;
  style: string;
  orientation: 'landscape' | 'portrait' | 'square';
  avoid: string[];
}

export interface ResolvedImage {
  url: string;
  provider: 'pexels' | 'pool' | 'placeholder';
  photoId?: string;
  photographer?: string;
  photographerUrl?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  alt: string;
  query?: string;
}

export interface ImageResolveRequest {
  intents: ImageIntent[];
  seed: number;
  dna: DesignDNA;
  profile: BusinessProfile;
}

/**
 * Narrow slice of `ImageSearchService` the pure pipeline depends on — keeps the
 * stages free of a Nest / Prisma import and trivially mockable (like `GeneratorAi`).
 * Omitted from `generateSite` ⇒ the curated pool is the only image source.
 */
export interface ImageSearchResolver {
  readonly configured: boolean;
  /** key → resolved photo, keyed `"<sectionId>|<field>|<itemIndex|->"`. */
  resolve(req: ImageResolveRequest): Promise<Map<string, ResolvedImage>>;
}

// --- QA -----------------------------------------------------------

export interface QaScores {
  structural: number;
  content: number;
  visual: number;
  image: number;
  diversity: number;
}

export interface VisualReview {
  score: number;
  criticalIssues: string[];
  warnings: string[];
  strengths: string[];
  recommendedFixes: TargetedFix[];
}

export type FixTarget =
  | 'hero.image'
  | 'typography'
  | 'spacing'
  | `section:${string}.image`
  | `section:${string}.variant`
  | `section:${string}.copy`;

export interface TargetedFix {
  target: FixTarget;
  instruction: string;
}

export interface QaReport {
  /** Failed deterministic check ids (+ optional detail after ": "). */
  checks: string[];
  findings: SiteFinding[];
  scores?: QaScores;
  visual?: Pick<VisualReview, 'score' | 'criticalIssues' | 'warnings' | 'strengths'>;
  /** Fixes applied during targeted repair, for the studio to show. */
  repaired?: string[];
}

// --- AI surface the generator depends on ---------------------------------

export interface GeneratorBusiness {
  name: string;
  type?: string;
  city?: string;
  services: string[];
}

/**
 * The narrow slice of `AiService` the generator modules call. Declaring it
 * here keeps the pure stages free of a Nest import and trivially mockable.
 */
export interface GeneratorAi {
  readonly configured: boolean;
  analyzeBusiness(input: {
    brief: string;
    business: GeneratorBusiness;
    locale: StudioLocale;
    seed: number;
  }): Promise<{
    profile: Partial<BusinessProfile>;
    direction: Partial<CreativeDirection>;
    dnaHints?: Partial<DnaHints>;
  } | null>;
  planArchitecture(input: {
    brief: string;
    business: GeneratorBusiness;
    profile: BusinessProfile;
    direction: CreativeDirection;
    locale: StudioLocale;
    seed: number;
    roleVocab: string[];
    /** Recommended page split from Stage 0 (`refineBrief`) — a strong signal, not a command. */
    pageHint?: string;
    /** The client EXPLICITLY chose this page count during clarification — not a
     *  suggestion, a requirement. The caller still clamps `pageCount` to this
     *  value in code regardless of what comes back; this is passed so the
     *  model scales its own role budget to match rather than under-shooting. */
    forcedPageCount?: number;
  }): Promise<{ roles: IARole[]; omitted: SectionRole[]; pageCount: number } | null>;
  /**
   * Stage 0 — rewrite the client's raw brief into a richer, more specific one
   * BEFORE the rest of the pipeline reads it, and recommend a page split.
   * MUST NOT invent facts not stated or clearly implied (no years in business,
   * staff counts, prices, certifications) — only elaborate tone/structure/
   * emphasis and make implicit specifics explicit. `null` ⇒ caller falls back
   * to the original brief unchanged.
   */
  refineBrief(input: {
    brief: string;
    business: GeneratorBusiness;
    locale: StudioLocale;
  }): Promise<Partial<EnrichedBrief> | null>;
  /**
   * Pre-generation clarification: decide whether the brief is missing
   * something important enough that generating now would force a guess
   * (page structure, design direction, a concrete fact) — and if so, ask up
   * to a few short questions instead of guessing. `null`/`done:true` ⇒ the
   * caller proceeds straight to generation.
   */
  clarifyBrief(input: {
    brief: string;
    business: GeneratorBusiness;
    locale: StudioLocale;
    archetype: string;
    answers: ClarifyAnswer[];
  }): Promise<{ done: boolean; questions?: ClarifyQuestion[] } | null>;
  writePageCopy(input: {
    brief: string;
    business: GeneratorBusiness;
    profile: BusinessProfile;
    dna: DesignDNA;
    locale: StudioLocale;
    /** Stage 0's concrete content angles — real material, not invented. */
    emphasize?: string[];
    pages: {
      title: string;
      purpose: string;
      sections: { type: string; variant: string; role: string; fieldKeys: string[] }[];
    }[];
  }): Promise<Record<string, unknown>[][] | null>;
  enrichImageIntents(input: {
    business: GeneratorBusiness;
    profile: BusinessProfile;
    dna: DesignDNA;
    locale: StudioLocale;
    slots: { key: string; role: string; sectionType: string; hint: string; pageTitle: string }[];
  }): Promise<Record<string, { subject: string; scene: string; avoid: string[] }> | null>;
  /** The model's read of the finished site (text digest) — feeds auto-repair. */
  reviewSite(input: {
    brief: string;
    digest: string;
    locale: StudioLocale;
  }): Promise<SiteFinding[] | null>;
  /** Post-generation auto-repair: rewrite flagged sections to resolve their issues. */
  fixSections(input: {
    brief: string;
    business: GeneratorBusiness;
    locale: StudioLocale;
    sections: {
      ref: string;
      type: string;
      variant: string;
      fieldKeys: string[];
      content: Record<string, unknown>;
      issues: string[];
    }[];
  }): Promise<Record<number, Record<string, unknown>> | null>;
  /**
   * Phase 3 — Claude-vision review of a screenshot of the rendered site.
   * `null` when no vision model is configured. The base64 image is the site's
   * OWN screenshot only.
   */
  visualReview(input: {
    imageBase64: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
    brief: string;
    digest: string;
    locale: StudioLocale;
  }): Promise<VisualReview | null>;
}

// --- Phase 3: visual QA config ------------------------------------------

export interface VisualQaConfig {
  /** `VISUAL_QA=on`. */
  enabled: boolean;
  /** Dev screenshot service (`?url=` → PNG). Empty ⇒ the whole pass no-ops. */
  screenshotUrl: string;
  /** Public URL of the rendered site to screenshot. Empty ⇒ no-op. */
  siteUrl?: string;
}
