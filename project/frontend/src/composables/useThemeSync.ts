import { computed, onBeforeUnmount, watch } from 'vue'
import { useTheme } from 'vuetify'

import { usePreferencesStore } from '@/stores/preferences'
import { DARK_THEME, LIGHT_THEME } from '@/plugins/vuetify'

/**
 * Bridges the persisted `themeMode` preference to Vuetify's active theme.
 * When the mode is "system" it follows (and live-tracks) the OS setting.
 * Call once, high in the component tree (App.vue).
 */
export function useThemeSync() {
  const theme = useTheme()
  const prefs = usePreferencesStore()

  const media =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null

  const resolvedTheme = computed(() => {
    if (prefs.themeMode === 'system') {
      return media?.matches ? DARK_THEME : LIGHT_THEME
    }
    return prefs.themeMode === 'dark' ? DARK_THEME : LIGHT_THEME
  })

  /** Keep the mobile browser-chrome colour in step with the active theme. */
  const syncThemeColor = (name: string) => {
    if (typeof document === 'undefined') return
    const color = name === DARK_THEME ? '#06080F' : '#F5F7FE'
    let el = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute('name', 'theme-color')
      document.head.appendChild(el)
    }
    el.setAttribute('content', color)
  }

  const apply = () => {
    theme.global.name.value = resolvedTheme.value
    syncThemeColor(resolvedTheme.value)
  }

  watch(resolvedTheme, apply, { immediate: true })
  media?.addEventListener('change', apply)
  onBeforeUnmount(() => media?.removeEventListener('change', apply))

  return { resolvedTheme }
}
