<script setup lang="ts">
/**
 * Every campaign in the Google Ads account (managed by the agent or only
 * monitored), with its optimization score, Google's own Ad Strength (shown
 * separately, never merged into the score) and 30-day performance.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import GaChip from './GaChip.vue'
import GoogleAdsScoreRing from './GoogleAdsScoreRing.vue'
import {
  adStrengthTone,
  googleAdsOptimizationApi,
  type GoogleAdsOptimizationCampaignRow,
} from '@/services/google-ads-optimization'
import { gaErrorText } from './gaErrors'

const { t, te } = useI18n()
const router = useRouter()
const rows = ref<GoogleAdsOptimizationCampaignRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    rows.value = await googleAdsOptimizationApi.campaigns()
    error.value = null
  } catch (e) {
    error.value = gaErrorText(e, t, t('admin.genericError'))
  } finally {
    loading.value = false
  }
}
onMounted(load)
defineExpose({ load })

const num = (n: number) => n.toLocaleString()
function money(micros: number, currency: string | null) {
  return `${(micros / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ''}`.trim()
}
function pct(v: number | null) {
  return v === null ? '–' : `${(v * 100).toFixed(2)}%`
}
function cpaRoas(r: GoogleAdsOptimizationCampaignRow) {
  const c = r.metrics.current
  if (c.roas !== null) return `ROAS ${c.roas.toFixed(2)}`
  if (c.cpa !== null) return `CPA ${c.cpa.toFixed(2)} ${r.currencyCode ?? ''}`.trim()
  return '–'
}
function label(prefix: string, v: string | null | undefined) {
  if (!v) return '–'
  const key = `adminGoogleAdsOpt.${prefix}.${v}`
  return te(key) ? t(key) : v
}
function fmtDate(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      })
    : '–'
}
const sorted = computed(() => rows.value)
function open(r: GoogleAdsOptimizationCampaignRow) {
  void router.push({
    name: 'admin-google-ads-campaign',
    params: { googleCampaignId: r.googleCampaignId },
  })
}
</script>

<template>
  <div class="gct">
    <div v-if="loading && !rows.length" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState v-else-if="error" icon="mdi-alert-circle-outline" :text="error" />
    <AdminEmptyState
      v-else-if="!rows.length"
      icon="mdi-bullhorn-outline"
      :text="t('adminGoogleAdsOpt.campaignsNone')"
    />
    <div v-else class="gct__scroll">
      <table class="gct__table">
        <thead>
          <tr>
            <th>{{ t('adminGoogleAdsOpt.colCampaign') }}</th>
            <th>{{ t('adminGoogleAdsOpt.colScore') }}</th>
            <th>{{ t('adminGoogleAdsOpt.colAdStrength') }}</th>
            <th class="num">{{ t('adminGoogleAdsOpt.colImpressions') }}</th>
            <th class="num">
              {{ t('adminGoogleAdsOpt.colClicks') }} · {{ t('adminGoogleAdsOpt.colCtr') }}
            </th>
            <th class="num">{{ t('adminGoogleAdsOpt.colConversions') }}</th>
            <th class="num">
              {{ t('adminGoogleAdsOpt.colCost') }} · {{ t('adminGoogleAdsOpt.colCpaRoas') }}
            </th>
            <th>{{ t('adminGoogleAdsOpt.colIssues') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in sorted"
            :key="r.googleCampaignId"
            tabindex="0"
            @click="open(r)"
            @keydown.enter="open(r)"
          >
            <td class="gct__name">
              <strong>{{ r.name }}</strong>
              <div class="gct__tags">
                <GaChip tone="neutral">{{ label('channel', r.channelType) }}</GaChip>
                <GaChip :tone="r.status === 'ENABLED' ? 'success' : 'neutral'">{{
                  label('campaignStatus', r.status)
                }}</GaChip>
                <GaChip
                  v-if="r.managed"
                  tone="primary"
                  icon="mdi-robot-outline"
                  :title="t('adminGoogleAdsOpt.managedHint')"
                >
                  {{ t('adminGoogleAdsOpt.managedBadge') }}
                </GaChip>
                <GaChip v-else tone="neutral" icon="mdi-eye-outline">{{
                  t('adminGoogleAdsOpt.monitoredOnly')
                }}</GaChip>
              </div>
              <div v-if="r.lastOptimizedAt" class="gct__date">
                {{ t('adminGoogleAdsOpt.colLastOptimized') }}: {{ fmtDate(r.lastOptimizedAt) }}
              </div>
            </td>
            <td><GoogleAdsScoreRing :score="r.score" :size="44" :stroke="5" /></td>
            <td>
              <GaChip :tone="adStrengthTone(r.adStrength)">{{
                label('adStrength', r.adStrength)
              }}</GaChip>
            </td>
            <td class="num">{{ num(r.metrics.current.impressions) }}</td>
            <td class="num">
              {{ num(r.metrics.current.clicks) }}
              <span class="gct__sub">{{ pct(r.metrics.current.ctr) }}</span>
            </td>
            <td class="num">{{ r.metrics.current.conversions.toLocaleString() }}</td>
            <td class="num">
              {{ money(r.metrics.current.costMicros, r.currencyCode) }}
              <span class="gct__sub">{{ cpaRoas(r) }}</span>
            </td>
            <td>
              <div class="gct__issues">
                <GaChip v-if="r.issueCounts.critical" tone="error">{{
                  r.issueCounts.critical
                }}</GaChip>
                <GaChip v-if="r.issueCounts.high" tone="warning">{{ r.issueCounts.high }}</GaChip>
                <GaChip v-if="r.issueCounts.medium" tone="primary">{{
                  r.issueCounts.medium
                }}</GaChip>
                <GaChip v-if="r.issueCounts.low" tone="neutral">{{ r.issueCounts.low }}</GaChip>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="gct__note">
        {{ t('adminGoogleAdsOpt.period30') }} · {{ t('adminGoogleAdsOpt.scoreExplainer') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.gct__scroll {
  overflow-x: auto;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.gct__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tvz-fs-small);
}
.gct__table th {
  text-align: left;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: rgba(var(--v-theme-on-surface), 0.55);
  padding: 0.6rem 0.55rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.gct__table td {
  padding: 0.55rem 0.55rem;
  border-bottom: 1px solid var(--tvz-hairline);
  vertical-align: middle;
}
.gct__table tbody tr {
  cursor: pointer;
}
.gct__table tbody tr:hover,
.gct__table tbody tr:focus-visible {
  background: rgba(var(--v-theme-primary), 0.04);
  outline: none;
}
.gct__table tbody tr:last-child td {
  border-bottom: none;
}
.num {
  text-align: right !important;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.gct__name {
  min-width: 210px;
}
.gct__sub {
  display: block;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gct__name strong {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.gct__tags,
.gct__issues {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}
.gct__date {
  margin-top: 0.25rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gct__note {
  margin: 0;
  padding: 0.5rem 0.75rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  border-top: 1px solid var(--tvz-hairline);
}
</style>
