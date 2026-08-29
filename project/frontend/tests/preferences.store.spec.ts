import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePreferencesStore } from '@/stores/preferences'

describe('preferences store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('defaults themeMode to "system"', () => {
    const prefs = usePreferencesStore()
    expect(prefs.themeMode).toBe('system')
  })

  it('updates the theme mode', () => {
    const prefs = usePreferencesStore()
    prefs.setThemeMode('dark')
    expect(prefs.themeMode).toBe('dark')
  })

  it('updates the locale', () => {
    const prefs = usePreferencesStore()
    prefs.setLocale('en')
    expect(prefs.locale).toBe('en')
  })
})
