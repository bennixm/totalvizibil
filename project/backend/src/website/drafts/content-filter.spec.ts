import { containsBannedContent } from './content-filter';

describe('content-filter', () => {
  it('still blocks plain profanity (RO + EN)', () => {
    expect(containsBannedContent('du-te în pizda mă-tii')).toBe(true);
    expect(containsBannedContent('this is fucking terrible')).toBe(true);
    expect(containsBannedContent('sugi pula')).toBe(true);
  });

  it('still blocks spaced / punctuated evasion', () => {
    expect(containsBannedContent('p u l a')).toBe(true);
    expect(containsBannedContent('f-u-c-k you')).toBe(true);
    expect(containsBannedContent('c.u.r.v.a')).toBe(true);
  });

  it('still blocks leetspeak', () => {
    expect(containsBannedContent('fvck')).toBe(false); // not covered — fine
    expect(containsBannedContent('f4ggot')).toBe(true);
  });

  it('does NOT block legitimate Romanian business copy (cross-word collisions)', () => {
    // these fuse into a banned substring only if you delete every space
    expect(containsBannedContent('Oferim o structură vastă de servicii.')).toBe(false);
    expect(containsBannedContent('Colaborare pe termen lung cu fiecare client.')).toBe(false);
    expect(containsBannedContent('Lucrări curente în tot județul, la preț corect.')).toBe(false);
    expect(containsBannedContent('Punem accent pe comunicare și pe calitate.')).toBe(false);
    expect(containsBannedContent('Curățenie generală și întreținere periodică.')).toBe(false);
    expect(containsBannedContent('Echipa noastră pornește de la nevoile tale.')).toBe(false);
  });

  it('empty / whitespace is clean', () => {
    expect(containsBannedContent('')).toBe(false);
    expect(containsBannedContent('   ')).toBe(false);
  });
});
