<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { stepsFor, type FlowStep } from '@/lib/flowSteps'

/**
 * Presentational progress strip for the "create a business" flow. Pure display:
 * the parent passes which step is current — this component never touches the
 * router or any store, so the flow's sequencing can never leak into (or be
 * driven by) an editor's internal logic.
 */
const props = defineProps<{
  mode: 'easy' | 'advanced' | 'ads'
  current: string
}>()

const { t } = useI18n()

const steps = computed(() => stepsFor(props.mode))
const currentIndex = computed(() => {
  const i = steps.value.indexOf(props.current as FlowStep)
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
  border-radius: 0;
  clip-path: var(--tvz-hex-sm);
  font-size: var(--tvz-fs-small);
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
  border-radius: 0;
  clip-path: var(--tvz-hex-xs);
  border: 1.5px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.2));
  font-size: var(--tvz-fs-micro);
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
  animation: ost-arrive 0.5s var(--tvz-ease-spring, ease) both;
}
.ost__step.is-current .ost__label {
  animation: ost-label 0.4s var(--tvz-ease-out, ease) both;
}
.ost__mark,
.ost__step {
  transition:
    color var(--tvz-dur-slow, 0.3s) var(--tvz-ease-out, ease),
    background-color var(--tvz-dur-slow, 0.3s) var(--tvz-ease-out, ease),
    border-color var(--tvz-dur-slow, 0.3s) var(--tvz-ease-out, ease);
}
/* Done steps: the connector after them is drawn in the brand color, so the
   path already walked reads at a glance. */
.ost__step.is-done::after {
  background: rgba(var(--v-theme-primary), 0.55);
}
@keyframes ost-arrive {
  from {
    transform: scale(0.7);
    opacity: 0.4;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes ost-label {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ost__step.is-current .ost__mark,
  .ost__step.is-current .ost__label {
    animation: none;
  }
}

/* Very narrow viewports: if the numbered path can't fit, it scrolls — anchor it
   to the start so step 1 stays in view rather than clipping both ends. */
@media (max-width: 520px) {
  .ost {
    justify-content: flex-start;
  }
}
</style>
