<script setup lang="ts">
/**
 * Site Simplu's CREATION flow — "Preview + Chat". A short conversational
 * intake (intro → services → optional photos → contact) ends with the AI
 * writing the rest of the site in one shot (about / why-us / how-we-work /
 * FAQ / CTA — never fabricated stats or testimonials, see the backend's own
 * comment on `generateEasySite`), landing on a terminal state where any
 * further change happens by asking in chat, not by filling a settings form.
 *
 * Deliberately a SEPARATE component from `EasyStudioAgent.vue`, not a mode
 * flag on it: that component is the claimed-site editor's full manual form
 * (used `standalone`, always reporting `step: 'done'`) and must keep working
 * exactly as it does today — this one only ever drives a fresh, anonymous
 * draft via `useWebsiteDraftStore`.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useWebsiteDraftStore } from '@/stores/websiteDraft'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import type { DraftIssue, DraftTurn } from '@/stores/websiteDraft'

const { t } = useI18n()
const store = useWebsiteDraftStore()
const { draft, sending, error } = storeToRefs(store)
const confirm = useConfirmStore()
const toasts = useToastStore()

type CreationStep = 'intro' | 'services' | 'photos' | 'contact' | 'done'
const STEPS: CreationStep[] = ['intro', 'services', 'photos', 'contact']
const TEMPLATES = ['classic', 'bold', 'minimal', 'warm', 'sharp', 'editorial'] as const
const PRESETS = ['#4f46e5', '#0ea5e9', '#059669', '#d97706', '#e11d48', '#7c3aed', '#0f172a']
/** Mirrors the backend's own decoded-byte cap (`MAX_ASSET_BYTES`). */
const MAX_UPLOAD = 4_500_000
const MAX_PORTFOLIO = 10

const step = computed<CreationStep>(() => (draft.value?.step ?? 'intro') as CreationStep)
const easy = computed(() => draft.value?.easy ?? null)
const stepIndex = computed(() => Math.max(0, STEPS.indexOf(step.value)))
const progressPct = computed(() =>
  step.value === 'done' ? '100%' : `${(stepIndex.value / STEPS.length) * 100}%`,
)
const transcript = computed(() => draft.value?.transcript ?? [])
const stepLabel = computed(() => t(`studio.step.${step.value}`))

const errorText = computed(() => {
  if (error.value === 'banned_content') return t('studio.bannedContent')
  if (error.value === 'rate_limited') return t('studio.rateLimited')
  if (error.value === 'unreachable') return t('studio.connectionError')
  return t('studio.loadError')
})
watch(error, (v) => {
  if (v) toasts.error(errorText.value)
})

function turnText(turn: DraftTurn): string {
  if (turn.role === 'user') return turn.text ?? ''
  // A chat-edit reply at the `done` step is the AI's own free-form text, not
  // an i18n key — the one deliberate exception, see the backend's comment.
  if (turn.text) return turn.text
  return turn.key ? t(`studio.msg.${turn.key}`) : ''
}
function showAv(i: number): boolean {
  const turn = transcript.value[i]
  return turn?.role === 'assistant' && transcript.value[i - 1]?.role !== 'assistant'
}

// --- auto-scroll the transcript on new turns --------------------------
const log = ref<HTMLElement | null>(null)
watch(
  () => [transcript.value.length, sending.value] as const,
  async () => {
    await nextTick()
    if (log.value) log.value.scrollTop = log.value.scrollHeight
  },
)

// --- chat input ---------------------------------------------------------
const chatDraft = ref('')
const chatPlaceholder = computed(() => {
  const k = `studio.ph.${step.value}`
  const s = t(k)
  return s === k ? t('studio.inputPlaceholder') : s
})
function sendChat(): void {
  const text = chatDraft.value.trim()
  if (!text || sending.value) return
  void store.send(text)
  chatDraft.value = ''
}
function onChatKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChat()
  }
}
function skipPhotos(): void {
  if (sending.value) return
  void store.advanceEasy(t('studio.noteSkipPhotos'))
}
/** Once a real services list exists, let the visitor move on without typing
 *  more — same "Continue" widget the old flow had for this step. A real
 *  `user` chat bubble (the actual service list, not a canned line) must
 *  still appear — advancing by button is still answering the question. */
function continueFromServices(): void {
  if (sending.value) return
  const names = easy.value?.services?.map((s) => s.name) ?? []
  void store.advanceEasy(names.join(', '))
}

// --- customize (template + colour) — a quick override, never a blocking
// step; AI already picked sane defaults by the time this is reachable. ---
const showCustomize = ref(false)
const template = computed(() => easy.value?.template ?? 'classic')
function pickTemplate(k: (typeof TEMPLATES)[number]): void {
  void store.patchEasy({ template: k })
}
const color = ref(easy.value?.accentColor || PRESETS[0])
watch(
  () => easy.value?.accentColor,
  (v) => {
    if (v) color.value = v
  },
)
let colorTimer: ReturnType<typeof setTimeout> | undefined
function pickColor(hex: string): void {
  const prev = easy.value?.accentColor || PRESETS[0]
  color.value = hex
  clearTimeout(colorTimer)
  colorTimer = setTimeout(async () => {
    const ok = await store.patchEasy({ accentColor: hex })
    if (!ok && color.value === hex) color.value = prev
  }, 110)
}

// --- photo upload (optional, at the `photos` step and any time after) ---
const uploading = ref(false)
const uploadErr = ref('')
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read'))
    r.readAsDataURL(file)
  })
}
async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadErr.value = ''
  if (!file.type.startsWith('image/')) return
  if (file.size > MAX_UPLOAD) {
    uploadErr.value = t('studio.uploadTooLarge')
    return
  }
  uploading.value = true
  try {
    const dataUri = await readFile(file)
    const url = await store.uploadAsset('portfolio', dataUri)
    if (!url) {
      uploadErr.value = t('studio.uploadFailed')
      return
    }
    // The first photo doubles as the landing background until the owner
    // uploads more / changes it later; every photo also joins the portfolio.
    if (!easy.value?.landingImage) await store.patchEasy({ landingImage: url })
    const next = [...(easy.value?.portfolio ?? []), url].slice(0, MAX_PORTFOLIO)
    await store.patchEasy({ portfolio: next })
    if (step.value === 'photos') void store.advanceEasy(t('studio.notePhotoAdded'))
  } catch {
    uploadErr.value = t('studio.uploadFailed')
  } finally {
    uploading.value = false
  }
}
function removePortfolio(i: number): void {
  void store.patchEasy({ portfolio: (easy.value?.portfolio ?? []).filter((_, idx) => idx !== i) })
}

// --- end-of-setup AI text review — now unconditional, no manual trigger.
// The backend runs it automatically right as the full site is generated
// (the `contact` → `done` transition) and reports any findings on that one
// response as `draft.reviewIssues`; just mirror it into local state so it
// renders once and doesn't reappear on every unrelated re-render.
const reviewIssues = ref<DraftIssue[] | null>(null)
watch(
  () => draft.value?.reviewIssues,
  (v) => {
    if (v) reviewIssues.value = v
  },
)

// --- restart (destructive) ----------------------------------------------
const restarting = computed(() => store.restarting)
function askRestart(): void {
  if (restarting.value) return
  confirm.ask(
    t('studio.restartConfirmTitle'),
    t('studio.restartConfirmText'),
    async () => {
      const ok = await store.restart()
      if (!ok) toasts.error(errorText.value)
    },
    { confirmLabel: t('studio.restart') },
  )
}
</script>

<template>
  <div class="ag">
    <header class="ag__head">
      <span class="ag__chip">
        <template v-if="step !== 'done'">
          {{ t('studio.stepOf', { n: stepIndex + 1, total: STEPS.length }) }} · {{ stepLabel }}
        </template>
        <template v-else>{{ t('studio.doneTitle') }}</template>
      </span>
      <div class="ag__bar"><span :style="{ width: progressPct }" /></div>
      <span v-if="sending" class="ag__status">
        <v-icon icon="mdi-pencil-outline" size="13" /> {{ t('studio.thinking') }}
      </span>
    </header>

    <div ref="log" class="ag__scroll">
      <div class="ag__log">
        <div
          v-for="(turn, i) in transcript"
          :key="i"
          class="msg"
          :class="[turn.role === 'user' ? 'msg--u' : 'msg--a', i === transcript.length - 1 ? 'msg--new' : '']"
        >
          <span v-if="showAv(i)" class="msg__av">{{ t('studio.agentPersona').charAt(0) }}</span>
          <span v-else-if="turn.role === 'assistant'" class="msg__av msg__av--ghost" />
          <p>{{ turnText(turn) }}</p>
        </div>
        <div v-if="sending" class="msg msg--a msg--typing" aria-hidden="true">
          <span class="msg__av">{{ t('studio.agentPersona').charAt(0) }}</span>
          <p class="dots"><span /><span /><span /></p>
        </div>
      </div>

      <!-- photo upload: available at the `photos` step, and any time after -->
      <div v-if="step === 'photos' || (easy?.portfolio?.length ?? 0) > 0" class="photos">
        <div class="photos__grid">
          <div v-for="(url, i) in easy?.portfolio ?? []" :key="url" class="ph">
            <img :src="url" alt="" />
            <button class="ph__del" type="button" @click="removePortfolio(i)">
              <v-icon icon="mdi-close" size="13" />
            </button>
          </div>
          <label v-if="(easy?.portfolio?.length ?? 0) < MAX_PORTFOLIO" class="ph ph--add">
            <v-progress-circular v-if="uploading" indeterminate size="18" width="2" />
            <v-icon v-else icon="mdi-plus" size="20" />
            <input type="file" accept="image/*" :disabled="uploading" @change="onFile" />
          </label>
        </div>
        <p v-if="uploadErr" class="uerr">{{ uploadErr }}</p>
      </div>
    </div>

    <div class="ag__foot">
      <div v-if="step === 'done'" class="customizeRow">
        <button type="button" class="customizeToggle" @click="showCustomize = !showCustomize">
          <v-icon icon="mdi-palette-outline" size="14" /> {{ t('studio.customize') }}
        </button>
      </div>
      <div v-if="showCustomize" class="customize">
        <p class="tl">{{ t('studio.templateTitle') }}</p>
        <div class="tpls">
          <button
            v-for="k in TEMPLATES"
            :key="k"
            class="tpl"
            :class="{ 'is-on': template === k }"
            type="button"
            @click="pickTemplate(k)"
          >
            {{ t(`studio.template.${k}`) }}
          </button>
        </div>
        <p class="tl">{{ t('studio.colorTitle') }}</p>
        <div class="sws">
          <button
            v-for="c in PRESETS"
            :key="c"
            class="sw"
            :class="{ 'is-on': color.toLowerCase() === c.toLowerCase() }"
            :style="{ '--sw': c }"
            type="button"
            :aria-label="c"
            @click="pickColor(c)"
          />
          <label class="sw sw--c" :style="{ '--sw': color }">
            <v-icon icon="mdi-eyedropper-variant" size="16" />
            <input type="color" :value="color" @input="pickColor(($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </div>

      <!-- Text verification is unconditional now — no button, no manual
           trigger. The backend always runs it right as the site is
           generated; this just shows the result if there was one. -->
      <div v-if="reviewIssues" class="review">
        <p v-if="!reviewIssues.length" class="rev__ok">
          <v-icon icon="mdi-check-circle-outline" size="14" /> {{ t('studio.reviewClean') }}
        </p>
        <ul v-else class="rev__list">
          <li v-for="(iss, i) in reviewIssues" :key="i" class="rev__i" :class="`rev__i--${iss.kind}`">
            <strong>{{ t('studio.reviewKind.' + iss.kind) }}</strong>
            <span class="rev__f">{{ iss.label }}</span>
            <span class="rev__m">{{ iss.message }}</span>
          </li>
        </ul>
      </div>

      <div v-if="step === 'done'" class="done">
        <v-btn color="primary" size="small" append-icon="mdi-arrow-right" :to="{ name: 'create-location' }">
          {{ t('studio.continueLocation') }}
        </v-btn>
        <button class="restart" type="button" :disabled="restarting" @click="askRestart">
          <v-progress-circular v-if="restarting" indeterminate size="13" width="2" />
          <v-icon v-else icon="mdi-restart" size="14" />
          {{ t('studio.restart') }}
        </button>
      </div>

      <div v-if="step === 'photos'" class="skiprow">
        <button type="button" class="skip" :disabled="sending" @click="skipPhotos">
          <v-icon icon="mdi-skip-next-outline" size="14" /> {{ t('studio.skip') }}
        </button>
      </div>

      <div v-if="step === 'services' && (easy?.services?.length ?? 0) > 0" class="skiprow">
        <button type="button" class="skip" :disabled="sending" @click="continueFromServices">
          <v-icon icon="mdi-arrow-right" size="14" /> {{ t('studio.continue') }}
        </button>
      </div>

      <form class="inp" @submit.prevent="sendChat">
        <textarea
          v-model="chatDraft"
          rows="1"
          :placeholder="chatPlaceholder"
          :disabled="sending"
          @keydown="onChatKey"
        />
        <v-btn
          type="submit"
          icon="mdi-send"
          size="small"
          color="primary"
          :loading="sending"
          :disabled="sending || !chatDraft.trim()"
          :aria-label="t('studio.send')"
        />
      </form>
    </div>
  </div>
</template>

<style scoped>
.ag {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

/* ---- slim step header (replaces the old AI-avatar side panel) ---- */
.ag__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background:
    radial-gradient(140% 160% at 0% 0%, var(--tvz-ai-soft), transparent 60%),
    rgb(var(--v-theme-surface));
}
.ag__chip {
  flex: none;
  padding: 0.3rem 0.7rem;
  border-radius: 0;
  clip-path: var(--tvz-hex-sm);
  font-size: 0.72rem;
  font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.75);
  line-height: 1.3;
  white-space: nowrap;
}
.ag__bar {
  flex: 1;
  min-width: 36px;
  max-width: 140px;
  height: 4px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  overflow: hidden;
}
.ag__bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--tvz-gradient-brand);
  transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
.ag__status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: auto;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
}

.ag__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.ag__log {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.msg {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  max-width: 90%;
}
.msg--a {
  align-self: flex-start;
}
.msg--u {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.msg p {
  margin: 0;
  padding: 0.6rem 0.85rem;
  border-radius: 15px;
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
.msg--a p {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-bottom-left-radius: 5px;
}
.msg--u p {
  background: rgba(var(--v-theme-primary), 0.16);
  border-bottom-right-radius: 5px;
}
.msg--new p {
  animation: pop 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
.msg__av {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 0;
  clip-path: var(--tvz-hex-sm);
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  background: var(--tvz-gradient-brand);
}
.msg__av--ghost {
  background: none;
}
.msg--typing .dots {
  display: flex;
  gap: 4px;
}
.msg--typing .dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.4);
  animation: dot 1s ease-in-out infinite;
}
.msg--typing .dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.msg--typing .dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes dot {
  50% {
    transform: translateY(-4px);
    opacity: 0.5;
  }
}

/* ---- optional photo strip ---- */
.photos {
  padding: 0 1rem 0.9rem;
}
.photos__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.ph {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--tvz-glass-border);
}
.ph img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ph__del {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.ph--add {
  display: grid;
  place-items: center;
  cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ph--add input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.uerr {
  margin: 0.4rem 0 0;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-error));
}

/* ---- customize (template + colour) ---- */
.customizeRow {
  display: flex;
  justify-content: flex-end;
  padding: 0.5rem 1rem 0;
}
.customizeToggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.customizeToggle:hover {
  color: rgb(var(--v-theme-primary));
}
.customize {
  padding: 0.6rem 1rem 0.9rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.tl {
  margin: 0.5rem 0 0.4rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.tl:first-child {
  margin-top: 0;
}
.tpls {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.tpl {
  padding: 0.35rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--tvz-glass-border);
  font-size: 0.8rem;
  background: rgb(var(--v-theme-surface));
}
.tpl.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.sws {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.sw {
  --sw: #4f46e5;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--sw);
  border: 2px solid rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 1px rgba(var(--v-theme-on-surface), 0.15);
  cursor: pointer;
  display: grid;
  place-items: center;
  color: #fff;
}
.sw.is-on {
  box-shadow:
    0 0 0 2px rgb(var(--v-theme-surface)),
    0 0 0 4px var(--sw);
}
.sw--c {
  position: relative;
  overflow: hidden;
}
.sw--c input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* ---- footer ---- */
.ag__foot {
  border-top: 1px solid var(--tvz-hairline);
}
.skiprow {
  padding: 0.5rem 1rem 0;
}
.skip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.skip:hover {
  color: rgb(var(--v-theme-primary));
}
.review {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
}
.rev__ok {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-success));
}
.rev__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.rev__i {
  font-size: 0.78rem;
  line-height: 1.4;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-left: 3px solid rgba(var(--v-theme-on-surface), 0.25);
}
.rev__i--profanity {
  border-left-color: rgb(var(--v-theme-error));
}
.rev__i--meaning {
  border-left-color: rgb(var(--v-theme-warning));
}
.rev__i strong {
  text-transform: uppercase;
  font-size: 0.66rem;
  letter-spacing: 0.05em;
}
.rev__f {
  font-weight: 600;
  margin: 0 0.35rem;
}
.rev__m {
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.done {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.6rem 1rem 0;
}
.restart {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.restart:hover {
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.restart:disabled {
  opacity: 0.5;
}

.inp {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
}
.inp textarea {
  flex: 1;
  resize: none;
  max-height: 120px;
  padding: 0.6rem 0.8rem;
  border-radius: 14px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-background));
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.4;
}
.inp textarea:focus {
  outline: 2px solid rgba(var(--v-theme-primary), 0.4);
  outline-offset: 1px;
}

@media (max-width: 760px) {
  .ag__head {
    padding: 0.6rem 0.9rem;
    flex-wrap: wrap;
  }
  .ag__chip {
    font-size: 0.68rem;
    padding: 0.2rem 0.55rem;
  }
  .ag__bar {
    order: 3;
    flex-basis: 100%;
    max-width: none;
    margin-top: 0.3rem;
  }
  .ag__log {
    padding: 0.85rem;
  }
  .msg {
    max-width: 94%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ag__bar span,
  .msg--new p,
  .msg--typing .dots span {
    transition: none;
    animation: none;
  }
}
</style>
