<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useBuilderStore } from '@/stores/builder'
import type { ClarifyQuestion } from '@/stores/builder'

const props = defineProps<{ companyId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const store = useBuilderStore()
const { working, view } = storeToRefs(store)

const brief = ref('')
const confirmed = ref(false)

// Pre-generation clarification — only on a FRESH build (never "improve" or the
// "another variant" reroll, which stay instant). The popup stays open and
// swaps the form for a short round of question cards before handing off to
// the AiLoader, same as a plain brief always has.
const phase = ref<'brief' | 'thinking' | 'clarify'>('brief')
const questions = ref<ClarifyQuestion[]>([])
const questionIndex = ref(0)
const roundAnswers = ref<Record<string, string>>({})
const textAnswer = ref('')
const currentQuestion = computed<ClarifyQuestion | null>(() => questions.value[questionIndex.value] ?? null)

// "Thinking" is a staged, animated stand-in for the one real network wait
// each clarify round has — there's no per-phase signal from the backend (a
// single request/response), so — same philosophy as `AiLoader.vue`'s fake
// progress bar for the full generation — we cycle through a few short,
// honest status lines on a timer rather than leaving a bare spinner up.
// Never advances past the last line before the real response lands.
const thinkingSteps = ref<string[]>([])
const thinkingStep = ref(0)
let thinkingTimer: ReturnType<typeof setInterval> | undefined
const THINKING_INITIAL = ['builder.aiThink.received', 'builder.aiThink.analyzing', 'builder.aiThink.preparing']
const THINKING_ANSWER = ['builder.aiThink.noted', 'builder.aiThink.checking']

function startThinking(steps: string[]): void {
  thinkingSteps.value = steps
  thinkingStep.value = 0
  phase.value = 'thinking'
  clearInterval(thinkingTimer)
  thinkingTimer = setInterval(() => {
    if (thinkingStep.value < steps.length - 1) thinkingStep.value += 1
  }, 1100)
}
function stopThinking(): void {
  clearInterval(thinkingTimer)
  thinkingTimer = undefined
}

// AI is metered per site (manual editing stays unlimited).
const planLeft = computed(() => view.value?.aiLimits?.planLeft ?? null)
const planLimit = computed(() => view.value?.aiLimits?.plan ?? 6)
const outOfQuota = computed(() => planLeft.value !== null && planLeft.value <= 0)

// A site that's already been generated once: a follow-up brief should refine
// the existing site, not bulldoze it. Offer the choice; default to "improve".
const planCount = computed(() => view.value?.doc?.ai?.planCount ?? 0)
const canImprove = computed(() => planCount.value > 0)
const mode = ref<'improve' | 'replace'>('improve')

// The brief that produced the current site — lets "another variant" work even
// when the user hasn't retyped anything.
const lastBrief = computed(() => (view.value?.doc?.ai?.brief ?? '').trim())
const canRegen = computed(
  () =>
    canImprove.value &&
    !outOfQuota.value &&
    (brief.value.trim().length >= 4 || lastBrief.value.length >= 4),
)

function launchGeneration(): void {
  const b = brief.value.trim()
  // Fire and close — the full-screen AiLoader takes over and any error
  // surfaces in the builder view once it resolves.
  void store.aiPlan(props.companyId, b, canImprove.value ? mode.value : undefined)
  emit('close')
}

async function generate(): Promise<void> {
  const b = brief.value.trim()
  if (b.length < 4 || working.value || outOfQuota.value) return
  // Clarification only applies to a genuinely FRESH build — an "improve" edit
  // is a surgical follow-up instruction, not a from-scratch brief.
  if (canImprove.value && mode.value === 'improve') {
    launchGeneration()
    return
  }
  startThinking(THINKING_INITIAL)
  const res = await store.aiClarifyStart(props.companyId, b)
  stopThinking()
  if (res.done) {
    launchGeneration()
    return
  }
  questions.value = res.questions
  questionIndex.value = 0
  roundAnswers.value = {}
  textAnswer.value = ''
  phase.value = 'clarify'
}

async function answerCurrent(value: string): Promise<void> {
  const q = currentQuestion.value
  if (!q || !value.trim() || working.value) return
  roundAnswers.value[q.id] = value.trim()
  textAnswer.value = ''
  if (questionIndex.value < questions.value.length - 1) {
    questionIndex.value += 1
    return
  }
  // Round complete — send the batch, then either show the next round or generate.
  const answers = Object.entries(roundAnswers.value).map(([questionId, val]) => ({
    questionId,
    value: val,
  }))
  startThinking(THINKING_ANSWER)
  const res = await store.aiClarifyAnswer(props.companyId, answers)
  stopThinking()
  if (res.done) {
    launchGeneration()
    return
  }
  questions.value = res.questions
  questionIndex.value = 0
  roundAnswers.value = {}
  phase.value = 'clarify'
}

function backToBrief(): void {
  stopThinking()
  phase.value = 'brief'
  questions.value = []
  questionIndex.value = 0
  roundAnswers.value = {}
  textAnswer.value = ''
}

onBeforeUnmount(stopThinking)

// Rebuild from the same brief with a fresh random seed — same business, a
// genuinely different layout / design direction. Always a full replace.
function regenVariant(): void {
  if (!canRegen.value || working.value) return
  const b = brief.value.trim().length >= 4 ? brief.value.trim() : lastBrief.value
  const seed = Math.floor(Math.random() * 2_147_483_647)
  void store.aiPlan(props.companyId, b, 'replace', seed)
  emit('close')
}
</script>

<template>
  <div class="ab" role="dialog" aria-modal="true" @click.self="emit('close')">
    <div class="ab__panel">
      <header class="ab__head">
        <strong><v-icon icon="mdi-creation" size="18" /> {{ t('builder.aiTitle') }}</strong>
        <button type="button" class="ab__x" @click="emit('close')">
          <v-icon icon="mdi-close" size="20" />
        </button>
      </header>

      <Transition name="ab-phase" mode="out-in">
      <div v-if="phase === 'brief'" key="brief" class="ab__body">
        <p class="ab__lead">{{ t('builder.aiLead') }}</p>

        <div v-if="canImprove" class="ab__mode">
          <button
            type="button"
            :class="{ 'is-on': mode === 'improve' }"
            @click="mode = 'improve'"
          >
            <v-icon icon="mdi-auto-fix" size="15" />
            <span>
              <strong>{{ t('builder.aiModeImprove') }}</strong>
              <em>{{ t('builder.aiModeImproveHint') }}</em>
            </span>
          </button>
          <button
            type="button"
            :class="{ 'is-on': mode === 'replace' }"
            @click="mode = 'replace'"
          >
            <v-icon icon="mdi-refresh" size="15" />
            <span>
              <strong>{{ t('builder.aiModeReplace') }}</strong>
              <em>{{ t('builder.aiModeReplaceHint') }}</em>
            </span>
          </button>
        </div>

        <textarea
          v-model="brief"
          class="ab__ta"
          rows="6"
          :placeholder="canImprove && mode === 'improve' ? t('builder.aiPlaceholderImprove') : t('builder.aiPlaceholder')"
          maxlength="2000"
        />
        <p v-if="view && !view.aiConfigured" class="ab__note">
          <v-icon icon="mdi-information-outline" size="14" /> {{ t('builder.aiNoKey') }}
        </p>
        <p v-if="planLeft !== null" class="ab__note" :class="{ 'ab__note--warn': outOfQuota }">
          <v-icon icon="mdi-creation" size="14" />
          {{
            outOfQuota
              ? t('builder.aiQuotaOut')
              : t('builder.aiQuota', { left: planLeft, limit: planLimit })
          }}
        </p>
        <label class="ab__chk">
          <input v-model="confirmed" type="checkbox" />
          {{ t('builder.aiConfirm') }}
        </label>

        <button
          v-if="canImprove"
          type="button"
          class="ab__regen"
          :disabled="!canRegen || working"
          @click="regenVariant"
        >
          <v-icon icon="mdi-dice-multiple" size="15" />
          <span>
            <strong>{{ t('builder.regenVariant') }}</strong>
            <em>{{ t('builder.regenVariantHint') }}</em>
          </span>
        </button>
      </div>

      <div v-else-if="phase === 'thinking'" key="thinking" class="ab__body ab__thinking">
        <div class="ab__think-orb">
          <v-icon icon="mdi-creation" size="26" />
        </div>
        <Transition name="ab-think-text" mode="out-in">
          <p :key="thinkingStep" class="ab__think-text">{{ t(thinkingSteps[thinkingStep]) }}</p>
        </Transition>
        <div class="ab__think-dots"><span /><span /><span /></div>
      </div>

      <div v-else key="clarify" class="ab__body ab__clarify">
        <p class="ab__lead">
          {{ t('builder.aiClarifyLead') }}
          <span v-if="questions.length > 1" class="ab__step">
            {{ t('builder.aiClarifyStep', { n: questionIndex + 1, total: questions.length }) }}
          </span>
        </p>

        <template v-if="currentQuestion">
          <p class="ab__q">{{ currentQuestion.prompt }}</p>

          <div v-if="currentQuestion.kind === 'choice'" class="ab__opts">
            <button
              v-for="opt in currentQuestion.options"
              :key="opt.id"
              type="button"
              class="ab__opt"
              :disabled="working"
              @click="answerCurrent(opt.label)"
            >
              {{ opt.label }}
            </button>
          </div>

          <div v-else class="ab__textq">
            <input
              v-model="textAnswer"
              type="text"
              class="ab__qinput"
              maxlength="300"
              :placeholder="t('builder.aiClarifyTextPlaceholder')"
              @keydown.enter="answerCurrent(textAnswer)"
            />
          </div>
        </template>
      </div>
      </Transition>

      <footer v-if="phase !== 'thinking'" class="ab__foot">
        <button
          v-if="phase === 'brief'"
          type="button"
          class="ab__cancel"
          @click="emit('close')"
        >{{ t('builder.cancel') }}</button>
        <button v-else type="button" class="ab__cancel" @click="backToBrief">
          {{ t('builder.back') }}
        </button>
        <button
          v-if="phase === 'brief'"
          type="button"
          class="ab__go"
          :disabled="!confirmed || brief.trim().length < 4 || working || outOfQuota"
          @click="generate"
        >
          <v-icon icon="mdi-creation" size="15" /> {{ t('builder.aiGo') }}
        </button>
        <button
          v-else-if="currentQuestion?.kind === 'text'"
          type="button"
          class="ab__go"
          :disabled="!textAnswer.trim() || working"
          @click="answerCurrent(textAnswer)"
        >
          {{ t('builder.aiClarifyNext') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ab {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 0.45);
}
.ab__panel {
  width: min(560px, 100%);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--tvz-glass-border);
  box-shadow: var(--tvz-shadow-lg);
  overflow: hidden;
}
.ab__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.ab__head strong {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'Space Grotesk Variable', sans-serif;
}
.ab__x {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ab__body {
  padding: 1rem 1.1rem;
}
.ab__lead {
  margin: 0 0 0.6rem;
  font-size: 0.86rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ab__ta {
  width: 100%;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-background));
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.5;
  resize: vertical;
}
.ab__ta:focus {
  outline: 2px solid rgba(var(--v-theme-primary), 0.4);
  outline-offset: 1px;
}
.ab__mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}
.ab__mode button {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  padding: 0.6rem 0.7rem;
  border-radius: 10px;
  text-align: left;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ab__mode button.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgb(var(--v-theme-primary));
}
.ab__mode button .v-icon {
  margin-top: 0.1rem;
  flex: none;
}
.ab__mode button span {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.ab__mode button strong {
  font-size: 0.8rem;
}
.ab__mode button em {
  font-style: normal;
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ab__mode button.is-on em {
  color: rgba(var(--v-theme-primary), 0.75);
}
.ab__note {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ab__note--warn {
  color: rgb(var(--v-theme-warning, 217 119 6));
  font-weight: 600;
}
.ab__chk {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 0.9rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.ab__regen {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  width: 100%;
  margin-top: 0.9rem;
  padding: 0.6rem 0.7rem;
  border-radius: 10px;
  text-align: left;
  border: 1px dashed var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.ab__regen:hover:not(:disabled) {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
.ab__regen:disabled {
  opacity: 0.45;
}
.ab__regen .v-icon {
  margin-top: 0.1rem;
  flex: none;
}
.ab__regen span {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.ab__regen strong {
  font-size: 0.8rem;
}
.ab__regen em {
  font-style: normal;
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ab__foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.8rem 1.1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ab__cancel {
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ab__go {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 1rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 700;
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.ab__go:disabled {
  opacity: 0.5;
}
.ab__step {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.ab__q {
  margin: 0.8rem 0 0.9rem;
  font-size: 1rem;
  font-weight: 600;
}
.ab__opts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.ab__opt {
  padding: 0.65rem 0.8rem;
  border-radius: 10px;
  text-align: left;
  font-size: 0.85rem;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ab__opt:hover:not(:disabled) {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
.ab__opt:disabled {
  opacity: 0.5;
}
.ab__qinput {
  width: 100%;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-background));
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
}
.ab__qinput:focus {
  outline: 2px solid rgba(var(--v-theme-primary), 0.4);
  outline-offset: 1px;
}

/* Crossfade between brief / thinking / clarify — the "the AI just received
   this and is starting" moment the transition into `thinking` is meant to sell. */
.ab-phase-enter-active,
.ab-phase-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.ab-phase-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.ab-phase-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.ab__thinking {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
  padding: 2.6rem 1.5rem 2.8rem;
  text-align: center;
  min-height: 200px;
}
.ab__think-orb {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--v-theme-primary), 0.2), rgba(var(--v-theme-primary), 0.04));
  color: rgb(var(--v-theme-primary));
  animation: ab-pulse 1.7s ease-in-out infinite;
}
@keyframes ab-pulse {
  0%,
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0.22);
  }
  50% {
    transform: scale(1.08);
    box-shadow: 0 0 0 12px rgba(var(--v-theme-primary), 0);
  }
}
.ab__think-text {
  margin: 0;
  min-height: 1.3em;
  font-size: 0.92rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.ab-think-text-enter-active,
.ab-think-text-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.ab-think-text-enter-from {
  opacity: 0;
  transform: translateY(5px);
}
.ab-think-text-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}
.ab__think-dots {
  display: flex;
  gap: 0.32rem;
}
.ab__think-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.45);
  animation: ab-dot 1.2s ease-in-out infinite;
}
.ab__think-dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.ab__think-dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes ab-dot {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ab__think-orb,
  .ab__think-dots span {
    animation: none;
  }
  .ab-phase-enter-active,
  .ab-phase-leave-active,
  .ab-think-text-enter-active,
  .ab-think-text-leave-active {
    transition: none;
  }
}
</style>
