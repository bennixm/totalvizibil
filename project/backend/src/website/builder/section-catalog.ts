/**
 * Section catalog for the ADVANCED website builder.
 *
 * The single source of truth for every section type the builder offers: its
 * category, design variants, editable field schema, and seed content. It is
 * reused by
 *   - the "add section" seeder (`seedSection`),
 *   - the `PATCH /sections/:id` validator (`coerceSection` / `coerceContent`),
 *   - the client catalog payload (`catalogForClient`) that drives the picker UI
 *     and the schema-generated editor form,
 *   - and (later) validation of an AI-generated site plan.
 *
 * Nothing here calls an LLM — seed copy is deterministic and localised.
 */
import { randomUUID } from 'node:crypto';
import { Section, SectionType } from '../website.types';

export type StudioLocale = 'ro' | 'en' | 'de';

export type FieldType =
  'text' | 'textarea' | 'richtext' | 'url' | 'image' | 'boolean' | 'enum' | 'list' | 'items';

export interface FieldSpec {
  key: string;
  type: FieldType;
  /** i18n suffix — resolved on the client as `builder.field.<label>`. */
  label: string;
  maxLength?: number;
  /** `enum` only — allowed values (first is the default). */
  enumValues?: string[];
  /** `items` only — the shape of one repeatable row. */
  itemFields?: FieldSpec[];
  /** `list` / `items` only — max rows. */
  itemMax?: number;
}

export interface VariantSpec {
  id: string;
  /** i18n suffix — resolved on the client as `catalog.variant.<label>`. */
  label: string;
}

export type SectionCategory = 'header' | 'story' | 'proof' | 'offer' | 'content' | 'conversion';

export interface SeedCtx {
  businessName: string;
  businessType: string;
  city: string;
  services: string[];
  phone?: string;
  email?: string;
  locale: StudioLocale;
}

export interface SectionSpec {
  type: SectionType;
  category: SectionCategory;
  /** i18n suffix — `catalog.<label>.label` / `.desc`. Equals `type` for all specs. */
  label: string;
  icon: string;
  variants: VariantSpec[];
  fields: FieldSpec[];
  /** Deterministic starting content (no id/type/visible/variant). */
  seed: (ctx: SeedCtx) => Record<string, unknown>;
}

// --- localisation helper ---------------------------------------------------

type Tri = { ro: string; en: string; de: string };
const L = (loc: StudioLocale, t: Tri): string => t[loc] ?? t.ro;

const cap = (v: string): string => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

/** A few generic service names when the company gave none. */
function seedServiceNames(ctx: SeedCtx): string[] {
  if (ctx.services.length) return ctx.services.slice(0, 4);
  return ctx.locale === 'de'
    ? ['Beratung', 'Umsetzung', 'Support']
    : ctx.locale === 'en'
      ? ['Consultation', 'Delivery', 'Support']
      : ['Consultanță', 'Execuție', 'Mentenanță'];
}

// --- field-spec shorthands ----------------------------------------------

const F = {
  text: (key: string, label: string, maxLength = 120): FieldSpec => ({
    key,
    type: 'text',
    label,
    maxLength,
  }),
  area: (key: string, label: string, maxLength = 400): FieldSpec => ({
    key,
    type: 'textarea',
    label,
    maxLength,
  }),
  rich: (key: string, label: string, maxLength = 4000): FieldSpec => ({
    key,
    type: 'richtext',
    label,
    maxLength,
  }),
  image: (key: string, label: string): FieldSpec => ({ key, type: 'image', label }),
  bool: (key: string, label: string): FieldSpec => ({ key, type: 'boolean', label }),
  enumf: (key: string, label: string, enumValues: string[]): FieldSpec => ({
    key,
    type: 'enum',
    label,
    enumValues,
  }),
  list: (key: string, label: string, itemMax = 8, maxLength = 120): FieldSpec => ({
    key,
    type: 'list',
    label,
    itemMax,
    maxLength,
  }),
  items: (key: string, label: string, itemMax: number, itemFields: FieldSpec[]): FieldSpec => ({
    key,
    type: 'items',
    label,
    itemMax,
    itemFields,
  }),
};

const v = (...ids: string[]): VariantSpec[] => ids.map((id) => ({ id, label: id }));

// --- the catalog -------------------------------------------------------

export const SECTION_CATALOG: Record<SectionType, SectionSpec> = {
  hero: {
    type: 'hero',
    category: 'header',
    label: 'hero',
    icon: 'mdi-page-layout-header',
    variants: v('split', 'centered', 'imageBg', 'minimal'),
    fields: [
      F.text('headline', 'headline', 120),
      F.area('subheadline', 'subheadline', 240),
      F.text('primaryCta', 'primaryCta', 40),
      F.text('secondaryCta', 'secondaryCta', 40),
      F.image('backgroundImage', 'image'),
    ],
    seed: (ctx) => {
      const type =
        ctx.businessType ||
        L(ctx.locale, {
          ro: 'servicii locale',
          en: 'local services',
          de: 'lokale Dienstleistungen',
        });
      return {
        headline: `${cap(type)}${ctx.city ? L(ctx.locale, { ro: ` în ${ctx.city}`, en: ` in ${ctx.city}`, de: ` in ${ctx.city}` }) : ''}, ${L(ctx.locale, { ro: 'făcute cum trebuie', en: 'done properly', de: 'richtig gemacht' })}`,
        subheadline: L(ctx.locale, {
          ro: `${ctx.businessName || 'Echipa noastră'} lucrează corect, comunică clar și respectă termenele.`,
          en: `${ctx.businessName || 'Our team'} works to a high standard, communicates clearly and keeps to deadlines.`,
          de: `${ctx.businessName || 'Unser Team'} arbeitet sauber, kommuniziert klar und hält Termine ein.`,
        }),
        primaryCta: L(ctx.locale, {
          ro: 'Cere o ofertă',
          en: 'Get a quote',
          de: 'Angebot anfragen',
        }),
        secondaryCta: L(ctx.locale, {
          ro: 'Vezi lucrările',
          en: 'See our work',
          de: 'Unsere Arbeiten',
        }),
        backgroundImage: '',
      };
    },
  },

  logos: {
    type: 'logos',
    category: 'proof',
    label: 'logos',
    icon: 'mdi-dots-grid',
    variants: v('strip', 'grid'),
    fields: [
      F.text('title', 'title', 80),
      F.items('items', 'logos', 12, [F.text('name', 'name', 40), F.image('imageUrl', 'image')]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, { ro: 'Ne-au ales', en: 'Trusted by', de: 'Sie vertrauen uns' }),
      items: [1, 2, 3, 4].map((i) => ({ name: `Client ${i}`, imageUrl: '' })),
    }),
  },

  about: {
    type: 'about',
    category: 'story',
    label: 'about',
    icon: 'mdi-account-group-outline',
    variants: v('text', 'imageRight', 'imageLeft', 'twoCol'),
    fields: [
      F.text('title', 'title', 120),
      F.area('body', 'body', 900),
      F.image('imageUrl', 'image'),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, {
        ro: `Despre ${ctx.businessName || 'noi'}`,
        en: `About ${ctx.businessName || 'us'}`,
        de: `Über ${ctx.businessName || 'uns'}`,
      }),
      body: L(ctx.locale, {
        ro: `${ctx.businessName || 'Firma noastră'} este o echipă${ctx.businessType ? ` de ${ctx.businessType.toLowerCase()}` : ''}${ctx.city ? ` din ${ctx.city}` : ''} care pune accent pe lucrări făcute corect, comunicare clară și termene respectate.`,
        en: `${ctx.businessName || 'Our company'} is a${ctx.businessType ? ` ${ctx.businessType.toLowerCase()}` : ''} team${ctx.city ? ` based in ${ctx.city}` : ''} focused on work done right, clear communication and deadlines that hold.`,
        de: `${ctx.businessName || 'Unser Unternehmen'} ist ein${ctx.businessType ? ` ${ctx.businessType}` : ''}-Team${ctx.city ? ` aus ${ctx.city}` : ''}, das auf saubere Ausführung, klare Kommunikation und verlässliche Termine setzt.`,
      }),
      imageUrl: '',
    }),
  },

  stats: {
    type: 'stats',
    category: 'proof',
    label: 'stats',
    icon: 'mdi-numeric',
    variants: v('band', 'plain'),
    fields: [
      F.text('title', 'title', 80),
      F.items('items', 'stats', 4, [
        F.text('value', 'value', 24),
        F.text('label', 'statLabel', 60),
      ]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, { ro: 'În cifre', en: 'By the numbers', de: 'In Zahlen' }),
      items: [
        {
          value: '10+',
          label: L(ctx.locale, {
            ro: 'ani de experiență',
            en: "years' experience",
            de: 'Jahre Erfahrung',
          }),
        },
        {
          value: '500+',
          label: L(ctx.locale, {
            ro: 'proiecte finalizate',
            en: 'projects delivered',
            de: 'abgeschlossene Projekte',
          }),
        },
        {
          value: '4.9',
          label: L(ctx.locale, {
            ro: 'rating mediu',
            en: 'average rating',
            de: 'Durchschnittsbewertung',
          }),
        },
      ],
    }),
  },

  services: {
    type: 'services',
    category: 'offer',
    label: 'services',
    icon: 'mdi-view-grid-plus-outline',
    variants: v('cards', 'list', 'iconGrid'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'services', 12, [
        F.text('name', 'name', 80),
        F.area('description', 'description', 300),
      ]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, {
        ro: 'Serviciile noastre',
        en: 'Our services',
        de: 'Unsere Leistungen',
      }),
      items: seedServiceNames(ctx).map((name) => ({
        name: cap(name),
        description: L(ctx.locale, {
          ro: `${cap(name)} la standard profesional, cu materiale de calitate și termene respectate.`,
          en: `${cap(name)} to a professional standard, with quality materials and deadlines you can count on.`,
          de: `${cap(name)} auf professionellem Niveau, mit hochwertigen Materialien und verlässlichen Terminen.`,
        }),
      })),
    }),
  },

  process: {
    type: 'process',
    category: 'offer',
    label: 'process',
    icon: 'mdi-format-list-numbered',
    variants: v('vertical', 'horizontal'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'steps', 6, [
        F.text('title', 'stepTitle', 80),
        F.area('text', 'stepText', 200),
      ]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, { ro: 'Cum lucrăm', en: 'How we work', de: 'So arbeiten wir' }),
      items: [
        {
          title: L(ctx.locale, {
            ro: 'Contact și programare',
            en: 'Get in touch',
            de: 'Kontakt & Termin',
          }),
          text: L(ctx.locale, {
            ro: 'Ne spui ce ai nevoie și stabilim o vizită.',
            en: 'Tell us what you need and we set up a visit.',
            de: 'Sagen Sie uns, was Sie brauchen, wir vereinbaren einen Termin.',
          }),
        },
        {
          title: L(ctx.locale, {
            ro: 'Evaluare și ofertă',
            en: 'Assessment & quote',
            de: 'Einschätzung & Angebot',
          }),
          text: L(ctx.locale, {
            ro: 'Vedem lucrarea la fața locului și primești o ofertă clară.',
            en: 'We look at the job on site and you get a clear quote.',
            de: 'Wir sehen uns die Arbeit vor Ort an, Sie erhalten ein klares Angebot.',
          }),
        },
        {
          title: L(ctx.locale, { ro: 'Execuție', en: 'The work', de: 'Ausführung' }),
          text: L(ctx.locale, {
            ro: 'Ne apucăm de treabă, cu materiale de calitate și la termen.',
            en: 'We get started, with quality materials and on schedule.',
            de: 'Wir legen los, mit guten Materialien und termingerecht.',
          }),
        },
        {
          title: L(ctx.locale, {
            ro: 'Predare și garanție',
            en: 'Handover & guarantee',
            de: 'Übergabe & Garantie',
          }),
          text: L(ctx.locale, {
            ro: 'Verificăm împreună rezultatul și îți lăsăm garanție.',
            en: 'We check the result together and leave you a guarantee.',
            de: 'Wir prüfen das Ergebnis gemeinsam und geben Ihnen Garantie.',
          }),
        },
      ],
    }),
  },

  features: {
    type: 'features',
    category: 'proof',
    label: 'features',
    icon: 'mdi-star-check-outline',
    variants: v('grid', 'list'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'points', 6, [
        F.text('title', 'pointTitle', 90),
        F.area('text', 'pointText', 200),
      ]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, { ro: 'De ce să ne alegi', en: 'Why choose us', de: 'Warum wir' }),
      items: [
        {
          title: L(ctx.locale, {
            ro: 'Răspuns rapid',
            en: 'Fast response',
            de: 'Schnelle Rückmeldung',
          }),
          text: '',
        },
        {
          title: L(ctx.locale, {
            ro: 'Preț corect, comunicat din start',
            en: 'Fair pricing, quoted up front',
            de: 'Faire Preise, vorab genannt',
          }),
          text: '',
        },
        {
          title: L(ctx.locale, {
            ro: 'Lucrări cu garanție',
            en: 'Work backed by a guarantee',
            de: 'Arbeiten mit Garantie',
          }),
          text: '',
        },
        {
          title: L(ctx.locale, {
            ro: 'Echipă cu experiență',
            en: 'An experienced team',
            de: 'Ein erfahrenes Team',
          }),
          text: '',
        },
      ],
    }),
  },

  featureSplit: {
    type: 'featureSplit',
    category: 'story',
    label: 'featureSplit',
    icon: 'mdi-view-split-vertical',
    variants: v('alternating', 'stacked'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'rows', 4, [
        F.text('title', 'rowTitle', 90),
        F.area('text', 'rowText', 400),
        F.image('imageUrl', 'image'),
        F.enumf('mediaSide', 'mediaSide', ['right', 'left']),
      ]),
    ],
    seed: (ctx) => ({
      title: '',
      items: [
        {
          title: L(ctx.locale, {
            ro: 'Ce facem diferit',
            en: 'What we do differently',
            de: 'Was wir anders machen',
          }),
          text: L(ctx.locale, {
            ro: 'Explică pe scurt abordarea voastră și ce câștigă clientul lucrând cu voi.',
            en: 'Briefly explain your approach and what the client gains by working with you.',
            de: 'Erklären Sie kurz Ihren Ansatz und was der Kunde durch die Zusammenarbeit gewinnt.',
          }),
          imageUrl: '',
          mediaSide: 'right',
        },
        {
          title: L(ctx.locale, {
            ro: 'Rezultate care contează',
            en: 'Results that matter',
            de: 'Ergebnisse, die zählen',
          }),
          text: L(ctx.locale, {
            ro: 'Un al doilea punct forte, cu un exemplu concret.',
            en: 'A second strong point, with a concrete example.',
            de: 'Ein zweiter starker Punkt, mit einem konkreten Beispiel.',
          }),
          imageUrl: '',
          mediaSide: 'left',
        },
      ],
    }),
  },

  gallery: {
    type: 'gallery',
    category: 'proof',
    label: 'gallery',
    icon: 'mdi-image-multiple-outline',
    variants: v('grid', 'masonry', 'wide'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'photos', 12, [
        F.text('title', 'photoTitle', 80),
        F.text('description', 'photoCaption', 160),
        F.image('imageUrl', 'image'),
      ]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, {
        ro: 'Lucrări recente',
        en: 'Selected work',
        de: 'Ausgewählte Arbeiten',
      }),
      items: [1, 2, 3].map((i) => ({
        title: L(ctx.locale, { ro: `Proiect ${i}`, en: `Project ${i}`, de: `Projekt ${i}` }),
        description: '',
        imageUrl: '',
      })),
    }),
  },

  team: {
    type: 'team',
    category: 'story',
    label: 'team',
    icon: 'mdi-account-multiple-outline',
    variants: v('cards', 'compact'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'members', 8, [
        F.text('name', 'memberName', 60),
        F.text('role', 'memberRole', 60),
        F.area('bio', 'memberBio', 200),
        F.image('imageUrl', 'image'),
      ]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, { ro: 'Echipa', en: 'Meet the team', de: 'Das Team' }),
      items: [
        {
          name: L(ctx.locale, { ro: 'Nume Prenume', en: 'First Last', de: 'Vorname Name' }),
          role: L(ctx.locale, { ro: 'Fondator', en: 'Founder', de: 'Gründer' }),
          bio: '',
          imageUrl: '',
        },
        {
          name: L(ctx.locale, { ro: 'Nume Prenume', en: 'First Last', de: 'Vorname Name' }),
          role: L(ctx.locale, { ro: 'Coordonator', en: 'Lead', de: 'Leitung' }),
          bio: '',
          imageUrl: '',
        },
      ],
    }),
  },

  testimonials: {
    type: 'testimonials',
    category: 'proof',
    label: 'testimonials',
    icon: 'mdi-format-quote-close-outline',
    variants: v('cards', 'quote', 'columns'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'quotes', 8, [
        F.area('quote', 'quote', 400),
        F.text('author', 'author', 80),
        F.text('role', 'authorRole', 80),
      ]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, {
        ro: 'Ce spun clienții',
        en: 'What clients say',
        de: 'Das sagen Kunden',
      }),
      items: [
        {
          quote: L(ctx.locale, {
            ro: 'Au făcut exact ce au promis, la timp și în buget.',
            en: 'They did exactly what they promised, on time and on budget.',
            de: 'Sie haben genau das geliefert, was sie versprochen haben — pünktlich und im Budget.',
          }),
          author: L(ctx.locale, {
            ro: 'Client recent',
            en: 'Recent client',
            de: 'Aktueller Kunde',
          }),
          role: '',
        },
        {
          quote: L(ctx.locale, {
            ro: 'Comunicare clară de la primul telefon până la final.',
            en: 'Clear communication from the first call to the final walkthrough.',
            de: 'Klare Kommunikation vom ersten Anruf bis zur Abnahme.',
          }),
          author: L(ctx.locale, {
            ro: 'Proprietar local',
            en: 'Local homeowner',
            de: 'Eigentümer vor Ort',
          }),
          role: '',
        },
      ],
    }),
  },

  pricing: {
    type: 'pricing',
    category: 'offer',
    label: 'pricing',
    icon: 'mdi-tag-multiple-outline',
    variants: v('tiers', 'compact'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'plans', 4, [
        F.text('name', 'planName', 40),
        F.text('price', 'price', 24),
        F.text('period', 'period', 24),
        F.list('features', 'planFeatures', 8, 120),
        F.text('cta', 'planCta', 30),
        F.bool('highlighted', 'highlighted'),
      ]),
    ],
    seed: (ctx) => {
      const per = L(ctx.locale, { ro: '/ lună', en: '/ mo', de: '/ Mon.' });
      const cta = L(ctx.locale, { ro: 'Alege', en: 'Choose', de: 'Wählen' });
      const feat = (t: Tri) => L(ctx.locale, t);
      return {
        title: L(ctx.locale, { ro: 'Prețuri', en: 'Pricing', de: 'Preise' }),
        items: [
          {
            name: 'Start',
            price: '€49',
            period: per,
            features: [
              feat({ ro: 'Funcție de bază', en: 'Core feature', de: 'Basisfunktion' }),
              feat({ ro: 'Suport email', en: 'Email support', de: 'E-Mail-Support' }),
            ],
            cta,
            highlighted: false,
          },
          {
            name: 'Pro',
            price: '€99',
            period: per,
            features: [
              feat({ ro: 'Tot din Start', en: 'Everything in Start', de: 'Alles aus Start' }),
              feat({ ro: 'Suport prioritar', en: 'Priority support', de: 'Priorisierter Support' }),
            ],
            cta,
            highlighted: true,
          },
          {
            name: 'Business',
            price: '€199',
            period: per,
            features: [
              feat({ ro: 'Tot din Pro', en: 'Everything in Pro', de: 'Alles aus Pro' }),
              feat({
                ro: 'Manager dedicat',
                en: 'Dedicated manager',
                de: 'Fester Ansprechpartner',
              }),
            ],
            cta,
            highlighted: false,
          },
        ],
      };
    },
  },

  faq: {
    type: 'faq',
    category: 'content',
    label: 'faq',
    icon: 'mdi-comment-question-outline',
    variants: v('accordion', 'twoCol'),
    fields: [
      F.text('title', 'title', 120),
      F.items('items', 'questions', 12, [F.text('q', 'question', 160), F.area('a', 'answer', 600)]),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, {
        ro: 'Întrebări frecvente',
        en: 'Frequently asked questions',
        de: 'Häufige Fragen',
      }),
      items: [
        {
          q: L(ctx.locale, {
            ro: 'Cum primesc o ofertă?',
            en: 'How do I get a quote?',
            de: 'Wie bekomme ich ein Angebot?',
          }),
          a: L(ctx.locale, {
            ro: 'Trimite-ne câteva detalii și revenim în aceeași zi lucrătoare.',
            en: 'Send us a few details and we reply within one business day.',
            de: 'Senden Sie uns ein paar Details, wir antworten innerhalb eines Werktags.',
          }),
        },
        {
          q: L(ctx.locale, {
            ro: 'Ce zonă acoperiți?',
            en: 'Which areas do you cover?',
            de: 'Welche Gebiete decken Sie ab?',
          }),
          a: ctx.city
            ? L(ctx.locale, {
                ro: `${ctx.city} și împrejurimile.`,
                en: `${ctx.city} and the surrounding area.`,
                de: `${ctx.city} und Umgebung.`,
              })
            : L(ctx.locale, {
                ro: 'Zona ta — întreabă-ne.',
                en: 'Your area — ask us.',
                de: 'Ihr Gebiet — fragen Sie uns.',
              }),
        },
        {
          q: L(ctx.locale, {
            ro: 'Estimările sunt gratuite?',
            en: 'Are estimates free?',
            de: 'Sind Kostenvoranschläge kostenlos?',
          }),
          a: L(ctx.locale, {
            ro: 'Da, estimarea inițială este gratuită și fără obligații.',
            en: 'Yes, initial estimates are free and without obligation.',
            de: 'Ja, der erste Kostenvoranschlag ist kostenlos und unverbindlich.',
          }),
        },
      ],
    }),
  },

  richText: {
    type: 'richText',
    category: 'content',
    label: 'richText',
    icon: 'mdi-text-long',
    variants: v('narrow', 'wide'),
    fields: [F.text('title', 'title', 120), F.rich('body', 'body', 4000)],
    seed: (ctx) => ({
      title: '',
      body: L(ctx.locale, {
        ro: 'Scrie aici textul paginii. Lasă un rând gol între paragrafe.',
        en: 'Write the page copy here. Leave a blank line between paragraphs.',
        de: 'Schreiben Sie hier den Seitentext. Lassen Sie eine Leerzeile zwischen Absätzen.',
      }),
    }),
  },

  cta: {
    type: 'cta',
    category: 'conversion',
    label: 'cta',
    icon: 'mdi-bullhorn-outline',
    variants: v('gradient', 'solid', 'split'),
    fields: [F.text('headline', 'headline', 120), F.text('buttonLabel', 'buttonLabel', 40)],
    seed: (ctx) => ({
      headline: L(ctx.locale, {
        ro: `Gata de început cu ${ctx.businessName || 'noi'}?`,
        en: `Ready to start with ${ctx.businessName || 'us'}?`,
        de: `Bereit für den Start mit ${ctx.businessName || 'uns'}?`,
      }),
      buttonLabel: L(ctx.locale, {
        ro: 'Cere o ofertă',
        en: 'Get a quote',
        de: 'Angebot anfragen',
      }),
    }),
  },

  contact: {
    type: 'contact',
    category: 'conversion',
    label: 'contact',
    icon: 'mdi-card-account-phone-outline',
    variants: v('cards', 'split'),
    fields: [
      F.text('title', 'title', 120),
      F.text('phone', 'phone', 40),
      F.text('email', 'email', 120),
      F.text('city', 'city', 80),
      F.text('addressLine', 'addressLine', 160),
      F.text('hours', 'hours', 120),
    ],
    seed: (ctx) => ({
      title: L(ctx.locale, { ro: 'Contact', en: 'Get in touch', de: 'Kontakt' }),
      phone: ctx.phone ?? '',
      email: ctx.email ?? '',
      city: ctx.city ?? '',
      addressLine: '',
      hours: '',
    }),
  },
};

export const SECTION_TYPES = Object.keys(SECTION_CATALOG) as SectionType[];

// --- helpers ---------------------------------------------------------

function isSectionType(v: unknown): v is SectionType {
  return typeof v === 'string' && v in SECTION_CATALOG;
}

/** Snap an arbitrary variant string to a known id for the type (else the default). */
export function snapVariant(type: SectionType, variant: unknown): string {
  const spec = SECTION_CATALOG[type];
  const ids = spec.variants.map((x) => x.id);
  return typeof variant === 'string' && ids.includes(variant) ? variant : ids[0];
}

function clampStr(v: unknown, max: number, trim: boolean): string {
  let s = typeof v === 'string' ? v : v == null ? '' : String(v);
  if (trim) s = s.trim();
  return s.slice(0, max);
}

/**
 * Allowed image sources: a local uploaded asset, or a royalty-free stock host
 * the AI planner is permitted to suggest (Unsplash/Pexels explicitly allow
 * hotlinking). Anything else is dropped so a published site never hotlinks an
 * arbitrary third party.
 */
const IMG_ALLOW =
  /^(\/api\/v1\/website-assets\/[0-9a-fA-F-]{36}|https:\/\/(images|plus)\.unsplash\.com\/|https:\/\/images\.pexels\.com\/)/;
function coerceImage(raw: unknown): string {
  const s = clampStr(raw, 400, true);
  return s === '' || IMG_ALLOW.test(s) ? s : '';
}

function coerceField(field: FieldSpec, raw: unknown): unknown {
  switch (field.type) {
    case 'image':
      return coerceImage(raw);
    case 'text':
    case 'url':
      return clampStr(raw, field.maxLength ?? 200, true);
    case 'textarea':
    case 'richtext':
      return clampStr(raw, field.maxLength ?? 2000, false);
    case 'boolean':
      return raw === true || raw === 'true';
    case 'enum': {
      const opts = field.enumValues ?? [];
      return typeof raw === 'string' && opts.includes(raw) ? raw : opts[0];
    }
    case 'list':
      return Array.isArray(raw)
        ? raw
            .map((x) => clampStr(x, field.maxLength ?? 120, true))
            .filter(Boolean)
            .slice(0, field.itemMax ?? 8)
        : [];
    case 'items':
      return Array.isArray(raw)
        ? raw.slice(0, field.itemMax ?? 12).map((row) => coerceRow(field.itemFields ?? [], row))
        : [];
    default:
      return clampStr(raw, 200, true);
  }
}

function coerceRow(fields: FieldSpec[], row: unknown): Record<string, unknown> {
  const src = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.key] = coerceField(f, src[f.key]);
  return out;
}

/** Validate + clamp a section's content object against its catalog field schema. */
export function coerceContent(
  type: SectionType,
  content: Record<string, unknown>,
): Record<string, unknown> {
  const spec = SECTION_CATALOG[type];
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) out[f.key] = coerceField(f, content[f.key]);
  return out;
}

/** Seed content only (no id/type/visible/variant), clamped to the field schema. */
export function seedSectionContent(type: SectionType, ctx: SeedCtx): Record<string, unknown> {
  const t: SectionType = isSectionType(type) ? type : 'richText';
  return coerceContent(t, SECTION_CATALOG[t].seed(ctx));
}

/** Build a fresh, fully-valid `Section` from the catalog seed. */
export function seedSection(type: SectionType, variant: unknown, ctx: SeedCtx): Section {
  const t: SectionType = isSectionType(type) ? type : 'richText';
  return {
    id: randomUUID(),
    type: t,
    visible: true,
    variant: snapVariant(t, variant),
    ...seedSectionContent(t, ctx),
  } as Section;
}

/**
 * Coerce an arbitrary section-shaped object (from a PATCH merge or an AI plan)
 * into a valid `Section`. Returns `null` when the `type` is unknown.
 */
export function coerceSection(raw: unknown): Section | null {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isSectionType(src.type)) return null;
  const type = src.type;
  return {
    id: typeof src.id === 'string' && src.id ? src.id : randomUUID(),
    type,
    visible: src.visible !== false,
    variant: snapVariant(type, src.variant),
    ...coerceContent(type, src),
  } as Section;
}

// --- client payload -------------------------------------------------

export interface ClientSectionSpec {
  type: SectionType;
  category: SectionCategory;
  label: string;
  icon: string;
  variants: VariantSpec[];
  fields: FieldSpec[];
}

/** Function-free catalog for the builder UI (picker + schema-driven editor). */
export function catalogForClient(): ClientSectionSpec[] {
  return SECTION_TYPES.map((t) => {
    const { type, category, label, icon, variants, fields } = SECTION_CATALOG[t];
    return { type, category, label, icon, variants, fields };
  });
}
