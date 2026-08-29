<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * The "assistant is building your site" sequence. Purely visual pacing while the
 * generate request is in flight; `done` freezes it on the last step.
 */
const props = defineProps<{ done?: boolean }>()
const { t } = useI18n()

const steps = [
  'aiThinking.step1',
  'aiThinking.step2',
  'aiThinking.step3',
  'aiThinking.step4',
  'aiThinking.step5',
]
const active = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    if (props.done) {
      active.value = steps.length - 1
      return
    }
    active.value = Math.min(active.value + 1, steps.length - 1)
  }, 900)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="ai" role="status" aria-live="polite">
    <div class="ai__orb"><span /><span /><span /></div>
    <ul class="ai__steps">
      <li
        v-for="(step, i) in steps"
        :key="step"
        :class="{ 'is-active': i === active, 'is-done': i < active || done }"
      >
        <v-icon
          :icon="i < active || done ? 'mdi-check-circle' : 'mdi-circle-outline'"
          size="16"
        />
        {{ t(step) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.6rem;
  padding: 2rem 0;
}
.ai__orb {
  position: relative;
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
}
.ai__orb span {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--tvz-ai);
  animation: ai-spin 1.4s var(--tvz-ease-out) infinite;
}
.ai__orb span:nth-child(2) {
  inset: 12px;
  border-top-color: var(--tvz-brand-1);
  animation-duration: 1.9s;
  animation-direction: reverse;
}
.ai__orb span:nth-child(3) {
  inset: 24px;
  border-top-color: var(--tvz-brand-3);
  animation-duration: 2.4s;
}
@keyframes ai-spin {
  to {
    transform: rotate(1turn);
  }
}

.ai__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
  font-size: 0.92rem;
}
.ai__steps li {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--tvz-hairline);
  color: rgb(var(--v-theme-on-surface) / 0.38);
  transition: color var(--tvz-dur-med) var(--tvz-ease-out);
}
.ai__steps li.is-active {
  color: rgb(var(--v-theme-on-surface));
}
.ai__steps li.is-done {
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.ai__steps li.is-done :deep(.v-icon) {
  color: var(--tvz-brand-1);
}

@media (prefers-reduced-motion: reduce) {
  .ai__orb span {
    animation: none;
  }
}
</style>
