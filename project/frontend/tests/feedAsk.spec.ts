import { beforeEach, describe, expect, it } from 'vitest'

import {
  askResultCounty,
  askResultLabel,
  askResultRoute,
  markAskGateSeen,
  resetAskGateForTests,
  shouldShowAskGate,
} from '@/services/feedAsk'
import type { FeedCategoryNode } from '@/stores/feed'

const CATEGORIES: FeedCategoryNode[] = [
  {
    slug: 'instalatii',
    name: { ro: 'Instalații', en: 'Installations', de: 'Installationen' },
    icon: null,
    children: [
      {
        slug: 'instalatii-sanitare',
        name: { ro: 'Instalații sanitare', en: 'Plumbing', de: 'Sanitärinstallation' },
        icon: null,
      },
      {
        slug: 'instalatii-electrice',
        name: { ro: 'Instalații electrice', en: 'Electrical', de: 'Elektroinstallation' },
        icon: null,
      },
    ],
  },
]

describe('ask gate visibility', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetAskGateForTests()
  })

  it('shows on a bare first visit to /', () => {
    expect(shouldShowAskGate({})).toBe(true)
  })

  it('never shows when the URL carries a query (ads, legacy links, referrals)', () => {
    expect(shouldShowAskGate({ loc: '1011828' })).toBe(false)
    expect(shouldShowAskGate({ ref: 'ABC' })).toBe(false)
  })

  it('shows only once per session', () => {
    markAskGateSeen()
    expect(shouldShowAskGate({})).toBe(false)
    // A fresh page load in the same session (in-memory flag gone) still remembers it.
    resetAskGateForTests()
    expect(shouldShowAskGate({})).toBe(false)
  })
})

describe('ask result → Feed inputs', () => {
  it('no category → no route (the Feed root is revealed in place)', () => {
    expect(askResultRoute({ group: null, niches: [], counties: ['Cluj'] })).toBeNull()
  })

  it('group only, and comma-joined leaves of one group', () => {
    expect(askResultRoute({ group: 'instalatii', niches: [], counties: [] })).toEqual({
      name: 'browse',
      params: { seg1: 'instalatii' },
    })
    expect(
      askResultRoute({
        group: 'instalatii',
        niches: ['instalatii-sanitare', 'instalatii-electrice'],
        counties: [],
      }),
    ).toEqual({
      name: 'browse',
      params: { seg1: 'instalatii', seg2: 'instalatii-sanitare,instalatii-electrice' },
    })
  })

  it('county filter is comma-joined, or null for "every județ"', () => {
    expect(askResultCounty({ group: null, niches: [], counties: [] })).toBeNull()
    expect(askResultCounty({ group: null, niches: [], counties: ['Cluj', 'Alba'] })).toBe('Cluj,Alba')
  })

  it('labels what was selected in the visitor\'s locale', () => {
    expect(
      askResultLabel(
        { group: 'instalatii', niches: ['instalatii-sanitare'], counties: ['Cluj'] },
        CATEGORIES,
        'ro',
      ),
    ).toBe('Instalații sanitare · Cluj')
    expect(
      askResultLabel({ group: 'instalatii', niches: [], counties: [] }, CATEGORIES, 'en'),
    ).toBe('Installations')
  })
})
