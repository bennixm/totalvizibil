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

  const apply = () => {
    theme.global.name.value = resolvedTheme.value
  }

  watch(resolvedTheme, apply, { immediate: true })
  media?.addEventListener('change', apply)
  onBeforeUnmount(() => media?.removeEventListener('change', apply))

  return { resolvedTheme }
}
