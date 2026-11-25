<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminHint from '@/components/admin/AdminHint.vue'
import AdsSection from './AdsSection.vue'
import { ApiError } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import {
  type PlannedTask,
  type PriceBreakdown,
  type Readiness,
  type UserCampaignDetail,
} from '@/services/googleAdsUser'
import { useAdsApi } from './adsApi'
import { creditsOf, dateTime } from './format'

/**
 * Starting the agent: what it would do and cost (free quote), then the
 * explicit, billed start.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'goto', tab: string): void }>()
const { t, locale } = useI18n()
const { api, staff } = useAdsApi()
const toasts = useToastStore()
const confirm = useConfirmStore()

const quoting = ref(false)
const starting = ref(false)
const quote = ref<PriceBreakdown | null>(null)
const tasks = ref<PlannedTask[]>([])
const readiness = ref<Readiness | null>(null)
const nothingToDo = ref(false)
const balanceMinor = ref(props.detail.balance.minor)

const id = computed(() => props.detail.campaign.id)
const running = computed(() => !!props.detail.runningCycle)
const blocked = computed(() => props.detail.campaign.status !== 'active')
const needsInfo = computed(() => readiness.value?.level === 'insufficient')
const gaps = computed(() => readiness.value?.gaps.filter((g) => g.askable) ?? [])
const canAfford = computed(() => staff || !quote.value || balanceMinor.value >= quote.value.minor)

async function getQuote(): Promise<void> {
  if (quoting.value) return
  quoting.value = true
  try {
    const res = await api.quote(id.value)
    quote.value = res.quote
    tasks.value = res.tasks
    readiness.value = res.readiness
    nothingToDo.value = res.nothingToDo
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
    'nothing_to_do',
    'needs_information',
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
    (needsInfo.value ? `${t('ads.agent.needsInfoConfirm')} ` : '') +
      (staff ? t('admin.ads.runConfirm') : t('ads.agent.confirmText', { credits: creditsOf(q.minor, locale.value) })),
    async () => {
      starting.value = true
      try {
        const key = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
        await api.startCycle(id.value, key, q.minor, needsInfo.value)
        toasts.success(t('ads.agent.started'))
        quote.value = null
        emit('changed')
      } catch (e) {
        toasts.error(errText(e))
        if (e instanceof ApiError && ['quote_changed', 'needs_information', 'nothing_to_do'].includes(e.message)) void getQuote()
      } finally {
        starting.value = false
      }
    },
    { danger: false },
  )
}

watch(id, () => (quote.value = null))
</script>

<template>
  <div class="run" data-guide="ads-run">
      <p v-if="running" class="ab-note">
        <v-progress-circular indeterminate size="16" width="2" color="primary" />
        {{ t('ads.agent.running', { when: dateTime(detail.runningCycle?.startedAt, locale) }) }}
      </p>
      <p v-else-if="blocked" class="ab-note ab-note--warn">
        <v-icon icon="mdi-pause-circle-outline" size="18" />
        {{ detail.campaign.status === 'paused' ? t('ads.agent.paused') : t('ads.agent.disconnected') }}
      </p>

      <template v-else-if="!quote">
        <p v-if="staff" class="ab-note">
          <v-icon icon="mdi-gift-outline" size="18" /> <span>{{ t('admin.ads.runFree') }}</span>
        </p>
        <div class="run__cta">
          <v-btn color="primary" size="large" :loading="quoting" prepend-icon="mdi-magnify-scan" data-guide="ads-quote" @click="getQuote">
            {{ t('ads.agent.quoteCta') }}
          </v-btn>
          <AdminHint v-if="!staff" :text="`${t('ads.agent.quoteFree')} ${t('ads.agent.firstFree', { credits: detail.pricing.minCredits })}`" />
        </div>
      </template>

      <template v-else-if="nothingToDo">
        <p class="ab-note">
          <v-icon icon="mdi-check-decagram" size="18" />
          <span>{{ t('ads.agent.nothingToDo') }}</span>
        </p>
        <div class="run__actions">
          <v-btn v-if="!staff" color="primary" variant="tonal" prepend-icon="mdi-chat-outline" @click="emit('goto', 'chat')">
            {{ t('ads.agent.openChat') }}
          </v-btn>
          <v-btn variant="text" @click="quote = null">{{ t('common.close') }}</v-btn>
        </div>
      </template>

      <template v-else>
        <div v-if="gaps.length && readiness?.level !== 'ready'" class="ab-note" :class="{ 'ab-note--warn': needsInfo }">
          <v-icon icon="mdi-chat-question-outline" size="18" />
          <div>
            <b>{{ needsInfo ? t('ads.agent.needsInfo') : t('ads.agent.couldKnowMore') }}</b>
            <ul class="run__gaps">
              <li v-for="g in gaps" :key="g.key">{{ t(`ads.chat.gap.${g.key}`) }}</li>
            </ul>
            <v-btn v-if="!staff" size="small" color="primary" :variant="needsInfo ? 'flat' : 'tonal'" prepend-icon="mdi-chat-outline" @click="emit('goto', 'chat')">
              {{ t('ads.agent.answerInChat') }}
            </v-btn>
          </div>
        </div>
        <div class="plan">
          <p class="plan__h">{{ t('ads.agent.planTitle') }}</p>
          <ul class="plan__list">
            <li v-for="(task, i) in tasks" :key="i">
              <v-icon icon="mdi-check-circle-outline" size="16" />
              <span>{{ t(`ads.task.${task.task}`) }}<template v-if="task.task !== 'analysis'"> ({{ task.units }})</template></span>
            </li>
          </ul>
        </div>
        <div v-if="!staff" class="price" data-guide="ads-price">
          <div class="price__row price__row--total">
            <span>{{ t('ads.agent.price') }} <AdminHint :text="t('ads.agent.settleNote')" /></span>
            <b>{{ creditsOf(quote.minor, locale) }} {{ t('ads.credits') }}</b>
          </div>
          <AdsSection name="pricing" class="price__details" :title="t('ads.agent.howPriced')" icon="mdi-calculator-variant-outline" :hint="t('ads.agent.priceRule', { min: quote.minCredits })">
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
                <span>{{ t('ads.agent.level') }}</span>
                <span>{{ quote.level.label }} · ×{{ quote.level.multiplier }}</span>
              </li>
              <li>
                <span>{{ t('ads.agent.points') }}: {{ quote.points }} × {{ quote.level.multiplier }}</span>
                <span>{{ quote.computedCredits }}</span>
              </li>
            </ul>
          </AdsSection>
          <p class="price__balance" :class="{ 'is-short': !canAfford }">
            {{ t('ads.agent.balance', { credits: creditsOf(balanceMinor, locale) }) }}
          </p>
        </div>
        <div class="run__actions">
          <v-btn v-if="canAfford" color="primary" :variant="needsInfo ? 'tonal' : 'flat'" size="large" :loading="starting" prepend-icon="mdi-play" data-guide="ads-start" @click="start">
            {{ staff ? t('admin.ads.runStart') : t('ads.agent.startCta', { credits: creditsOf(quote.minor, locale) }) }}
          </v-btn>
          <v-btn v-else color="primary" size="large" prepend-icon="mdi-wallet-plus-outline" :to="{ name: 'wallet', query: { topup: '1' } }">
            {{ t('ads.agent.topUp') }}
          </v-btn>
          <v-btn variant="text" @click="quote = null">{{ t('common.cancel') }}</v-btn>
        </div>
      </template>
  </div>
</template>

<style scoped>
.run {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.run__cta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.run__gaps {
  margin: 0.3rem 0 0.6rem;
  padding-left: 1.1rem;
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
.price__details ul {
  list-style: none;
  margin: 0;
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
.price__balance {
  margin: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.price__balance.is-short {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
</style>
