import {
  subcategoryLandingPath,
  subcategoryLandingUrl,
} from 'src/google-ads/google-ads-landing-url';

describe('subcategoryLandingPath / subcategoryLandingUrl', () => {
  it('builds /group/niche for a leaf category with a parent', () => {
    expect(subcategoryLandingPath({ slug: 'electricieni', parent: { slug: 'constructii' } })).toBe(
      '/constructii/electricieni',
    );
  });

  it('builds /slug for a category with no parent', () => {
    expect(subcategoryLandingPath({ slug: 'constructii', parent: null })).toBe('/constructii');
  });

  it('prefixes with the frontend origin', () => {
    expect(
      subcategoryLandingUrl(
        { slug: 'electricieni', parent: { slug: 'constructii' } },
        'https://totalvizibil.ro',
      ),
    ).toBe('https://totalvizibil.ro/constructii/electricieni');
  });
});
