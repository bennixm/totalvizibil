/**
 * Deterministic composer for the "Site Simplu" one-pager.
 *
 * The Simple site is a richer fixed template — Landing, About, Services, Why-us,
 * Portfolio, Testimonials, FAQ, CTA, Contact — driven entirely by the studio's
 * guided answers. Nothing here calls an LLM: the AI touchpoints (Services copy,
 * grammar proofreading) happen in the service and their output lands in
 * `answers` before this runs. Every studio interaction ends with a call to
 * `composeEasySite`, so the left-hand preview always mirrors the current config.
 */
import {
  FeatureItem,
  GeneratedWebsite,
  GalleryItem,
  ProcessItem,
  Section,
  ServiceItem,
  StatItem,
  WebsiteTheme,
} from '../website.types';
import { pickFeatureIcon, pickServiceIcon } from './service-icons';

export type StudioLocale = 'ro' | 'en' | 'de';

export interface EasyTestimonial {
  quote: string;
  author?: string;
}
export interface EasyFaq {
  q: string;
  a: string;
}
export interface EasyStat {
  value: string;
  label: string;
}
export interface EasyProcessStep {
  title: string;
  text?: string;
}

export interface EasyAnswers {
  companyName?: string;
  /** Free-text trade/field, kept for SEO + the AI Services prompt. */
  businessType?: string;
  /** Landing headline. Defaults to the company name. */
  landingTitle?: string;
  landingSubtitle?: string;
  /** Brand colour, `#rrggbb`. */
  accentColor?: string;
  /** Landing background image — a `/api/v1/website-assets/:id` URL. */
  landingImage?: string;
  /** Brand logo — a `/api/v1/website-assets/:id` URL. Shown in the site nav/footer. */
  logoUrl?: string;
  /** Raw service names the client typed (input to the AI copy call). */
  serviceNames?: string[];
  /** Final Services items (AI-written or deterministic fallback), reorderable. */
  services?: ServiceItem[];
  /** Portfolio photos — up to 10 `/api/v1/website-assets/:id` URLs. */
  portfolio?: string[];
  phone?: string;
  email?: string;
  city?: string;

  // --- extra editable sections -----------------------------------------
  /** "About us" paragraph. Empty ⇒ a deterministic default is used. */
  about?: string;
  showAbout?: boolean;
  /** Headline numbers band (years, projects, rating…). Opt-in. */
  stats?: EasyStat[];
  showStats?: boolean;
  /** "Why choose us" bullet points. Empty ⇒ deterministic defaults. */
  whyUs?: string[];
  showWhyUs?: boolean;
  /** "How we work" steps. Empty ⇒ deterministic defaults. */
  process?: EasyProcessStep[];
  showProcess?: boolean;
  testimonials?: EasyTestimonial[];
  faq?: EasyFaq[];
  ctaHeadline?: string;
  ctaButton?: string;
  showCta?: boolean;
  /** Opening hours, free text (Contact section). */
  hours?: string;

  // --- site chrome: navbar + footer ----------------------------------
  /** Show the brand (logo / wordmark) in the one-pager bar. Default true. */
  navShowLogo?: boolean;
  /** Optional nav button — label + target (a section id, `contact`, or a URL). */
  navCtaLabel?: string;
  navCtaTarget?: string;
  /** Footer blurb under the brand. Empty ⇒ the SEO description is used. */
  footerTagline?: string;
  /** Show the phone / email / city column in the footer. Default true. */
  footerShowContact?: boolean;
  /** Footer social links (`label` + `https://…` url). */
  footerSocials?: { label: string; url: string }[];

  /** One-pager layout variant chosen at the start. */
  template?: 'classic' | 'bold' | 'minimal';

  locale?: StudioLocale;
  /** Deprecated — the manual grammar toggle was replaced by the end-of-setup review. */
  autoGrammar?: boolean;
  /** How many real AI copy calls this draft has spent (guards abuse). */
  aiCalls?: number;
  /** Deprecated counter from the old manual proofread flow. */
  proofreadCount?: number;
  /** How many end-of-setup AI review passes this draft has spent. */
  reviewCount?: number;
}

interface Labels {
  defaultTitle: string;
  heroCta: string;
  servicesTitle: string;
  aboutTitle: string;
  aboutDefault: (name: string, trade: string, city: string) => string;
  statsTitle: string;
  whyUsTitle: string;
  whyUsDefault: string[];
  processTitle: string;
  processDefault: EasyProcessStep[];
  portfolioTitle: string;
  testimonialsTitle: string;
  faqTitle: string;
  ctaTitle: (name: string) => string;
  ctaButton: string;
  contactTitle: string;
  /** Deterministic copy used when the AI call is unavailable; `i` rotates a few phrasings. */
  fallbackDesc: (name: string, i: number) => string;
  seoDesc: (name: string, trade: string) => string;
}

const LABELS: Record<StudioLocale, Labels> = {
  ro: {
    defaultTitle: 'Afacerea ta',
    heroCta: 'Contactează-ne',
    servicesTitle: 'Serviciile noastre',
    aboutTitle: 'Despre noi',
    aboutDefault: (name, trade, city) =>
      `${name} este o echipă${trade ? ` de ${trade.toLowerCase()}` : ''}${city ? ` din ${city}` : ''} ` +
      `care pune accent pe lucrări făcute corect, comunicare clară și termene respectate. ` +
      `Venim la evaluare, îți explicăm opțiunile pe înțelesul tău și ducem treaba la capăt.`,
    statsTitle: 'În cifre',
    whyUsTitle: 'De ce să ne alegi',
    whyUsDefault: [
      'Răspuns rapid la solicitări',
      'Preț corect, comunicat din start',
      'Lucrări cu garanție',
      'Echipă cu experiență',
    ],
    processTitle: 'Cum lucrăm',
    processDefault: [
      { title: 'Contact și programare', text: 'Ne spui ce ai nevoie și stabilim o vizită.' },
      {
        title: 'Evaluare și ofertă',
        text: 'Vedem lucrarea la fața locului și primești o ofertă clară.',
      },
      { title: 'Execuție', text: 'Ne apucăm de treabă, cu materiale de calitate și la termen.' },
      {
        title: 'Predare și garanție',
        text: 'Verificăm împreună rezultatul și îți lăsăm garanție.',
      },
    ],
    portfolioTitle: 'Portofoliu',
    testimonialsTitle: 'Ce spun clienții',
    faqTitle: 'Întrebări frecvente',
    ctaTitle: (name) => `Gata să începem? Contactează ${name}`,
    ctaButton: 'Cere o ofertă',
    contactTitle: 'Contact',
    fallbackDesc: (name, i) =>
      [
        `${cap(name)} executat de o echipă cu experiență, cu materiale de calitate și termene respectate.`,
        `Ne ocupăm de ${name.toLowerCase()} de la evaluare până la finalizare, cu o ofertă clară de la început.`,
        `${cap(name)} la standard profesional — lucrări curate, comunicare simplă și garanție pentru ce facem.`,
      ][i % 3],
    seoDesc: (name, trade) => `${name}${trade ? `, ${trade}` : ''}. Cere o ofertă.`,
  },
  en: {
    defaultTitle: 'Your business',
    heroCta: 'Get in touch',
    servicesTitle: 'Our services',
    aboutTitle: 'About us',
    aboutDefault: (name, trade, city) =>
      `${name} is a${trade ? ` ${trade.toLowerCase()}` : ''} team${city ? ` based in ${city}` : ''} ` +
      `focused on work done right, clear communication and deadlines that hold. ` +
      `We assess on site, walk you through the options in plain terms, and see the job through.`,
    statsTitle: 'By the numbers',
    whyUsTitle: 'Why choose us',
    whyUsDefault: [
      'Fast response to enquiries',
      'Fair pricing, quoted up front',
      'Work backed by a guarantee',
      'An experienced team',
    ],
    processTitle: 'How we work',
    processDefault: [
      { title: 'Get in touch', text: 'Tell us what you need and we set up a visit.' },
      {
        title: 'Assessment & quote',
        text: 'We look at the job on site and you get a clear quote.',
      },
      { title: 'The work', text: 'We get started, with quality materials and on schedule.' },
      {
        title: 'Handover & guarantee',
        text: 'We check the result together and leave you a guarantee.',
      },
    ],
    portfolioTitle: 'Portfolio',
    testimonialsTitle: 'What clients say',
    faqTitle: 'Frequently asked questions',
    ctaTitle: (name) => `Ready to start? Get in touch with ${name}`,
    ctaButton: 'Request a quote',
    contactTitle: 'Contact',
    fallbackDesc: (name, i) =>
      [
        `${cap(name)} handled by an experienced team, with quality materials and deadlines you can count on.`,
        `We take ${name.toLowerCase()} from first assessment to sign-off, with a clear quote up front.`,
        `${cap(name)} done to a professional standard — tidy work, straightforward communication, and a guarantee.`,
      ][i % 3],
    seoDesc: (name, trade) => `${name}${trade ? `, ${trade}` : ''}. Ask for a quote.`,
  },
  de: {
    defaultTitle: 'Ihr Unternehmen',
    heroCta: 'Kontakt aufnehmen',
    servicesTitle: 'Unsere Leistungen',
    aboutTitle: 'Über uns',
    aboutDefault: (name, trade, city) =>
      `${name} ist ein${trade ? ` ${trade}` : ''}-Team${city ? ` aus ${city}` : ''}, ` +
      `das auf saubere Ausführung, klare Kommunikation und verlässliche Termine setzt. ` +
      `Wir schauen uns alles vor Ort an, erklären die Optionen verständlich und bringen den Auftrag zu Ende.`,
    statsTitle: 'In Zahlen',
    whyUsTitle: 'Warum wir',
    whyUsDefault: [
      'Schnelle Rückmeldung auf Anfragen',
      'Faire Preise, vorab genannt',
      'Arbeiten mit Garantie',
      'Ein erfahrenes Team',
    ],
    processTitle: 'So arbeiten wir',
    processDefault: [
      {
        title: 'Kontakt & Termin',
        text: 'Sagen Sie uns, was Sie brauchen, wir vereinbaren einen Termin.',
      },
      {
        title: 'Einschätzung & Angebot',
        text: 'Wir sehen uns die Arbeit vor Ort an, Sie erhalten ein klares Angebot.',
      },
      { title: 'Ausführung', text: 'Wir legen los, mit guten Materialien und termingerecht.' },
      {
        title: 'Übergabe & Garantie',
        text: 'Wir prüfen das Ergebnis gemeinsam und geben Ihnen Garantie.',
      },
    ],
    portfolioTitle: 'Portfolio',
    testimonialsTitle: 'Das sagen Kunden',
    faqTitle: 'Häufige Fragen',
    ctaTitle: (name) => `Bereit loszulegen? Kontaktieren Sie ${name}`,
    ctaButton: 'Angebot anfragen',
    contactTitle: 'Kontakt',
    fallbackDesc: (name, i) =>
      [
        `${cap(name)} von einem erfahrenen Team, mit hochwertigen Materialien und verlässlichen Terminen.`,
        `Wir übernehmen ${name} von der ersten Einschätzung bis zur Abnahme — mit klarem Angebot vorab.`,
        `${cap(name)} auf professionellem Niveau — sauber ausgeführt, klar kommuniziert und mit Garantie.`,
      ][i % 3],
    seoDesc: (name, trade) => `${name}${trade ? `, ${trade}` : ''}. Angebot anfragen.`,
  },
};

function cap(v: string): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

const NAMED_ACCENTS: [WebsiteTheme['palette'], [number, number, number]][] = [
  ['indigo', [79, 70, 229]],
  ['emerald', [5, 150, 105]],
  ['amber', [217, 119, 6]],
  ['slate', [71, 85, 105]],
  ['rose', [225, 29, 72]],
];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Nearest named palette to an arbitrary hex — the fallback for old renderers. */
export function nearestPalette(hex?: string): WebsiteTheme['palette'] {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return 'indigo';
  let best: WebsiteTheme['palette'] = 'indigo';
  let bestD = Infinity;
  for (const [name, [r, g, b]] of NAMED_ACCENTS) {
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/** Deterministic Services copy when the AI call is unavailable. */
export function fallbackServiceItems(names: string[], locale: StudioLocale): ServiceItem[] {
  const L = LABELS[locale] ?? LABELS.ro;
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((name, i) => ({ name: cap(name), description: L.fallbackDesc(name, i) }));
}

// --- templates ---------------------------------------------------------
// All one-pagers, but with a different section order + feel so two clients
// picking the same trade don't end up with an identical site.
export type TemplateKey = 'classic' | 'bold' | 'minimal';

type SectionKind =
  | 'hero'
  | 'about'
  | 'stats'
  | 'services'
  | 'process'
  | 'features'
  | 'gallery'
  | 'testimonials'
  | 'faq'
  | 'cta'
  | 'contact';

interface TemplateSpec {
  radius: WebsiteTheme['radius'];
  fontPair: WebsiteTheme['fontPair'];
  density: WebsiteTheme['density'];
  heroAlign: 'center' | 'start';
  servicesLayout: 'cards' | 'list';
  order: SectionKind[];
  defaults: { about: boolean; stats: boolean; whyUs: boolean; process: boolean; cta: boolean };
}

const TEMPLATES: Record<TemplateKey, TemplateSpec> = {
  classic: {
    radius: 'rounded',
    fontPair: 'grotesk-inter',
    density: 'comfortable',
    heroAlign: 'center',
    servicesLayout: 'cards',
    order: [
      'hero',
      'about',
      'stats',
      'services',
      'process',
      'features',
      'gallery',
      'testimonials',
      'faq',
      'cta',
      'contact',
    ],
    defaults: { about: true, stats: false, whyUs: true, process: true, cta: true },
  },
  bold: {
    radius: 'subtle',
    fontPair: 'grotesk-inter',
    density: 'compact',
    heroAlign: 'start',
    servicesLayout: 'list',
    order: [
      'hero',
      'stats',
      'services',
      'gallery',
      'process',
      'features',
      'testimonials',
      'about',
      'faq',
      'cta',
      'contact',
    ],
    defaults: { about: true, stats: false, whyUs: true, process: true, cta: true },
  },
  minimal: {
    radius: 'large',
    fontPair: 'serif-sans',
    density: 'spacious',
    heroAlign: 'center',
    servicesLayout: 'cards',
    order: [
      'hero',
      'about',
      'services',
      'process',
      'gallery',
      'testimonials',
      'faq',
      'cta',
      'contact',
    ],
    defaults: { about: true, stats: false, whyUs: false, process: false, cta: true },
  },
};

export function templateKey(v: unknown): TemplateKey {
  return v === 'bold' || v === 'minimal' ? v : 'classic';
}
export const TEMPLATE_KEYS: TemplateKey[] = ['classic', 'bold', 'minimal'];

/** Effective section visibility = the client's answer, or the template default. */
export function effectiveToggles(a: EasyAnswers): {
  showAbout: boolean;
  showStats: boolean;
  showWhyUs: boolean;
  showProcess: boolean;
  showCta: boolean;
} {
  const d = TEMPLATES[templateKey(a.template)].defaults;
  return {
    showAbout: a.showAbout ?? d.about,
    showStats: a.showStats ?? d.stats,
    showWhyUs: a.showWhyUs ?? d.whyUs,
    showProcess: a.showProcess ?? d.process,
    showCta: a.showCta ?? d.cta,
  };
}

export function composeEasySite(a: EasyAnswers): GeneratedWebsite {
  const locale: StudioLocale = a.locale ?? 'ro';
  const L = LABELS[locale] ?? LABELS.ro;
  const tpl = TEMPLATES[templateKey(a.template)];

  const name = (a.companyName ?? '').trim() || L.defaultTitle;
  const trade = (a.businessType ?? '').trim();
  const city = (a.city ?? '').trim();
  const accent = /^#[0-9a-fA-F]{6}$/.test(a.accentColor ?? '') ? a.accentColor : undefined;

  const showAbout = a.showAbout ?? tpl.defaults.about;
  const showStats = a.showStats ?? tpl.defaults.stats;
  const showWhyUs = a.showWhyUs ?? tpl.defaults.whyUs;
  const showProcess = a.showProcess ?? tpl.defaults.process;
  const showCta = a.showCta ?? tpl.defaults.cta;

  const rawServices: ServiceItem[] = a.services?.length
    ? a.services
    : a.serviceNames?.length
      ? fallbackServiceItems(a.serviceNames, locale)
      : [];
  // Icons are a pure function of the service name — always (re)derive them so
  // reorder / regenerate keep them consistent.
  const services: ServiceItem[] = rawServices.map((s) => ({
    ...s,
    icon: pickServiceIcon(s.name),
  }));

  const portfolio = (a.portfolio ?? []).filter(Boolean).slice(0, 10);
  const portfolioItems: GalleryItem[] = portfolio.map((url, i) => ({
    title: `${L.portfolioTitle} ${i + 1}`,
    imageUrl: url,
  }));

  const whyUsPoints = (
    a.whyUs?.map((s) => s.trim()).filter(Boolean).length
      ? a.whyUs!.map((s) => s.trim()).filter(Boolean)
      : L.whyUsDefault
  ).slice(0, 6);
  const features: FeatureItem[] = whyUsPoints.map((title) => ({
    title,
    icon: pickFeatureIcon(title),
  }));

  const statItems: StatItem[] = (a.stats ?? [])
    .map((s) => ({ value: (s.value ?? '').trim(), label: (s.label ?? '').trim() }))
    .filter((s) => s.value && s.label)
    .slice(0, 4);

  const processSteps: ProcessItem[] = (
    a.process
      ?.map((s) => ({ title: (s.title ?? '').trim(), text: (s.text ?? '').trim() }))
      .filter((s) => s.title).length
      ? a
          .process!.map((s) => ({
            title: (s.title ?? '').trim(),
            text: (s.text ?? '').trim() || undefined,
          }))
          .filter((s) => s.title)
      : L.processDefault.map((s) => ({ ...s }))
  ).slice(0, 6);

  const testimonials = (a.testimonials ?? [])
    .map((tt) => ({ quote: (tt.quote ?? '').trim(), author: (tt.author ?? '').trim() }))
    .filter((tt) => tt.quote)
    .slice(0, 8);
  const faq = (a.faq ?? [])
    .map((q) => ({ q: (q.q ?? '').trim(), a: (q.a ?? '').trim() }))
    .filter((q) => q.q && q.a)
    .slice(0, 10);

  const byKind: Partial<Record<SectionKind, Section>> = {
    hero: {
      id: 'hero',
      type: 'hero',
      visible: true,
      headline: (a.landingTitle ?? '').trim() || name,
      subheadline: (a.landingSubtitle ?? '').trim(),
      primaryCta: L.heroCta,
      backgroundImage: a.landingImage || undefined,
      align: tpl.heroAlign,
    },
    services: {
      id: 'services',
      type: 'services',
      visible: true,
      title: L.servicesTitle,
      items: services,
      layout: tpl.servicesLayout,
    },
    contact: {
      id: 'contact',
      type: 'contact',
      visible: true,
      title: L.contactTitle,
      phone: a.phone?.trim() || undefined,
      email: a.email?.trim() || undefined,
      city: city || undefined,
      hours: a.hours?.trim() || undefined,
    },
  };

  if (showAbout) {
    byKind.about = {
      id: 'about',
      type: 'about',
      visible: true,
      title: L.aboutTitle,
      body: (a.about ?? '').trim() || L.aboutDefault(name, trade, city),
    };
  }
  if (showStats && statItems.length) {
    byKind.stats = {
      id: 'stats',
      type: 'stats',
      visible: true,
      title: L.statsTitle,
      items: statItems,
    };
  }
  if (showProcess && processSteps.length) {
    byKind.process = {
      id: 'process',
      type: 'process',
      visible: true,
      title: L.processTitle,
      items: processSteps,
    };
  }
  if (showWhyUs && features.length) {
    byKind.features = {
      id: 'features',
      type: 'features',
      visible: true,
      title: L.whyUsTitle,
      items: features,
    };
  }
  if (portfolioItems.length) {
    byKind.gallery = {
      id: 'portfolio',
      type: 'gallery',
      visible: true,
      title: L.portfolioTitle,
      items: portfolioItems,
    };
  }
  if (testimonials.length) {
    byKind.testimonials = {
      id: 'testimonials',
      type: 'testimonials',
      visible: true,
      title: L.testimonialsTitle,
      items: testimonials,
    };
  }
  if (faq.length) {
    byKind.faq = {
      id: 'faq',
      type: 'faq',
      visible: true,
      title: L.faqTitle,
      items: faq,
    };
  }
  if (showCta) {
    byKind.cta = {
      id: 'cta',
      type: 'cta',
      visible: true,
      headline: (a.ctaHeadline ?? '').trim() || L.ctaTitle(name),
      buttonLabel: (a.ctaButton ?? '').trim() || L.ctaButton,
    };
  }

  const sections: Section[] = tpl.order.map((k) => byKind[k]).filter((s): s is Section => !!s);

  // --- owner-editable chrome (navbar + footer) ------------------------
  const navCtaLabel = (a.navCtaLabel ?? '').trim().slice(0, 40);
  const navCta = navCtaLabel
    ? { label: navCtaLabel, target: (a.navCtaTarget ?? '').trim().slice(0, 120) || 'contact' }
    : null;
  const footerTagline = (a.footerTagline ?? '').trim().slice(0, 200);
  const footerSocials = (a.footerSocials ?? [])
    .map((s) => ({
      label: (s.label ?? '').trim().slice(0, 40),
      url: (s.url ?? '').trim().slice(0, 200),
    }))
    .filter((s) => s.label && /^https?:\/\//i.test(s.url))
    .slice(0, 6);

  return {
    generator: `easy-template-v3:${templateKey(a.template)}`,
    theme: {
      palette: nearestPalette(accent),
      accent,
      fontPair: tpl.fontPair,
      radius: tpl.radius,
      density: tpl.density,
      ...(a.logoUrl ? { logoUrl: a.logoUrl } : {}),
    },
    content: {
      pages: [{ slug: 'home', title: name, isHome: true, sections }],
      nav: {
        logo: a.navShowLogo === false ? 'hide' : 'show',
        ...(navCta ? { cta: navCta } : {}),
      },
      footer: {
        showContact: a.footerShowContact !== false,
        showLegal: false,
        ...(footerTagline ? { tagline: footerTagline } : {}),
        ...(footerSocials.length ? { socials: footerSocials } : {}),
      },
      seo: {
        title: name,
        description: L.seoDesc(name, trade || (a.serviceNames ?? []).join(', ') || name).slice(
          0,
          160,
        ),
        schemaType: 'LocalBusiness',
      },
    },
  };
}

// --- patch merge (shared: pre-account draft + post-account site editor) ---

/** Fields the studio widgets can patch (draft or claimed simple site). */
export interface EasyPatch {
  accentColor?: string;
  landingTitle?: string;
  landingSubtitle?: string;
  landingImage?: string;
  logoUrl?: string;
  portfolio?: string[];
  services?: { name: string; description: string }[];
  phone?: string;
  email?: string;
  city?: string;
  about?: string;
  showAbout?: boolean;
  stats?: EasyStat[];
  showStats?: boolean;
  whyUs?: string[];
  showWhyUs?: boolean;
  process?: EasyProcessStep[];
  showProcess?: boolean;
  testimonials?: EasyTestimonial[];
  faq?: EasyFaq[];
  ctaHeadline?: string;
  ctaButton?: string;
  showCta?: boolean;
  hours?: string;
  navShowLogo?: boolean;
  navCtaLabel?: string;
  navCtaTarget?: string;
  footerTagline?: string;
  footerShowContact?: boolean;
  footerSocials?: { label: string; url: string }[];
  template?: 'classic' | 'bold' | 'minimal';
  autoGrammar?: boolean;
  locale?: StudioLocale;
}

export interface EasyPatchHelpers {
  /** Validate an asset URL; `''` → undefined; throw on garbage. */
  assetUrl: (u: string | undefined) => string | undefined;
  /** Called when `accentColor` isn't `#rrggbb`. */
  onBadColor: () => never;
}

/**
 * Apply a studio patch onto the guided answers, in place. Pure field clamping;
 * the caller runs `assertClean` first and re-composes after. Used by both the
 * anonymous draft (`WebsiteDraftService`) and the claimed-site editor.
 */
export function mergeEasyPatch(a: EasyAnswers, patch: EasyPatch, h: EasyPatchHelpers): void {
  if (patch.accentColor !== undefined) {
    const c = patch.accentColor.trim();
    if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) h.onBadColor();
    a.accentColor = c || undefined;
  }
  if (patch.landingTitle !== undefined)
    a.landingTitle = patch.landingTitle.slice(0, 120) || undefined;
  if (patch.landingSubtitle !== undefined) {
    a.landingSubtitle = patch.landingSubtitle.slice(0, 160) || undefined;
  }
  if (patch.landingImage !== undefined) a.landingImage = h.assetUrl(patch.landingImage);
  if (patch.logoUrl !== undefined) {
    a.logoUrl = patch.logoUrl.trim() ? h.assetUrl(patch.logoUrl) : undefined;
  }
  if (patch.portfolio !== undefined) {
    a.portfolio = patch.portfolio
      .map((u) => h.assetUrl(u))
      .filter((u): u is string => !!u)
      .slice(0, 10);
  }
  if (patch.services !== undefined) {
    a.services = patch.services.slice(0, 12).map((s) => ({
      name: String(s.name ?? '').slice(0, 80),
      description: String(s.description ?? '').slice(0, 300),
    }));
  }
  if (patch.phone !== undefined) a.phone = patch.phone.slice(0, 40) || undefined;
  if (patch.email !== undefined) a.email = patch.email.slice(0, 120) || undefined;
  if (patch.city !== undefined) a.city = patch.city.slice(0, 80) || undefined;

  if (patch.about !== undefined) a.about = patch.about.slice(0, 900) || undefined;
  if (patch.showAbout !== undefined) a.showAbout = patch.showAbout;
  if (patch.stats !== undefined) {
    a.stats = patch.stats
      .map((s) => ({
        value: String(s.value ?? '').slice(0, 24),
        label: String(s.label ?? '').slice(0, 60),
      }))
      .filter((s) => s.value.trim() && s.label.trim())
      .slice(0, 4);
  }
  if (patch.showStats !== undefined) a.showStats = patch.showStats;
  if (patch.whyUs !== undefined) {
    a.whyUs = patch.whyUs
      .map((s) => String(s ?? '').slice(0, 90))
      .filter((s) => s.trim())
      .slice(0, 6);
  }
  if (patch.showWhyUs !== undefined) a.showWhyUs = patch.showWhyUs;
  if (patch.process !== undefined) {
    a.process = patch.process
      .map((s) => ({
        title: String(s.title ?? '').slice(0, 80),
        text: String(s.text ?? '').slice(0, 200) || undefined,
      }))
      .filter((s) => s.title.trim())
      .slice(0, 6);
  }
  if (patch.showProcess !== undefined) a.showProcess = patch.showProcess;
  if (patch.testimonials !== undefined) {
    a.testimonials = patch.testimonials
      .map((tt) => ({
        quote: String(tt.quote ?? '').slice(0, 400),
        author: String(tt.author ?? '').slice(0, 80),
      }))
      .filter((tt) => tt.quote.trim())
      .slice(0, 8);
  }
  if (patch.faq !== undefined) {
    a.faq = patch.faq
      .map((q) => ({ q: String(q.q ?? '').slice(0, 160), a: String(q.a ?? '').slice(0, 600) }))
      .filter((q) => q.q.trim() && q.a.trim())
      .slice(0, 10);
  }
  if (patch.ctaHeadline !== undefined) a.ctaHeadline = patch.ctaHeadline.slice(0, 120) || undefined;
  if (patch.ctaButton !== undefined) a.ctaButton = patch.ctaButton.slice(0, 40) || undefined;
  if (patch.showCta !== undefined) a.showCta = patch.showCta;
  if (patch.hours !== undefined) a.hours = patch.hours.slice(0, 120) || undefined;

  // --- navbar + footer chrome --------------------------------------
  if (patch.navShowLogo !== undefined) a.navShowLogo = patch.navShowLogo;
  if (patch.navCtaLabel !== undefined) a.navCtaLabel = patch.navCtaLabel.slice(0, 40) || undefined;
  if (patch.navCtaTarget !== undefined)
    a.navCtaTarget = patch.navCtaTarget.slice(0, 120) || undefined;
  if (patch.footerTagline !== undefined)
    a.footerTagline = patch.footerTagline.slice(0, 200) || undefined;
  if (patch.footerShowContact !== undefined) a.footerShowContact = patch.footerShowContact;
  if (patch.footerSocials !== undefined) {
    a.footerSocials = patch.footerSocials
      .map((s) => ({
        label: String(s.label ?? '').slice(0, 40),
        url: String(s.url ?? '').slice(0, 200),
      }))
      .filter((s) => s.label.trim() && s.url.trim())
      .slice(0, 6);
  }
  if (patch.template !== undefined) {
    a.template = ['classic', 'bold', 'minimal'].includes(patch.template)
      ? patch.template
      : 'classic';
  }
  if (patch.autoGrammar !== undefined) a.autoGrammar = patch.autoGrammar;
  if (patch.locale !== undefined) a.locale = patch.locale;
}
