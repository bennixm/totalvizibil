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
  | 'primaryCTA'
  | 'secondaryCTA'
  | 'contact';

export interface IARole {
  role: SectionRole;
  required: boolean;
  /** Lower = earlier on the page. */
  priority: number;
  rationale?: string;
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
  }): Promise<{ roles: IARole[]; omitted: SectionRole[]; pageCount: number } | null>;
  writePageCopy(input: {
    brief: string;
    business: GeneratorBusiness;
    profile: BusinessProfile;
    dna: DesignDNA;
    locale: StudioLocale;
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
    slots: { key: string; role: string; sectionType: string; hint: string }[];
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
