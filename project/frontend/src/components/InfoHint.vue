<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * A muted "?" / info button that reveals a short explanation on tap.
 * Keeps informational copy out of the main layout until it's asked for —
 * and works the same on touch as on desktop.
 */
withDefaults(
  defineProps<{
    text: string
    label?: string
    size?: number
  }>(),
  { size: 16 },
)

const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <v-menu
    v-model="open"
    :close-on-content-click="false"
    location="bottom"
    origin="auto"
    max-width="280"
    content-class="infohint__pop"
  >
    <template #activator="{ props }">
      <button
        v-bind="props"
        type="button"
        class="infohint"
        :aria-label="label ?? t('common.moreInfo')"
        :aria-expanded="open"
      >
        <v-icon icon="mdi-information-outline" :size="size" />
      </button>
    </template>
    <v-card class="infohint__card" rounded="lg" :elevation="8">
      <p v-if="label" class="infohint__title">{{ label }}</p>
      <p class="infohint__text">{{ text }}</p>
    </v-card>
  </v-menu>
</template>

<style scoped>
.infohint {
  display: inline-grid;
  place-items: center;
  padding: 2px;
  border-radius: 50%;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  cursor: pointer;
  vertical-align: middle;
  transition: color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.infohint:hover,
.infohint:focus-visible {
  color: rgb(var(--v-theme-primary));
  outline: none;
}
.infohint__card {
  padding: 0.75rem 0.9rem;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
.infohint__title {
  margin: 0 0 0.25rem;
  font-size: 0.78rem;
  font-weight: 700;
}
.infohint__text {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
</style>

<style>
.infohint__pop.v-overlay__content {
  background: transparent;
  box-shadow: none;
}
</style>
