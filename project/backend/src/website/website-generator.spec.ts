import { RuleBasedWebsiteGenerator } from './website-generator';
import { AdvancedInput, EasyInput } from './website.types';

const gen = new RuleBasedWebsiteGenerator();

describe('RuleBasedWebsiteGenerator', () => {
  it('easy mode still produces a single home page', () => {
    const input: EasyInput = {
      mode: 'easy',
      businessName: 'AquaFix',
      businessType: 'plumbing',
      city: 'Cluj',
      services: ['Leak detection'],
      shortDescription: 'Fast plumbing.',
    };
    const out = gen.generate(input);
    expect(out.content.pages).toHaveLength(1);
    expect(out.content.pages[0].isHome).toBe(true);
  });

  it('advanced mode composes the requested pages, home always first', () => {
    const input: AdvancedInput = {
      mode: 'advanced',
      businessName: 'Studio Arc',
      businessType: 'architecture',
      city: 'Cluj',
      services: ['Design', 'Permits'],
      shortDescription: 'Residential architecture.',
      palette: 'slate',
      fontPair: 'serif-sans',
      pages: ['contact', 'portfolio', 'about'],
      portfolio: [{ title: 'Villa V' }, { title: 'Office HQ' }],
      includeTestimonials: true,
    };
    const out = gen.generate(input);
    const slugs = out.content.pages.map((p) => p.slug);
    expect(slugs[0]).toBe('home');
    expect(slugs).toEqual(['home', 'about', 'portfolio', 'contact']);
    expect(out.theme.palette).toBe('slate');
    expect(out.theme.fontPair).toBe('serif-sans');

    const portfolio = out.content.pages.find((p) => p.slug === 'portfolio');
    const gallery = portfolio?.sections.find((s) => s.type === 'gallery') as
      { items: { title: string }[] } | undefined;
    expect(gallery?.items.map((i) => i.title)).toEqual(['Villa V', 'Office HQ']);
  });

  it('advanced mode defaults to home + services + contact when no pages given', () => {
    const input: AdvancedInput = {
      mode: 'advanced',
      businessName: 'X',
      businessType: 'y',
      city: '',
      services: [],
      shortDescription: '',
    };
    expect(gen.generate(input).content.pages.map((p) => p.slug)).toEqual([
      'home',
      'services',
      'contact',
    ]);
  });
});
