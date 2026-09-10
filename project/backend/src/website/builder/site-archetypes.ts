/**
 * Site archetypes + skeleton blueprints for the Advanced builder's AI planner.
 *
 * Problem it solves: the planner kept emitting the same structure
 * (hero → services → testimonials → cta / about → team → stats / contact → faq)
 * for every business, and the 20-type catalog went unused. Now a cheap keyword
 * classifier picks an *archetype*, and each archetype ships 2 hand-authored
 * page/section blueprints that lean on the whole catalog. The blueprint is:
 *   - injected into Phase-A as a worked example ("adapt, don't copy"), and
 *   - used verbatim by the deterministic `keywordPlanDoc` fallback.
 *
 * Pure data + string helpers — no LLM, no DB, no import of `compose-advanced`
 * (which imports this file). `skeletonToDoc` lives in `compose-advanced.ts`.
 */
import type { SectionType, WebsiteTheme } from '../website.types';
import type { StudioLocale } from './section-catalog';

export type Archetype =
  | 'local-trade'
  | 'agency'
  | 'portfolio'
  | 'saas'
  | 'hospitality'
  | 'clinic'
  | 'shop'
  | 'events'
  | 'generic';

type Tri = Record<StudioLocale, string>;

export interface SkeletonSection {
  type: SectionType;
  variant: string;
  animation?: string;
}
export interface SkeletonPage {
  title: Tri;
  /** ≤ 8 words — becomes the Phase-B page brief. */
  purpose: string;
  nav?: boolean;
  sections: SkeletonSection[];
}
export interface SkeletonSpec {
  pages: SkeletonPage[];
  theme?: Partial<WebsiteTheme>;
}

const T = (ro: string, en: string, de: string): Tri => ({ ro, en, de });
const HOME = T('Acasă', 'Home', 'Start');
const ABOUT = T('Despre noi', 'About', 'Über uns');
const CONTACT = T('Contact', 'Contact', 'Kontakt');
const WORK = T('Lucrări', 'Work', 'Arbeiten');
const SERVICES = T('Servicii', 'Services', 'Leistungen');
const PRICING = T('Prețuri', 'Pricing', 'Preise');
const MENU = T('Meniu', 'Menu', 'Speisekarte');
const PACKAGES = T('Pachete', 'Packages', 'Pakete');
const FEATURES = T('Funcționalități', 'Features', 'Funktionen');

const s = (type: SectionType, variant: string, animation?: string): SkeletonSection =>
  animation ? { type, variant, animation } : { type, variant };

/**
 * Two distinct blueprints per archetype. Keep each home to 4–6 sections and
 * every (type, variant) valid per `SECTION_CATALOG` (`snapVariant` is the
 * runtime safety net regardless).
 */
export const ARCHETYPE_SKELETONS: Record<Archetype, SkeletonSpec[]> = {
  'local-trade': [
    {
      theme: { preset: 'studio', background: 'light', shadow: 'soft' },
      pages: [
        {
          title: HOME,
          purpose: 'trust, services and a fast quote',
          sections: [
            s('hero', 'imageBg', 'fade'),
            s('stats', 'inline', 'rise'),
            s('services', 'cards', 'rise'),
            s('features', 'checklist', 'slideLeft'),
            s('testimonials', 'columns', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'contact details and common questions',
          sections: [s('contact', 'split'), s('faq', 'twoCol', 'fade')],
        },
      ],
    },
    {
      theme: {
        preset: 'bold',
        palette: 'orange',
        radius: 'none',
        shadow: 'bold',
        motion: 'lively',
      },
      pages: [
        {
          title: HOME,
          purpose: 'what we do and how we work',
          sections: [
            s('hero', 'split', 'none'),
            s('services', 'list', 'rise'),
            s('process', 'vertical', 'slideLeft'),
            s('cta', 'solid', 'fade'),
          ],
        },
        {
          title: WORK,
          purpose: 'recent projects with photos and reviews',
          sections: [s('gallery', 'grid', 'rise'), s('testimonials', 'cards', 'fade')],
        },
        {
          title: CONTACT,
          purpose: 'reach us and book a visit',
          sections: [s('contact', 'cards'), s('faq', 'accordion', 'fade')],
        },
      ],
    },
    {
      theme: { preset: 'warm', background: 'tinted', shadow: 'soft' },
      pages: [
        {
          title: HOME,
          purpose: 'before/after proof and an easy quote',
          sections: [
            s('hero', 'overlap', 'fade'),
            s('highlightsRow', 'plain', 'rise'),
            s('services', 'rows', 'rise'),
            s('beforeAfter', 'side', 'fade'),
            s('ratingBand', 'center', 'zoom'),
            s('cta', 'boxed', 'fade'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'reach us, working hours and questions',
          sections: [s('contact', 'cards'), s('hours', 'card'), s('faq', 'plain', 'fade')],
        },
      ],
    },
  ],

  agency: [
    {
      theme: { preset: 'studio', background: 'tinted', headingFont: 'grotesk' },
      pages: [
        {
          title: HOME,
          purpose: 'capabilities, method and proof',
          sections: [
            s('hero', 'gradient', 'fade'),
            s('logos', 'strip', 'fade'),
            s('services', 'iconGrid', 'rise'),
            s('process', 'horizontal', 'slideRight'),
            s('testimonials', 'single', 'zoom'),
            s('cta', 'boxed', 'fade'),
          ],
        },
        {
          title: SERVICES,
          purpose: 'what each engagement includes',
          sections: [
            s('featureSplit', 'alternating', 'rise'),
            s('comparison', 'columns', 'fade'),
            s('faq', 'accordion', 'fade'),
          ],
        },
        { title: CONTACT, purpose: 'start a project', sections: [s('contact', 'split')] },
      ],
    },
    {
      theme: { preset: 'editorial', headingFont: 'fraunces', radius: 'subtle', shadow: 'none' },
      pages: [
        {
          title: HOME,
          purpose: 'point of view and selected results',
          sections: [
            s('hero', 'minimal', 'fade'),
            s('about', 'twoCol', 'rise'),
            s('bento', 'mixed', 'rise'),
            s('features', 'cards', 'slideLeft'),
            s('testimonials', 'ticker', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        { title: CONTACT, purpose: 'get in touch', sections: [s('contact', 'cards')] },
      ],
    },
    {
      theme: { preset: 'bold', background: 'dark', motion: 'lively' },
      pages: [
        {
          title: HOME,
          purpose: 'point of view, named results and clients',
          sections: [
            s('hero', 'centered', 'fade'),
            s('marquee', 'text', 'none'),
            s('bigStatement', 'plain', 'rise'),
            s('caseStudy', 'imageRight', 'slideLeft'),
            s('comparison', 'columns', 'fade'),
            s('cta', 'split', 'zoom'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'start a project with us',
          sections: [s('contact', 'split')],
        },
      ],
    },
  ],

  portfolio: [
    {
      theme: { preset: 'editorial', background: 'light', headingFont: 'fraunces', shadow: 'none' },
      pages: [
        {
          title: HOME,
          purpose: 'a visual-first introduction',
          sections: [
            s('hero', 'imageBg', 'fade'),
            s('gallery', 'masonry', 'rise'),
            s('about', 'stat', 'slideRight'),
            s('cta', 'solid', 'fade'),
          ],
        },
        {
          title: WORK,
          purpose: 'a wider selection with context',
          sections: [s('gallery', 'wide', 'rise'), s('testimonials', 'quote', 'fade')],
        },
        {
          title: CONTACT,
          purpose: 'commissions and enquiries',
          sections: [s('contact', 'split'), s('faq', 'plain', 'fade')],
        },
      ],
    },
    {
      theme: { preset: 'mono', headingFont: 'jetbrains', radius: 'none', motion: 'lively' },
      pages: [
        {
          title: HOME,
          purpose: 'bold showcase, minimal words',
          sections: [
            s('hero', 'overlap', 'zoom'),
            s('marquee', 'text', 'none'),
            s('gallery', 'carousel', 'fade'),
            s('about', 'imageLeft', 'slideLeft'),
            s('testimonials', 'single', 'fade'),
            s('cta', 'boxed', 'rise'),
          ],
        },
        { title: CONTACT, purpose: 'say hello', sections: [s('contact', 'cards')] },
      ],
    },
    {
      theme: { preset: 'editorial', background: 'light', headingFont: 'fraunces' },
      pages: [
        {
          title: HOME,
          purpose: 'a signature piece, then the wider body of work',
          sections: [
            s('hero', 'minimal', 'none'),
            s('showcase', 'center', 'fade'),
            s('gallery', 'masonry', 'rise'),
            s('quoteBig', 'plain', 'fade'),
            s('cta', 'solid', 'fade'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'commission a project',
          sections: [s('contact', 'cards')],
        },
      ],
    },
  ],

  saas: [
    {
      theme: {
        preset: 'tech',
        background: 'dark',
        palette: 'cyan',
        radius: 'subtle',
        motion: 'lively',
      },
      pages: [
        {
          title: HOME,
          purpose: 'the product value in one screen',
          sections: [
            s('hero', 'gradient', 'fade'),
            s('logos', 'strip', 'fade'),
            s('features', 'grid', 'rise'),
            s('featureSplit', 'alternating', 'slideRight'),
            s('stats', 'cards', 'zoom'),
            s('cta', 'gradient', 'fade'),
          ],
        },
        {
          title: FEATURES,
          purpose: 'capabilities in depth and how we compare',
          sections: [
            s('bento', 'mixed', 'rise'),
            s('comparison', 'table', 'fade'),
            s('faq', 'accordion', 'fade'),
          ],
        },
        {
          title: PRICING,
          purpose: 'plans and billing questions',
          sections: [s('pricing', 'tiers', 'rise'), s('faq', 'twoCol', 'fade')],
        },
        { title: CONTACT, purpose: 'talk to us', sections: [s('contact', 'split')] },
      ],
    },
    {
      theme: { preset: 'tech', palette: 'blue', background: 'tinted', motion: 'subtle' },
      pages: [
        {
          title: HOME,
          purpose: 'problem, solution, proof',
          sections: [
            s('hero', 'split', 'fade'),
            s('marquee', 'logos', 'none'),
            s('features', 'cards', 'rise'),
            s('timeline', 'line', 'slideLeft'),
            s('testimonials', 'ticker', 'fade'),
            s('cta', 'boxed', 'zoom'),
          ],
        },
        {
          title: PRICING,
          purpose: 'simple, transparent plans',
          sections: [s('pricing', 'table', 'rise'), s('faq', 'accordion', 'fade')],
        },
        { title: CONTACT, purpose: 'book a demo', sections: [s('contact', 'cards')] },
      ],
    },
    {
      theme: { preset: 'tech', background: 'dark', palette: 'cyan', motion: 'lively' },
      pages: [
        {
          title: HOME,
          purpose: 'the product by use case, priced simply',
          sections: [
            s('hero', 'gradient', 'fade'),
            s('logos', 'strip', 'fade'),
            s('tabs', 'pill', 'rise'),
            s('featureSplit', 'alternating', 'slideRight'),
            s('pricing', 'table', 'fade'),
            s('newsletter', 'band', 'fade'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'talk to us or see the docs',
          sections: [s('contact', 'split'), s('faq', 'accordion', 'fade')],
        },
      ],
    },
  ],

  hospitality: [
    {
      theme: { preset: 'warm', palette: 'amber', background: 'tinted', headingFont: 'fraunces' },
      pages: [
        {
          title: HOME,
          purpose: 'atmosphere, signature dishes, a reservation',
          sections: [
            s('hero', 'imageBg', 'fade'),
            s('about', 'imageRight', 'rise'),
            s('services', 'list', 'rise'),
            s('gallery', 'grid', 'slideLeft'),
            s('testimonials', 'cards', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        {
          title: MENU,
          purpose: 'the menu by course',
          sections: [s('services', 'rows', 'rise'), s('faq', 'twoCol', 'fade')],
        },
        { title: CONTACT, purpose: 'find us and book a table', sections: [s('contact', 'split')] },
      ],
    },
    {
      theme: { preset: 'warm', palette: 'orange', radius: 'large', shadow: 'bold' },
      pages: [
        {
          title: HOME,
          purpose: 'a mouth-watering first impression',
          sections: [
            s('hero', 'overlap', 'zoom'),
            s('marquee', 'text', 'none'),
            s('gallery', 'masonry', 'rise'),
            s('stats', 'inline', 'fade'),
            s('testimonials', 'single', 'fade'),
            s('cta', 'boxed', 'rise'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'hours, location, reservations',
          sections: [s('contact', 'cards'), s('faq', 'plain', 'fade')],
        },
      ],
    },
    {
      theme: { preset: 'warm', background: 'tinted', shadow: 'soft' },
      pages: [
        {
          title: HOME,
          purpose: 'the room, the food and what guests say',
          sections: [
            s('hero', 'imageBg', 'fade'),
            s('bigStatement', 'boxed', 'rise'),
            s('gallery', 'wide', 'rise'),
            s('ratingBand', 'split', 'zoom'),
            s('cta', 'gradient', 'fade'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'find us, opening hours and booking',
          sections: [s('contact', 'cards'), s('hours', 'list')],
        },
      ],
    },
  ],

  clinic: [
    {
      theme: { preset: 'soft', palette: 'teal', background: 'light', shadow: 'soft' },
      pages: [
        {
          title: HOME,
          purpose: 'services, credentials and how to book',
          sections: [
            s('hero', 'split', 'fade'),
            s('services', 'cards', 'rise'),
            s('features', 'list', 'slideLeft'),
            s('team', 'cards', 'rise'),
            s('testimonials', 'columns', 'fade'),
            s('cta', 'solid', 'zoom'),
          ],
        },
        {
          title: ABOUT,
          purpose: 'the practice, its standards and history',
          sections: [
            s('about', 'imageRight', 'rise'),
            s('stats', 'band', 'fade'),
            s('timeline', 'line', 'slideRight'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'appointments and directions',
          sections: [s('contact', 'split')],
        },
      ],
    },
    {
      theme: { preset: 'soft', palette: 'blue', radius: 'large', motion: 'subtle' },
      pages: [
        {
          title: HOME,
          purpose: 'calm, clear, reassuring',
          sections: [
            s('hero', 'minimal', 'fade'),
            s('about', 'twoCol', 'rise'),
            s('services', 'list', 'rise'),
            s('team', 'compact', 'slideLeft'),
            s('faq', 'twoCol', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        { title: CONTACT, purpose: 'book a consultation', sections: [s('contact', 'cards')] },
      ],
    },
    {
      theme: { preset: 'soft', background: 'light', shadow: 'soft' },
      pages: [
        {
          title: HOME,
          purpose: 'reassurance, the care path and outcomes',
          sections: [
            s('hero', 'split', 'fade'),
            s('highlightsRow', 'divided', 'rise'),
            s('services', 'iconGrid', 'rise'),
            s('timeline', 'line', 'slideLeft'),
            s('testimonials', 'quote', 'fade'),
            s('cta', 'boxed', 'fade'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'book an appointment and see hours',
          sections: [s('contact', 'split'), s('hours', 'card'), s('faq', 'twoCol', 'fade')],
        },
      ],
    },
  ],

  shop: [
    {
      theme: {
        preset: 'bold',
        palette: 'rose',
        radius: 'rounded',
        shadow: 'bold',
        motion: 'lively',
      },
      pages: [
        {
          title: HOME,
          purpose: 'hero product, offers and social proof',
          sections: [
            s('hero', 'imageBg', 'fade'),
            s('banner', 'gradient', 'slideLeft'),
            s('features', 'grid', 'rise'),
            s('gallery', 'grid', 'rise'),
            s('testimonials', 'cards', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        {
          title: T('Produse', 'Products', 'Produkte'),
          purpose: 'the range and what to pick',
          sections: [
            s('gallery', 'masonry', 'rise'),
            s('comparison', 'columns', 'fade'),
            s('faq', 'accordion', 'fade'),
          ],
        },
        { title: CONTACT, purpose: 'orders and support', sections: [s('contact', 'cards')] },
      ],
    },
    {
      theme: { preset: 'studio', palette: 'violet', background: 'tinted' },
      pages: [
        {
          title: HOME,
          purpose: 'brand story and best sellers',
          sections: [
            s('hero', 'gradient', 'fade'),
            s('marquee', 'text', 'none'),
            s('bento', 'even', 'rise'),
            s('features', 'cards', 'slideLeft'),
            s('stats', 'inline', 'fade'),
            s('cta', 'boxed', 'zoom'),
          ],
        },
        { title: CONTACT, purpose: 'get in touch', sections: [s('contact', 'split')] },
      ],
    },
    {
      theme: { preset: 'bold', background: 'light', radius: 'large' },
      pages: [
        {
          title: HOME,
          purpose: 'the range, why buy here and offers',
          sections: [
            s('hero', 'imageBg', 'fade'),
            s('marquee', 'text', 'none'),
            s('bento', 'mixed', 'rise'),
            s('features', 'cards', 'rise'),
            s('ratingBand', 'center', 'zoom'),
            s('splitCta', 'cards', 'fade'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'store, delivery and support',
          sections: [s('contact', 'cards')],
        },
      ],
    },
  ],

  events: [
    {
      theme: { preset: 'editorial', palette: 'fuchsia', headingFont: 'fraunces', shadow: 'soft' },
      pages: [
        {
          title: HOME,
          purpose: 'the experience, packages and a gallery',
          sections: [
            s('hero', 'overlap', 'zoom'),
            s('about', 'stat', 'rise'),
            s('services', 'cards', 'rise'),
            s('gallery', 'carousel', 'fade'),
            s('testimonials', 'single', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        {
          title: PACKAGES,
          purpose: 'options and what each includes',
          sections: [s('pricing', 'tiers', 'rise'), s('faq', 'twoCol', 'fade')],
        },
        { title: CONTACT, purpose: 'check a date', sections: [s('contact', 'split')] },
      ],
    },
    {
      theme: { preset: 'bold', palette: 'violet', radius: 'large', motion: 'lively' },
      pages: [
        {
          title: HOME,
          purpose: 'energy first, details second',
          sections: [
            s('hero', 'imageBg', 'fade'),
            s('gallery', 'wide', 'rise'),
            s('process', 'vertical', 'slideLeft'),
            s('testimonials', 'columns', 'fade'),
            s('cta', 'boxed', 'zoom'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'tell us about your event',
          sections: [s('contact', 'cards'), s('faq', 'plain', 'fade')],
        },
      ],
    },
    {
      theme: { preset: 'editorial', background: 'tinted', motion: 'lively' },
      pages: [
        {
          title: HOME,
          purpose: 'a signature event, the plan and reactions',
          sections: [
            s('hero', 'overlap', 'fade'),
            s('showcase', 'left', 'slideRight'),
            s('timeline', 'alternating', 'rise'),
            s('gallery', 'grid', 'rise'),
            s('testimonials', 'ticker', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'tell us about your event',
          sections: [s('contact', 'cards'), s('faq', 'plain', 'fade')],
        },
      ],
    },
  ],

  generic: [
    {
      theme: { preset: 'studio', background: 'light' },
      pages: [
        {
          title: HOME,
          purpose: 'who we are and what we offer',
          sections: [
            s('hero', 'centered', 'fade'),
            s('about', 'imageRight', 'rise'),
            s('services', 'cards', 'rise'),
            s('features', 'checklist', 'slideLeft'),
            s('testimonials', 'cards', 'fade'),
            s('cta', 'gradient', 'zoom'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'reach us',
          sections: [s('contact', 'split'), s('faq', 'accordion', 'fade')],
        },
      ],
    },
    {
      theme: { preset: 'soft', palette: 'blue', radius: 'large' },
      pages: [
        {
          title: HOME,
          purpose: 'proof-led overview',
          sections: [
            s('hero', 'split', 'fade'),
            s('stats', 'inline', 'rise'),
            s('services', 'iconGrid', 'rise'),
            s('testimonials', 'columns', 'slideLeft'),
            s('cta', 'solid', 'zoom'),
          ],
        },
        {
          title: ABOUT,
          purpose: 'story, people and milestones',
          sections: [
            s('about', 'twoCol', 'rise'),
            s('team', 'cards', 'fade'),
            s('timeline', 'line', 'slideRight'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'get in touch',
          sections: [s('contact', 'cards'), s('faq', 'twoCol', 'fade')],
        },
      ],
    },
    {
      theme: { preset: 'studio', background: 'light', shadow: 'soft' },
      pages: [
        {
          title: HOME,
          purpose: 'what you do, the difference and proof',
          sections: [
            s('hero', 'centered', 'fade'),
            s('stats', 'cards', 'rise'),
            s('featureSplit', 'stacked', 'slideLeft'),
            s('highlightsRow', 'plain', 'rise'),
            s('cta', 'solid', 'fade'),
          ],
        },
        {
          title: CONTACT,
          purpose: 'get in touch',
          sections: [s('contact', 'split')],
        },
      ],
    },
  ],
};

const ARCHETYPE_KEYWORDS: [Archetype, RegExp][] = [
  [
    'hospitality',
    /restaurant|cafenea|caf[eé]\b|bistro|pizz|patiser|cofet|catering|buc[ăa]t[ăa]r|meniu|braserie|pub\b|bar\b|hotel|pensiun|cazare|gastro|food ?truck|bakery/i,
  ],
  [
    'clinic',
    /clinic|cabinet|medic|dentist|stomatolog|kineto|fizio|psiholog|terapi|nutri[țt]ion|optic|farmaci|veterinar|dental|logoped|recuperare medical/i,
  ],
  [
    'saas',
    /software|aplica[țt]ie|\bapp\b|saas|platform[ăa]|startup|\bit\b|dezvoltare (web|software)|programare|automatiz|dashboard|\bapi\b|cloud|crm\b|erp\b|no-?code/i,
  ],
  [
    'portfolio',
    /fotograf|photo|arhitect|design(?:er)?|ilustrat|artist|video(?:graf)?|portofoliu|portfolio|grafic|make-?up artist|creativ|studio foto/i,
  ],
  [
    'events',
    /eveniment|nunt[ăa]|botez|organizare (de )?event|wedding|\bdj\b|forma[țt]ie|sonoriz|decor(?:a[țt]iuni)? eveniment|petrecere|conferin[țt]|corporate event|team ?building/i,
  ],
  [
    'shop',
    /magazin|shop\b|store\b|boutique|butic|e-?commerce|ecommerce|vânz[ăa]ri|produse proprii|showroom|distribu[țt]ie|retail|marketplace/i,
  ],
  [
    'agency',
    /agen[țt]ie|studio (de )?(creat|design|web|marketing|branding)|consultan[țt][ăa]|marketing|branding|\bseo\b|\bppc\b|social media|software house|birou de|firm[ăa] de consultan/i,
  ],
  [
    'local-trade',
    /construc|acoperi|instal(?:a[țt]ii|ator)|zugrav|electric|amenaj|tâmpl|tamplar|dulgher|izola[țt]|renov|fa[țt]ad|hidroizol|pavaj|gard|beton|montaj|repara[țt]ii|vulcaniz|tinichig|instalator|frigotehnist|lăc[ăa]tu|cur[ăa][țt]enie|deratiz|zid[ăa]r|faian[țt]ar|parchetar/i,
  ],
];

function matchArchetype(hay: string): Archetype {
  for (const [a, re] of ARCHETYPE_KEYWORDS) if (re.test(hay)) return a;
  return 'generic';
}

/**
 * Cheap deterministic archetype pick. The BRIEF is tried first and on its own —
 * a concrete brief must never be overridden by stale stored facts (a leftover
 * category/description from an earlier setup). Only a vague brief falls back to
 * the stored business type + services.
 */
export function classifyArchetype(
  brief: string,
  businessType = '',
  services: string[] = [],
): Archetype {
  const fromBrief = matchArchetype((brief ?? '').toLowerCase());
  if (fromBrief !== 'generic') return fromBrief;
  return matchArchetype(`${businessType} ${services.join(' ')}`.toLowerCase());
}

/**
 * Seed-rotated "look" knobs. Two businesses with the same archetype + blueprint
 * still get a different palette / heading font / corner style, so same-trade
 * sites don't come out looking identical. Structure-feel knobs (`preset`,
 * `background`, `motion`, `shadow`) stay with the blueprint — a blueprint that
 * explicitly pins any of these below wins the merge.
 */
const VAR_PALETTES: WebsiteTheme['palette'][] = [
  'indigo',
  'violet',
  'blue',
  'cyan',
  'teal',
  'emerald',
  'lime',
  'amber',
  'orange',
  'rose',
  'fuchsia',
  'slate',
];
const VAR_HEAD_FONTS: NonNullable<WebsiteTheme['headingFont']>[] = ['grotesk', 'inter', 'fraunces'];
const VAR_RADII: WebsiteTheme['radius'][] = ['subtle', 'rounded', 'large'];

export function themeVariant(seed: number): Partial<WebsiteTheme> {
  const h = Math.abs(seed);
  return {
    palette: VAR_PALETTES[h % VAR_PALETTES.length],
    headingFont: VAR_HEAD_FONTS[Math.floor(h / 7) % VAR_HEAD_FONTS.length],
    radius: VAR_RADII[Math.floor(h / 53) % VAR_RADII.length],
  };
}

/**
 * One of the archetype's blueprints, chosen by a stable seed, with a seed-rotated
 * palette/font/radius merged in (the blueprint's own theme values win). Returns
 * a fresh object — never mutate `ARCHETYPE_SKELETONS`.
 */
export function pickSkeleton(archetype: Archetype, seed: number): SkeletonSpec {
  const list = ARCHETYPE_SKELETONS[archetype] ?? ARCHETYPE_SKELETONS.generic;
  const base = list[Math.abs(seed) % list.length];
  return { ...base, theme: { ...themeVariant(seed), ...(base.theme ?? {}) } };
}

/** Compact worked-example JSON for the Phase-A prompt (structure only). */
export function skeletonExampleJson(sk: SkeletonSpec): string {
  return JSON.stringify({
    theme: sk.theme ?? {},
    pages: sk.pages.map((p) => ({
      title: p.title.en,
      purpose: p.purpose,
      sections: p.sections.map((x) => ({
        type: x.type,
        variant: x.variant,
        animation: x.animation,
      })),
    })),
  });
}
