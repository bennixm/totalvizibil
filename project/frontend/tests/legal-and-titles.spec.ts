import { describe, expect, it } from 'vitest'

import { PRIVACY, TERMS } from '@/content/legal'
import { i18n } from '@/plugins/i18n'
import { router } from '@/router'
import { notificationTitle } from '@/stores/notifications'

describe('legal pages', () => {
  it('have their own public addresses', () => {
    expect(router.resolve('/confidentialitate').name).toBe('privacy')
    expect(router.resolve('/termeni').name).toBe('terms')
  })
  it('are never published as ready without text in every section', () => {
    for (const d of [PRIVACY, TERMS]) {
      if (d.ready) expect(d.sections.every((s) => s.body.trim()) && !!d.updatedAt).toBe(true)
    }
  })
})

describe('Google Ads notice titles', () => {
  it('follow the reader language, other types stay as sent', () => {
    const n = { type: 'google_ads_cycle_done', title: 'Agentul a optimizat campania' }
    i18n.global.locale.value = 'en'
    expect(notificationTitle(n)).toBe('The agent optimized the campaign')
    expect(notificationTitle({ type: 'lead_received', title: 'Cerere nouă' })).toBe('Cerere nouă')
    i18n.global.locale.value = 'ro'
    expect(notificationTitle(n)).toBe(n.title)
  })
})
