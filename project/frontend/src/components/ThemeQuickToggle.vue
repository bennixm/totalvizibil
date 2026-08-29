<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePreferencesStore, type ThemeMode } from '@/stores/preferences'

withDefaults(defineProps<{ size?: string | number }>(), { size: 'small' })

const { t } = useI18n()
const prefs = usePreferencesStore()

const order: ThemeMode[] = ['light', 'dark', 'system']
const icons: Record<ThemeMode, string> = {
  light: 'mdi-white-balance-sunny',
  dark: 'mdi-weather-night',
  system: 'mdi-monitor',
}

const icon = computed(() => icons[prefs.themeMode])
const label = computed(() => t(`theme.${prefs.themeMode}`))

function cycle() {
  const next = order[(order.indexOf(prefs.themeMode) + 1) % order.length]
  prefs.setThemeMode(next)
}
</script>

<template>
  <v-btn
    :icon="icon"
    :size="size"
    variant="text"
    :aria-label="`${t('theme.toggle')} — ${label}`"
    :title="label"
    @click="cycle"
  />
</template>
