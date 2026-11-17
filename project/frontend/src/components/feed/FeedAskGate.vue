<script setup lang="ts">
/**
 * The homepage's first screen: one question, one prompt-style input. The
 * visitor's sentence is interpreted server-side (`POST /feed/interpret`, AI
 * with a deterministic fallback) into the Feed's own filters; this component
 * only collects the text and reports the result — `HomeView` applies it to
 * the Feed, which itself stays exactly as it is.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDisplay } from 'vuetify'

import { ApiError } from '@/services/api'
import { interpretAsk, type AskResult } from '@/services/feedAsk'
import { useToastStore } from '@/stores/toast'

const emit = defineEmits<{ resolved: [result: AskResult]; close: [] }>()

const { t, locale } = useI18n()
const { mdAndUp } = useDisplay()
const toasts = useToastStore()

const EXAMPLES = computed(() => [1, 2, 3, 4].map((i) => t(`ask.example${i}`)))
/** Keeps a near-instant answer from flashing the "thinking" state. */
const MIN_THINKING_MS = 450

const text = ref('')
const busy = ref(false)
const input = ref<HTMLTextAreaElement | null>(null)

function grow(): void {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}
watch(text, () => nextTick(grow))

// --- typewriter placeholder, cycling through the example requests ---------
const placeholder = ref('')
let typeTimer: ReturnType<typeof setTimeout> | undefined
function typeLoop(i: number, pos: number, deleting: boolean): void {
  const ex = EXAMPLES.value[i % EXAMPLES.value.length]
  if (!deleting) {
    placeholder.value = ex.slice(0, pos + 1)
    typeTimer =
      pos + 1 < ex.length
        ? setTimeout(() => typeLoop(i, pos + 1, false), 45)
        : setTimeout(() => typeLoop(i, ex.length, true), 1800)
  } else {
    placeholder.value = ex.slice(0, Math.max(0, pos - 1))
    typeTimer =
      pos > 1
        ? setTimeout(() => typeLoop(i, pos - 1, true), 22)
        : setTimeout(() => typeLoop(i + 1, 0, false), 350)
  }
}

onMounted(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (reduced) placeholder.value = EXAMPLES.value[0]
  else typeLoop(0, 0, false)
  // Desktop only — on a phone this would pop the keyboard over the page.
  if (mdAndUp.value) input.value?.focus()
})
onBeforeUnmount(() => clearTimeout(typeTimer))

async function submit(raw = text.value): Promise<void> {
  const query = raw.trim()
  if (query.length < 2 || busy.value) return
  text.value = query
  busy.value = true
  try {
    const [result] = await Promise.all([
      interpretAsk(query, locale.value),
      new Promise((r) => setTimeout(r, MIN_THINKING_MS)),
    ])
    emit('resolved', result)
  } catch (err) {
    // Stay on the gate: the visitor can rephrase, retry, or skip.
    const banned = err instanceof ApiError && err.message.includes('banned_content')
    toasts.error(banned ? t('ask.banned') : t('ask.error'))
  } finally {
    busy.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void submit()
  }
}
</script>

<template>
  <section class="ask" :aria-busy="busy">
    <div class="ask__in">
      <p class="ask__eyebrow">
        <v-icon icon="mdi-creation" size="14" /> {{ t('ask.eyebrow') }}
      </p>
      <h1 class="ask__title">{{ t('ask.title') }}</h1>
      <p class="ask__lead">{{ t('ask.lead') }}</p>

      <form class="ask__box" :class="{ 'is-busy': busy }" @submit.prevent="submit()">
        <label for="ask-input" class="d-sr-only">{{ t('ask.inputLabel') }}</label>
        <textarea
          id="ask-input"
          ref="input"
          v-model="text"
          rows="1"
          maxlength="300"
          :placeholder="placeholder"
          :disabled="busy"
          @keydown="onKey"
        />
        <v-btn
          type="submit"
          class="ask__send"
          icon="mdi-arrow-up"
          :loading="busy"
          :disabled="busy || text.trim().length < 2"
          :aria-label="t('ask.send')"
        />
      </form>

      <p class="ask__status" aria-live="polite">
        <template v-if="busy">
          <span class="ask__dots" aria-hidden="true"><i /><i /><i /></span>
          {{ t('ask.thinking') }}
        </template>
        <template v-else>{{ t('ask.hint') }}</template>
      </p>

      <div class="ask__try">
        <span>{{ t('ask.tryLabel') }}</span>
        <button
          v-for="ex in EXAMPLES"
          :key="ex"
          type="button"
          class="ask__chip"
          :disabled="busy"
          @click="submit(ex)"
        >
          {{ ex }}
        </button>
      </div>

      <button type="button" class="ask__skip" :disabled="busy" @click="emit('close')">
        {{ t('ask.skip') }}
        <v-icon icon="mdi-arrow-right" size="16" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.ask {
  min-height: calc(100dvh - var(--tvz-topbar-h) - 2px);
  display: grid;
  place-items: center;
  padding: clamp(1.5rem, 5vw, 3rem) 16px;
  animation: ask-in 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes ask-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}
.ask__in {
  width: min(720px, 100%);
  text-align: center;
}

.ask__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 1.1rem;
  padding: 0.32rem 0.8rem;
  border-radius: 0;
  clip-path: var(--tvz-hex-sm);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tvz-ai);
  background: var(--tvz-ai-soft);
}
.ask__title {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.9rem, 5.2vw, 3.1rem);
  line-height: 1.08;
  letter-spacing: -0.03em;
}
.ask__lead {
  margin: 0.9rem auto 0;
  max-width: 52ch;
  font-size: clamp(0.95rem, 2vw, 1.05rem);
  line-height: 1.55;
  color: rgba(var(--v-theme-on-surface), 0.68);
}

/* ---- prompt box ---- */
.ask__box {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
  margin-top: 2rem;
  padding: 0.6rem 0.6rem 0.6rem 1.15rem;
  text-align: left;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: var(--tvz-glass-bg);
  backdrop-filter: blur(var(--tvz-glass-blur));
  box-shadow: var(--tvz-shadow-lg);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}
.ask__box:focus-within {
  border-color: rgba(var(--v-theme-primary), 0.55);
  box-shadow:
    0 0 0 4px rgba(var(--v-theme-primary), 0.12),
    var(--tvz-shadow-lg);
}
.ask__box.is-busy {
  border-color: rgba(var(--v-theme-primary), 0.6);
  animation: ask-glow 1.3s ease-in-out infinite alternate;
}
@keyframes ask-glow {
  from {
    box-shadow:
      0 0 0 0 rgba(var(--v-theme-primary), 0),
      var(--tvz-shadow-lg);
  }
  to {
    box-shadow:
      0 0 0 6px rgba(var(--v-theme-primary), 0.14),
      0 12px 44px rgba(var(--v-theme-primary), 0.28);
  }
}
.ask__box textarea {
  flex: 1;
  min-width: 0;
  max-height: 160px;
  padding: 0.55rem 0;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 1.05rem;
  line-height: 1.5;
}
.ask__box textarea::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ask__send {
  flex: none;
  color: #fff !important;
  background: var(--tvz-gradient-brand) !important;
}
.ask__send.v-btn--disabled {
  opacity: 0.45;
}

.ask__status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 1.4em;
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ask__dots {
  display: inline-flex;
  gap: 3px;
}
.ask__dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  animation: ask-dot 1s ease-in-out infinite;
}
.ask__dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.ask__dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes ask-dot {
  50% {
    transform: translateY(-3px);
    opacity: 0.4;
  }
}

/* ---- examples + skip ---- */
.ask__try {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1.6rem;
}
.ask__try > span {
  margin-right: 0.15rem;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ask__chip {
  padding: 0.45rem 0.95rem;
  border-radius: 0;
  clip-path: var(--tvz-hex-sm);
  font-size: 0.84rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
  background: rgba(var(--v-theme-on-surface), 0.06);
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.ask__chip:hover:not(:disabled) {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.ask__chip:disabled {
  opacity: 0.5;
}
.ask__skip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 2.2rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.ask__skip .v-icon {
  transition: transform 0.15s ease;
}
.ask__skip:hover .v-icon {
  transform: translateX(3px);
}
.ask__skip:disabled {
  opacity: 0.5;
}

@media (max-width: 900px) {
  .ask {
    min-height: calc(
      100dvh - var(--tvz-topbar-h) - var(--tvz-tabbar-h) - env(safe-area-inset-bottom, 0px) - 18px
    );
    align-content: start;
    padding-top: 2.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ask,
  .ask__box.is-busy,
  .ask__dots i {
    animation: none;
  }
}
</style>
