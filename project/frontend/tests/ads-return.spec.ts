import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { adsReturnFromQuery, adsRouteFor, readStoredAdsReturn, walletForAds } from '@/lib/adsReturn'
import { router } from '@/router'
import { useWorkspaceStore } from '@/stores/workspace'

describe('Google Ads detour and first area', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('survives the Stripe round-trip and leads back to the campaign', () => {
    const to = walletForAds({ id: 'c1', tab: 'chat' }) as { query: Record<string, string> }
    expect(adsReturnFromQuery(to.query)).toEqual({ id: 'c1', tab: 'chat' })
    expect(readStoredAdsReturn()).toEqual({ id: 'c1', tab: 'chat' })
    expect(adsRouteFor({ id: 'c1', tab: 'chat' })).toEqual({
      name: 'ads-dashboard',
      params: { id: 'c1' },
      query: { tab: 'chat' },
    })
    expect(adsReturnFromQuery({ from: 'unlock' })).toBeNull()
  })

  it('a Google Ads-only owner starts in that area, without overriding a choice', () => {
    const ws = useWorkspaceStore()
    ws.pickFor(1, 2)
    expect(ws.id).toBe('site')
    ws.pickFor(0, 2)
    expect(ws.id).toBe('ads')
    ws.enter('site')
    ws.pickFor(0, 2)
    expect(ws.id).toBe('site')
  })

  it('old sign-up links lead to the choice between the two products', async () => {
    for (const p of ['/register', '/for-business']) {
      expect(router.getRoutes().find((r) => r.path === p)?.redirect).toEqual({ name: 'start' })
    }
    expect(router.resolve('/google-ads/costs').meta.workspace).toBe('ads')
  })
})
