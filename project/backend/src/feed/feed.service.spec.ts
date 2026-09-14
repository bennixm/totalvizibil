import { heroBillboard } from './feed.service';

const CONTENT = {
  pages: [
    {
      isHome: true,
      sections: [
        {
          type: 'hero',
          headline: 'Real Headline',
          subheadline: 'Real sub',
          backgroundImage: 'https://x/hero.jpg',
        },
      ],
    },
  ],
};
const THEME = { accent: '#123456' };

describe('heroBillboard', () => {
  it('extracts title/subtitle/image/accent from an advanced-builder site and marks it builtWithBuilder', () => {
    const b = heroBillboard(CONTENT, THEME, 'advanced-builder-v2');
    expect(b).toEqual({
      title: 'Real Headline',
      subtitle: 'Real sub',
      image: 'https://x/hero.jpg',
      builtWithBuilder: true,
      accent: '#123456',
    });
  });

  it('does not mark a non-builder generator as builtWithBuilder, but still extracts content', () => {
    const b = heroBillboard(CONTENT, THEME, 'rule-based-v1');
    expect(b.builtWithBuilder).toBe(false);
    expect(b.title).toBe('Real Headline');
  });

  /** The Website Builder (PRO V2) never touches `content`/`theme` on publish —
   *  those columns stay as stale onboarding placeholder JSON, unrelated to the
   *  real published site. Extracting a hero from them would show wrong text,
   *  so a "pro-v2" site skips content extraction entirely, falling back to
   *  the company's own displayName/description on the card instead. */
  it('skips content/theme extraction for a "pro-v2" bundle site, but still marks it builtWithBuilder', () => {
    const b = heroBillboard(CONTENT, THEME, 'pro-v2');
    expect(b).toEqual({
      title: null,
      subtitle: null,
      image: null,
      builtWithBuilder: true,
      accent: null,
    });
  });

  it('returns an all-null billboard when there is no usable content and no generator', () => {
    const b = heroBillboard(null, null, null);
    expect(b).toEqual({
      title: null,
      subtitle: null,
      image: null,
      builtWithBuilder: false,
      accent: null,
    });
  });
});
