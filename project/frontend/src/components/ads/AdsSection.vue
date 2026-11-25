<script setup lang="ts">
import { ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminHint from '@/components/admin/AdminHint.vue'

/**
 * One section of a campaign page: a card whose whole header opens and
 * closes it, with a labelled button so it is obvious. Open by default; what
 * the viewer closed stays closed on this browser.
 */
const props = defineProps<{
  /** Stable key for remembering open/closed. */
  name: string
  title: string
  icon: string
  hint?: string
}>()
const { t } = useI18n()

const KEY = `tvz.adsSection.${props.name}`
function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}
const open = ref(read())
const bodyId = useId()

function toggle(): void {
  open.value = !open.value
  try {
    if (open.value) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, '0')
  } catch {
    /* storage unavailable: kept for this page view */
  }
}
</script>

<template>
  <section class="as" :class="{ 'is-open': open }">
    <header class="as__head" @click="toggle">
      <v-icon :icon="icon" size="18" class="as__icon" />
      <h3 class="as__title">
        {{ title }}
        <span v-if="hint" class="as__hint" @click.stop><AdminHint :text="hint" /></span>
      </h3>
      <button type="button" class="as__btn" :aria-expanded="open" :aria-controls="bodyId" :aria-label="`${t(open ? 'ads.section.close' : 'ads.section.open')}: ${title}`" @click.stop="toggle">
        <span>{{ t(open ? 'ads.section.close' : 'ads.section.open') }}</span>
        <v-icon icon="mdi-chevron-down" size="18" class="as__chev" />
      </button>
    </header>
    <div v-show="open" :id="bodyId" class="as__body"><slot /></div>
  </section>
</template>

<style scoped>
.as {
  min-width: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.as__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.75rem 0.85rem 0.75rem 1.15rem;
  border-radius: var(--tvz-radius-lg);
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.as__head:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.is-open > .as__head {
  border-bottom: 1px solid var(--tvz-hairline);
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.as__icon {
  flex: none;
  color: rgb(var(--v-theme-primary));
}
.as__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.as__hint {
  display: inline-block;
  margin-left: 0.25rem;
  vertical-align: -2px;
}
.as__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex: none;
  min-height: 32px;
  padding: 0 0.5rem 0 0.7rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 999px;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.as__btn:hover,
.as__btn:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.5);
  color: rgb(var(--v-theme-primary));
}
.as__chev {
  transition: transform 0.2s ease;
}
.is-open > .as__head .as__chev {
  transform: rotate(180deg);
}
.as__body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem 1.15rem 1.15rem;
}
@media (max-width: 480px) {
  .as__btn span {
    display: none;
  }
  .as__btn {
    justify-content: center;
    width: 36px;
    padding: 0;
  }
}
</style>
