<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useBuilderStore } from '@/stores/builder'

const { t } = useI18n()
const store = useBuilderStore()
const { aiPlanning } = storeToRefs(store)

// Fake progress: we have no real per-phase signal from the two-phase call, so
// creep toward 95% on a schedule and let `aiPlanning` flipping false finish it.
const pct = ref(4)
const done = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const STEPS = ['structure', 'copy', 'design'] as const
/** Which step is active from the current percentage. */
const step = computed(() => (pct.value < 34 ? 0 : pct.value < 82 ? 1 : 2))

function stepState(i: number): 'done' | 'active' | 'wait' {
  if (done.value || step.value > i) return 'done'
  return step.value === i ? 'active' : 'wait'
}

onMounted(() => {
  timer = setInterval(() => {
    if (!aiPlanning.value) {
      pct.value = 100
      done.value = true
      if (timer) clearInterval(timer)
      return
    }
    // ease-out creep, capped at 95
    const target = 95
    pct.value = Math.min(target, pct.value + Math.max(0.4, (target - pct.value) * 0.045))
  }, 220)
})
onBeforeUnmount(() => timer && clearInterval(timer))
</script>

<template>
  <div class="al" role="status" aria-live="polite">
    <div class="al__card">
      <div class="al__head">
        <span class="al__spark"><v-icon icon="mdi-creation" size="18" /></span>
        <strong>{{ t('builder.aiBuilding') }}</strong>
      </div>

      <ol class="al__steps">
        <li v-for="(s, i) in STEPS" :key="s" :class="`is-${stepState(i)}`">
          <span class="al__mark">
            <v-icon v-if="stepState(i) === 'done'" icon="mdi-check" size="13" />
            <v-progress-circular v-else-if="stepState(i) === 'active'" indeterminate size="13" width="2" />
            <span v-else class="al__o" />
          </span>
          {{ t(`builder.aiStage.${s}`) }}
        </li>
      </ol>

      <div class="al__bar"><span :style="{ width: pct + '%' }" /></div>

      <!-- shimmering website skeleton -->
      <div class="al__skel" aria-hidden="true">
        <div class="al__sk-nav">
          <span class="sk sk--dot" /><span class="sk sk--pill" /><span class="sk sk--pill" />
        </div>
        <div class="sk sk--hero" />
        <div class="al__sk-row">
          <span class="sk sk--card" /><span class="sk sk--card" /><span class="sk sk--card" />
        </div>
        <span class="sk sk--line" /><span class="sk sk--line sk--line-sm" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.al {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(8 9 14 / 0.55);
  backdrop-filter: blur(6px);
}
.al__card {
  width: min(460px, 100%);
  padding: 1.4rem 1.4rem 1.6rem;
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--tvz-glass-border);
  box-shadow: var(--tvz-shadow-lg);
}
.al__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.02rem;
}
.al__spark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: #fff;
  background: linear-gradient(120deg, rgb(var(--v-theme-primary)), var(--tvz-ai, #7c5cff));
}
.al__steps {
  list-style: none;
  margin: 1rem 0 0.9rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.al__steps li {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.86rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  transition: color 0.25s ease;
}
.al__steps li.is-active {
  color: rgb(var(--v-theme-on-surface) / 0.95);
  font-weight: 600;
}
.al__steps li.is-done {
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.al__mark {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #fff;
  background: rgb(var(--v-theme-primary) / 0.25);
}
.is-done .al__mark {
  background: rgb(var(--v-theme-primary));
}
.is-active .al__mark {
  background: transparent;
  color: rgb(var(--v-theme-primary));
}
.al__o {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
}
.al__bar {
  height: 6px;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.1);
  overflow: hidden;
}
.al__bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgb(var(--v-theme-primary)), var(--tvz-ai, #7c5cff));
  transition: width 0.3s ease;
}
.al__skel {
  margin-top: 1.1rem;
  padding: 0.9rem;
  border-radius: 12px;
  border: 1px solid var(--tvz-hairline);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.al__sk-nav,
.al__sk-row {
  display: flex;
  gap: 0.5rem;
}
.al__sk-row .sk {
  flex: 1;
}
.sk {
  border-radius: 7px;
  background: rgb(var(--v-theme-on-surface) / 0.14);
  position: relative;
  overflow: hidden;
}
.sk::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--v-theme-primary) / 0.28),
    transparent
  );
  animation: al-sheen 1.4s ease-in-out infinite;
}
.sk--dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
}
.sk--pill {
  width: 54px;
  height: 22px;
}
.sk--hero {
  height: 84px;
}
.sk--card {
  height: 60px;
}
.sk--line {
  height: 12px;
}
.sk--line-sm {
  width: 60%;
}
@keyframes al-sheen {
  to {
    transform: translateX(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk::after {
    animation: none;
  }
  .al__bar span {
    transition: none;
  }
}
</style>
