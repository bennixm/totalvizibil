<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import GaChip from '@/components/admin/google-ads/GaChip.vue'
import GoogleAdsActivityFeed from '@/components/admin/google-ads/GoogleAdsActivityFeed.vue'
import { ApiError } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import {
  googleAdsUserApi,
  type PlannedTask,
  type PriceBreakdown,
  type UserCampaignDetail,
} from '@/services/googleAdsUser'
import { creditsOf, dateTime } from './format'

/**
 * The optimization agent: what the next cycle will do and cost (free
 * quote), the explicit "run" (the only thing that is ever charged), live
 * activity of the running cycle, and the history of past cycles.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const { t, locale } = useI18n()
const toasts = useToastStore()
const confirm = useConfirmStore()

const quoting = ref(false)
const starting = ref(false)
const quote = ref<PriceBreakdown | null>(null)
const tasks = ref<PlannedTask[]>([])
const balanceMinor = ref(props.detail.balance.minor)
const feed = ref<InstanceType<typeof GoogleAdsActivityFeed> | null>(null)

const id = computed(() => props.detail.campaign.id)
const running = computed(() => !!props.detail.runningCycle)
const blocked = computed(() => props.detail.campaign.status !== 'active')
const canAfford = computed(() => !quote.value || balanceMinor.value >= quote.value.minor)
const loader = (after?: string) => googleAdsUserApi.activity(id.value, after)

async function getQuote(): Promise<void> {
  if (quoting.value) return
  quoting.value = true
  try {
    const res = await googleAdsUserApi.quote(id.value)
    quote.value = res.quote
    tasks.value = res.tasks
    balanceMinor.value = res.balanceMinor
  } catch (e) {
    toasts.error(errText(e))
  } finally {
    quoting.value = false
  }
}

function errText(e: unknown): string {
  const m = e instanceof ApiError ? e.message : ''
  const known = [
    'insufficient_credits',
    'cycle_already_running',
    'quote_changed',
    'campaign_paused',
    'google_ads_reconnect_required',
    'wallet_blocked',
  ]
  return known.includes(m) ? t(`ads.agent.err.${m}`) : m || t('ads.agent.err.generic')
}

function start(): void {
  const q = quote.value
  if (!q || starting.value) return
  confirm.ask(
    t('ads.agent.confirmTitle'),
    t('ads.agent.confirmText', { credits: creditsOf(q.minor, locale.value) }),
    async () => {
      starting.value = true
      try {
        const key = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
        await googleAdsUserApi.startCycle(id.value, key, q.minor)
        toasts.success(t('ads.agent.started'))
        quote.value = null
        emit('changed')
        setTimeout(() => feed.value?.refresh(), 500)
      } catch (e) {
        toasts.error(errText(e))
        if (e instanceof ApiError && e.message === 'quote_changed') void getQuote()
      } finally {
        starting.value = false
      }
    },
    { danger: false },
  )
}

function onRunning(v: boolean): void {
  if (!v && running.value) emit('changed')
}

const TONE: Record<string, 'success' | 'warning' | 'error' | 'primary'> = {
  completed: 'success',
  failed: 'error',
  running: 'primary',
}
</script>

<template>
  <div class="ag">
    <!-- Run panel -->
    <section class="run" data-guide="ads-run">
      <div class="run__head">
        <span class="run__icon"><v-icon icon="mdi-robot-outline" size="22" /></span>
        <div>
          <h3>{{ t('ads.agent.runTitle') }}</h3>
          <p>{{ t('ads.agent.runLead') }}</p>
        </div>
      </div>

      <p v-if="running" class="ab-note">
        <v-progress-circular indeterminate size="16" width="2" color="primary" />
        {{ t('ads.agent.running', { when: dateTime(detail.runningCycle?.startedAt, locale) }) }}
      </p>
      <p v-else-if="blocked" class="ab-note ab-note--warn">
        <v-icon icon="mdi-pause-circle-outline" size="18" />
        {{ detail.campaign.status === 'paused' ? t('ads.agent.paused') : t('ads.agent.disconnected') }}
      </p>

      <template v-else-if="!quote">
        <p v-if="!detail.firstCycleDone" class="ab-note">
          <v-icon icon="mdi-gift-outline" size="18" />
          {{ t('ads.agent.firstFree', { credits: detail.pricing.minCredits }) }}
        </p>
        <v-btn color="primary" size="large" :loading="quoting" prepend-icon="mdi-magnify-scan" data-guide="ads-quote" @click="getQuote">
          {{ t('ads.agent.quoteCta') }}
        </v-btn>
        <p class="run__free">{{ t('ads.agent.quoteFree') }}</p>
      </template>

      <template v-else>
        <div class="plan">
          <p class="plan__h">{{ t('ads.agent.planTitle') }}</p>
          <ul class="plan__list">
            <li v-for="(task, i) in tasks" :key="i">
              <v-icon icon="mdi-check-circle-outline" size="16" />
              <span>{{ t(`ads.task.${task.task}`) }}<template v-if="task.task !== 'analysis'"> ({{ task.units }})</template></span>
            </li>
          </ul>
        </div>
        <div class="price" data-guide="ads-price">
          <div class="price__row price__row--total">
            <span>{{ t('ads.agent.price') }}</span>
            <b>{{ creditsOf(quote.minor, locale) }} {{ t('ads.credits') }}</b>
          </div>
          <div class="price__row">
            <span>{{ t('ads.agent.level') }}</span>
            <GaChip tone="primary">{{ quote.level.label }} · ×{{ quote.level.multiplier }}</GaChip>
          </div>
          <details class="price__details">
            <summary>{{ t('ads.agent.howPriced') }}</summary>
            <ul>
              <li v-for="l in quote.lines" :key="l.task">
                <span>{{ t(`ads.task.${l.task}`) }} ({{ l.units }} × {{ l.creditsPerUnit }})</span>
                <span>{{ l.credits }}</span>
              </li>
              <li v-if="quote.elementsAnalyzed">
                <span>{{ t('ads.agent.elements', { n: quote.elementsAnalyzed }) }}</span>
                <span>{{ quote.elementsCredits }}</span>
              </li>
              <li>
                <span>{{ t('ads.agent.points') }}: {{ quote.points }} × {{ quote.level.multiplier }}</span>
                <span>{{ quote.computedCredits }}</span>
              </li>
            </ul>
            <p>{{ t('ads.agent.priceRule', { min: quote.minCredits }) }}</p>
          </details>
          <p class="price__balance" :class="{ 'is-short': !canAfford }">
            {{ t('ads.agent.balance', { credits: creditsOf(balanceMinor, locale) }) }}
          </p>
        </div>
        <div class="run__actions">
          <v-btn v-if="canAfford" color="primary" size="large" :loading="starting" prepend-icon="mdi-play" data-guide="ads-start" @click="start">
            {{ t('ads.agent.startCta', { credits: creditsOf(quote.minor, locale) }) }}
          </v-btn>
          <v-btn v-else color="primary" size="large" prepend-icon="mdi-wallet-plus-outline" :to="{ name: 'wallet', query: { topup: '1' } }">
            {{ t('ads.agent.topUp') }}
          </v-btn>
          <v-btn variant="text" @click="quote = null">{{ t('common.cancel') }}</v-btn>
        </div>
        <p class="run__free">{{ t('ads.agent.settleNote') }}</p>
      </template>
    </section>

    <!-- Live activity -->
    <section class="ag__block">
      <h3 class="ag__h"><v-icon icon="mdi-pulse" size="18" /> {{ t('ads.agent.activity') }}</h3>
      <GoogleAdsActivityFeed ref="feed" :loader="loader" :limit="80" hide-campaign compact @running="onRunning" />
    </section>

    <!-- Cycles -->
    <section class="ag__block">
      <h3 class="ag__h"><v-icon icon="mdi-history" size="18" /> {{ t('ads.agent.cycles') }}</h3>
      <p v-if="!detail.cycles.length" class="ab-note"><v-icon icon="mdi-information-outline" size="18" /> {{ t('ads.agent.noCycles') }}</p>
      <ul v-else class="cyc">
        <li v-for="c in detail.cycles" :key="c.id" class="cyc__row">
          <div class="cyc__top">
            <GaChip :tone="TONE[c.status] ?? 'neutral'">{{ t(`ads.cycle.${c.status}`) }}</GaChip>
            <span class="cyc__date">{{ dateTime(c.startedAt, locale) }}</span>
            <span v-if="c.trigger === 'scheduled'" class="cyc__trig">{{ t('ads.cycle.scheduled') }}</span>
            <b class="cyc__cost">{{ creditsOf(c.chargedMinor, locale) }} {{ t('ads.credits') }}</b>
          </div>
          <p class="cyc__sum">
            {{
              c.status === 'running'
                ? t('ads.cycle.inProgress')
                : c.status === 'failed'
                  ? t('ads.cycle.failedSum')
                  : t('ads.cycle.summary', { applied: c.tasksApplied, proposed: c.tasksProposed })
            }}
            <template v-if="c.scoreBefore != null && c.scoreAfter != null">
              · {{ t('ads.cycle.score', { from: c.scoreBefore, to: c.scoreAfter }) }}
            </template>
            <template v-if="c.refundedMinor > 0">
              · {{ t('ads.cycle.refunded', { credits: creditsOf(c.refundedMinor, locale) }) }}
            </template>
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.ag {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}
.run {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.35rem;
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  border-radius: var(--tvz-radius-lg);
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06), rgb(var(--v-theme-surface)) 70%);
}
.run__head {
  display: flex;
  gap: 0.85rem;
  align-items: flex-start;
}
.run__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 12px;
  background: var(--tvz-ai-soft);
  color: var(--tvz-ai);
}
.run__head h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}
.run__head p {
  margin: 0.2rem 0 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.run__free {
  margin: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.run__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.plan__h {
  margin: 0 0 0.4rem;
  font-weight: 600;
  font-size: var(--tvz-fs-small);
}
.plan__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: var(--tvz-fs-small);
}
.plan__list li {
  display: flex;
  gap: 0.45rem;
  align-items: flex-start;
}
.plan__list .v-icon {
  flex: none;
  margin-top: 0.15rem;
  color: rgb(var(--v-theme-primary));
}
.price {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.9rem 1rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
}
.price__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--tvz-fs-small);
}
.price__row--total b {
  font-size: 1.3rem;
  font-variant-numeric: tabular-nums;
}
.price__details summary {
  cursor: pointer;
  font-size: var(--tvz-fs-small);
  color: rgb(var(--v-theme-primary));
}
.price__details ul {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--tvz-fs-caption);
}
.price__details li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-variant-numeric: tabular-nums;
}
.price__details p {
  margin: 0.5rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.price__balance {
  margin: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.price__balance.is-short {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.ag__block {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.ag__h {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.ag__h .v-icon {
  color: rgb(var(--v-theme-primary));
}
.cyc {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
}
.cyc__row {
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.cyc__row:first-child {
  border-top: 0;
}
.cyc__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--tvz-fs-small);
}
.cyc__date {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
}
.cyc__trig {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.cyc__cost {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.cyc__sum {
  margin: 0.3rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
</style>
