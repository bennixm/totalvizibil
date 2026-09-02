/**
 * Website content model (PRD §11.1) — a constrained block tree, stored as JSON
 * in `Website.content`.
 */

export type SectionType =
  | 'hero'
  | 'about'
  | 'services'
  | 'features'
  | 'gallery'
  | 'testimonials'
  | 'faq'
  | 'contact'
  | 'cta';

export interface BaseSection {
  id: string;
  type: SectionType;
  visible: boolean;
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

export interface TestimonialItem {
  quote: string;
  author: string;
}
export interface TestimonialsSection extends BaseSection {
  type: 'testimonials';
  title: string;
  items: TestimonialItem[];
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

export interface ContactSection extends BaseSection {
  type: 'contact';
  title: string;
  phone?: string;
  email?: string;
  city?: string;
  addressLine?: string;
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

export type Section =
  | HeroSection
  | AboutSection
  | ServicesSection
  | FeaturesSection
  | GallerySection
  | TestimonialsSection
  | FaqSection
  | ContactSection
  | CtaSection;

export interface WebsitePage {
  slug: string;
  title: string;
  isHome: boolean;
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

export interface WebsiteTheme {
  palette: 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose';
  fontPair: 'grotesk-inter' | 'serif-sans' | 'mono-sans';
  radius: 'sharp' | 'soft' | 'round';
  density: 'compact' | 'comfortable' | 'spacious';
  /**
   * Custom brand colour picked in the Simple-site builder (`#rrggbb`). When set
   * it overrides the named `palette` in the renderer; `palette` is kept as the
   * nearest-match fallback.
   */
  accent?: string;
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
