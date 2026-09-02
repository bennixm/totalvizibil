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
  splitList,
} from './website-draft.script';

describe('website-draft guided script', () => {
  it('opens with the style/template prompt', () => {
    const t = openingTranscript();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ role: 'assistant', key: 'opening' });
  });

  it('walks template -> name -> field -> color -> landing -> services -> portfolio -> contact -> done', () => {
    let step: EasyStep = 'template';
    let answers: EasyAnswers = { locale: 'ro' };

    const feed = (text?: string) => {
      const r = advanceEasy(step, answers, text);
      step = r.step;
      answers = r.answers;
      return r;
    };

    // template step is advanced from the picker widget, no text
    let r = feed();
    expect(step).toBe('name');
    expect(r.assistant).toEqual(['askName']);

    r = feed('AquaFix');
    expect(step).toBe('field');
    expect(answers.companyName).toBe('AquaFix');
    expect(r.assistant).toEqual(['askField']);

    r = feed('instalații sanitare și termice');
    expect(step).toBe('color');
    expect(answers.businessType).toBe('instalații sanitare și termice');
    expect(r.assistant).toEqual(['askColor']);

    // colour step is advanced from the widget, no text
    feed();
    expect(step).toBe('landing');

    feed('Instalatori de încredere în Cluj');
    expect(step).toBe('services');
    expect(answers.landingTitle).toBe('Instalatori de încredere în Cluj');

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
    // the trade from the "field" step is preserved (not overwritten by service names)
    expect(answers.businessType).toBe('instalații sanitare și termice');

    // "Continue" (no text) advances services -> portfolio -> contact
    feed();
    expect(step).toBe('portfolio');
    feed();
    expect(step).toBe('contact');

    const c = feed('0722 123 456, contact@aquafix.ro');
    expect(step).toBe('done');
    expect(answers.phone).toBe('0722123456');
    expect(answers.email).toBe('contact@aquafix.ro');
    expect(c.assistant).toEqual(['contactSaved', 'done']);
    expect(c.regenerate).toBe(true);
  });

  it('services step with "skip" moves on without an AI call', () => {
    const r = advanceEasy('services', { locale: 'ro' }, 'skip');
    expect(r.step).toBe('portfolio');
    expect(r.generateServicesFor).toBeUndefined();
    expect(r.assistant).toEqual(['askPortfolio']);
  });

  it('contact step accepts "skip"', () => {
    const r = advanceEasy('contact', { locale: 'ro' }, 'skip');
    expect(r.step).toBe('done');
    expect(r.answers.phone).toBeUndefined();
    expect(r.answers.email).toBeUndefined();
  });

  it('a finished draft stays finished', () => {
    const r = advanceEasy('done', {}, 'hello?');
    expect(r.step).toBe('done');
    expect(r.assistant).toEqual(['alreadyDone']);
    expect(r.regenerate).toBe(false);
  });

  it('nextEasyStep clamps at done', () => {
    expect(nextEasyStep('template')).toBe('name');
    expect(nextEasyStep('name')).toBe('field');
    expect(nextEasyStep('field')).toBe('color');
    expect(nextEasyStep('contact')).toBe('done');
    expect(nextEasyStep('done')).toBe('done');
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
