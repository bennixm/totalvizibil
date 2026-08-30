import {
  DraftAnswers,
  DraftStep,
  advance,
  buildEasyInput,
  condenseType,
  extractEmail,
  extractPhone,
  matchTone,
  openingTranscript,
  splitList,
} from './website-draft.script';

describe('website-draft script', () => {
  it('opens with the fixed "describe your business" prompt key', () => {
    const t = openingTranscript();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ role: 'assistant', key: 'opening' });
  });

  it('walks business -> name -> city -> services -> contact -> refine', () => {
    let step: DraftStep = 'business';
    let answers: DraftAnswers = {};

    const feed = (text: string) => {
      const r = advance(step, answers, text);
      step = r.step;
      answers = r.answers;
      return r;
    };

    let r = feed('Instalatii sanitare si termice, interventii rapide');
    expect(step).toBe('name');
    expect(answers.businessType).toBeTruthy();
    expect(r.regenerate).toBe(true);

    feed('AquaFix');
    expect(step).toBe('city');
    expect(answers.businessName).toBe('AquaFix');

    feed('Cluj-Napoca');
    expect(step).toBe('services');
    expect(answers.city).toBe('Cluj-Napoca');

    feed('Montaj centrale, Desfundare canalizare, Reparatii baterii');
    expect(step).toBe('contact');
    expect(answers.services).toEqual([
      'Montaj centrale',
      'Desfundare canalizare',
      'Reparatii baterii',
    ]);

    r = feed('0722 123 456, contact@aquafix.ro');
    expect(step).toBe('refine');
    expect(answers.phone).toBe('0722123456');
    expect(answers.email).toBe('contact@aquafix.ro');
    expect(r.assistant).toEqual(['generated', 'askRefine']);
    expect(r.regenerate).toBe(true);
  });

  it('refine step maps a tone keyword and regenerates', () => {
    const r = advance('refine', { description: 'x' }, 'as vrea sa fie mai prietenos');
    expect(r.answers.tone).toBe('friendly');
    expect(r.step).toBe('refine');
    expect(r.regenerate).toBe(true);
  });

  it('refine step finishes on an acknowledgement', () => {
    const r = advance('refine', { description: 'x', tone: 'calm' }, 'gata, arata bine');
    expect(r.step).toBe('done');
    expect(r.regenerate).toBe(false);
    expect(r.assistant).toEqual(['done']);
  });

  it('a finished draft stays finished', () => {
    const r = advance('done', {}, 'hello?');
    expect(r.step).toBe('done');
    expect(r.assistant).toEqual(['alreadyDone']);
  });

  it('contact step accepts "skip"', () => {
    const r = advance('contact', {}, 'skip');
    expect(r.step).toBe('refine');
    expect(r.answers.phone).toBeUndefined();
    expect(r.answers.email).toBeUndefined();
  });

  describe('helpers', () => {
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

    it('buildEasyInput fills sane fallbacks', () => {
      const input = buildEasyInput({ description: 'cofetarie artizanala' });
      expect(input.mode).toBe('easy');
      expect(input.businessType).toBe('cofetarie artizanala');
      expect(input.businessName).toBe('');
      expect(input.services).toEqual([]);
    });
  });
});
