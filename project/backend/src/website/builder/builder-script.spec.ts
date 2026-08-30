import {
  BuilderAnswers,
  BuilderStep,
  advanceBuilder,
  buildAdvancedInput,
  matchFont,
  matchPalette,
  parsePages,
} from './builder-script';

describe('advanced builder script', () => {
  it('walks the full chain to a generated preview', () => {
    let step: BuilderStep = 'business';
    let answers: BuilderAnswers = {};
    const feed = (t: string) => {
      const r = advanceBuilder(step, answers, t);
      step = r.step;
      answers = r.answers;
      return r;
    };

    feed('agentie de arhitectura');
    expect(step).toBe('name');
    feed('Studio Arc');
    expect(step).toBe('city');
    feed('Cluj-Napoca');
    expect(step).toBe('services');
    feed('proiectare, consultanta, avize');
    expect(step).toBe('audience');
    feed('dezvoltatori rezidentiali');
    expect(step).toBe('tone');
    feed('premium');
    expect(answers.tone).toBe('premium');
    feed('despre, servicii, portofoliu, contact');
    expect(step).toBe('design');
    expect(answers.pages).toEqual(
      expect.arrayContaining(['home', 'about', 'services', 'portfolio', 'contact']),
    );
    feed('vreau un albastru elegant');
    expect(answers.palette).toBe('indigo');
    feed('typography moderna, grotesk');
    expect(answers.fontPair).toBe('grotesk-inter');
    feed('Vila Panoramic, Sediu birouri, Casa V');
    expect(answers.portfolio).toHaveLength(3);
    const r = feed('0722 000 111, hello@studioarc.ro');
    expect(step).toBe('refine');
    expect(answers.phone).toBe('0722000111');
    expect(r.assistant).toEqual(['generated', 'askRefine']);
  });

  it('refine recognises palette/font/tone tweaks and finishes on "gata"', () => {
    const base: BuilderAnswers = { description: 'x', pages: ['home', 'contact'] };
    expect(advanceBuilder('refine', base, 'schimba pe verde').answers.palette).toBe('emerald');
    expect(advanceBuilder('refine', base, 'font serif te rog').answers.fontPair).toBe('serif-sans');
    expect(advanceBuilder('refine', base, 'gata').step).toBe('done');
  });

  it('parsePages always includes home and expands "toate"', () => {
    expect(parsePages('doar contact')).toEqual(expect.arrayContaining(['home', 'contact']));
    expect(parsePages('toate paginile')).toEqual(
      expect.arrayContaining(['home', 'about', 'services', 'portfolio', 'faq', 'contact']),
    );
    expect(parsePages('')).toEqual(expect.arrayContaining(['home', 'services', 'contact']));
  });

  it('matchPalette / matchFont understand RO + EN', () => {
    expect(matchPalette('un roz cald')).toBe('rose');
    expect(matchPalette('gri antracit')).toBe('slate');
    expect(matchFont('ceva tehnic, mono')).toBe('mono-sans');
    expect(matchFont('nimic special')).toBeNull();
  });

  it('buildAdvancedInput maps answers into an AdvancedInput', () => {
    const input = buildAdvancedInput({
      businessName: 'Studio Arc',
      businessType: 'arhitectura',
      pages: ['home', 'faq'],
      palette: 'emerald',
    });
    expect(input.mode).toBe('advanced');
    expect(input.includeFaq).toBe(true);
    expect(input.includeTestimonials).toBe(true);
    expect(input.palette).toBe('emerald');
  });
});
