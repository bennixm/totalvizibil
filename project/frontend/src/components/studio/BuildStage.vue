<script setup lang="ts">
/**
 * The simple builder's preview as a construction site. The draft always
 * holds a fully composed one-pager (so nothing can ever render blank), but
 * showing it whole from the first second reads as "a template". Here the
 * page starts empty and each section appears only once the owner has given
 * what it needs (intro → hero, services → services, photos → gallery, the
 * end of setup → everything else), each one visibly "built": wireframe
 * outline, a scan sweep, the heading typed out, content settling in, with a
 * console narrating the steps. Later edits rebuild just the section that
 * changed. Pure presentation: the content itself is untouched.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import { useBuildNarration } from '@/composables/useBuildNarration'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'

const props = defineProps<{
  content: WebsiteContent
  theme: WebsiteTheme
  step: string
  sending: boolean
  servicesCount: number
  photosCount: number
}>()
const emit = defineEmits<{ built: [] }>()

const { t, tm, rt } = useI18n()
const reduced =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const STEPS = ['intro', 'services', 'photos', 'contact', 'done']
const past = (s: string) => STEPS.indexOf(props.step) > STEPS.indexOf(s)

type Section = WebsiteContent['pages'][number]['sections'][number]
const allSections = computed<Section[]>(() => props.content.pages?.[0]?.sections ?? [])

/** Whether the owner has already "asked for" this section. */
function earned(s: Section): boolean {
  if (!s.visible) return false
  if (props.step === 'done') return true
  switch (s.type) {
    case 'hero':
      return props.step !== 'intro'
    case 'services':
      return props.servicesCount > 0 || past('services')
    case 'gallery':
      return props.photosCount > 0
    default:
      return false
  }
}
const target = computed(() => allSections.value.filter(earned).map((s) => s.id))

// --- reveal sequencer -----------------------------------------------------
const shown = reactive(new Set<string>())
const queue: string[] = []
let running = false
let first = true

const consoleLines = ref<{ text: string; done: boolean }[]>([])
const consoleOpen = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | undefined

const sleep = (ms: number) => new Promise((r) => setTimeout(r, reduced ? 0 : ms))
const typeOf = (id: string) => allSections.value.find((s) => s.id === id)?.type ?? 'generic'
function linesFor(type: string): string[] {
  const raw = tm(`studio.build.lines.${type}`) as unknown
  const list = Array.isArray(raw) && raw.length ? raw : (tm('studio.build.lines.generic') as unknown[])
  return (list as Parameters<typeof rt>[0][]).map((m) => rt(m))
}
function openConsole(): void {
  clearTimeout(closeTimer)
  consoleOpen.value = true
}
function closeConsoleSoon(): void {
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    if (!running && !props.sending) {
      consoleOpen.value = false
      consoleLines.value = []
    }
  }, 1800)
}
async function say(text: string, ms: number): Promise<void> {
  consoleLines.value.push({ text, done: false })
  if (consoleLines.value.length > 6) consoleLines.value.splice(0, consoleLines.value.length - 6)
  await sleep(ms)
  const last = consoleLines.value[consoleLines.value.length - 1]
  if (last) last.done = true
}

const root = ref<HTMLElement | null>(null)
function sectionEl(id: string): HTMLElement | null {
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
  return root.value?.querySelector<HTMLElement>(`.site__scroll [id="${esc}"]`) ?? null
}
function scrollTo(el: HTMLElement): void {
  const sc = root.value?.querySelector<HTMLElement>('.site__scroll')
  if (!sc) return
  sc.scrollTo({ top: Math.max(0, el.offsetTop - 70), behavior: reduced ? 'auto' : 'smooth' })
}
function flash(el: HTMLElement, cls: string, ms: number): void {
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
  setTimeout(() => el.classList.remove(cls), ms)
}

async function pump(): Promise<void> {
  if (running) return
  running = true
  openConsole()
  while (queue.length) {
    const id = queue.shift()!
    if (!target.value.includes(id)) continue
    const type = typeOf(id)
    const lines = linesFor(type)
    // Narrate, then put the section on the page while the last line runs.
    for (const line of lines.slice(0, -1)) await say(line, 520)
    shown.add(id)
    await nextTick()
    const el = sectionEl(id)
    if (el) {
      el.classList.add('is-in')
      scrollTo(el)
      flash(el, 'bs-building', 1600)
    }
    await say(lines[lines.length - 1] ?? t('studio.build.sec.generic'), 900)
    emit('built')
  }
  running = false
  closeConsoleSoon()
}

watch(
  target,
  (ids) => {
    for (const id of [...shown]) if (!ids.includes(id)) shown.delete(id)
    const fresh = ids.filter((id) => !shown.has(id) && !queue.includes(id))
    if (!fresh.length) return
    // Resuming a draft (page reload) shows what exists without replaying.
    if (first || reduced) {
      fresh.forEach((id) => shown.add(id))
      return
    }
    queue.push(...fresh)
    void pump()
  },
  { immediate: true },
)
first = false

// --- rebuild on edits -----------------------------------------------------
const signature = (s: Section) => JSON.stringify({ ...s, visible: true })
const lastSig = new Map<string, string>()
watch(
  allSections,
  async (list) => {
    const changed: string[] = []
    for (const s of list) {
      const sig = signature(s)
      const prev = lastSig.get(s.id)
      lastSig.set(s.id, sig)
      if (prev !== undefined && prev !== sig && shown.has(s.id) && !queue.includes(s.id)) changed.push(s.id)
    }
    if (!changed.length || reduced) return
    await nextTick()
    openConsole()
    for (const id of changed.slice(0, 3)) {
      const el = sectionEl(id)
      if (el) flash(el, 'bs-rebuild', 1300)
      void say(
        t('studio.build.updating', { section: t(`studio.build.sec.${typeOf(id)}`, typeOf(id)) }),
        700,
      )
    }
    if (!running) closeConsoleSoon()
  },
  { immediate: true, deep: true },
)

const themeSig = computed(() => JSON.stringify(props.theme))
watch(themeSig, () => {
  // A restyle only reads as one on a page that exists and isn't mid-build
  // (a fresh draft or the first build also bring a new theme).
  if (reduced || !root.value || shown.size === 0 || running || queue.length) return
  flash(root.value, 'bs-repaint', 1100)
  openConsole()
  void say(t('studio.build.restyle'), 700)
  if (!running) closeConsoleSoon()
})

// --- waiting narration (request in flight) --------------------------------
const narration = useBuildNarration(toRef(props, 'step'), toRef(props, 'sending'))
watch(
  () => narration.current.value,
  (line, prev) => {
    if (!line) return
    openConsole()
    const last = consoleLines.value[consoleLines.value.length - 1]
    if (last && last.text === prev) last.done = true
    if (!consoleLines.value.some((l) => l.text === line && !l.done))
      consoleLines.value.push({ text: line, done: false })
    if (consoleLines.value.length > 6) consoleLines.value.splice(0, consoleLines.value.length - 6)
  },
)
watch(
  () => props.sending,
  (v) => {
    if (v) return
    consoleLines.value.forEach((l) => (l.done = true))
    if (!running) closeConsoleSoon()
  },
)
onBeforeUnmount(() => clearTimeout(closeTimer))

const staged = computed<WebsiteContent>(() => {
  const pages = props.content.pages ?? []
  if (!pages.length) return props.content
  return {
    ...props.content,
    pages: [
      {
        ...pages[0],
        sections: pages[0].sections.map((s) => ({ ...s, visible: s.visible && shown.has(s.id) })),
      },
      ...pages.slice(1),
    ],
  }
})
const empty = computed(() => shown.size === 0)

/** Still mid-setup: no footer yet, and a "next section" slot under the
 *  last built one, so the page reads as a construction site. */
const partial = computed(() => props.step !== 'done')
const nextLabel = computed(() => {
  // What the owner has not given yet, in the order the chat asks for it.
  const k =
    props.step === 'services' && !props.servicesCount
      ? 'services'
      : (props.step === 'services' || props.step === 'photos') && !props.photosCount
        ? 'gallery'
        : props.step !== 'done' && props.step !== 'intro'
          ? 'rest'
          : ''
  if (!k) return ''
  return t('studio.build.next', {
    section: k === 'rest' ? t('studio.build.nextRest') : t(`studio.build.sec.${k}`),
  })
})
const stageVars = computed(() => ({ '--bs-next': JSON.stringify(nextLabel.value) }))
</script>

<template>
  <div
    ref="root"
    class="bstage"
    :class="{ 'bstage--busy': sending, 'bstage--partial': partial && !!nextLabel }"
    :style="stageVars"
  >
    <!-- An empty page waiting for the owner's first description -->
    <div v-if="empty" class="bcanvas">
      <div class="bcanvas__chrome"><span /><span /><span /><i /></div>
      <div class="bcanvas__body">
        <div class="bcanvas__ghost" aria-hidden="true">
          <b class="g g--bar" />
          <b class="g g--title" />
          <b class="g g--line" />
          <b class="g g--line g--short" />
          <div class="g__row"><b class="g g--card" /><b class="g g--card" /><b class="g g--card" /></div>
        </div>
        <div class="bcanvas__msg">
          <span class="bcanvas__cursor" aria-hidden="true" />
          <p class="bcanvas__title">{{ sending ? t('studio.build.canvasBusy') : t('studio.build.canvasTitle') }}</p>
          <p v-if="!sending" class="bcanvas__text">{{ t('studio.build.canvasText') }}</p>
        </div>
      </div>
    </div>
    <WebsiteRenderer v-else :content="staged" :theme="theme" framed />

    <!-- The build console -->
    <Transition name="bcon">
      <div v-if="consoleOpen && consoleLines.length" class="bcon" role="status" aria-live="polite">
        <p class="bcon__head">
          <span class="bcon__pulse" />
          {{ t('studio.build.consoleTitle') }}
        </p>
        <TransitionGroup name="bline" tag="ul" class="bcon__list">
          <li v-for="(l, i) in consoleLines" :key="`${i}:${l.text}`" :class="{ 'is-done': l.done }">
            <v-icon v-if="l.done" icon="mdi-check" size="13" />
            <span v-else class="bcon__spin" />
            <span>{{ l.text }}</span>
          </li>
        </TransitionGroup>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.bstage {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bstage > :deep(.site) {
  flex: 1;
  min-height: 0;
}

/* --- empty canvas --------------------------------------------------------- */
.bcanvas {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--tvz-radius-lg, 14px);
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
}
.bcanvas__chrome {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.bcanvas__chrome span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.15);
}
.bcanvas__chrome i {
  flex: 1;
  height: 18px;
  margin-left: 0.6rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.bcanvas__body {
  position: relative;
  flex: 1;
  display: grid;
  place-items: center;
  padding: 2rem;
  background-image: radial-gradient(rgba(var(--v-theme-on-surface), 0.09) 1px, transparent 1px);
  background-size: 18px 18px;
  overflow: hidden;
}
.bcanvas__ghost {
  position: absolute;
  inset: 2rem 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  opacity: 0.35;
}
.g {
  display: block;
  border-radius: 8px;
  border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.22);
}
.g--bar {
  height: 34px;
  border-radius: 999px;
}
.g--title {
  height: 46px;
  width: 62%;
  margin-top: 1.5rem;
}
.g--line {
  height: 14px;
  width: 80%;
}
.g--short {
  width: 48%;
}
.g__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.8rem;
  margin-top: 1.4rem;
}
.g--card {
  height: 110px;
}
.bstage--busy .g {
  border-style: solid;
  border-color: rgba(var(--v-theme-primary), 0.35);
  animation: gFill 2.4s ease-in-out infinite;
}
.bstage--busy .g:nth-child(2) {
  animation-delay: 0.25s;
}
.bstage--busy .g:nth-child(3) {
  animation-delay: 0.5s;
}
.bstage--busy .g:nth-child(4) {
  animation-delay: 0.75s;
}
@keyframes gFill {
  0%,
  100% {
    background: transparent;
  }
  50% {
    background: rgba(var(--v-theme-primary), 0.1);
  }
}
.bcanvas__msg {
  position: relative;
  max-width: 380px;
  text-align: center;
  padding: 1.25rem 1.4rem;
  border-radius: 14px;
  background: rgba(var(--v-theme-surface), 0.92);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
}
.bcanvas__cursor {
  display: inline-block;
  width: 3px;
  height: 26px;
  margin-bottom: 0.5rem;
  background: rgb(var(--v-theme-primary));
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink {
  to {
    visibility: hidden;
  }
}
.bcanvas__title {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
}
.bcanvas__text {
  margin: 0.4rem 0 0;
  font-size: 0.88rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

/* --- build console -------------------------------------------------------- */
.bcon {
  position: absolute;
  left: 0.9rem;
  bottom: 0.9rem;
  z-index: 5;
  width: min(320px, calc(100% - 1.8rem));
  padding: 0.7rem 0.85rem 0.6rem;
  border-radius: 12px;
  background: rgba(15, 18, 32, 0.88);
  backdrop-filter: blur(8px);
  color: #e8eaf6;
  font-size: 0.78rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.bcon__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.45rem;
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #b9b6ff;
}
.bcon__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8b7bff;
  box-shadow: 0 0 0 0 rgba(139, 123, 255, 0.7);
  animation: pulse 1.4s infinite;
}
@keyframes pulse {
  70% {
    box-shadow: 0 0 0 7px rgba(139, 123, 255, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(139, 123, 255, 0);
  }
}
.bcon__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}
.bcon__list li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: #fff;
}
.bcon__list li.is-done {
  color: rgba(232, 234, 246, 0.6);
}
.bcon__list li.is-done :deep(.v-icon) {
  color: #4ade80;
}
.bcon__spin {
  width: 11px;
  height: 11px;
  flex: none;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #b9b6ff;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.bcon-enter-active,
.bcon-leave-active {
  transition:
    opacity 0.25s,
    transform 0.25s;
}
.bcon-enter-from,
.bcon-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.bline-enter-active {
  transition:
    opacity 0.25s,
    transform 0.25s;
}
.bline-enter-from {
  opacity: 0;
  transform: translateX(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .bstage--busy .g,
  .bcanvas__cursor,
  .bcon__pulse,
  .bcon__spin {
    animation: none;
  }
}
</style>

<!-- Effects on the renderer's own section nodes (outside this component's
     scope): the "being built" and "rebuilt" passes. -->
<style>
.bstage .s.bs-building,
.bstage .s.bs-rebuild {
  position: relative;
}
.bstage .s.bs-building > * {
  animation: bsSettle 0.9s 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.bstage .s.bs-building::after,
.bstage .s.bs-rebuild::after {
  content: '';
  position: absolute;
  inset: 6px;
  z-index: 3;
  pointer-events: none;
  border-radius: 10px;
  outline: 2px dashed rgba(124, 92, 255, 0.7);
  background: linear-gradient(100deg, transparent 35%, rgba(124, 92, 255, 0.22) 50%, transparent 65%);
  background-size: 260% 100%;
  animation: bsSweep 1.5s ease-out both;
}
.bstage .s.bs-rebuild::after {
  animation-duration: 1.2s;
}
.bstage .s.bs-building :is(h1, h2) {
  animation: bsType 0.95s 0.35s steps(26, end) both;
}
.bstage .site.bs-repaint,
.bstage.bs-repaint .site {
  animation: bsRepaint 1s ease-out;
}
.bstage--partial .site__foot {
  display: none;
}
.bstage--partial .site__scroll::after {
  content: var(--bs-next);
  display: block;
  margin: 1.75rem clamp(1rem, 4%, 2.5rem) 2.5rem;
  padding: 2.6rem 1rem;
  border: 2px dashed rgba(124, 92, 255, 0.4);
  border-radius: 14px;
  text-align: center;
  font: 600 0.92rem/1.4 system-ui, sans-serif;
  letter-spacing: 0.02em;
  color: rgba(110, 100, 160, 0.9);
  background:
    linear-gradient(100deg, transparent 35%, rgba(124, 92, 255, 0.1) 50%, transparent 65%) 0 0 / 260% 100%,
    repeating-linear-gradient(45deg, rgba(124, 92, 255, 0.04) 0 10px, transparent 10px 20px);
  animation: bsIdle 2.8s linear infinite;
}
@keyframes bsIdle {
  from {
    background-position: 130% 0, 0 0;
  }
  to {
    background-position: -30% 0, 0 0;
  }
}
@keyframes bsSettle {
  from {
    opacity: 0;
    transform: translateY(16px);
    filter: blur(6px);
  }
  to {
    opacity: 1;
    transform: none;
    filter: none;
  }
}
@keyframes bsSweep {
  0% {
    background-position: 130% 0;
    opacity: 1;
  }
  75% {
    opacity: 1;
  }
  100% {
    background-position: -30% 0;
    opacity: 0;
  }
}
@keyframes bsType {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
@keyframes bsRepaint {
  0% {
    filter: saturate(0.2) brightness(1.08);
  }
  100% {
    filter: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bstage .s.bs-building > *,
  .bstage .s.bs-building :is(h1, h2),
  .bstage .s.bs-building::after,
  .bstage .s.bs-rebuild::after,
  .bstage.bs-repaint .site,
  .bstage--partial .site__scroll::after {
    animation: none;
  }
}
</style>
