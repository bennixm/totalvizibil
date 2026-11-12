import { Logger } from '@nestjs/common';
import {
  fetchOwnKeywords,
  pushNegativesOntoSiblings,
} from 'src/google-ads/google-ads-negative-keywords';

/**
 * Direction 1 (research doc): a subcategory's own terms must land as
 * NEGATIVE criteria on every SIBLING's shared set — never on its own, never
 * duplicated, and never onto a sibling campaign where the term is also one
 * of THAT sibling's own positive keywords (which would self-cancel it).
 */
function fakeClient(overrides: { search?: jest.Mock; mutate?: jest.Mock } = {}) {
  return {
    customerId: '1234567890',
    search: overrides.search ?? jest.fn().mockResolvedValue([]),
    mutate: overrides.mutate ?? jest.fn().mockResolvedValue([]),
  } as never;
}

function fakePrisma(siblings: any[]) {
  return {
    googleAdsSubcategoryCampaign: { findMany: jest.fn().mockResolvedValue(siblings) },
  } as never;
}

const logger = new Logger('test');

describe('pushNegativesOntoSiblings', () => {
  it('does nothing when there are no terms', async () => {
    const prisma = fakePrisma([{ negativeKeywordSetResourceId: '1', googleAdGroupId: '10' }]);
    const mutate = jest.fn();
    await pushNegativesOntoSiblings(fakeClient({ mutate }), prisma, logger, {
      parentCategoryId: 'parent-1',
      ownCategoryId: 'cat-a',
      terms: [],
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does nothing when there are no siblings with a shared set yet', async () => {
    const prisma = fakePrisma([]);
    const mutate = jest.fn();
    await pushNegativesOntoSiblings(fakeClient({ mutate }), prisma, logger, {
      parentCategoryId: 'parent-1',
      ownCategoryId: 'cat-a',
      terms: ['reparatii auto'],
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('pushes new terms onto a sibling set as negatives', async () => {
    const prisma = fakePrisma([
      {
        negativeKeywordSetResourceId: '1',
        googleAdGroupId: '10',
        category: { slug: 'vulcanizare' },
      },
    ]);
    const search = jest.fn().mockResolvedValue([]); // no existing negatives, no own positives
    const mutate = jest.fn().mockResolvedValue([]);
    await pushNegativesOntoSiblings(fakeClient({ search, mutate }), prisma, logger, {
      parentCategoryId: 'parent-1',
      ownCategoryId: 'cat-a',
      terms: ['reparatii caroserie', 'vopsitorie auto'],
    });

    expect(mutate).toHaveBeenCalledWith([
      {
        sharedCriterionOperation: {
          create: {
            sharedSet: 'customers/1234567890/sharedSets/1',
            keyword: { text: 'reparatii caroserie', matchType: 'PHRASE' },
          },
        },
      },
      {
        sharedCriterionOperation: {
          create: {
            sharedSet: 'customers/1234567890/sharedSets/1',
            keyword: { text: 'vopsitorie auto', matchType: 'PHRASE' },
          },
        },
      },
    ]);
  });

  it('never pushes a term already on the sibling set, or one that is also the sibling’s own positive keyword', async () => {
    const prisma = fakePrisma([
      {
        negativeKeywordSetResourceId: '1',
        googleAdGroupId: '10',
        category: { slug: 'vulcanizare' },
      },
    ]);
    const search = jest.fn((query: string) => {
      if (query.includes('shared_criterion')) {
        return Promise.resolve([{ sharedCriterion: { keyword: { text: 'reparatii caroserie' } } }]);
      }
      // the sibling's own positive keyword — must never be negated on itself
      return Promise.resolve([{ adGroupCriterion: { keyword: { text: 'vopsitorie auto' } } }]);
    });
    const mutate = jest.fn().mockResolvedValue([]);
    await pushNegativesOntoSiblings(fakeClient({ search, mutate }), prisma, logger, {
      parentCategoryId: 'parent-1',
      ownCategoryId: 'cat-a',
      terms: ['reparatii caroserie', 'vopsitorie auto', 'tinichigerie'],
    });

    // Only 'tinichigerie' is genuinely new and safe to push.
    expect(mutate).toHaveBeenCalledWith([
      {
        sharedCriterionOperation: {
          create: {
            sharedSet: 'customers/1234567890/sharedSets/1',
            keyword: { text: 'tinichigerie', matchType: 'PHRASE' },
          },
        },
      },
    ]);
  });

  it('skips a sibling whose read/write fails, without throwing', async () => {
    const prisma = fakePrisma([
      { negativeKeywordSetResourceId: '1', googleAdGroupId: '10', category: { slug: 'broken' } },
    ]);
    const search = jest.fn().mockRejectedValue(new Error('API down'));
    const mutate = jest.fn();
    await expect(
      pushNegativesOntoSiblings(fakeClient({ search, mutate }), prisma, logger, {
        parentCategoryId: 'parent-1',
        ownCategoryId: 'cat-a',
        terms: ['reparatii caroserie'],
      }),
    ).resolves.toBeUndefined();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('fetchOwnKeywords', () => {
  it('reads back the plain keyword texts for an ad group', async () => {
    const search = jest
      .fn()
      .mockResolvedValue([
        { adGroupCriterion: { keyword: { text: 'electrician bucuresti' } } },
        { adGroupCriterion: { keyword: { text: 'reparatii electrice' } } },
        {},
      ]);
    const terms = await fetchOwnKeywords(
      fakeClient({ search }),
      'customers/1234567890/adGroups/777',
    );
    expect(terms).toEqual(['electrician bucuresti', 'reparatii electrice']);
  });
});
