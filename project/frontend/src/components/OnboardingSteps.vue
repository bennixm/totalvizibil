<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Presentational progress strip for the "create a business" flow. Pure display:
 * the parent passes which step is current — this component never touches the
 * router or any store, so the flow's sequencing can never leak into (or be
 * driven by) an editor's internal logic.
 */
const props = defineProps<{
  mode: 'easy' | 'advanced'
  current: string
}>()

const { t } = useI18n()

const EASY = ['plan', 'build', 'location', 'account', 'budget', 'launch'] as const
const ADVANCED = [
  'plan',
  'pitch',
  'location',
  'account',
  'unlock',
  'build',
  'budget',
  'launch',
] as const

const steps = computed(() => (props.mode === 'advanced' ? ADVANCED : EASY))
const currentIndex = computed(() => {
  const i = steps.value.indexOf(props.current as (typeof EASY)[number])
  return i === -1 ? 0 : i
})
</script>

<template>
  <nav class="ost" :aria-label="t('onboarding.aria')">
    <ol class="ost__list">
      <li
        v-for="(key, i) in steps"
        :key="key"
        class="ost__step"
        :class="{
          'is-done': i < currentIndex,
          'is-current': i === currentIndex,
        }"
        :aria-current="i === currentIndex ? 'step' : undefined"
      >
        <span class="ost__mark">
          <v-icon v-if="i < currentIndex" icon="mdi-check" size="13" />
          <span v-else class="ost__num">{{ i + 1 }}</span>
        </span>
        <span class="ost__label">{{ t('onboarding.step.' + key) }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
/* The strip lives in narrow step-page columns (~460–690px) and the advanced
   flow has eight steps — so only the current step ever shows its label; every
   step keeps its numbered circle + connector so the whole path stays visible
   without overflowing. */
.ost {
  display: flex;
  justify-content: center;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 0.15rem;
}
.ost::-webkit-scrollbar {
  display: none;
}
.ost__list {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: max-content;
}
.ost__step {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.25rem;
  border-radius: var(--tvz-radius-pill);
  font-size: 0.8125rem;
  line-height: 1;
  color: var(--tvz-label, rgba(var(--v-theme-on-surface), 0.55));
  white-space: nowrap;
}
.ost__step::after {
  content: '';
  width: 12px;
  height: 1px;
  margin-left: 0.05rem;
  background: var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.16));
  flex: none;
}
.ost__step:last-child::after {
  display: none;
}
.ost__step:not(.is-current) .ost__label {
  display: none;
}
.ost__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  flex: none;
  border-radius: 50%;
  border: 1.5px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.2));
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1;
}
.ost__num {
  display: block;
  font-variant-numeric: tabular-nums;
}
.ost__mark :deep(.v-icon) {
  display: block;
}
.ost__step.is-done {
  color: rgb(var(--v-theme-primary));
}
.ost__step.is-done .ost__mark {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.ost__step.is-current {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.ost__step.is-current .ost__mark {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: #fff;
}

/* Very narrow viewports: if the numbered path can't fit, it scrolls — anchor it
   to the start so step 1 stays in view rather than clipping both ends. */
@media (max-width: 520px) {
  .ost {
    justify-content: flex-start;
  }
}
</style>
