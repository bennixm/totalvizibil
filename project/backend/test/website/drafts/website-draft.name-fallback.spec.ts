import {
  advanceEasy,
  extractBusinessName,
  isMoveOn,
  nameFromAnswer,
} from 'src/website/drafts/website-draft.script';

describe('guided script: name without the AI + "move on" replies', () => {
  describe('extractBusinessName', () => {
    it.each([
      ['Firma mea se numește Termo Audit Brașov, facem instalații termice', 'Termo Audit Brașov'],
      ['Sunt Instalatii Audit SRL, facem instalatii sanitare in Brasov', 'Instalatii Audit'],
      ['Suntem Frizeria Ionuț, tuns și bărbierit în Cluj', 'Frizeria Ionuț'],
      ['Numele firmei este „Casa Verde” și facem grădini', 'Casa Verde'],
      ['We are called Bright Smile and we do dental care', 'Bright Smile'],
    ])('%s → %s', (text, name) => {
      expect(extractBusinessName(text)).toBe(name);
    });

    it.each([
      'sunt instalator in brasov si fac centrale',
      'facem curățenie după constructor',
      'salut, vreau un site',
    ])('finds no name in "%s"', (text) => {
      expect(extractBusinessName(text)).toBeUndefined();
    });
  });

  it('reads the answer to "what is it called?"', () => {
    expect(nameFromAnswer('Termo Instal Brașov')).toBe('Termo Instal Brașov');
    expect(nameFromAnswer('Se numește Termo Instal, din Brașov')).toBe('Termo Instal');
    expect(nameFromAnswer('skip')).toBeUndefined();
  });

  it('a name answer moves the intro on to services', () => {
    const r = advanceEasy('intro', { awaitingName: true }, 'Termo Instal');
    expect(r.step).toBe('services');
    expect(r.answers.companyName).toBe('Termo Instal');
    expect(r.answers.awaitingName).toBe(false);
    expect(r.parseIntroFor).toBeUndefined();
  });

  describe('typed "continue" at the services step', () => {
    it.each(['gata', 'Continuă', 'continua', 'ok', 'mai departe', 'next', 'Gata!'])(
      '"%s" advances without touching the services',
      (text) => {
        expect(isMoveOn(text)).toBe(true);
        const before = { serviceNames: ['Montaj centrale', 'Revizii'] };
        const r = advanceEasy('services', before, text);
        expect(r.step).toBe('photos');
        expect(r.answers.serviceNames).toEqual(['Montaj centrale', 'Revizii']);
        expect(r.generateServicesFor).toBeUndefined();
      },
    );

    it('a real list still replaces the services', () => {
      const r = advanceEasy('services', {}, 'Montaj centrale, Revizii');
      expect(r.step).toBe('services');
      expect(r.generateServicesFor).toEqual(['Montaj centrale', 'Revizii']);
    });
  });
});
