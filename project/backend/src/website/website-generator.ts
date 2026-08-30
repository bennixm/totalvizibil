import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AdvancedInput,
  AdvancedPage,
  EasyInput,
  FaqSection,
  GallerySection,
  GeneratedWebsite,
  GeneratorInput,
  Section,
  TestimonialsSection,
  ToneOfVoice,
  WebsiteTheme,
  ServiceItem,
} from './website.types';

/**
 * Website draft generator.
 *
 * This is the RULE-BASED implementation (`rule-based-v1`): it composes a real,
 * previewable, editable block tree from the user's answers. It is deliberately
 * behind the `WebsiteGenerator` interface so an LLM-backed implementation can
 * replace it later without touching callers (PRD §10, §11).
 */
export interface WebsiteGenerator {
  readonly id: string;
  generate(input: GeneratorInput): GeneratedWebsite;
}

const s = (v?: string) => (v ?? '').trim();
const cap = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

function toneWord(tone: ToneOfVoice | undefined): string {
  switch (tone) {
    case 'friendly':
      return 'friendly, approachable';
    case 'premium':
      return 'premium, refined';
    case 'bold':
      return 'bold, confident';
    case 'calm':
      return 'calm, reassuring';
    default:
      return 'clear, professional';
  }
}

function pickTheme(input: GeneratorInput): WebsiteTheme {
  if (input.mode === 'advanced') {
    return {
      palette: input.palette ?? 'indigo',
      fontPair: input.fontPair ?? 'grotesk-inter',
      radius: input.radius ?? 'soft',
      density: 'comfortable',
    };
  }
  // Easy mode: derive a palette from the business type keyword.
  const t = input.businessType.toLowerCase();
  const palette: WebsiteTheme['palette'] = /(garden|clean|eco|green|plumb)/.test(t)
    ? 'emerald'
    : /(food|restaurant|bakery|cafe|caf)/.test(t)
      ? 'amber'
      : /(law|finance|consult|account|dental|clinic)/.test(t)
        ? 'slate'
        : /(beauty|salon|hair|spa|studio)/.test(t)
          ? 'rose'
          : 'indigo';
  return { palette, fontPair: 'grotesk-inter', radius: 'soft', density: 'comfortable' };
}

function serviceItems(names: string[], businessType: string): ServiceItem[] {
  const clean = names.map(s).filter(Boolean);
  const list = clean.length ? clean : ['Consultation', 'Project delivery', 'Support & maintenance'];
  return list.slice(0, 8).map((name) => ({
    name: cap(name),
    description: `Professional ${name.toLowerCase()} for ${businessType.toLowerCase()} clients, handled end to end.`,
  }));
}

function buildSections(input: GeneratorInput): Section[] {
  const name = s(input.businessName) || 'Your business';
  const type = s(input.businessType) || 'local services';
  const city = s(input.city);
  const desc =
    s(input.shortDescription) ||
    `${name} is a ${type} team${city ? ` based in ${city}` : ''}, focused on doing the job right.`;

  const advanced = input.mode === 'advanced' ? (input as AdvancedInput) : null;
  const easy = input.mode === 'easy' ? (input as EasyInput) : null;
  const primaryCta = advanced?.primaryCta?.trim() || 'Get a quote';
  const tone = toneWord(advanced?.toneOfVoice ?? easy?.tone);

  const sections: Section[] = [
    {
      id: randomUUID(),
      type: 'hero',
      visible: true,
      headline: `${type.charAt(0).toUpperCase()}${type.slice(1)}${city ? ` in ${city}` : ''}, done properly`,
      subheadline: desc,
      primaryCta,
      secondaryCta: 'See our work',
    },
    {
      id: randomUUID(),
      type: 'about',
      visible: true,
      title: `About ${name}`,
      body:
        `${desc} ` +
        `We keep communication ${tone}, quote transparently, and show up when we say we will.` +
        (advanced?.targetAudience ? ` We work mostly with ${advanced.targetAudience.trim()}.` : ''),
    },
    {
      id: randomUUID(),
      type: 'services',
      visible: true,
      title: 'What we do',
      items: serviceItems(input.services ?? [], type),
    },
  ];

  if (advanced?.includeTestimonials) {
    sections.push({
      id: randomUUID(),
      type: 'testimonials',
      visible: true,
      title: 'What clients say',
      items: [
        {
          quote: `${name} did exactly what they promised, on time and on budget.`,
          author: 'Recent client',
        },
        {
          quote: 'Clear communication from the first call to the final walkthrough.',
          author: 'Local homeowner',
        },
      ],
    });
  }

  if (advanced?.includeFaq) {
    sections.push({
      id: randomUUID(),
      type: 'faq',
      visible: true,
      title: 'Frequently asked questions',
      items: [
        {
          q: 'How do I get a quote?',
          a: `Send us a message with a few details and ${name} replies within one business day.`,
        },
        {
          q: 'Which areas do you cover?',
          a: city ? `${city} and the surrounding area.` : 'Your area — ask us.',
        },
        { q: 'Are estimates free?', a: 'Yes, initial estimates are free and without obligation.' },
      ],
    });
  }

  sections.push({
    id: randomUUID(),
    type: 'contact',
    visible: true,
    title: 'Get in touch',
    phone: (advanced?.phone ?? easy?.phone)?.trim() || undefined,
    email: (advanced?.email ?? easy?.email)?.trim() || undefined,
    city: city || undefined,
  });

  sections.push({
    id: randomUUID(),
    type: 'cta',
    visible: true,
    headline: `Ready to start with ${name}?`,
    buttonLabel: primaryCta,
  });

  return sections;
}

// --- Advanced (multi-page) helpers --------------------------------------

function testimonialsBlock(name: string): TestimonialsSection {
  return {
    id: randomUUID(),
    type: 'testimonials',
    visible: true,
    title: 'What clients say',
    items: [
      {
        quote: `${name} did exactly what they promised, on time and on budget.`,
        author: 'Recent client',
      },
      {
        quote: 'Clear communication from the first call to the final walkthrough.',
        author: 'Local homeowner',
      },
    ],
  };
}

function faqBlock(name: string, city: string): FaqSection {
  return {
    id: randomUUID(),
    type: 'faq',
    visible: true,
    title: 'Frequently asked questions',
    items: [
      {
        q: 'How do I get a quote?',
        a: `Send us a message with a few details and ${name} replies within one business day.`,
      },
      {
        q: 'Which areas do you cover?',
        a: city ? `${city} and the surrounding area.` : 'Your area — ask us.',
      },
      { q: 'Are estimates free?', a: 'Yes, initial estimates are free and without obligation.' },
    ],
  };
}

function galleryBlock(input: AdvancedInput): GallerySection {
  const items = (input.portfolio ?? [])
    .map((p) => ({ title: cap(s(p.title)), description: p.description?.trim() || undefined }))
    .filter((p) => p.title);
  const list = items.length
    ? items
    : [
        {
          title: 'Recent project',
          description: `A recent ${(s(input.businessType) || 'local services').toLowerCase()} project delivered on time.`,
        },
        {
          title: 'Featured work',
          description: 'One of our favourite results — ask us for the full story.',
        },
      ];
  return { id: randomUUID(), type: 'gallery', visible: true, title: 'Selected work', items: list };
}

const PAGE_TITLES: Record<AdvancedPage, string> = {
  home: 'Home',
  about: 'About',
  services: 'Services',
  portfolio: 'Portfolio',
  faq: 'FAQ',
  contact: 'Contact',
};
const PAGE_ORDER: AdvancedPage[] = ['home', 'about', 'services', 'portfolio', 'faq', 'contact'];

function advancedSections(slug: AdvancedPage, input: AdvancedInput): Section[] {
  const name = s(input.businessName) || 'Your business';
  const type = s(input.businessType) || 'local services';
  const city = s(input.city);
  const desc =
    s(input.shortDescription) ||
    `${name} is a ${type} team${city ? ` based in ${city}` : ''}, focused on doing the job right.`;
  const cta = input.primaryCta?.trim() || 'Get a quote';
  const tone = toneWord(input.toneOfVoice);
  const uid = () => randomUUID();

  switch (slug) {
    case 'about':
      return [
        {
          id: uid(),
          type: 'about',
          visible: true,
          title: `About ${name}`,
          body:
            `${desc} We keep communication ${tone}, quote transparently, and show up when we say we will.` +
            (input.targetAudience ? ` We work mostly with ${input.targetAudience.trim()}.` : ''),
        },
        { id: uid(), type: 'cta', visible: true, headline: `Work with ${name}`, buttonLabel: cta },
      ];
    case 'services':
      return [
        {
          id: uid(),
          type: 'services',
          visible: true,
          title: 'Our services',
          items: serviceItems(input.services ?? [], type),
        },
        ...(input.includeFaq ? [faqBlock(name, city)] : []),
      ];
    case 'portfolio':
      return [galleryBlock(input)];
    case 'faq':
      return [faqBlock(name, city)];
    case 'contact':
      return [
        {
          id: uid(),
          type: 'contact',
          visible: true,
          title: 'Get in touch',
          phone: input.phone?.trim() || undefined,
          email: input.email?.trim() || undefined,
          city: city || undefined,
        },
        {
          id: uid(),
          type: 'cta',
          visible: true,
          headline: `Ready to start with ${name}?`,
          buttonLabel: cta,
        },
      ];
    case 'home':
    default:
      return [
        {
          id: uid(),
          type: 'hero',
          visible: true,
          headline: `${cap(type)}${city ? ` in ${city}` : ''}, done properly`,
          subheadline: desc,
          primaryCta: cta,
          secondaryCta: 'See our work',
        },
        {
          id: uid(),
          type: 'services',
          visible: true,
          title: 'What we do',
          items: serviceItems(input.services ?? [], type).slice(0, 3),
        },
        ...(input.includeTestimonials ? [testimonialsBlock(name)] : []),
        {
          id: uid(),
          type: 'cta',
          visible: true,
          headline: `Ready to start with ${name}?`,
          buttonLabel: cta,
        },
      ];
  }
}

@Injectable()
export class RuleBasedWebsiteGenerator implements WebsiteGenerator {
  readonly id = 'rule-based-v1';

  generate(input: GeneratorInput): GeneratedWebsite {
    if (input.mode === 'advanced') return this.generateAdvanced(input);

    const name = s(input.businessName) || 'Your business';
    const type = s(input.businessType) || 'local services';
    const city = s(input.city);

    return {
      generator: this.id,
      theme: pickTheme(input),
      content: {
        pages: [{ slug: 'home', title: name, isHome: true, sections: buildSections(input) }],
        seo: {
          title: `${name}${city ? ` — ${type} in ${city}` : ` — ${type}`}`,
          description: (
            s(input.shortDescription) || `${name}, ${type}${city ? ` in ${city}` : ''}.`
          ).slice(0, 160),
          schemaType: 'LocalBusiness',
        },
      },
    };
  }

  private generateAdvanced(input: AdvancedInput): GeneratedWebsite {
    const name = s(input.businessName) || 'Your business';
    const type = s(input.businessType) || 'local services';
    const city = s(input.city);

    const requested = new Set<AdvancedPage>(
      input.pages?.length ? input.pages : ['services', 'contact'],
    );
    requested.add('home');
    const slugs = PAGE_ORDER.filter((p) => requested.has(p));

    return {
      generator: this.id,
      theme: pickTheme(input),
      content: {
        pages: slugs.map((slug) => ({
          slug,
          title: slug === 'home' ? name : PAGE_TITLES[slug],
          isHome: slug === 'home',
          sections: advancedSections(slug, input),
        })),
        seo: {
          title: `${name}${city ? ` — ${type} in ${city}` : ` — ${type}`}`,
          description: (
            s(input.shortDescription) || `${name}, ${type}${city ? ` in ${city}` : ''}.`
          ).slice(0, 160),
          schemaType: 'LocalBusiness',
        },
      },
    };
  }
}

export function isEasyInput(x: GeneratorInput): x is EasyInput {
  return x.mode === 'easy';
}
