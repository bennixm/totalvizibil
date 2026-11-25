<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
/**
 * Overview → "Technical details", organized into three labelled cards:
 * campaign coverage, the scheduled passes (with "Run now"), and the feed's
 * cost per click. Collapsed by default (secondary information), but the
 * closed header still shows a one-line summary of each card so nothing
 * important needs a click to be noticed. Pure presentation: the page owns
 * the data and the confirm + run action (`run` event).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AdminHintText from '@/components/admin/AdminHintText.vue'
import GaChip from './GaChip.vue'
import { useMoney } from '@/composables/useMoney'
import type { GoogleAdsAgentOverview } from '@/stores/admin'

type RunKind = 'structural' | 'content' | 'intelligence'

const props = defineProps<{ overview: GoogleAdsAgentOverview; busyKind: RunKind | null }>()
const emit = defineEmits<{ (e: 'run', kind: RunKind): void }>()
const { t } = useI18n()
const { credits } = useMoney()

const RUN_KINDS: RunKind[] = ['structural', 'content', 'intelligence']
const RUN_ICONS: Record<RunKind, string> = {
  structural: 'mdi-sitemap-outline',
  content: 'mdi-text-box-edit-outline',
  intelligence: 'mdi-cash-sync',
}

// Open/closed is a per-browser convenience only.
const STORE_KEY = 'tvz.gaa.techOpen'
function readOpen(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1'
  } catch {
    return false
  }
}
const open = ref(readOpen())
function toggle(): void {
  open.value = !open.value
  try {
    localStorage.setItem(STORE_KEY, open.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function runTone(status?: string): 'success' | 'error' | 'warning' | 'primary' | 'neutral' {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'partial') return 'warning'
  if (status === 'in_progress') return 'primary'
  return 'neutral'
}
function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(uiLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const c = computed(() => props.overview.campaigns)
const cpc = computed(() => props.overview.feedCpc)
const runsWithProblems = computed(
  () =>
    RUN_KINDS.filter((k) => ['failed', 'partial'].includes(props.overview.lastRuns[k]?.status ?? ''))
      .length,
)
</script>

<template>
  <section class="gtd" :class="{ 'is-open': open }">
    <button
      type="button"
      class="gtd__head"
      :aria-expanded="open"
      aria-controls="gtd-body"
      @click="toggle"
    >
      <span class="gtd__headIcon"><v-icon icon="mdi-cog-outline" size="18" /></span>
      <span class="gtd__headText">
        <span class="gtd__title">{{ t('adminGoogleAdsOpt.techDetails') }}</span>
        <span class="gtd__sub">{{ t('adminGoogleAdsOpt.techDetailsSub') }}</span>
      </span>
      <!-- At-a-glance summary, visible while collapsed -->
      <span v-if="!open" class="gtd__peek">
        <GaChip :tone="runsWithProblems ? 'warning' : 'neutral'" icon="mdi-timer-cog-outline">
          {{
            runsWithProblems
              ? t('adminGoogleAds.techPeekRunsIssues', { n: runsWithProblems })
              : t('adminGoogleAds.techPeekRunsOk')
          }}
        </GaChip>
        <GaChip :tone="cpc.fresh ? 'neutral' : 'warning'" icon="mdi-cursor-default-click-outline">
          {{ t('adminGoogleAds.techPeekCpc', { value: credits(cpc.activeCostPromovareCredits) }) }}
        </GaChip>
        <GaChip
          v-if="overview.subcategoriesWithoutCampaign"
          tone="warning"
          icon="mdi-sitemap-outline"
        >
          {{ t('adminGoogleAds.techPeekWithout', { n: overview.subcategoriesWithoutCampaign }) }}
        </GaChip>
      </span>
      <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" class="gtd__chev" />
    </button>

    <div v-if="open" id="gtd-body" class="gtd__body">
      <!-- 1. Campaign coverage -->
      <article class="gtd__card gtd__card--wide">
        <header class="gtd__cardHead">
          <v-icon icon="mdi-bullhorn-outline" size="18" />
          <div>
            <h4>{{ t('adminGoogleAds.techCoverageTitle') }}</h4>
            <p>{{ t('adminGoogleAds.techCoverageLead') }}</p>
          </div>
        </header>
        <dl class="gtd__stats">
          <div>
            <dt>{{ t('adminGoogleAds.statActiveCampaigns') }}</dt>
            <dd class="tone-success">{{ c.active }}</dd>
          </div>
          <div>
            <dt>{{ t('adminGoogleAds.statPausedCampaigns') }}</dt>
            <dd>{{ c.paused }}</dd>
          </div>
          <div>
            <dt>{{ t('adminGoogleAds.statPendingCampaigns') }}</dt>
            <dd :class="{ 'tone-warning': c.pendingCreation }">{{ c.pendingCreation }}</dd>
          </div>
          <div>
            <dt>{{ t('adminGoogleAds.statSubcategoriesWithout') }}</dt>
            <dd :class="{ 'tone-warning': overview.subcategoriesWithoutCampaign }">
              {{ overview.subcategoriesWithoutCampaign }}
            </dd>
          </div>
        </dl>
      </article>

      <!-- 2. Scheduled passes -->
      <article class="gtd__card">
        <header class="gtd__cardHead">
          <v-icon icon="mdi-timer-cog-outline" size="18" />
          <div>
            <h4>{{ t('adminGoogleAds.techRunsTitle') }}</h4>
            <p>{{ t('adminGoogleAds.techRunsLead') }}</p>
          </div>
        </header>
        <ul class="gtd__runs">
          <li v-for="kind in RUN_KINDS" :key="kind" class="gtd__run">
            <span class="gtd__runIcon"><v-icon :icon="RUN_ICONS[kind]" size="16" /></span>
            <div class="gtd__runBody">
              <div class="gtd__runTop">
                <span class="gtd__runName">{{ t(`adminGoogleAds.run.${kind}`) }}</span>
                <GaChip :tone="runTone(overview.lastRuns[kind]?.status)">
                  {{
                    overview.lastRuns[kind]
                      ? t(`adminGoogleAds.runStatus.${overview.lastRuns[kind]?.status}`)
                      : t('adminGoogleAds.runNever')
                  }}
                </GaChip>
              </div>
              <p class="gtd__runDesc">{{ t(`adminGoogleAds.runDesc.${kind}`) }}</p>
              <p v-if="overview.lastRuns[kind]" class="gtd__runMeta">
                <span>{{ fmtDate(overview.lastRuns[kind]?.startedAt) }}</span>
                <span>{{
                  t('adminGoogleAds.runActionsTaken', { n: overview.lastRuns[kind]?.actionsTaken ?? 0 })
                }}</span>
                <span v-if="overview.lastRuns[kind]?.actionsPendingApproval" class="tone-warning">{{
                  t('adminGoogleAds.runPendingN', {
                    n: overview.lastRuns[kind]?.actionsPendingApproval,
                  })
                }}</span>
              </p>
              <p v-if="overview.lastRuns[kind]?.errorSummary" class="gtd__runErr">
                <v-icon icon="mdi-alert-circle-outline" size="14" />
                {{ overview.lastRuns[kind]?.errorSummary }}
              </p>
            </div>
            <v-btn
              class="gtd__runBtn"
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-play"
              :loading="busyKind === kind"
              @click="emit('run', kind)"
            >
              {{ t('adminGoogleAds.runNowCta') }}
            </v-btn>
          </li>
        </ul>
      </article>

      <!-- 3. Feed cost per click -->
      <article class="gtd__card">
        <header class="gtd__cardHead">
          <v-icon icon="mdi-cursor-default-click-outline" size="18" />
          <div>
            <h4>
              <AdminHintText
                :label="t('adminGoogleAds.feedCpcTitle')"
                :hint="t('adminGoogleAds.feedCpcHint', { minutes: cpc.staleAfterMinutes })"
              />
            </h4>
            <p>{{ t('adminGoogleAds.feedCpcLead') }}</p>
          </div>
        </header>
        <div class="gtd__cpc">
          <span class="gtd__cpcLabel">{{ t('adminGoogleAds.feedCpcActive') }}</span>
          <span class="gtd__cpcValue">
            <b>{{ credits(cpc.activeCostPromovareCredits) }}</b>
            <v-icon icon="mdi-poker-chip" size="16" class="gtd__unit" />
          </span>
          <GaChip :tone="cpc.fresh ? 'success' : 'warning'">
            {{ t(cpc.fresh ? 'adminGoogleAds.feedCpcFresh' : 'adminGoogleAds.feedCpcStale') }}
          </GaChip>
        </div>
        <dl class="gtd__facts">
          <dt>{{ t('adminGoogleAds.feedCpcRaw') }}</dt>
          <dd>{{ cpc.rawAvgCpcCredits != null ? credits(cpc.rawAvgCpcCredits) : '–' }}</dd>
          <dt>{{ t('adminGoogleAds.feedCpcBuffer') }}</dt>
          <dd>{{ cpc.bufferPct }}%</dd>
          <dt>{{ t('adminGoogleAds.feedCpcFallback') }}</dt>
          <dd>{{ credits(cpc.fallbackCredits) }}</dd>
          <dt>{{ t('adminGoogleAds.feedCpcUpdatedAt') }}</dt>
          <dd>{{ fmtDate(cpc.updatedAt) || '–' }}</dd>
        </dl>
      </article>
    </div>
  </section>
</template>

<style scoped>
.gtd {
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.gtd__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem 0.9rem;
  width: 100%;
  padding: 0.9rem 1.1rem;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.gtd__head:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.gtd.is-open .gtd__head {
  border-bottom: 1px solid var(--tvz-hairline);
}
.gtd__headIcon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.gtd__headText {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 14rem;
}
.gtd__title {
  font-weight: 600;
}
.gtd__sub {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.gtd__peek {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.gtd__chev {
  flex: none;
  margin-left: auto;
  opacity: 0.6;
}

.gtd__body {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1rem;
  padding: 1rem;
}
.gtd__card {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding: 1rem 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
}
.gtd__card--wide {
  grid-column: 1 / -1;
}
.gtd__cardHead {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
}
.gtd__cardHead > .v-icon {
  margin-top: 0.1rem;
  color: rgb(var(--v-theme-primary));
}
.gtd__cardHead h4 {
  margin: 0;
  font-size: var(--tvz-fs-body, 0.95rem);
  font-weight: 600;
}
.gtd__cardHead p {
  margin: 0.1rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* coverage */
.gtd__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
}
.gtd__stats > div {
  padding: 0.1rem 1rem;
  border-left: 1px solid var(--tvz-hairline);
}
.gtd__stats > div:first-child {
  padding-left: 0;
  border-left: 0;
}
.gtd__stats dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gtd__stats dd {
  margin: 0.1rem 0 0;
  font-size: 1.35rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* runs */
.gtd__runs {
  list-style: none;
  margin: 0;
  padding: 0;
}
.gtd__run {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-top: 1px solid var(--tvz-hairline);
}
.gtd__run:first-child {
  border-top: 0;
  padding-top: 0;
}
.gtd__runIcon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.gtd__runTop {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.gtd__runName {
  font-weight: 600;
  font-size: var(--tvz-fs-small);
}
.gtd__runDesc {
  margin: 0.15rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gtd__runMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.9rem;
  margin: 0.3rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-variant-numeric: tabular-nums;
}
.gtd__runErr {
  display: flex;
  align-items: flex-start;
  gap: 0.3rem;
  margin: 0.35rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgb(var(--v-theme-error));
}
.gtd__runBtn {
  align-self: center;
}

/* feed cpc */
.gtd__cpc {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.6rem;
  padding: 0.75rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-primary), 0.06);
}
.gtd__cpcLabel {
  width: 100%;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gtd__cpcValue {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.gtd__cpcValue b {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}
.gtd__unit {
  opacity: 0.6;
}
.gtd__facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.45rem 1rem;
  margin: 0;
  font-size: var(--tvz-fs-small);
}
.gtd__facts dt {
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gtd__facts dd {
  margin: 0;
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tone-success {
  color: rgb(var(--v-theme-success));
}
.tone-warning {
  color: rgb(var(--v-theme-warning));
}

@media (max-width: 1000px) {
  .gtd__body {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .gtd__body {
    padding: 0.75rem;
  }
  .gtd__card {
    padding: 0.9rem;
  }
  .gtd__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 0.75rem;
  }
  .gtd__stats > div:nth-child(3) {
    padding-left: 0;
    border-left: 0;
  }
  .gtd__run {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .gtd__runBtn {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
