<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import GaChip from '@/components/admin/google-ads/GaChip.vue'
import type { UserCampaignDetail } from '@/services/googleAdsUser'
import { creditsOf, dateTime } from './format'

/**
 * Transparent pricing: how a cycle is priced (admin-configured levels and
 * minimum) and, per cycle, what was quoted, charged and returned.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const { t, locale } = useI18n()

const totalMinor = computed(() => props.detail.cycles.reduce((s, c) => s + c.chargedMinor, 0))
const returnedMinor = computed(() => props.detail.cycles.reduce((s, c) => s + c.refundedMinor, 0))
</script>

<template>
  <div class="co">
    <section>
      <div class="lv">
        <div v-for="l in detail.pricing.levels" :key="l.key" class="lv__item">
          <b>{{ l.label }}</b>
          <span>{{ t('ads.cost.levelFrom', { points: l.minPoints }) }} · ×{{ l.multiplier }}</span>
        </div>
      </div>
    </section>

    <section class="co__block">
      <div class="co__totals">
        <div>
          <span>{{ t('ads.cost.total') }}</span>
          <b>{{ creditsOf(totalMinor, locale) }} {{ t('ads.credits') }}</b>
        </div>
        <div>
          <span>{{ t('ads.cost.returned') }}</span>
          <b>{{ creditsOf(returnedMinor, locale) }} {{ t('ads.credits') }}</b>
        </div>
        <div>
          <span>{{ t('ads.cost.cycles') }}</span>
          <b>{{ detail.cycles.length }}</b>
        </div>
      </div>
      <div class="tw">
        <table class="tb">
          <thead>
            <tr>
              <th>{{ t('ads.cost.colDate') }}</th>
              <th>{{ t('ads.cost.colLevel') }}</th>
              <th class="num">{{ t('ads.cost.colQuote') }}</th>
              <th class="num">{{ t('ads.cost.colCharged') }}</th>
              <th class="num">{{ t('ads.cost.colReturned') }}</th>
              <th>{{ t('ads.cost.colStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!detail.cycles.length">
              <td colspan="6" class="tb__empty">{{ t('ads.agent.noCycles') }}</td>
            </tr>
            <tr v-for="c in detail.cycles" :key="c.id">
              <td :data-label="t('ads.cost.colDate')">{{ dateTime(c.startedAt, locale) }}</td>
              <td :data-label="t('ads.cost.colLevel')">{{ c.quote.level?.label ?? c.complexityLevel ?? '–' }}</td>
              <td class="num" :data-label="t('ads.cost.colQuote')">{{ creditsOf(c.quotedMinor, locale) }}</td>
              <td class="num" :data-label="t('ads.cost.colCharged')"><b>{{ creditsOf(c.chargedMinor, locale) }}</b></td>
              <td class="num" :data-label="t('ads.cost.colReturned')">{{ creditsOf(c.refundedMinor, locale) }}</td>
              <td :data-label="t('ads.cost.colStatus')">
                <GaChip :tone="c.status === 'completed' ? 'success' : c.status === 'failed' ? 'error' : 'primary'">
                  {{ t(`ads.cycle.${c.status}`) }}
                </GaChip>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.co {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.lv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.5rem;
}
.lv__item {
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0.75rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: var(--tvz-fs-small);
}
.lv__item span {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.co__block {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.co__totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.co__totals > div {
  display: flex;
  flex-direction: column;
  padding: 0.75rem 1rem;
  border-left: 1px solid var(--tvz-hairline);
}
.co__totals > div:first-child {
  border-left: 0;
}
.co__totals span {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.co__totals b {
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.tw {
  overflow-x: auto;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
}
.tb {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tvz-fs-small);
}
.tb th {
  text-align: left;
  padding: 0.6rem 0.85rem;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  border-bottom: 1px solid var(--tvz-hairline);
}
.tb td {
  padding: 0.6rem 0.85rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.tb tbody tr:last-child td {
  border-bottom: 0;
}
.tb .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tb__empty {
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
@media (max-width: 600px) {
  .co__totals {
    grid-template-columns: minmax(0, 1fr);
  }
  .co__totals > div {
    border-left: 0;
    border-top: 1px solid var(--tvz-hairline);
  }
  .co__totals > div:first-child {
    border-top: 0;
  }
  .tb thead {
    display: none;
  }
  .tb tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.3rem 1rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .tb td {
    padding: 0;
    border: 0;
    text-align: left !important;
  }
  .tb td::before {
    content: attr(data-label);
    display: block;
    font-size: var(--tvz-fs-caption);
    color: rgba(var(--v-theme-on-surface), 0.55);
  }
  .tb__empty {
    grid-column: 1 / -1;
  }
  .tb__empty::before {
    display: none !important;
  }
}
</style>
