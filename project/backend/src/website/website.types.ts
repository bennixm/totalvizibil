/**
 * Website content model (PRD §11.1) — a constrained block tree, stored as JSON
 * in `Website.content`.
 */

export type SectionType =
  | 'hero'
  | 'logos'
  | 'about'
  | 'stats'
  | 'services'
  | 'process'
  | 'features'
  | 'featureSplit'
  | 'gallery'
  | 'team'
  | 'testimonials'
  | 'pricing'
  | 'faq'
  | 'richText'
  | 'contact'
  | 'cta'
  | 'marquee'
  | 'bento'
  | 'timeline'
  | 'comparison'
  | 'banner'
  | 'custom'
  | 'bigStatement'
  | 'highlightsRow'
  | 'ratingBand'
  | 'video'
  | 'showcase'
  | 'beforeAfter'
  | 'tabs'
  | 'hours'
  | 'caseStudy'
  | 'splitCta'
  | 'newsletter'
  | 'quoteBig';

/** Scroll-in animation preset for a section (Advanced builder). */
export type SectionAnimation =
  'none' | 'fade' | 'rise' | 'slideLeft' | 'slideRight' | 'zoom' | 'blur';

export interface BaseSection {
  id: string;
  type: SectionType;
  visible: boolean;
  /** Design variant within the section type (Advanced builder catalog). */
  variant?: string;
  /** Entrance animation; absent = inherit the theme's motion default. */
  animation?: string;
  /** Owner colour overrides for this section (Advanced builder). */
  style?: { bg?: string; text?: string; heading?: string; accent?: string };
}

export interface HeroSection extends BaseSection {
  type: 'hero';
  headline: string;
  subheadline: string;
  primaryCta: string;
  secondaryCta?: string;
  /** Landing background image (Simple-site builder) — a `/website-assets/:id` URL. */
  backgroundImage?: string;
  /** Text alignment (template variation). */
  align?: 'center' | 'start';
}

export interface AboutSection extends BaseSection {
  type: 'about';
  title: string;
  body: string;
  /** Optional side image (`imageRight` / `imageLeft` variants). */
  imageUrl?: string;
}

export interface LogoItem {
  name: string;
  imageUrl?: string;
}
export interface LogosSection extends BaseSection {
  type: 'logos';
  title?: string;
  items: LogoItem[];
}

export interface ServiceItem {
  name: string;
  description: string;
  /** mdi icon name picked from the service name (Simple-site builder). */
  icon?: string;
}
export interface ServicesSection extends BaseSection {
  type: 'services';
  title: string;
  items: ServiceItem[];
  /** Card grid vs. stacked rows (template variation). */
  layout?: 'cards' | 'list';
}

export interface FeatureItem {
  title: string;
  text?: string;
  /** mdi icon picked from the point's wording (Simple-site builder). */
  icon?: string;
}
export interface FeaturesSection extends BaseSection {
  type: 'features';
  title: string;
  items: FeatureItem[];
}

export interface FeatureSplitItem {
  title: string;
  text?: string;
  imageUrl?: string;
  /** Which side the image sits on for this row. */
  mediaSide?: 'left' | 'right';
}
export interface FeatureSplitSection extends BaseSection {
  type: 'featureSplit';
  title?: string;
  items: FeatureSplitItem[];
}

export interface StatItem {
  value: string;
  label: string;
}
export interface StatsSection extends BaseSection {
  type: 'stats';
  title?: string;
  items: StatItem[];
}

export interface ProcessItem {
  title: string;
  text?: string;
}
export interface ProcessSection extends BaseSection {
  type: 'process';
  title: string;
  items: ProcessItem[];
}

export interface TestimonialItem {
  quote: string;
  author: string;
  /** Optional role/company line under the author. */
  role?: string;
}
export interface TestimonialsSection extends BaseSection {
  type: 'testimonials';
  title: string;
  items: TestimonialItem[];
}

export interface PricingItem {
  name: string;
  price: string;
  period?: string;
  features: string[];
  cta?: string;
  highlighted?: boolean;
}
export interface PricingSection extends BaseSection {
  type: 'pricing';
  title: string;
  items: PricingItem[];
}

export interface FaqItem {
  q: string;
  a: string;
}
export interface FaqSection extends BaseSection {
  type: 'faq';
  title: string;
  items: FaqItem[];
}

export interface RichTextSection extends BaseSection {
  type: 'richText';
  title?: string;
  /** Plain text; the renderer splits paragraphs on blank lines. */
  body: string;
}

export interface ContactSection extends BaseSection {
  type: 'contact';
  title: string;
  phone?: string;
  email?: string;
  city?: string;
  addressLine?: string;
  /** Opening hours, free text (Simple-site builder). */
  hours?: string;
}

export interface CtaSection extends BaseSection {
  type: 'cta';
  headline: string;
  buttonLabel: string;
}

export interface GalleryItem {
  title: string;
  description?: string;
  /** Portfolio photo (Simple-site builder) — a `/website-assets/:id` URL. */
  imageUrl?: string;
}
export interface GallerySection extends BaseSection {
  type: 'gallery';
  title: string;
  items: GalleryItem[];
}

export interface TeamLink {
  label: string;
  url: string;
}
export interface TeamMember {
  name: string;
  role?: string;
  bio?: string;
  imageUrl?: string;
  links?: TeamLink[];
}
export interface TeamSection extends BaseSection {
  type: 'team';
  title: string;
  items: TeamMember[];
}

export interface MarqueeSection extends BaseSection {
  type: 'marquee';
  title?: string;
  /** Short phrases (text variant) or client names (logos variant). */
  items: string[];
  speed?: 'slow' | 'normal' | 'fast';
}

export interface BentoItem {
  title: string;
  text?: string;
  imageUrl?: string;
}
export interface BentoSection extends BaseSection {
  type: 'bento';
  title?: string;
  items: BentoItem[];
}

export interface TimelineItem {
  date: string;
  title: string;
  text?: string;
}
export interface TimelineSection extends BaseSection {
  type: 'timeline';
  title?: string;
  items: TimelineItem[];
}

export interface ComparisonItem {
  label: string;
  /** Short text, or "yes"/"no"/"" — the renderer shows a ✓/✗ for the latter. */
  us: string;
  them: string;
}
export interface ComparisonSection extends BaseSection {
  type: 'comparison';
  usTitle: string;
  themTitle: string;
  items: ComparisonItem[];
}

export interface BannerSection extends BaseSection {
  type: 'banner';
  text: string;
  buttonLabel?: string;
}

/** One typed block inside a `custom` section. */
export interface CustomBlock {
  kind: 'heading' | 'text' | 'image' | 'button' | 'spacer' | 'divider';
  text?: string;
  size?: 'lg' | 'md' | 'sm';
  /** Per-block text colour (heading / text blocks). */
  color?: string;
  url?: string;
  caption?: string;
  label?: string;
  target?: string;
  variant?: 'solid' | 'ghost';
}

/** Owner-assembled free-form section: pick a width + background, stack blocks. */
export interface CustomSection extends BaseSection {
  type: 'custom';
  width: 'standard' | 'wide' | 'full' | 'narrow';
  background: 'transparent' | 'surface' | 'wash' | 'accent' | 'ink';
  align: 'left' | 'center';
  blocks: CustomBlock[];
}

export interface BigStatementSection extends BaseSection {
  type: 'bigStatement';
  statement: string;
  items: string[];
}
export interface HighlightItem {
  icon: string;
  label: string;
}
export interface HighlightsRowSection extends BaseSection {
  type: 'highlightsRow';
  title: string;
  items: HighlightItem[];
}
export interface RatingBandSection extends BaseSection {
  type: 'ratingBand';
  rating: string;
  count: string;
  source: string;
  text: string;
}
export interface VideoSection extends BaseSection {
  type: 'video';
  title: string;
  videoUrl: string;
  posterImage: string;
  caption: string;
}
export interface ShowcaseSection extends BaseSection {
  type: 'showcase';
  backgroundImage: string;
  headline: string;
  text: string;
  buttonLabel: string;
}
export interface BeforeAfterSection extends BaseSection {
  type: 'beforeAfter';
  title: string;
  beforeImage: string;
  afterImage: string;
  beforeLabel: string;
  afterLabel: string;
}
export interface TabItem {
  label: string;
  body: string;
  imageUrl: string;
}
export interface TabsSection extends BaseSection {
  type: 'tabs';
  title: string;
  items: TabItem[];
}
export interface HoursItem {
  day: string;
  value: string;
}
export interface HoursSection extends BaseSection {
  type: 'hours';
  title: string;
  note: string;
  items: HoursItem[];
}
export interface CaseStudySection extends BaseSection {
  type: 'caseStudy';
  title: string;
  client: string;
  imageUrl: string;
  challenge: string;
  solution: string;
  result: string;
  metric: string;
  metricLabel: string;
}
export interface SplitCtaItem {
  title: string;
  text: string;
  buttonLabel: string;
  target: string;
}
export interface SplitCtaSection extends BaseSection {
  type: 'splitCta';
  title: string;
  items: SplitCtaItem[];
}
export interface NewsletterSection extends BaseSection {
  type: 'newsletter';
  title: string;
  text: string;
  buttonLabel: string;
  placeholder: string;
  note: string;
}
export interface QuoteBigSection extends BaseSection {
  type: 'quoteBig';
  quote: string;
  author: string;
  role: string;
  imageUrl: string;
}

export type Section =
  | HeroSection
  | LogosSection
  | AboutSection
  | StatsSection
  | ServicesSection
  | ProcessSection
  | FeaturesSection
  | FeatureSplitSection
  | GallerySection
  | TeamSection
  | TestimonialsSection
  | PricingSection
  | FaqSection
  | RichTextSection
  | ContactSection
  | CtaSection
  | MarqueeSection
  | BentoSection
  | TimelineSection
  | ComparisonSection
  | BannerSection
  | CustomSection
  | BigStatementSection
  | HighlightsRowSection
  | RatingBandSection
  | VideoSection
  | ShowcaseSection
  | BeforeAfterSection
  | TabsSection
  | HoursSection
  | CaseStudySection
  | SplitCtaSection
  | NewsletterSection
  | QuoteBigSection;

export interface WebsitePage {
  slug: string;
  title: string;
  isHome: boolean;
  /** Show this page in the site's top navigation (Advanced builder). Default true. */
  nav?: boolean;
  /** Reserved legal page — editable text, but the owner can't delete/reorder it. */
  system?: 'privacy' | 'terms' | 'cookies';
  sections: Section[];
}

export interface WebsiteSeo {
  title: string;
  description: string;
  schemaType: 'LocalBusiness';
}

/** Owner-editable navbar settings (Advanced builder). */
export interface SiteNavConfig {
  /** Show the brand logo/name on the left. Default 'show'. */
  logo?: 'show' | 'hide';
  /** Sticky navbar on scroll. Default true. */
  sticky?: boolean;
  /** Render page links as plain text or pill buttons. Default 'text'. */
  linkStyle?: 'text' | 'pill';
  /** List the site's nav pages automatically. Default true. */
  showPages?: boolean;
  /** Optional call-to-action button; `target` is a page slug or 'contact'. */
  cta?: { label: string; target: string } | null;
}

/** Owner-editable footer settings (Advanced builder). */
export interface SiteFooterConfig {
  /** Overrides the auto blurb (SEO description) under the brand. */
  tagline?: string;
  /** Show the "Legal" column (privacy / terms / cookies). Default true. */
  showLegal?: boolean;
  /** Show the phone/email/city block. Default true. */
  showContact?: boolean;
  /** Social links rendered in the footer. */
  socials?: { label: string; url: string }[];
}

export interface WebsiteContent {
  pages: WebsitePage[];
  seo: WebsiteSeo;
  nav?: SiteNavConfig;
  footer?: SiteFooterConfig;
}

export type ThemePalette =
  | 'indigo'
  | 'violet'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'emerald'
  | 'lime'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'fuchsia'
  | 'slate';

export type ThemeRadius = 'none' | 'subtle' | 'rounded' | 'large' | 'pill';
export type ThemeFont = 'grotesk' | 'inter' | 'fraunces' | 'jetbrains';

export interface WebsiteTheme {
  palette: ThemePalette;
  /** Legacy coupled font pair (Simple-site builder). `headingFont`/`bodyFont` win when set. */
  fontPair: 'grotesk-inter' | 'serif-sans' | 'mono-sans';
  radius: ThemeRadius;
  density: 'compact' | 'comfortable' | 'spacious';
  /**
   * Custom brand colour (`#rrggbb`). When set it overrides the named `palette`
   * in the renderer; `palette` is kept as the nearest-match fallback.
   */
  accent?: string;
  /** Named style bundle chosen in the Advanced builder (UI highlight + round-trip). */
  preset?: string;
  /** Page surface mode (Advanced builder). */
  background?: 'light' | 'tinted' | 'dark';
  headingFont?: ThemeFont;
  bodyFont?: ThemeFont;
  buttonStyle?: 'solid' | 'outline' | 'soft' | 'pill';
  shadow?: 'none' | 'soft' | 'bold';
  /** Scroll-animation intensity for the whole site (Advanced builder). */
  motion?: 'off' | 'subtle' | 'lively';
  /** Brand logo shown in the site nav + footer (both builders). Also mirrored
   *  to `company.logoUrl` so the feed card uses the same image. */
  logoUrl?: string;

  // --- typographic character (Advanced generator's Design DNA) ----------
  // All optional; absent ⇒ the renderer's existing defaults. They let one
  // theme read as "quiet editorial" vs "loud display" without new fonts.
  /** Heading size ramp. `display` = oversized, `tight` = restrained. */
  headingScale?: 'tight' | 'normal' | 'display';
  /** Heading font-weight. */
  headingWeight?: 'regular' | 'medium' | 'semibold' | 'bold';
  /** Section-heading alignment. `left` = editorial, `center` = classic. */
  headingAlign?: 'left' | 'center';
  /** Body copy size nudge. */
  bodyScale?: 'small' | 'normal' | 'large';
  /** Body line-height. */
  lineHeight?: 'tight' | 'normal' | 'relaxed';
  /** Heading letter-spacing. */
  letterSpacing?: 'tight' | 'normal' | 'wide';
  /** Max width of running prose (`narrow` ≈ 58ch, `wide` ≈ 78ch). */
  textWidth?: 'narrow' | 'normal' | 'wide';
}

// --- Generator inputs -----------------------------------------------------

export type ToneOfVoice = 'professional' | 'friendly' | 'premium' | 'bold' | 'calm';

export interface EasyInput {
  mode: 'easy';
  businessName: string;
  businessType: string; // free text, e.g. "construction company"
  city: string;
  services: string[];
  shortDescription: string;
  // Optional tone tweak from the studio's "refine" step (free plan).
  tone?: ToneOfVoice;
  phone?: string;
  email?: string;
}

/** Pages the advanced builder can compose. `home` is always present and first. */
export type AdvancedPage = 'home' | 'about' | 'services' | 'portfolio' | 'faq' | 'contact';

export interface AdvancedInput {
  mode: 'advanced';
  businessName: string;
  businessType: string;
  city: string;
  region?: string;
  services: string[];
  shortDescription: string;
  targetAudience?: string;
  toneOfVoice?: ToneOfVoice;
  palette?: WebsiteTheme['palette'];
  fontPair?: WebsiteTheme['fontPair'];
  radius?: WebsiteTheme['radius'];
  primaryCta?: string;
  includeFaq?: boolean;
  includeTestimonials?: boolean;
  seoKeywords?: string[];
  phone?: string;
  email?: string;
  // Advanced builder (M7)
  pages?: AdvancedPage[];
  portfolio?: GalleryItem[];
}

export type GeneratorInput = EasyInput | AdvancedInput;

export interface GeneratedWebsite {
  theme: WebsiteTheme;
  content: WebsiteContent;
  generator: string;
}
