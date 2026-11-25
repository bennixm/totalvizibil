<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import GaChip from '@/components/admin/google-ads/GaChip.vue'
import AdsChangePreview from './AdsChangePreview.vue'
import { ApiError } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { type UserAction, type UserCampaignDetail } from '@/services/googleAdsUser'
import { useAdsApi } from './adsApi'
import { adsMoney, dateTime } from './format'

/**
 * Everything that waits for the owner's decision (budget changes ALWAYS do,
 * text rewrites too) plus the history of what the agent changed. Approving
 * applies exactly what is shown, verified in Google afterwards.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const { t, locale } = useI18n()
const { api, staff } = useAdsApi()
const toasts = useToastStore()
const confirm = useConfirmStore()

const history = ref<UserAction[]>([])
const busy = ref<string | null>(null)
const id = computed(() => props.detail.campaign.id)
const currency = computed(() => props.detail.campaign.currencyCode)

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

function isBudget(a: UserAction): boolean {
  return a.action === 'budget.change.proposed'
}

function approve(a: UserAction): void {
  const text = isBudget(a)
    ? t('ads.prop.confirmBudget', {
        from: adsMoney(obj(a.before).amountMicros as string, currency.value, locale.value),
        to: adsMoney(obj(a.after).amountMicros as string, currency.value, locale.value),
      })
    : t(a.action.startsWith('chat.') ? 'ads.chat.confirmApply' : 'ads.prop.confirmText')
  confirm.ask(t('ads.prop.confirmTitle'), text, async () => {
    busy.value = a.id
    try {
      const res = await api.approve(id.value, a.id)
      if (res?.status === 'failed') toasts.error(res.errorMessage ?? t('ads.prop.failed'))
      else toasts.success(t('ads.prop.applied'))
      emit('changed')
      await loadHistory()
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : t('ads.prop.failed'))
    } finally {
      busy.value = null
    }
  }, { danger: false })
}

async function reject(a: UserAction): Promise<void> {
  busy.value = a.id
  try {
    await api.reject(id.value, a.id)
    toasts.success(t('ads.prop.rejected'))
    emit('changed')
    await loadHistory()
  } catch {
    toasts.error(t('ads.prop.failed'))
  } finally {
    busy.value = null
  }
}

async function loadHistory(): Promise<void> {
  try {
    history.value = (await api.actions(id.value)).filter((a) => a.status !== 'pending_approval')
  } catch {
    /* the pending list still works */
  }
}
onMounted(loadHistory)

const TONE: Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'primary'> = {
  applied: 'success',
  failed: 'error',
  rejected: 'neutral',
  approved: 'primary',
  superseded: 'neutral',
}
function label(a: UserAction): string {
  return t(`ads.action.${a.action}`, a.action)
}
function summary(a: UserAction): string {
  const after = obj(a.after)
  const added = obj(after.added)
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  switch (a.action) {
    case 'creative.rsa_gap_fill':
      return t('ads.prop.sumTexts', { h: count(added.headlines), d: count(added.descriptions) })
    case 'creative.assets_gap_fill':
      return t('ads.prop.sumAssets', { s: count(added.sitelinks), c: count(added.callouts) })
    case 'creative.images_gap_fill':
      return t('ads.prop.sumImages', { n: count(added.images) })
    case 'creative.keyword_headlines':
      return t('ads.prop.sumKeywords', { n: count(after.missingKeywords) })
    case 'creative.replace_text':
      return `„${obj(a.before).text ?? ''}” → „${after.text ?? ''}”`
    case 'policy.fix_text':
      return t('ads.prop.sumPolicy', { r: count(after.replaced), d: count(after.removed) })
    case 'budget.change.proposed':
      return `${adsMoney(obj(a.before).amountMicros as string, currency.value, locale.value)} → ${adsMoney(after.amountMicros as string, currency.value, locale.value)}`
    default:
      return ''
  }
}
</script>

<template>
  <div class="pr">
    <section class="pr__block" data-guide="ads-proposals">
      <h3 class="pr__h"><v-icon icon="mdi-account-check-outline" size="18" /> {{ t('ads.prop.pendingTitle') }}</h3>
      <p v-if="!detail.pending.length" class="ab-note"><v-icon icon="mdi-check-all" size="18" /> {{ t('ads.prop.none') }}</p>
      <article v-for="a in detail.pending" :key="a.id" class="prop" :class="{ 'prop--budget': isBudget(a) }">
        <header class="prop__head">
          <v-icon :icon="isBudget(a) ? 'mdi-cash-sync' : 'mdi-swap-horizontal'" size="18" />
          <span class="prop__title">{{ label(a) }}</span>
          <GaChip v-if="isBudget(a)" tone="warning">{{ t('ads.prop.needsYou') }}</GaChip>
          <span class="prop__date">{{ dateTime(a.createdAt, locale) }}</span>
        </header>

        <div v-if="isBudget(a)" class="diff">
          <div>
            <span>{{ t('ads.prop.current') }}</span>
            <b>{{ adsMoney(obj(a.before).amountMicros as string, currency, locale) }}</b>
          </div>
          <v-icon icon="mdi-arrow-right" size="18" />
          <div>
            <span>{{ t('ads.prop.proposed') }}</span>
            <b class="diff__new">{{ adsMoney(obj(a.after).amountMicros as string, currency, locale) }}</b>
          </div>
          <small>{{ t('ads.prop.perDay') }}</small>
        </div>
        <AdsChangePreview v-else-if="a.action.startsWith('chat.')" :action="a" :currency="currency" />
        <div v-else class="diff diff--text">
          <p><span>{{ t('ads.prop.before') }}</span> <span class="diff__val">{{ obj(a.before).text }}</span></p>
          <p><span>{{ t('ads.prop.after') }}</span> <b>{{ obj(a.after).text }}</b></p>
        </div>

        <p v-if="a.reasoning" class="prop__why">{{ a.reasoning }}</p>
        <div class="prop__actions">
          <span v-if="staff && isBudget(a)" class="prop__why">{{ t('admin.ads.budgetOwner') }}</span>
          <v-btn v-else color="primary" :loading="busy === a.id" prepend-icon="mdi-check" @click="approve(a)">
            {{ t('ads.prop.approve') }}
          </v-btn>
          <v-btn variant="text" :disabled="busy === a.id" @click="reject(a)">{{ t('ads.prop.reject') }}</v-btn>
        </div>
      </article>
    </section>

    <section class="pr__block">
      <h3 class="pr__h"><v-icon icon="mdi-history" size="18" /> {{ t('ads.prop.historyTitle') }}</h3>
      <p v-if="!history.length" class="ab-note"><v-icon icon="mdi-information-outline" size="18" /> {{ t('ads.prop.noHistory') }}</p>
      <ul v-else class="hist">
        <li v-for="a in history" :key="a.id" class="hist__row">
          <div class="hist__top">
            <GaChip :tone="TONE[a.status] ?? 'neutral'">{{ t(`ads.actionStatus.${a.status}`, a.status) }}</GaChip>
            <span class="hist__label">{{ label(a) }}</span>
            <span class="hist__date">{{ dateTime(a.createdAt, locale) }}</span>
          </div>
          <AdsChangePreview v-if="a.action.startsWith('chat.')" class="mt-2" :action="a" :currency="currency" />
          <p v-else-if="summary(a)" class="hist__sum">{{ summary(a) }}</p>
          <p v-if="a.errorMessage" class="hist__err">{{ a.errorMessage }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.pr {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}
.pr__block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.pr__h {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.pr__h .v-icon {
  color: rgb(var(--v-theme-primary));
}
.prop {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 1rem 1.15rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.prop--budget {
  border-color: rgba(var(--v-theme-warning), 0.45);
}
.prop__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.prop__title {
  font-weight: 600;
}
.prop__date {
  margin-left: auto;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.diff {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.75rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.diff > div {
  display: flex;
  flex-direction: column;
}
.diff span {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.diff b {
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.diff__new {
  color: rgb(var(--v-theme-primary));
}
.diff small {
  width: 100%;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.diff--text {
  flex-direction: column;
  align-items: stretch;
}
.diff--text p {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr);
  gap: 0.5rem;
  overflow-wrap: anywhere;
  margin: 0;
  font-size: var(--tvz-fs-small);
}
.diff--text b {
  font-size: inherit;
}
.diff .diff__val {
  font-size: inherit;
  color: inherit;
}
.prop__why {
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.prop__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.hist {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
}
.hist__row {
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.hist__row:first-child {
  border-top: 0;
}
.hist__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--tvz-fs-small);
}
.hist__label {
  font-weight: 500;
}
.hist__date {
  margin-left: auto;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.hist__sum,
.hist__err {
  margin: 0.3rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow-wrap: anywhere;
}
.hist__err {
  color: rgb(var(--v-theme-error));
}
</style>
