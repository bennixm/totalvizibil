<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePreferencesStore, type ThemeMode } from '@/stores/preferences'

withDefaults(defineProps<{ showLabel?: boolean; density?: 'default' | 'comfortable' | 'compact' }>(), {
  showLabel: true,
  density: 'comfortable',
})

const { t } = useI18n()
const prefs = usePreferencesStore()

const options: { value: ThemeMode; icon: string }[] = [
  { value: 'light', icon: 'mdi-white-balance-sunny' },
  { value: 'dark', icon: 'mdi-weather-night' },
  { value: 'system', icon: 'mdi-monitor' },
]

const model = computed<ThemeMode>({
  get: () => prefs.themeMode,
  set: (value) => {
    // v-btn-toggle emits null when the active button is re-clicked — ignore it.
    if (value) prefs.setThemeMode(value)
  },
})
</script>

<template>
  <div class="d-inline-flex align-center ga-2">
    <span v-if="showLabel" class="text-caption text-medium-emphasis">{{ t('theme.label') }}</span>
    <v-btn-toggle
      v-model="model"
      mandatory
      :density="density"
      variant="outlined"
      divided
      rounded="pill"
      class="tvz-glass"
      color="primary"
    >
      <v-btn
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :icon="option.icon"
        size="small"
        :aria-label="t(`theme.${option.value}`)"
        :title="t(`theme.${option.value}`)"
      />
    </v-btn-toggle>
  </div>
</template>
