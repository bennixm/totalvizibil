<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminHint from '@/components/admin/AdminHint.vue'
import AdsChangePreview from '@/components/ads/AdsChangePreview.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import { ApiError } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import {
  BRIEF_FIELDS,
  googleAdsUserApi,
  type AdsConversation,
  type CampaignBrief,
  type ChatTurn,
  type UserAction,
  type UserCampaignDetail,
} from '@/services/googleAdsUser'
import { creditsOf } from './format'

/**
 * Chat with the optimization agent of one campaign. The opening (what it still
 * needs to know) is free; each message sent is billed on its own, separately
 * from optimization cycles. Changes are only prepared here: each one is
 * applied when the owner approves it.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const { t, locale } = useI18n()
const toasts = useToastStore()
const confirm = useConfirmStore()

const conv = ref<AdsConversation | null>(null)
const loadFailed = ref(false)
const draft = ref('')
const sending = ref(false)
const busyAction = ref<string | null>(null)
const editing = ref(false)
const savingBrief = ref(false)
const brief = reactive<CampaignBrief>({})
const log = ref<HTMLElement | null>(null)
let poll: ReturnType<typeof setTimeout> | undefined
let alive = true
/** Same key for a retry of the same text, so it can never be billed twice. */
let pendingKey: { text: string; key: string } | null = null

const id = computed(() => props.detail.campaign.id)
const currency = computed(() => props.detail.campaign.currencyCode)
const running = computed(() => !!conv.value?.turns.some((x) => x.status === 'running'))
const disconnected = computed(() => props.detail.campaign.status === 'disconnected')
const gaps = computed(() => conv.value?.readiness?.gaps.filter((g) => g.askable) ?? [])
const minMinor = computed(() => Math.round((conv.value?.pricing.minCredits ?? 0) * 100))
const short = computed(() => !!conv.value && conv.value.balanceMinor < minMinor.value)
const canSend = computed(
  () =>
    !!draft.value.trim() && !sending.value && !running.value && !disconnected.value && !!conv.value?.available && !short.value,
)
const lastTurn = computed(() => conv.value?.turns.at(-1) ?? null)

async function scrollDown(): Promise<void> {
  await nextTick()
  if (log.value) log.value.scrollTop = log.value.scrollHeight
}

async function load(): Promise<void> {
  clearTimeout(poll)
  const forId = id.value
  try {
    const before = conv.value
    const wasRunning = running.value
    const next = await googleAdsUserApi.chat(forId)
    if (!alive || forId !== id.value) return
    conv.value = next
    loadFailed.value = false
    if (before?.turns.length !== next.turns.length || wasRunning !== running.value) void scrollDown()
    // The answer may carry new proposals: refresh the tab counter.
    if (wasRunning && !running.value) emit('changed')
  } catch {
    if (!alive || forId !== id.value) return
    if (!conv.value) loadFailed.value = true
  }
  if (running.value) poll = setTimeout(() => void load(), 2000)
}

const ERRORS = [
  'insufficient_credits',
  'chat_daily_limit',
  'chat_busy',
  'ai_unavailable',
  'restarting',
  'google_ads_reconnect_required',
  'wallet_blocked',
]
function errText(e: unknown): string {
  const m = e instanceof ApiError ? e.message : ''
  return t(`ads.chat.err.${ERRORS.includes(m) ? m : 'generic'}`)
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!canSend.value) return
  sending.value = true
  if (pendingKey?.text !== text) {
    pendingKey = { text, key: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}` }
  }
  try {
    await googleAdsUserApi.sendChat(id.value, text, pendingKey.key, locale.value)
    pendingKey = null
    draft.value = ''
    await load()
    void scrollDown()
  } catch (e) {
    toasts.error(errText(e))
    if (e instanceof ApiError) void load()
  } finally {
    sending.value = false
  }
}

/** Puts an answer option in the composer, for the owner to complete or send. */
function pick(question: string, option: string): void {
  const line = `${question} ${option}`
  draft.value = draft.value.trim() ? `${draft.value.trim()}\n${line}` : line
}

function turnError(x: ChatTurn): string {
  const known = ['ai_error', 'ai_refused', 'google_error', 'google_ads_reconnect_required', 'interrupted']
  return t(`ads.chat.err.${known.includes(x.errorCode ?? '') ? x.errorCode : 'generic'}`)
}

function approve(a: UserAction): void {
  confirm.ask(
    t('ads.prop.confirmTitle'),
    t('ads.chat.confirmApply'),
    async () => {
      busyAction.value = a.id
      try {
        const res = await googleAdsUserApi.approve(id.value, a.id)
        if (res?.status === 'failed') toasts.error(res.errorMessage ?? t('ads.prop.failed'))
        else toasts.success(t('ads.prop.applied'))
      } catch (e) {
        toasts.error(e instanceof ApiError ? e.message : t('ads.prop.failed'))
      } finally {
        busyAction.value = null
        emit('changed')
        void load()
      }
    },
    { danger: false },
  )
}

async function reject(a: UserAction): Promise<void> {
  busyAction.value = a.id
  try {
    await googleAdsUserApi.reject(id.value, a.id)
  } catch {
    toasts.error(t('ads.prop.failed'))
  } finally {
    busyAction.value = null
    emit('changed')
    void load()
  }
}

function editBrief(): void {
  for (const f of BRIEF_FIELDS) brief[f] = conv.value?.brief[f] ?? ''
  editing.value = true
}
async function saveBrief(): Promise<void> {
  if (savingBrief.value) return
  savingBrief.value = true
  try {
    await googleAdsUserApi.saveBrief(id.value, { ...brief })
    editing.value = false
    toasts.success(t('ads.chat.briefSaved'))
    await load()
  } catch {
    toasts.error(t('ads.chat.err.generic'))
  } finally {
    savingBrief.value = false
  }
}

const TONE: Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'primary'> = {
  pending_approval: 'warning',
  applied: 'success',
  failed: 'error',
  approved: 'primary',
}
/** Ready-made requests: a tap fills the box, nothing is sent or billed. */
const STARTERS = ['explain', 'calls', 'texts', 'keywords'] as const
const LEVEL_TONE = { ready: 'success', partial: 'warning', insufficient: 'error' } as const

watch(id, () => {
  conv.value = null
  editing.value = false
  pendingKey = null
  draft.value = ''
  void load()
})
onMounted(async () => {
  await load()
  void scrollDown()
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(poll)
})
</script>

<template>
  <p v-if="loadFailed" class="ab-note ab-note--warn">
    <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ t('ads.dash.loadError') }}
    <v-btn size="small" variant="text" @click="load">{{ t('common.retry') }}</v-btn>
  </p>
  <div v-else-if="!conv" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>
  <div v-else class="ch__wrap">
  <div class="ch">
    <section class="ch__main">
      <div ref="log" class="ch__log" role="log" aria-live="polite">
        <!-- Opening: what the agent still needs. Not an AI call, free. -->
        <div class="msg msg--agent">
          <p>{{ gaps.length ? t('ads.chat.openGaps') : t('ads.chat.openReady') }}</p>
          <ul v-if="gaps.length" class="msg__gaps">
            <li v-for="g in gaps" :key="g.key">{{ t(`ads.chat.gap.${g.key}`) }}</li>
          </ul>
          <span class="msg__cost">{{ t('ads.chat.freeMessage') }}</span>
        </div>

        <template v-for="x in conv.turns" :key="x.id">
          <div class="msg msg--owner"><p>{{ x.userText }}</p></div>
          <div v-if="x.status === 'running'" class="msg msg--agent">
            <p class="msg__wait"><v-progress-circular indeterminate size="16" width="2" color="primary" /> {{ t('ads.chat.working') }}</p>
          </div>
          <div v-else-if="x.status === 'failed'" class="msg msg--agent msg--error">
            <p>{{ turnError(x) }}</p>
            <span class="msg__cost">{{ t('ads.chat.notCharged') }}</span>
          </div>
          <div v-else class="msg msg--agent">
            <p v-if="x.assistantText">{{ x.assistantText }}</p>
            <p v-else-if="x.actions.length">{{ t('ads.chat.prepared', { n: x.actions.length }) }}</p>
            <div v-for="(q, qi) in x.questions" :key="qi" class="msg__q">
              <p><b>{{ q.question }}</b></p>
              <div v-if="q.options.length && x.id === lastTurn?.id" class="msg__opts">
                <button v-for="o in q.options" :key="o" type="button" class="msg__opt" @click="pick(q.question, o)">{{ o }}</button>
              </div>
            </div>
            <article v-for="a in x.actions" :key="a.id" class="chg">
              <header class="chg__head">
                <b>{{ t(`ads.action.${a.action}`, a.action) }}</b>
                <GaChip :tone="TONE[a.status] ?? 'neutral'">{{ t(`ads.actionStatus.${a.status}`, a.status) }}</GaChip>
              </header>
              <AdsChangePreview :action="a" :currency="currency" />
              <p v-if="a.reasoning" class="chg__why">{{ a.reasoning }}</p>
              <p v-if="a.errorMessage" class="chg__err">{{ a.errorMessage }}</p>
              <div v-if="a.status === 'pending_approval'" class="chg__actions">
                <v-btn color="primary" size="small" prepend-icon="mdi-check" :loading="busyAction === a.id" :disabled="!!busyAction" @click="approve(a)">
                  {{ t('ads.prop.approve') }}
                </v-btn>
                <v-btn variant="text" size="small" :disabled="!!busyAction" @click="reject(a)">{{ t('ads.prop.reject') }}</v-btn>
              </div>
            </article>
            <details class="msg__cost" :open="x.id === lastTurn?.id">
              <summary>{{ t('ads.chat.cost', { credits: creditsOf(x.chargedMinor, locale) }) }}</summary>
              <ul v-if="x.pricing">
                <li>{{ t('ads.chat.costBase', { credits: creditsOf(x.pricing.baseCredits * 100, locale) }) }}</li>
                <li>{{ t('ads.chat.costAi', { credits: creditsOf(x.pricing.aiCredits * 100, locale) }) }}</li>
                <li v-for="l in x.pricing.lines" :key="l.type">
                  {{ t(`ads.chat.unit.${l.type}`) }}: {{ l.units }} × {{ creditsOf(l.creditsPerUnit * 100, locale) }} = {{ creditsOf(l.credits * 100, locale) }}
                </li>
              </ul>
            </details>
          </div>
        </template>
      </div>

      <div class="ch__foot">
      <p v-if="disconnected" class="ab-note ab-note--warn">
        <v-icon icon="mdi-link-variant-off" size="18" /> {{ t('ads.agent.disconnected') }}
      </p>
      <p v-else-if="!conv.available" class="ab-note ab-note--warn">
        <v-icon icon="mdi-robot-off-outline" size="18" /> {{ t('ads.chat.err.ai_unavailable') }}
      </p>
      <p v-else-if="short" class="ab-note ab-note--warn">
        <v-icon icon="mdi-wallet-outline" size="18" /> {{ t('ads.chat.err.insufficient_credits') }}
        <v-btn size="small" color="primary" class="ml-auto" :to="{ name: 'wallet', query: { topup: '1' } }">{{ t('ads.agent.topUp') }}</v-btn>
      </p>
      <div v-if="!conv.turns.length && !draft" class="ch__starters">
        <button v-for="k in STARTERS" :key="k" type="button" class="msg__opt" @click="draft = t(`ads.chat.starter.${k}`)">
          {{ t(`ads.chat.starter.${k}`) }}
        </button>
      </div>
      <form class="ch__form" @submit.prevent="send">
        <v-textarea
          v-model="draft"
          :label="t('ads.chat.placeholder')"
          variant="outlined"
          rounded="lg"
          density="comfortable"
          rows="1"
          max-rows="6"
          auto-grow
          maxlength="2000"
          hide-details
          :disabled="disconnected || !conv.available"
          @keydown.enter.exact.prevent="send"
        />
        <v-btn type="submit" color="primary" prepend-icon="mdi-send" :loading="sending || running" :disabled="!canSend">
          {{ t('ads.chat.send') }}
        </v-btn>
      </form>
      <p class="ch__price">
        {{ t('ads.chat.priceRange', { min: creditsOf(conv.pricing.minCredits * 100, locale), max: creditsOf(conv.pricing.maxCredits * 100, locale) }) }}
        {{ t('ads.agent.balance', { credits: creditsOf(conv.balanceMinor, locale) }) }}
      </p>
      </div>
    </section>

    <aside class="ch__side">
      <section class="box">
        <header class="box__head">
          <h3>{{ t('ads.chat.knows') }}</h3>
          <GaChip v-if="conv.readiness" :tone="LEVEL_TONE[conv.readiness.level]">{{ t(`ads.chat.level.${conv.readiness.level}`) }}</GaChip>
        </header>
        <form v-if="editing" class="box__form" @submit.prevent="saveBrief">
          <v-textarea v-for="f in BRIEF_FIELDS" :key="f" v-model="brief[f]" :label="t(`ads.chat.brief.${f}`)" variant="outlined" rounded="lg" density="compact" rows="1" max-rows="6" auto-grow maxlength="400" hide-details />
          <div class="box__actions">
            <v-btn type="submit" color="primary" size="small" :loading="savingBrief">{{ t('common.save') }}</v-btn>
            <v-btn variant="text" size="small" @click="editing = false">{{ t('common.cancel') }}</v-btn>
          </div>
        </form>
        <template v-else>
          <dl class="box__facts">
            <div v-for="f in BRIEF_FIELDS" :key="f">
              <dt>{{ t(`ads.chat.brief.${f}`) }}</dt>
              <dd :class="{ 'is-empty': !conv.brief[f] }">{{ conv.brief[f] || t('ads.chat.unknown') }}</dd>
            </div>
          </dl>
          <v-btn variant="tonal" size="small" prepend-icon="mdi-pencil-outline" @click="editBrief">{{ t('ads.chat.editBrief') }}</v-btn>
        </template>
      </section>
      <section class="box">
        <h3>{{ t('ads.chat.pricingTitle') }} <AdminHint :text="t('ads.chat.pricingText')" /></h3>
        <ul class="box__list">
          <li v-for="(v, k) in conv.pricing.changeCredits" :key="k">
            <span>{{ t(`ads.chat.unit.${k}`) }}</span><b>{{ creditsOf(v * 100, locale) }}</b>
          </li>
        </ul>
        <p class="box__text">
          {{ t('ads.chat.today', { credits: creditsOf(conv.spentTodayMinor, locale) }) }}
          <template v-if="conv.dailyLimitMinor != null">{{ t('ads.chat.ofLimit', { credits: creditsOf(conv.dailyLimitMinor, locale) }) }}</template>
        </p>
      </section>
    </aside>
  </div>
  </div>
</template>

<style scoped>
.ch__wrap {
  container-type: inline-size;
}
.ch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 1.5rem;
  align-items: start;
}
.ch__main {
  min-width: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.ch__foot {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.ch__side {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}
.ch__log {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 260px;
  max-height: min(62vh, 640px);
  overflow: hidden auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.25) transparent;
  overscroll-behavior: contain;
  padding: 1rem;
}
.msg {
  flex: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: min(88%, 620px);
  padding: 0.7rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  font-size: var(--tvz-fs-small);
  line-height: 1.5;
}
.msg p {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
/* A message with changes uses the whole width of the conversation. */
.msg:has(.chg) {
  width: 100%;
  max-width: 100%;
}
.msg--agent {
  align-self: flex-start;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.msg--owner {
  align-self: flex-end;
  background: rgba(var(--v-theme-primary), 0.13);
}
.msg--error {
  background: rgba(var(--v-theme-error), 0.09);
}
.msg__gaps {
  margin: 0;
  padding-left: 1.1rem;
}
.msg__wait {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.msg__opts,
.chg__actions,
.box__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.msg__opts {
  margin-top: 0.35rem;
}
.msg__opt {
  max-width: 100%;
  padding: 0.35rem 0.75rem;
  border: 1px solid rgba(var(--v-theme-primary), 0.4);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: inherit;
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.msg__opt:hover,
.msg__opt:focus-visible {
  background: rgba(var(--v-theme-primary), 0.18);
}
.msg__cost {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.msg__cost summary {
  cursor: pointer;
}
.msg__cost ul {
  margin: 0.25rem 0 0;
  padding-left: 1.1rem;
}
.chg {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.chg__head,
.box__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
.chg__why,
.chg__err {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.chg__err {
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-error));
}
.ch__starters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.ch__form {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.ch__price {
  margin: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.box {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.box h3 {
  margin: 0;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.box__form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.box__facts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
}
.box__facts dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.box__facts dd {
  margin: 0;
  font-size: var(--tvz-fs-small);
  overflow-wrap: anywhere;
}
.box__facts .is-empty {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.box__text {
  margin: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.box__list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: var(--tvz-fs-small);
}
.box__list li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.15rem 0;
}
/* By the room the panel really leaves (sidebar open or not), not the window. */
@container (max-width: 820px) {
  .ch {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .ch__foot {
    padding: 0.7rem;
  }
  .ch__log {
    padding: 0.7rem;
  }
  .msg {
    max-width: 96%;
  }
  .ch__form {
    flex-direction: column;
    align-items: stretch;
  }
}
.msg__cost summary {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 28px;
  padding: 0 0.6rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.msg__cost summary::-webkit-details-marker {
  display: none;
}
.msg__cost summary::after {
  content: '';
  width: 6px;
  height: 6px;
  margin: -3px 0 0 4px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
}
.msg__cost[open] summary::after {
  margin-top: 3px;
  transform: rotate(225deg);
}
.msg__cost summary:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  color: rgb(var(--v-theme-primary));
}
</style>
