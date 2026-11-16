import {
  EasyAnswers,
  EasyStep,
  advanceEasy,
  condenseType,
  extractEmail,
  extractPhone,
  matchTone,
  nextEasyStep,
  openingTranscript,
  quickNameGuess,
  splitList,
} from 'src/website/drafts/website-draft.script';

describe('website-draft guided script', () => {
  it('opens with the combined intro prompt', () => {
    const t = openingTranscript();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ role: 'assistant', key: 'opening' });
  });

  it('walks intro -> services -> photos -> contact -> done', () => {
    let step: EasyStep = 'intro';
    let answers: EasyAnswers = { locale: 'ro' };

    const feed = (text?: string) => {
      const r = advanceEasy(step, answers, text);
      step = r.step;
      answers = r.answers;
      return r;
    };

    let r = feed('AquaFix, instalații sanitare și termice, din Cluj');
    expect(step).toBe('services');
    expect(answers.companyName).toBe('AquaFix');
    expect(answers.rawIntro).toBe('AquaFix, instalații sanitare și termice, din Cluj');
    expect(r.assistant).toEqual(['askServices']);
    // the service should run the immediate intro-parse AI call on this text
    expect(r.parseIntroFor).toBe('AquaFix, instalații sanitare și termice, din Cluj');
    expect(r.toneGuess).toBeNull();

    r = feed('Montaj centrale, Desfundare canalizare, Reparatii baterii');
    // a real list keeps us on the services step so the copy can be reordered
    expect(step).toBe('services');
    expect(answers.serviceNames).toEqual([
      'Montaj centrale',
      'Desfundare canalizare',
      'Reparatii baterii',
    ]);
    // the one AI call is requested for exactly these names
    expect(r.generateServicesFor).toEqual([
      'Montaj centrale',
      'Desfundare canalizare',
      'Reparatii baterii',
    ]);
    expect(r.assistant).toEqual(['servicesGenerated']);

    // "Continue" (no text) advances services -> photos
    feed();
    expect(step).toBe('photos');

    // photos is optional/skippable — any message (including "skip") moves on
    feed('sar peste');
    expect(step).toBe('contact');

    const c = feed('0722 123 456, contact@aquafix.ro');
    expect(step).toBe('done');
    expect(answers.phone).toBe('0722123456');
    expect(answers.email).toBe('contact@aquafix.ro');
    expect(c.assistant).toEqual(['contactSaved', 'done']);
    expect(c.regenerate).toBe(true);
    // the service should run the one-shot full-site generation call now
    expect(c.generateFullSite).toBe(true);
  });

  it('intro step carries the regex tone pre-filter alongside parseIntroFor', () => {
    const r = advanceEasy(
      'intro',
      { locale: 'ro' },
      'Suntem o firmă premium și elegantă din Sibiu',
    );
    expect(r.parseIntroFor).toBe('Suntem o firmă premium și elegantă din Sibiu');
    expect(r.toneGuess).toBe('premium');
  });

  it('intro step with no text sets neither parseIntroFor nor toneGuess', () => {
    const r = advanceEasy('intro', { locale: 'ro' }, '');
    expect(r.parseIntroFor).toBeUndefined();
    expect(r.toneGuess).toBeUndefined();
    expect(r.step).toBe('services');
  });

  it('services step with "skip" moves on without an AI call', () => {
    const r = advanceEasy('services', { locale: 'ro' }, 'skip');
    expect(r.step).toBe('photos');
    expect(r.generateServicesFor).toBeUndefined();
    expect(r.assistant).toEqual(['askPhotos']);
  });

  it('contact step accepts "skip"', () => {
    const r = advanceEasy('contact', { locale: 'ro' }, 'skip');
    expect(r.step).toBe('done');
    expect(r.answers.phone).toBeUndefined();
    expect(r.answers.email).toBeUndefined();
  });

  it('a finished draft stays finished (free-form edits are handled by the service, not this pure script)', () => {
    const r = advanceEasy('done', {}, 'hello?');
    expect(r.step).toBe('done');
    expect(r.assistant).toEqual(['alreadyDone']);
    expect(r.regenerate).toBe(false);
  });

  it('nextEasyStep clamps at done', () => {
    expect(nextEasyStep('intro')).toBe('services');
    expect(nextEasyStep('services')).toBe('photos');
    expect(nextEasyStep('photos')).toBe('contact');
    expect(nextEasyStep('contact')).toBe('done');
    expect(nextEasyStep('done')).toBe('done');
  });

  describe('quickNameGuess', () => {
    it('takes the clause before the first comma/dash', () => {
      expect(quickNameGuess('AquaFix, instalații sanitare în Cluj')).toBe('AquaFix');
      expect(quickNameGuess('AquaFix - instalații sanitare')).toBe('AquaFix');
    });

    it('falls back to the whole (truncated) text with no separator', () => {
      expect(quickNameGuess('AquaFix Instalatii')).toBe('AquaFix Instalatii');
    });
  });

  describe('helpers (shared with the advanced builder script)', () => {
    it('condenseType trims filler and caps length', () => {
      expect(condenseType('Suntem o firma de constructii civile din Brasov')).toBe(
        'firma de constructii civile din Brasov',
      );
    });

    it('splitList dedupes and splits on separators', () => {
      expect(splitList('web design, web design; SEO\nHosting')).toEqual([
        'web design',
        'SEO',
        'Hosting',
      ]);
    });

    it('extractEmail / extractPhone pull structured bits out of free text', () => {
      expect(extractEmail('scrie-mi la ana@studio.ro oricand')).toBe('ana@studio.ro');
      expect(extractPhone('telefon +40 744 555 666')).toBe('+40744555666');
      expect(extractPhone('nu am acum')).toBeUndefined();
    });

    it('matchTone recognises RO and EN keywords', () => {
      expect(matchTone('premium si elegant')).toBe('premium');
      expect(matchTone('keep it professional')).toBe('professional');
      expect(matchTone('whatever')).toBeNull();
    });
  });
});
