<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePreferencesStore } from '@/stores/preferences'

withDefaults(defineProps<{ showLabel?: boolean; density?: 'default' | 'comfortable' | 'compact' }>(), {
  showLabel: true,
  density: 'comfortable',
})

const { t } = useI18n()
const prefs = usePreferencesStore()

const options = [
  { value: true, icon: 'mdi-blur', key: 'theme.bgEffectOn' },
  { value: false, icon: 'mdi-blur-off', key: 'theme.bgEffectOff' },
]

const model = computed<boolean>({
  get: () => prefs.bgEffectEnabled,
  set: (value) => {
    // v-btn-toggle emits null when the active button is re-clicked — ignore it.
    if (value !== null && value !== undefined) prefs.setBgEffectEnabled(value)
  },
})
</script>

<template>
  <div class="d-inline-flex align-center ga-2">
    <span v-if="showLabel" class="text-caption text-medium-emphasis">{{ t('theme.bgEffectLabel') }}</span>
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
        :key="String(option.value)"
        :value="option.value"
        :icon="option.icon"
        size="small"
        :aria-label="t(option.key)"
        :title="t(option.key)"
      />
    </v-btn-toggle>
  </div>
</template>
