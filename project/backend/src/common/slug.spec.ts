import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('Popescu Instalatii SRL')).toBe('popescu-instalatii-srl');
  });

  it('folds diacritics', () => {
    expect(slugify('Acoperișuri Cluj-Napoca')).toBe('acoperisuri-cluj-napoca');
  });

  it('trims leading/trailing separators and symbols', () => {
    expect(slugify('  !!Café & Bar!!  ')).toBe('cafe-bar');
  });
});

describe('uniqueSlug', () => {
  it('returns the root when free', async () => {
    expect(await uniqueSlug('My Shop', async () => false)).toBe('my-shop');
  });

  it('appends an incrementing suffix when taken', async () => {
    const taken = new Set(['my-shop', 'my-shop-2']);
    expect(await uniqueSlug('My Shop', async (c) => taken.has(c))).toBe('my-shop-3');
  });

  it('falls back to "company" for empty input', async () => {
    expect(await uniqueSlug('!!!', async () => false)).toBe('company');
  });
});
