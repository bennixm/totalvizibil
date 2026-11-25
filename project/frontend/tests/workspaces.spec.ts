import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { nextStep } from '@/components/ads/format'
import { workspaceOfRoute } from '@/lib/workspaces'
import { router } from '@/router'
import { routeForNotification } from '@/stores/notifications'
import { useWorkspaceStore } from '@/stores/workspace'
import type { UserCampaignDetail } from '@/services/googleAdsUser'

const area = (name: string) => {
  const r = router.getRoutes().find((x) => x.name === name)!
  return workspaceOfRoute({ name, meta: r.meta })
}

describe('workspaces', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('every Google Ads page belongs to the Google Ads area', () => {
    const pages = router.getRoutes().filter((r) => r.path.startsWith('/google-ads'))
    expect(pages.length).toBeGreaterThan(5)
    for (const p of pages) expect(area(String(p.name))).toBe('ads')
  })

  it('site pages and shared pages', () => {
    for (const n of ['dashboard', 'leads', 'website-settings']) expect(area(n)).toBe('site')
    for (const n of ['wallet', 'invoices', 'support', 'account']) expect(area(n)).toBeNull()
  })

  it('remembers the area across reloads and forgets it on sign out', () => {
    useWorkspaceStore().enter('ads')
    setActivePinia(createPinia())
    expect(useWorkspaceStore().current.home).toEqual({ name: 'ads-home' })
    useWorkspaceStore().reset()
    setActivePinia(createPinia())
    expect(useWorkspaceStore().id).toBe('site')
  })

  it('the "credits returned" notification opens its campaign', () => {
    expect(
      routeForNotification({ type: 'google_ads_no_change', data: { adsCampaignId: 'c1' } }),
    ).toEqual({ name: 'ads-dashboard', params: { id: 'c1' } })
  })
})

describe('next step of a campaign', () => {
  const make = (o: object = {}, issues: object[] = []) =>
    ({
      campaign: { status: 'active' },
      runningCycle: null,
      pending: [],
      readiness: { level: 'ready' },
      snapshot: { evaluation: { issues } },
      ...o,
    }) as unknown as UserCampaignDetail

  it('picks the most blocking one', () => {
    expect(nextStep(make({ campaign: { status: 'disconnected' }, pending: [{}] }))).toBe('reconnect')
    expect(nextStep(make({ runningCycle: {}, pending: [{}] }))).toBe('running')
    expect(nextStep(make({ pending: [{}] }))).toBe('approve')
    expect(nextStep(make({ campaign: { status: 'paused' } }))).toBe('paused')
    expect(nextStep(make({ snapshot: null }))).toBe('sync')
    expect(nextStep(make({ readiness: { level: 'insufficient' } }))).toBe('answer')
    expect(nextStep(make({}, [{ autoFixable: true, priority: 'low' }]))).toBe('optimize')
  })

  it('never says all is fine while something urgent needs the owner', () => {
    expect(nextStep(make({}, [{ autoFixable: false, priority: 'critical' }]))).toBe('yours')
    expect(nextStep(make({}, [{ autoFixable: false, priority: 'low' }]))).toBe('done')
  })
})
