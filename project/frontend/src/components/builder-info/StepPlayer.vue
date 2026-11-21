<script setup lang="ts">
/**
 * The step-by-step demo player shared by the builder guides and the
 * homepage sections: a rail of steps (title + description of the active
 * one, with a progress bar) next to an animated demo, rendered by the
 * `demo` slot for the current step. Autoplays only while on screen, pauses
 * on hover/focus, stops on a manual pick, and honours reduced motion.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ steps: { t: string; d: string }[]; label?: string }>()
defineSlots<{ demo(props: { step: number }): unknown }>()
const { t } = useI18n()

const reduced =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const step = ref(0)
const playing = ref(!reduced)
const hovering = ref(false)
const visible = ref(false)
const STEP_MS = 5200
let timer: ReturnType<typeof setInterval> | undefined
function tick(): void {
  if (!playing.value || hovering.value || !visible.value || !props.steps.length) return
  step.value = (step.value + 1) % props.steps.length
}
function pick(i: number): void {
  step.value = i
  playing.value = false
}
const root = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null
onMounted(() => {
  timer = setInterval(tick, STEP_MS)
  if (typeof IntersectionObserver !== 'undefined' && root.value) {
    io = new IntersectionObserver(([e]) => (visible.value = !!e?.isIntersecting), { threshold: 0.25 })
    io.observe(root.value)
  } else visible.value = true
})
onBeforeUnmount(() => {
  clearInterval(timer)
  io?.disconnect()
})
const progressKey = computed(() => `${step.value}:${playing.value && !hovering.value}`)

// On phones the rail is a horizontal strip: keep the active step in view
// (scrolling the strip only, never the page).
const rail = ref<HTMLElement | null>(null)
watch(step, (i) => {
  const el = rail.value
  const item = el?.children[i] as HTMLElement | undefined
  if (!el || !item || el.scrollWidth <= el.clientWidth) return
  el.scrollTo({ left: item.offsetLeft - el.offsetLeft, behavior: reduced ? 'auto' : 'smooth' })
})
</script>

<template>
  <div
    ref="root"
    class="sp"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
    @focusin="hovering = true"
    @focusout="hovering = false"
  >
    <ol ref="rail" class="rail" role="tablist">
      <li v-for="(s, i) in steps" :key="i">
        <button
          type="button"
          role="tab"
          class="rail__step"
          :class="{ 'is-on': i === step, 'is-done': i < step }"
          :aria-selected="i === step"
          @click="pick(i)"
        >
          <span class="rail__num">{{ i + 1 }}</span>
          <span class="rail__txt">
            <b>{{ s.t }}</b>
            <span class="rail__d">{{ s.d }}</span>
          </span>
          <span v-if="i === step" :key="progressKey" class="rail__bar" :class="{ 'is-run': playing && !hovering }" />
        </button>
      </li>
    </ol>
    <div class="sp__demo" :aria-label="label ?? t('binfo.common.demoLabel')">
      <slot name="demo" :step="step" />
      <button
        type="button"
        class="sp__play"
        :aria-label="playing ? t('binfo.common.pause') : t('binfo.common.play')"
        @click="playing = !playing"
      >
        <v-icon :icon="playing ? 'mdi-pause' : 'mdi-play'" size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.sp {
  display: grid;
  grid-template-columns: minmax(250px, 340px) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}
.rail {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.rail__step {
  position: relative;
  overflow: hidden;
  width: 100%;
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
  text-align: left;
  padding: 0.8rem 0.9rem;
  border-radius: 14px;
  border: 1px solid transparent;
  color: inherit;
  transition:
    background 0.25s,
    border-color 0.25s;
}
.rail__step:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.rail__step.is-on {
  background: var(--tvz-glass-bg);
  border-color: rgba(var(--v-theme-primary), 0.4);
  box-shadow: var(--tvz-shadow-sm);
}
.rail__num {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-weight: 700;
  font-size: 0.85rem;
  background: rgba(var(--v-theme-on-surface), 0.08);
  transition:
    background 0.25s,
    color 0.25s;
}
.rail__step.is-on .rail__num,
.rail__step.is-done .rail__num {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.rail__txt {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.rail__txt b {
  font-size: 0.95rem;
}
.rail__d {
  display: none;
  font-size: 0.83rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.68);
}
.rail__step.is-on .rail__d {
  display: block;
  animation: spUp 0.35s ease both;
}
.rail__bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: 100%;
  transform-origin: left;
  transform: scaleX(0);
  background: rgb(var(--v-theme-primary));
}
.rail__bar.is-run {
  animation: spFill 5.2s linear forwards;
}
@keyframes spFill {
  to {
    transform: scaleX(1);
  }
}
@keyframes spUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.sp__demo {
  position: relative;
  min-width: 0;
}
.sp__play {
  position: absolute;
  top: 0.55rem;
  right: 0.6rem;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(15, 18, 32, 0.7);
  color: #fff;
}
@media (max-width: 860px) {
  .sp {
    grid-template-columns: 1fr;
  }
  .rail {
    flex-direction: row;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-bottom: 0.3rem;
  }
  .rail li {
    flex: 0 0 78%;
    scroll-snap-align: start;
  }
  .rail__step {
    height: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rail__bar.is-run,
  .rail__step.is-on .rail__d {
    animation: none;
  }
}
</style>
