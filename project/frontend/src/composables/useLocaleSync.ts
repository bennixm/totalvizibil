import { watch } from 'vue'

import { usePreferencesStore } from '@/stores/preferences'
import { applyLocale } from '@/plugins/i18n'

/**
 * Applies the persisted `locale` preference to vue-i18n and <html lang>.
 * Call once, high in the component tree (App.vue).
 */
export function useLocaleSync() {
  const prefs = usePreferencesStore()

  watch(
    () => prefs.locale,
    (locale) => applyLocale(locale),
    { immediate: true },
  )
}
