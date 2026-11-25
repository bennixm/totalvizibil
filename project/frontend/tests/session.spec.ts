import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearSessionData } from '@/lib/session'
import { readDraftToken, saveDraftToken } from '@/services/googleAdsUser'
import { useCompaniesStore } from '@/stores/companies'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import { useWalletStore } from '@/stores/wallet'
import { useWorkspaceStore } from '@/stores/workspace'

describe('clearSessionData', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('leaves nothing of the previous user for the next one', () => {
    const wallet = useWalletStore()
    const companies = useCompaniesStore()
    const ads = useGoogleAdsUserStore()
    wallet.$patch({ summary: { blocked: true } as never })
    companies.$patch({ overview: [{ id: 'c1' }] as never, overviewLoaded: true })
    companies.select('c1')
    ads.select('a1')
    useWorkspaceStore().enter('ads')
    saveDraftToken('secret')

    clearSessionData()

    expect(wallet.summary).toBeNull()
    expect(companies.overview).toEqual([])
    expect(companies.overviewLoaded).toBe(false)
    expect(companies.currentId).toBeNull()
    expect(ads.selectedId).toBe('')
    expect(useWorkspaceStore().id).toBe('site')
    expect(readDraftToken()).toBeNull()
    expect(localStorage.length).toBe(0)
  })
})
