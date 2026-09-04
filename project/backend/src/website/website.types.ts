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
  | 'banner';

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
  | BannerSection;

export interface WebsitePage {
  slug: string;
  title: string;
  isHome: boolean;
  /** Show this page in the site's top navigation (Advanced builder). Default true. */
  nav?: boolean;
  sections: Section[];
}

export interface WebsiteSeo {
  title: string;
  description: string;
  schemaType: 'LocalBusiness';
}

export interface WebsiteContent {
  pages: WebsitePage[];
  seo: WebsiteSeo;
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
