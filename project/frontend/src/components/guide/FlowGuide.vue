<script setup lang="ts">
/**
 * Optional visual guide for the "Devino vizibil" (create a business) flow.
 *
 * A pure overlay: it never touches the router, never calls a store action,
 * never clicks, types or submits anything. It only
 *   1. finds real elements already rendered by the flow's views (marked with
 *      inert `data-guide="…"` attributes),
 *   2. draws a highlight ring + small pointer around them (pointer-events: none,
 *      so every click still lands on the real control underneath), and
 *   3. shows a compact explanation card, placed where it covers neither the
 *      highlighted element nor the page's key controls.
 *
 * Users can close it, switch auto-open off, and reopen it from the small edge
 * handle. What was seen/dismissed is remembered per page in localStorage
 * (a per-device convenience only; losing it just shows the tips again).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { TOURS, tourForRoute, type GuideTip, type GuideTour } from '@/lib/flowGuideTours'
import { stepsFor, type FlowMode } from '@/lib/flowSteps'
import { useCompaniesStore } from '@/stores/companies'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'

const { t } = useI18n()
const route = useRoute()
const companies = useCompaniesStore()
const draftStore = useWebsiteDraftStore()

// ---------------------------------------------------------------- memory ----
const STORE_KEY = 'tvz.guide.v1'
interface Saved {
  off: boolean
  done: Record<string, boolean>
  seen: Record<string, boolean>
}
function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<Saved>
      return { off: !!v.off, done: v.done ?? {}, seen: v.seen ?? {} }
    }
  } catch {
    /* private mode / blocked storage: behave as a first visit */
  }
  return { off: false, done: {}, seen: {} }
}
const saved = reactive<Saved>(loadSaved())
function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(saved))
  } catch {
    /* non-critical */
  }
}

// ----------------------------------------------------------------- state ----
const tour = computed<GuideTour | null>(() => tourForRoute(route))
const open = ref(false)
/** 'tour' walks every visible tip of the page; 'single' is one contextual tip. */
const mode = ref<'tour' | 'single'>('tour')
const list = ref<GuideTip[]>([])
const index = ref(0)
/** At least one tip of this page currently has its element on screen. */
const available = ref(false)
const tip = computed<GuideTip | null>(() => list.value[index.value] ?? null)
const isLast = computed(() => index.value >= list.value.length - 1)

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (!el.getClientRects().length) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none'
}
function narrow(): boolean {
  return window.matchMedia('(max-width: 900px)').matches
}
function resolveTips(tr: GuideTour | null): GuideTip[] {
  if (!tr) return []
  const isNarrow = narrow()
  return tr.tips.filter((tp) => {
    if (tp.only === 'mobile' && !isNarrow) return false
    if (tp.only === 'desktop' && isNarrow) return false
    return isVisible(document.querySelector(tp.target))
  })
}

// ----------------------------------------------------- flow step label ----
const flowMode = computed<FlowMode | null>(() => {
  const tr = tour.value
  if (!tr) return null
  if (tr.mode) return tr.mode
  const c = typeof route.query.c === 'string' ? route.query.c : null
  if (c) {
    const m = companies.overview.find((x) => x.id === c)?.website?.mode
    if (m === 'easy' || m === 'advanced') return m
  }
  const dm = draftStore.draft?.mode
  return dm === 'easy' || dm === 'advanced' ? dm : null
})
const stepLabel = computed(() => {
  const tr = tour.value
  if (!tr) return ''
  const label = t('onboarding.step.' + tr.step)
  if (!flowMode.value) return tr.step === 'plan' ? t('guide.stepOnly', { n: 1, label }) : label
  const steps = stepsFor(flowMode.value)
  const i = steps.indexOf(tr.step)
  return i === -1 ? label : t('guide.stepOf', { n: i + 1, total: steps.length, label })
})

/** Real on-screen labels, so the tip text always quotes the button as shown. */
const labels = computed(() => ({
  chat: t('studio.paneChat'),
  preview: t('studio.panePreview'),
  standard: t('campaign.tierStandard'),
  first: t('campaign.tierFirst'),
  activate: t('campaign.activate'),
  nationwide: t('location.nationwideOption'),
  publish: t('proV2.publish'),
  easy: t('create.easyTitle'),
  advanced: t('create.advancedTitle'),
  topUp: t('wallet.topUpCta'),
  addCredits: t('unlock.addCredits'),
  backToUnlock: t('wallet.unlockReturn.back'),
}))

// ------------------------------------------------------ open / close -------
let autoTimer: ReturnType<typeof setTimeout> | undefined
let autoPending = false

function markSeen(tp: GuideTip | null): void {
  if (tp && !saved.seen[tp.id]) {
    saved.seen[tp.id] = true
    persist()
  }
}
watch(tip, (tp) => {
  if (open.value) markSeen(tp)
})

function openTour(from = 0, userInitiated = true): void {
  const tips = resolveTips(tour.value)
  if (!tips.length) return
  mode.value = 'tour'
  list.value = tips
  index.value = Math.min(from, tips.length - 1)
  open.value = true
  measure()
  markSeen(tip.value)
  if (userInitiated) void nextTick(() => revealIfOffscreen())
}
function openSingle(tp: GuideTip): void {
  mode.value = 'single'
  list.value = [tp]
  index.value = 0
  open.value = true
  measure()
  markSeen(tp)
}
/** Closing = "I've seen this page's tips": they won't auto-open here again. */
function close(): void {
  open.value = false
  const page = tour.value?.page
  if (page && !saved.done[page]) {
    saved.done[page] = true
    persist()
  }
}
function next(): void {
  if (isLast.value) return close()
  index.value++
  void nextTick(() => revealIfOffscreen())
}
function prev(): void {
  if (index.value > 0) index.value--
  void nextTick(() => revealIfOffscreen())
}
function toggleAuto(): void {
  saved.off = !saved.off
  persist()
}

function cancelAuto(): void {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = undefined
  autoPending = false
}
/** First visit to a page: wait for its content (pages show spinners while they
 *  validate), then open the tips without scrolling or focusing anything. */
function scheduleAutoOpen(tr: GuideTour): void {
  cancelAuto()
  autoPending = true
  const started = Date.now()
  const attempt = (): void => {
    if (tour.value?.page !== tr.page || saved.off || saved.done[tr.page]) return cancelAuto()
    if (resolveTips(tr).length && !overlayActive()) {
      autoPending = false
      openTour(0, false)
      return
    }
    if (Date.now() - started > 20_000) return cancelAuto()
    autoTimer = setTimeout(attempt, 400)
  }
  autoTimer = setTimeout(attempt, 900)
}

watch(
  () => tour.value?.page ?? null,
  (page) => {
    open.value = false
    cancelAuto()
    list.value = []
    available.value = false
    if (!page) return
    const tr = TOURS[page]
    if (tr && !saved.off && !saved.done[page]) scheduleAutoOpen(tr)
    void nextTick(onDomChange)
  },
  { immediate: true },
)

// ---------------------------------------------------- DOM awareness -------
function overlayActive(): boolean {
  // Vuetify menus/dialogs (a v-select list, the confirm dialog, the mobile
  // drawer): step aside entirely while one is open. Tooltips don't count.
  return !!document.querySelector(
    '.v-overlay--active:not(.v-tooltip), .v-navigation-drawer--temporary.v-navigation-drawer--active',
  )
}

function onDomChange(): void {
  const tr = tour.value
  if (!tr) return
  const tips = resolveTips(tr)
  available.value = tips.length > 0
  if (open.value) {
    if (mode.value === 'tour') {
      const currentId = tip.value?.id
      list.value = tips
      if (!tips.length) {
        open.value = false
        return
      }
      const keep = tips.findIndex((x) => x.id === currentId)
      index.value = keep === -1 ? Math.min(index.value, tips.length - 1) : keep
    } else if (!tips.some((x) => x.id === tip.value?.id)) {
      // The contextual element went away (e.g. the step moved on).
      open.value = false
    }
    return
  }
  if (saved.off || autoPending) return
  const fresh = tips.find((x) => x.contextual && !saved.seen[x.id])
  if (fresh) openSingle(fresh)
}

let mo: MutationObserver | null = null
let moTimer: ReturnType<typeof setTimeout> | undefined
function onMutate(): void {
  if (moTimer) return
  moTimer = setTimeout(() => {
    moTimer = undefined
    onDomChange()
  }, 180)
}

// --------------------------------------------------------- geometry -------
interface Box {
  top: number
  left: number
  width: number
  height: number
}
const geo = reactive({
  target: null as Box | null,
  bandTop: 0,
  bandBottom: 0,
  vw: 0,
  vh: 0,
  hidden: false,
  keyboard: false,
})
const cardEl = ref<HTMLElement | null>(null)
const cardPos = reactive({
  x: 0,
  y: 0,
  w: 340,
  /** Which slot is in use (for hysteresis). */
  key: '',
  /** Edge it enters from (for the entrance animation direction). */
  place: 'bottom' as 'top' | 'bottom' | 'br' | 'tr' | 'bl' | 'tl',
})

function rectOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}
function overlap(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top))
  return x * y
}

/** The visible content band: below the app bar, above the mobile tab bar. */
function band(): { top: number; bottom: number } {
  const vh = window.visualViewport?.height ?? window.innerHeight
  const bar = document.querySelector('.topbar')
  const tab = document.querySelector('.tabbar')
  const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0
  const tabTop = tab && isVisible(tab) ? tab.getBoundingClientRect().top : vh
  return { top, bottom: Math.min(vh, tabTop) }
}

function measure(): void {
  const vw = document.documentElement.clientWidth
  const vh = window.visualViewport?.height ?? window.innerHeight
  const b = band()
  geo.vw = vw
  geo.vh = vh
  geo.bandTop = b.top
  geo.bandBottom = b.bottom

  // Phone keyboard open over a field: get out of the way until it closes.
  const ae = document.activeElement
  geo.keyboard =
    vw < 900 &&
    !!ae &&
    /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) &&
    window.innerHeight - vh > 120
  geo.hidden = overlayActive()

  const el = tip.value ? document.querySelector(tip.value.target) : null
  geo.target = isVisible(el) ? rectOf(el) : null
  if (open.value) place()
}

function place(): void {
  const M = geo.vw < 600 ? 12 : 20
  const compact = geo.vw < 600
  const w = compact ? geo.vw - M * 2 : Math.min(360, geo.vw - M * 2)
  const h = cardEl.value?.offsetHeight ?? 160
  const top = geo.bandTop + M
  const bottom = geo.bandBottom - M - h
  type P = typeof cardPos.place
  const cands: { key: string; place: P; x: number; y: number }[] = compact
    ? [
        { key: 'b', place: 'bottom', x: M, y: bottom },
        { key: 't', place: 'top', x: M, y: top },
      ]
    : [
        { key: 'br', place: 'br', x: geo.vw - M - w, y: bottom },
        { key: 'tr', place: 'tr', x: geo.vw - M - w, y: top },
        { key: 'bl', place: 'bl', x: M, y: bottom },
        { key: 'tl', place: 'tl', x: M, y: top },
      ]
  // Phones: also try hugging the target from below / above, so when both screen
  // edges are taken (target near the top, chat composer at the bottom) there
  // is still a slot that covers neither.
  if (compact && geo.target) {
    const below = geo.target.top + geo.target.height + 14
    const above = geo.target.top - 14 - h
    if (below >= top && below <= bottom) cands.push({ key: 'hb', place: 'top', x: M, y: below })
    if (above >= top && above <= bottom) cands.push({ key: 'ha', place: 'bottom', x: M, y: above })
  }

  const keep: Box[] = []
  if (geo.target) {
    const p = 14
    keep.push({
      top: geo.target.top - p,
      left: geo.target.left - p,
      width: geo.target.width + p * 2,
      height: geo.target.height + p * 2,
    })
  }
  for (const sel of tour.value?.avoid ?? []) {
    document.querySelectorAll(sel).forEach((el) => {
      if (isVisible(el)) keep.push(rectOf(el))
    })
  }
  const score = (c: { x: number; y: number }): number =>
    keep.reduce((s, k, i) => s + overlap({ left: c.x, top: c.y, width: w, height: h }, k) * (i === 0 ? 3 : 1), 0)

  // Hysteresis: stay put unless another spot is genuinely better, so the
  // card doesn't hop around while the page scrolls.
  const current = cands.find((c) => c.key === cardPos.key)
  let best = current ?? cands[0]
  let bestScore = score(best)
  for (const c of cands) {
    const s = score(c)
    if (s < bestScore - 1) {
      best = c
      bestScore = s
    }
  }
  cardPos.key = best.key
  cardPos.place = best.place
  cardPos.x = best.x
  cardPos.y = Math.max(top, best.y)
  cardPos.w = w
}

let raf = 0
function loop(): void {
  measure()
  raf = requestAnimationFrame(loop)
}
function startLoop(): void {
  if (!raf) raf = requestAnimationFrame(loop)
}
function stopLoop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}
watch(open, (v) => {
  if (v) startLoop()
  else stopLoop()
})

/** Ring + pointer, in the coordinates of the clipped content band. */
const ring = computed(() => {
  const tg = geo.target
  if (!tg) return null
  const pad = 6
  return {
    top: tg.top - geo.bandTop - pad,
    left: tg.left - pad,
    width: tg.width + pad * 2,
    height: tg.height + pad * 2,
  }
})
const offscreen = computed(() => {
  const tg = geo.target
  if (!tg) return true
  return tg.top + tg.height < geo.bandTop + 8 || tg.top > geo.bandBottom - 8
})
const pointer = computed(() => {
  const r = ring.value
  const tg = geo.target
  if (!r || !tg || offscreen.value) return null
  const cardCenter = cardPos.y + (cardEl.value?.offsetHeight ?? 160) / 2
  const below = cardCenter > tg.top + tg.height / 2
  // Seated ON the ring's edge (half in, half out) on the side facing the card,
  // and off-centre, so it never overlaps a neighbouring control or a centred
  // button label. Hidden when that edge is outside the visible band.
  const x = Math.min(Math.max(r.left + r.width * 0.84, 24), geo.vw - 24)
  const y = below ? r.top + r.height - 12 : r.top - 12
  const bandH = geo.bandBottom - geo.bandTop
  if (y < 0 || y + 24 > bandH) return null
  return { x, y, dir: below ? 'up' : 'down' }
})

function revealIfOffscreen(): void {
  const el = tip.value ? document.querySelector(tip.value.target) : null
  if (!isVisible(el)) return
  const r = el.getBoundingClientRect()
  const b = band()
  if (r.top >= b.top + 8 && r.bottom <= b.bottom - 8) return
  el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' })
}

const showCard = computed(() => open.value && !!tip.value && !geo.hidden && !geo.keyboard)
const showHandle = computed(
  () => !!tour.value && available.value && !open.value && !geo.hidden && !geo.keyboard,
)

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !showCard.value) return
  const ae = document.activeElement
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !cardEl.value?.contains(ae)) return
  close()
}

/** Keeps `geo.hidden/keyboard` fresh for the handle while the card is closed
 *  (the rAF loop only runs while the card is open). */
function onPassiveChange(): void {
  if (!open.value) {
    geo.hidden = overlayActive()
    const vh = window.visualViewport?.height ?? window.innerHeight
    const ae = document.activeElement
    geo.keyboard =
      document.documentElement.clientWidth < 900 &&
      !!ae &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) &&
      window.innerHeight - vh > 120
  }
}

onMounted(() => {
  mo = new MutationObserver((records) => {
    // Our own ring/card restyle every frame: never react to those.
    const external = records.some((r) => {
      const el = r.target instanceof Element ? r.target : r.target.parentElement
      return !el?.closest('.fg')
    })
    if (!external) return
    onMutate()
    onPassiveChange()
  })
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'data-guide'],
  })
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onMutate)
  window.visualViewport?.addEventListener('resize', onPassiveChange)
  document.addEventListener('focusin', onPassiveChange)
  document.addEventListener('focusout', onPassiveChange)
})
onBeforeUnmount(() => {
  mo?.disconnect()
  stopLoop()
  cancelAuto()
  if (moTimer) clearTimeout(moTimer)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onMutate)
  window.visualViewport?.removeEventListener('resize', onPassiveChange)
  document.removeEventListener('focusin', onPassiveChange)
  document.removeEventListener('focusout', onPassiveChange)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="tour" class="fg" :class="{ 'fg--still': reducedMotion }">
      <!-- Highlight ring + pointer, clipped to the content band so they never
           draw over the app bar or the mobile tab bar. Never intercepts input. -->
      <div
        v-if="showCard && ring && !offscreen"
        class="fg__band"
        :style="{ top: geo.bandTop + 'px', height: Math.max(0, geo.bandBottom - geo.bandTop) + 'px' }"
        aria-hidden="true"
      >
        <div
          :key="tip?.id"
          class="fg__ring"
          :style="{
            transform: `translate3d(${ring.left}px, ${ring.top}px, 0)`,
            width: ring.width + 'px',
            height: ring.height + 'px',
          }"
        />
        <div
          v-if="pointer"
          class="fg__pointer"
          :class="'fg__pointer--' + pointer.dir"
          :style="{ transform: `translate3d(${pointer.x - 12}px, ${pointer.y}px, 0)` }"
        >
          <v-icon :icon="pointer.dir === 'up' ? 'mdi-arrow-up' : 'mdi-arrow-down'" size="14" />
        </div>
      </div>

      <!-- The explanation card -->
      <Transition name="fg-card">
        <section
          v-if="showCard && tip"
          ref="cardEl"
          class="fg__card"
          :class="'is-' + cardPos.place"
          :style="{
            transform: `translate3d(${cardPos.x}px, ${cardPos.y}px, 0)`,
            width: cardPos.w + 'px',
          }"
          role="dialog"
          aria-modal="false"
          :aria-label="t('guide.name')"
        >
          <header class="fg__top">
            <span class="fg__brand">
              <v-icon icon="mdi-creation" size="13" />
              {{ t('guide.brand') }}
            </span>
            <span class="fg__step">{{ stepLabel }}</span>
            <button type="button" class="fg__x" :aria-label="t('guide.close')" :title="t('guide.close')" @click="close">
              <v-icon icon="mdi-close" size="16" />
            </button>
          </header>

          <Transition name="fg-swap" mode="out-in">
            <div :key="tip.id" class="fg__body" aria-live="polite">
              <span class="fg__icon"><v-icon :icon="tip.icon" size="18" /></span>
              <div class="fg__copy">
                <p class="fg__title">{{ t(tip.key + '.title', labels) }}</p>
                <p class="fg__text">{{ t(tip.key + '.text', labels) }}</p>
              </div>
            </div>
          </Transition>

          <footer class="fg__foot">
            <div v-if="list.length > 1" class="fg__dots" aria-hidden="true">
              <span v-for="(x, i) in list" :key="x.id" :class="{ 'is-on': i === index, 'is-past': i < index }" />
            </div>
            <button v-if="offscreen" type="button" class="fg__show" @click="revealIfOffscreen">
              <v-icon icon="mdi-crosshairs-gps" size="14" /> {{ t('guide.showMe') }}
            </button>
            <span class="fg__spacer" />
            <v-btn v-if="index > 0" variant="text" size="small" class="fg__btn" @click="prev">
              {{ t('guide.back') }}
            </v-btn>
            <v-btn color="primary" variant="flat" size="small" class="fg__btn" @click="next">
              {{ isLast ? t('guide.done') : t('guide.next') }}
            </v-btn>
          </footer>
          <button type="button" class="fg__auto" @click="toggleAuto">
            {{ saved.off ? t('guide.autoOn') : t('guide.autoOff') }}
          </button>
        </section>
      </Transition>

      <!-- Reopen handle: a slim tab on the right edge, out of the way of
           forms and bottom controls. -->
      <Transition name="fg-handle">
        <button
          v-if="showHandle"
          type="button"
          class="fg__handle"
          :aria-label="t('guide.open')"
          :title="t('guide.open')"
          @click="openTour(0, true)"
        >
          <v-icon icon="mdi-creation" size="15" />
          <span class="fg__handleLabel">{{ t('guide.brand') }}</span>
        </button>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.fg__band {
  position: fixed;
  left: 0;
  right: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1002;
}
.fg__ring {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 12px;
  border: 2px solid rgb(var(--v-theme-primary));
  box-shadow:
    0 0 0 4px rgba(var(--v-theme-primary), 0.16),
    0 0 24px rgba(var(--v-theme-primary), 0.22);
  animation:
    fg-ring-in 0.35s var(--tvz-ease-out, ease) both,
    fg-ring-pulse 2.4s ease-in-out 0.4s infinite;
}
.fg__pointer {
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: rgb(var(--v-theme-primary));
  box-shadow: 0 4px 12px rgba(var(--v-theme-primary), 0.4);
}
.fg__pointer :deep(.v-icon) {
  animation: fg-nudge-up 1.4s ease-in-out infinite;
}
.fg__pointer--down :deep(.v-icon) {
  animation-name: fg-nudge-down;
}

.fg__card {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1003;
  padding: 0.7rem 0.8rem 0.45rem;
  border-radius: var(--tvz-radius-lg, 16px);
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  background:
    linear-gradient(180deg, rgba(var(--v-theme-primary), 0.07), transparent 70%),
    rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow:
    var(--tvz-shadow-lg, 0 18px 40px rgba(0, 0, 0, 0.18)),
    0 0 0 1px rgba(var(--v-theme-on-surface), 0.04);
  transition: transform 0.38s var(--tvz-ease-spring, ease);
  will-change: transform;
}
.fg__top {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.fg__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: none;
  padding: 0.15rem 0.45rem;
  clip-path: var(--tvz-hex-xs);
  font-size: var(--tvz-fs-micro, 0.6875rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--tvz-ai, rgb(var(--v-theme-primary)));
  background: var(--tvz-ai-soft, rgba(var(--v-theme-primary), 0.12));
}
.fg__step {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--tvz-fs-micro, 0.6875rem);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.fg__x {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: -0.2rem -0.3rem -0.2rem 0;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: background-color var(--tvz-dur-fast, 0.12s);
}
.fg__x:hover,
.fg__x:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface));
}

.fg__body {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  margin-top: 0.5rem;
}
.fg__icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: #fff;
  background: var(--tvz-gradient-brand, rgb(var(--v-theme-primary)));
  box-shadow: var(--tvz-glow-primary, none);
}
.fg__copy {
  min-width: 0;
}
.fg__title {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.fg__text {
  margin: 0.2rem 0 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.fg__foot {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.55rem;
}
.fg__spacer {
  flex: 1;
}
.fg__dots {
  display: flex;
  gap: 4px;
}
.fg__dots span {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.18);
  transition:
    width 0.3s var(--tvz-ease-out, ease),
    background-color 0.3s;
}
.fg__dots span.is-past {
  background: rgba(var(--v-theme-primary), 0.45);
}
.fg__dots span.is-on {
  width: 16px;
  background: rgb(var(--v-theme-primary));
}
.fg__show {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.2rem 0.4rem;
  font-size: var(--tvz-fs-micro, 0.6875rem);
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  border-radius: 6px;
}
.fg__show:hover,
.fg__show:focus-visible {
  background: rgba(var(--v-theme-primary), 0.08);
}
.fg__btn {
  text-transform: none;
  font-weight: 600;
  letter-spacing: 0;
}
.fg__auto {
  display: block;
  margin: 0.3rem auto 0;
  padding: 0.15rem 0.4rem;
  font-size: var(--tvz-fs-micro, 0.6875rem);
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.fg__auto:hover,
.fg__auto:focus-visible {
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.fg__handle {
  position: fixed;
  right: 0;
  top: 58%;
  z-index: 1003;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  height: 44px;
  width: 26px;
  padding: 0 0 0 6px;
  overflow: hidden;
  border-radius: 12px 0 0 12px;
  color: #fff;
  background: var(--tvz-gradient-brand, rgb(var(--v-theme-primary)));
  box-shadow: -4px 6px 18px rgba(var(--v-theme-primary), 0.3);
  transition:
    width 0.25s var(--tvz-ease-out, ease),
    box-shadow 0.25s;
}
.fg__handleLabel {
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s;
}
@media (hover: hover) and (min-width: 901px) {
  .fg__handle:hover,
  .fg__handle:focus-visible {
    width: 78px;
  }
  .fg__handle:hover .fg__handleLabel,
  .fg__handle:focus-visible .fg__handleLabel {
    opacity: 1;
  }
}
.fg__handle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

/* --- transitions --- */
.fg-card-enter-active {
  transition:
    opacity 0.28s var(--tvz-ease-out, ease),
    translate 0.28s var(--tvz-ease-out, ease);
}
.fg-card-leave-active {
  transition:
    opacity 0.18s ease,
    translate 0.18s ease;
}
.fg-card-enter-from,
.fg-card-leave-to {
  opacity: 0;
  translate: 0 10px;
}
.fg__card.is-top.fg-card-enter-from,
.fg__card.is-tr.fg-card-enter-from,
.fg__card.is-tl.fg-card-enter-from {
  translate: 0 -10px;
}
.fg-swap-enter-active,
.fg-swap-leave-active {
  transition:
    opacity 0.18s ease,
    translate 0.18s ease;
}
.fg-swap-enter-from {
  opacity: 0;
  translate: 8px 0;
}
.fg-swap-leave-to {
  opacity: 0;
  translate: -8px 0;
}
.fg-handle-enter-active,
.fg-handle-leave-active {
  transition:
    opacity 0.25s ease,
    translate 0.25s var(--tvz-ease-out, ease);
}
.fg-handle-enter-from,
.fg-handle-leave-to {
  opacity: 0;
  translate: 100% 0;
}

@keyframes fg-ring-in {
  from {
    opacity: 0;
    scale: 1.04;
  }
  to {
    opacity: 1;
    scale: 1;
  }
}
@keyframes fg-ring-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 4px rgba(var(--v-theme-primary), 0.16),
      0 0 24px rgba(var(--v-theme-primary), 0.22);
  }
  50% {
    box-shadow:
      0 0 0 8px rgba(var(--v-theme-primary), 0.07),
      0 0 28px rgba(var(--v-theme-primary), 0.3);
  }
}
@keyframes fg-nudge-up {
  0%,
  100% {
    translate: 0 1px;
  }
  50% {
    translate: 0 -2px;
  }
}
@keyframes fg-nudge-down {
  0%,
  100% {
    translate: 0 -1px;
  }
  50% {
    translate: 0 2px;
  }
}

/* Phones: a touch tighter, and every tap target stays >= 28px. */
@media (max-width: 599px) {
  .fg__card {
    padding: 0.6rem 0.7rem 0.4rem;
  }
  .fg__title {
    font-size: 0.9rem;
  }
  .fg__text {
    font-size: 0.82rem;
  }
}

.fg--still .fg__ring,
.fg--still .fg__pointer :deep(.v-icon) {
  animation: none;
}
.fg--still .fg__card {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .fg__ring,
  .fg__pointer :deep(.v-icon) {
    animation: none;
  }
  .fg__card,
  .fg__handle {
    transition: none;
  }
}
</style>
