<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import GaChip from '@/components/admin/google-ads/GaChip.vue'
import GoogleAdsIssueList from '@/components/admin/google-ads/GoogleAdsIssueList.vue'
import GoogleAdsScoreRing from '@/components/admin/google-ads/GoogleAdsScoreRing.vue'
import type { UserCampaignDetail } from '@/services/googleAdsUser'
import { adsMoney, pct, strengthTone } from './format'

/**
 * Overview of one customer campaign, from the latest real sync: the same
 * score, components and issues the platform's own agent uses (evaluator),
 * plus the campaign's last-30-days performance and ad elements.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'goto', tab: string): void }>()
const { t, n, locale } = useI18n()

const snap = computed(() => props.detail.snapshot)
const ev = computed(() => snap.value?.evaluation)
const cur = computed(() => ev.value?.performance.current)
const currency = computed(() => snap.value?.campaign.currencyCode ?? props.detail.campaign.currencyCode)
const assets = computed(() => ev.value?.assets)

const TARGETS = { headlines: 15, descriptions: 4, sitelinks: 6, callouts: 4, images: 4 } as const
const elements = computed(() => {
  const a = assets.value
  if (!a) return []
  return [
    { key: 'headlines', have: a.headlines.length, target: TARGETS.headlines, icon: 'mdi-format-title' },
    { key: 'descriptions', have: a.descriptions.length, target: TARGETS.descriptions, icon: 'mdi-text' },
    { key: 'sitelinks', have: a.sitelinks.length, target: TARGETS.sitelinks, icon: 'mdi-link-variant' },
    { key: 'callouts', have: a.callouts.length, target: TARGETS.callouts, icon: 'mdi-tag-text-outline' },
    { key: 'images', have: a.images.filter((i) => i.valid).length, target: TARGETS.images, icon: 'mdi-image-outline' },
  ]
})
/** Large account figures (e.g. 1.2 mil. RON) must still fit their cell. */
function compact(v: number): string {
  return new Intl.NumberFormat(locale.value, {
    notation: v >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(v)
}
function compactMoney(micros: number): string {
  const v = micros / 1e6
  return v >= 100_000 ? `${compact(v)} ${currency.value ?? ''}`.trim() : adsMoney(micros, currency.value, locale.value)
}
const sortedIssues = computed(() => {
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const
  return [...(ev.value?.issues ?? [])].sort((a, b) => order[a.priority] - order[b.priority])
})
/** What the agent can do is kept apart from what only the owner can. */
const agentIssues = computed(() => sortedIssues.value.filter((i) => i.autoFixable))
const ownIssues = computed(() => sortedIssues.value.filter((i) => !i.autoFixable))
/** Same rule as the agent: it only acts below half, or when Google asks. */
const keywordsOk = computed(() => {
  const k = assets.value?.headlineKeywords
  return !!k && !k.googleFlagged && k.covered.length >= Math.ceil((k.covered.length + k.missing.length) / 2)
})
const components = computed(() => (ev.value?.components ?? []).filter((c) => c.status !== 'na'))
function change(v: number | null | undefined): string {
  if (v == null) return ''
  return `${v > 0 ? '+' : ''}${pct(v, locale.value, 0)}`
}
</script>

<template>
  <div v-if="!ev" class="ov__empty">
    <v-icon icon="mdi-cloud-sync-outline" size="28" />
    <p>{{ t('ads.dash.noSnapshot') }}</p>
  </div>

  <div v-else class="ov">
    <!-- Score + key numbers -->
    <section class="ov__strip">
      <div class="ov__score">
        <GoogleAdsScoreRing :score="ev.score" :size="92" :stroke="8" />
        <div>
          <p class="ov__scoreLabel">{{ t('ads.dash.score') }}</p>
          <p class="ov__scoreHint">{{ t('ads.dash.scoreHint') }}</p>
        </div>
      </div>
      <dl class="ov__kpis">
        <div>
          <dt>{{ t('ads.dash.adStrength') }}</dt>
          <dd><GaChip :tone="strengthTone(ev.adStrength)">{{ t(`ads.strength.${ev.adStrength ?? 'UNKNOWN'}`, ev.adStrength ?? '–') }}</GaChip></dd>
        </div>
        <div>
          <dt>{{ t('ads.metrics.clicks') }}</dt>
          <dd :title="n(cur?.clicks ?? 0)">{{ compact(cur?.clicks ?? 0) }}</dd>
          <span v-if="ev.performance.comparable" class="ov__chg">{{ change(ev.performance.clicksChange) }}</span>
        </div>
        <div>
          <dt>{{ t('ads.metrics.ctr') }}</dt>
          <dd>{{ pct(cur?.ctr, locale) }}</dd>
          <span v-if="ev.performance.comparable" class="ov__chg">{{ change(ev.performance.ctrChange) }}</span>
        </div>
        <div>
          <dt>{{ t('ads.metrics.cost') }}</dt>
          <dd :title="adsMoney(cur?.costMicros, currency, locale)">{{ compactMoney(cur?.costMicros ?? 0) }}</dd>
        </div>
        <div>
          <dt>{{ t('ads.metrics.conversions') }}</dt>
          <dd>{{ compact(cur?.conversions ?? 0) }}</dd>
        </div>
      </dl>
    </section>
    <p class="ov__period">{{ t('ads.dash.period') }}</p>

    <div class="ov__cols">
      <!-- What to improve -->
      <section class="ov__block">
        <div class="ov__hrow">
          <h3 class="ov__h"><v-icon icon="mdi-lightbulb-on-outline" size="18" /> {{ t('ads.dash.toImprove') }}</h3>
          <v-btn v-if="agentIssues.length" size="small" variant="text" append-icon="mdi-arrow-right" @click="emit('goto', 'home')">
            {{ t('ads.dash.letAgent') }}
          </v-btn>
        </div>
        <template v-if="sortedIssues.length">
          <template v-if="agentIssues.length">
            <p class="ov__own">{{ t('ads.dash.agentCan') }}</p>
            <GoogleAdsIssueList :issues="agentIssues" />
          </template>
          <template v-if="ownIssues.length">
            <p class="ov__own">{{ t('ads.dash.needsYou') }}</p>
            <GoogleAdsIssueList :issues="ownIssues" />
          </template>
        </template>
        <p v-else class="ov__ok"><v-icon icon="mdi-check-decagram" size="18" /> {{ t('ads.dash.noIssues') }}</p>
      </section>

      <!-- Ad elements -->
      <section class="ov__block">
        <h3 class="ov__h"><v-icon icon="mdi-format-list-checks" size="18" /> {{ t('ads.dash.elements') }}</h3>
        <ul class="el">
          <li v-for="e in elements" :key="e.key" class="el__row">
            <v-icon :icon="e.icon" size="17" class="el__ic" />
            <span class="el__name">{{ t(`ads.element.${e.key}`) }}</span>
            <span class="el__bar"><i :style="{ width: `${Math.min(100, (e.have / e.target) * 100)}%` }" :class="{ 'is-full': e.have >= e.target }" /></span>
            <span class="el__val">{{ e.have }}/{{ e.target }}</span>
          </li>
        </ul>
        <div v-if="assets?.headlineKeywords" class="kw">
          <p class="kw__h">
            {{ t('ads.dash.keywords', { n: assets.headlineKeywords.covered.length, total: assets.headlineKeywords.covered.length + assets.headlineKeywords.missing.length }) }}
          </p>
          <p v-if="assets.headlineKeywords.missing.length" class="kw__missing">
            {{ t(keywordsOk ? 'ads.dash.keywordsOptional' : 'ads.dash.keywordsMissing') }}
            <span v-for="k in assets.headlineKeywords.missing.slice(0, 8)" :key="k" class="kw__tag">{{ k }}</span>
          </p>
        </div>
      </section>
    </div>

    <!-- Score breakdown -->
    <section class="ov__block">
      <h3 class="ov__h"><v-icon icon="mdi-chart-box-outline" size="18" /> {{ t('ads.dash.breakdown') }}</h3>
      <ul class="cmp">
        <li v-for="c in components" :key="c.key" class="cmp__row">
          <div class="cmp__top">
            <span class="cmp__label">{{ c.label }}</span>
            <span class="cmp__pts">{{ n(c.earned, { maximumFractionDigits: 1 }) }} / {{ c.max }}</span>
          </div>
          <span class="cmp__bar"><i :class="`s-${c.status}`" :style="{ width: `${(c.earned / c.max) * 100}%` }" /></span>
          <p v-if="c.missing.length" class="cmp__missing">{{ t('ads.dash.missing') }}: {{ c.missing.join(', ') }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.ov {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.ov__empty {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ov__strip {
  display: flex;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.ov__score {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem 1.25rem;
  border-right: 1px solid var(--tvz-hairline);
  flex: none;
  max-width: 300px;
}
.ov__scoreLabel {
  margin: 0;
  font-weight: 600;
  font-size: var(--tvz-fs-small);
}
.ov__scoreHint {
  margin: 0.15rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ov__kpis {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
}
.ov__kpis > div {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.9rem 1rem;
  border-left: 1px solid var(--tvz-hairline);
  min-width: 0;
}
.ov__kpis > div:first-child {
  border-left: 0;
}
.ov__kpis dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ov__kpis dd {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.ov__chg {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ov__period {
  margin: -1rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ov__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.ov__block {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}
.ov__hrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.ov__h {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.ov__h .v-icon {
  color: rgb(var(--v-theme-primary));
}
.ov__own {
  margin: 0.75rem 0 0.35rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ov__ok {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  color: rgb(var(--v-theme-success));
}
.el {
  list-style: none;
  margin: 0;
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
}
.el__row {
  display: grid;
  grid-template-columns: auto minmax(0, 7rem) minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem;
  font-size: var(--tvz-fs-small);
}
.el__ic {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.el__bar,
.cmp__bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
}
.el__bar i,
.cmp__bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: rgb(var(--v-theme-warning));
}
.el__bar i.is-full,
.cmp__bar i.s-ok {
  background: rgb(var(--v-theme-success));
}
.cmp__bar i.s-missing {
  background: rgb(var(--v-theme-error));
}
.el__val {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.kw {
  padding: 0.75rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-primary), 0.06);
  font-size: var(--tvz-fs-small);
}
.kw__h {
  margin: 0;
  font-weight: 600;
}
.kw__missing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin: 0.4rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.kw__tag {
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-size: var(--tvz-fs-caption);
}
.cmp {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 0.9rem 1.5rem;
}
.cmp__row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.cmp__top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: var(--tvz-fs-small);
}
.cmp__label {
  font-weight: 500;
}
.cmp__pts {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cmp__missing {
  margin: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
@media (max-width: 1100px) {
  .ov__strip {
    flex-direction: column;
  }
  .ov__score {
    max-width: none;
    border-right: 0;
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .ov__cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 700px) {
  .ov__score {
    padding: 1rem;
  }
  .ov__kpis > div {
    padding: 0.8rem;
  }
  .ov__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ov__kpis > div {
    border-left: 0;
    border-top: 1px solid var(--tvz-hairline);
  }
  .ov__kpis > div:nth-child(even) {
    border-left: 1px solid var(--tvz-hairline);
  }
  .ov__kpis > div:first-child,
  .ov__kpis > div:nth-child(2) {
    border-top: 0;
  }
  .ov__kpis > div:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}
</style>
