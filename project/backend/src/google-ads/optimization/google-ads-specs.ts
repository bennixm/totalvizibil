/**
 * Google's own asset requirements, per campaign type, as published in the
 * official Google Ads Help Center (fetched and checked 2026-11-19). Every
 * number the evaluator/score uses comes from here, with the page it came
 * from, so a reviewer can verify any rule against the source instead of
 * trusting a magic constant. Where Google publishes no number (e.g. a
 * recommended callout count), the rule says so and is scored as optional.
 *
 * Only the campaign types this account actually runs are modelled
 * (SEARCH and PERFORMANCE_MAX, confirmed from the live account). Videos do
 * not exist as an asset type on Search, so Search has no video rule at all.
 */

export const SOURCES = {
  rsa: 'https://support.google.com/google-ads/answer/7684791',
  adStrength: 'https://support.google.com/google-ads/answer/9921843',
  sitelinks: 'https://support.google.com/google-ads/answer/2375416',
  callouts: 'https://support.google.com/google-ads/answer/6079510',
  snippets: 'https://support.google.com/google-ads/answer/6280012',
  searchImages: 'https://support.google.com/google-ads/answer/9566341',
  businessInfo: 'https://support.google.com/google-ads/answer/12497613',
  pmaxSpecs: 'https://support.google.com/google-ads/answer/17091269',
  pmaxApiRequirements:
    'https://developers.google.com/google-ads/api/performance-max/asset-requirements',
} as const;

/** Responsive Search Ad (Search campaigns). */
export const RSA = {
  headlines: { min: 3, max: 15, maxChars: 30 },
  descriptions: { min: 2, max: 4, maxChars: 90 },
  pathMaxChars: 15,
} as const;

/** Ad Strength names sitelinks as a scored factor: "6 or more sitelinks". */
export const SITELINKS = {
  linkTextMaxChars: 25,
  /** Not published on the Help Center page; this is the API field limit
   *  of `SitelinkAsset.description1/2`. */
  descriptionMaxChars: 35,
  minToShow: 2,
  recommended: 6,
} as const;

export const CALLOUTS = {
  maxChars: 25,
  /** Google publishes no recommended count, only "up to 10" shown. We use
   *  4 as our own target (enough to fill a desktop callout line) and label
   *  it as such in the score explanation. */
  ourTarget: 4,
} as const;

export const STRUCTURED_SNIPPETS = {
  minValues: 3,
  recommendedValues: 4,
  /** Max characters per snippet value. */
  valueMaxChars: 25,
} as const;

/** Image assets on Search campaigns. */
export const SEARCH_IMAGES = {
  square: { ratio: 1, minW: 300, minH: 300, recW: 1200, recH: 1200 },
  landscape: { ratio: 1.91, minW: 600, minH: 314, recW: 1200, recH: 628 },
  maxFileBytes: 5120 * 1024,
  recommendedCount: 4,
  max: 20,
} as const;

/** Performance Max asset group requirements. */
export const PMAX = {
  headlines: { min: 3, max: 15, recommended: 11, maxChars: 30, shortMaxChars: 15 },
  longHeadlines: { min: 1, max: 5, recommended: 2, maxChars: 90 },
  descriptions: { min: 2, max: 5, recommended: 4, maxChars: 90 },
  businessNameMaxChars: 25,
  images: {
    landscape: {
      ratio: 1.91,
      minW: 600,
      minH: 314,
      recW: 1200,
      recH: 628,
      recommended: 4,
      required: true,
    },
    square: {
      ratio: 1,
      minW: 300,
      minH: 300,
      recW: 1200,
      recH: 1200,
      recommended: 4,
      required: true,
    },
    portrait: {
      ratio: 0.8,
      minW: 480,
      minH: 600,
      recW: 960,
      recH: 1200,
      recommended: 2,
      required: false,
    },
  },
  logos: {
    square: { ratio: 1, minW: 128, minH: 128, recW: 1200, recH: 1200, required: true },
    landscape: { ratio: 4, minW: 512, minH: 128, recW: 1200, recH: 300, required: false },
  },
  maxFileBytes: 5120 * 1024,
  videos: {
    /** One of each orientation is Google's recommendation (16:9, 1:1,
     *  9:16), each ≥10 s. The Google Ads API exposes only a video's YouTube
     *  id and title, NOT its duration or orientation, so the evaluator can
     *  count videos but cannot verify those two properties. */
    recommended: 3,
    max: 15,
    minSeconds: 10,
  },
} as const;

/** Aspect-ratio tolerance when classifying an image (Google's own crops
 *  accept small deviations; 1% keeps 1200x628 = 1.9108 as 1.91:1). */
export const RATIO_TOLERANCE = 0.01;

export function ratioMatches(width: number, height: number, ratio: number): boolean {
  if (!width || !height) return false;
  return Math.abs(width / height - ratio) / ratio <= RATIO_TOLERANCE;
}
