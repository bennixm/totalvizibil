import { defineStore } from 'pinia'

import { resolveInitialLocale, type AppLocale } from '@/plugins/i18n'

export type ThemeMode = 'light' | 'dark' | 'system'

interface PreferencesState {
  themeMode: ThemeMode
  locale: AppLocale
  /** The animated background shader (App.vue). Off entirely spares the GPU
   *  cost for users on weaker hardware — opt-out, not a visual preference. */
  bgEffectEnabled: boolean
}

/**
 * User-facing UI preferences (theme + language).
 * Persisted to localStorage so the choice survives reloads; a stored value
 * always wins over browser defaults on the next visit.
 */
export const usePreferencesStore = defineStore('preferences', {
  state: (): PreferencesState => ({
    themeMode: 'system',
    locale: resolveInitialLocale(),
    bgEffectEnabled: true,
  }),

  persist: {
    key: 'tvz.preferences',
  },

  actions: {
    setThemeMode(mode: ThemeMode) {
      this.themeMode = mode
    },
    setLocale(locale: AppLocale) {
      this.locale = locale
    },
    setBgEffectEnabled(on: boolean) {
      this.bgEffectEnabled = on
    },
  },
})
