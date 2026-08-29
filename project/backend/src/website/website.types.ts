/**
 * Website content model (PRD §11.1) — a constrained block tree, stored as JSON.
 * The same shape is used for `WebsiteDraft.content` and `Website.content`.
 */

export type SectionType =
  'hero' | 'about' | 'services' | 'gallery' | 'testimonials' | 'faq' | 'contact' | 'cta';

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
}

export interface AboutSection extends BaseSection {
  type: 'about';
  title: string;
  body: string;
}

export interface ServiceItem {
  name: string;
  description: string;
}
export interface ServicesSection extends BaseSection {
  type: 'services';
  title: string;
  items: ServiceItem[];
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

export type Section =
  | HeroSection
  | AboutSection
  | ServicesSection
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
}

// --- Generator inputs -----------------------------------------------------

export interface EasyInput {
  mode: 'easy';
  businessName: string;
  businessType: string; // free text, e.g. "construction company"
  city: string;
  services: string[];
  shortDescription: string;
}

export interface AdvancedInput {
  mode: 'advanced';
  businessName: string;
  businessType: string;
  city: string;
  region?: string;
  services: string[];
  shortDescription: string;
  targetAudience?: string;
  toneOfVoice?: 'professional' | 'friendly' | 'premium' | 'bold' | 'calm';
  palette?: WebsiteTheme['palette'];
  fontPair?: WebsiteTheme['fontPair'];
  radius?: WebsiteTheme['radius'];
  primaryCta?: string;
  includeFaq?: boolean;
  includeTestimonials?: boolean;
  seoKeywords?: string[];
  phone?: string;
  email?: string;
}

export type GeneratorInput = EasyInput | AdvancedInput;

export interface GeneratedWebsite {
  theme: WebsiteTheme;
  content: WebsiteContent;
  generator: string;
}
