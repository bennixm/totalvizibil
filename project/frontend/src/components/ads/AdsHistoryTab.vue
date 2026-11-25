<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import GaChip from '@/components/admin/google-ads/GaChip.vue'
import GoogleAdsActivityFeed from '@/components/admin/google-ads/GoogleAdsActivityFeed.vue'
import AdsCostsTab from './AdsCostsTab.vue'
import AdsSection from './AdsSection.vue'
import { type UserCampaignDetail } from '@/services/googleAdsUser'
import { useAdsApi } from './adsApi'
import { creditsOf, dateTime } from './format'

/** What the agent did and what it cost; the step-by-step log is optional. */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'changed'): void }>()
const { t, locale } = useI18n()
const { api } = useAdsApi()

const id = computed(() => props.detail.campaign.id)
const running = computed(() => !!props.detail.runningCycle)
/** How the price works, in the section's info icon. */
const costHint = computed(() =>
  [
    t('ads.cost.free'),
    t('ads.cost.min', { min: props.detail.pricing.minCredits }),
    t('ads.cost.complexity'),
    t('ads.cost.settle'),
    t('ads.cost.chat'),
    t('ads.cost.walletNote'),
  ].join(' '),
)
const loader = (after?: string) => api.activity(id.value, after)

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
    <!-- Cycles -->
    <AdsSection name="cycles" :title="t('ads.agent.cycles')" icon="mdi-history">
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
                  : !c.tasksApplied && !c.tasksProposed
                    ? t('ads.cycle.noChange')
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
    </AdsSection>

    <AdsSection name="steps" :title="t('ads.agent.steps')" icon="mdi-format-list-bulleted" :hint="t('ads.agent.stepsHint')">
      <GoogleAdsActivityFeed :key="id" :loader="loader" :limit="80" hide-campaign compact @running="onRunning" />
    </AdsSection>

    <AdsSection name="costs" :title="t('ads.agent.costs')" icon="mdi-cash-multiple" :hint="costHint">
      <AdsCostsTab :detail="detail" />
    </AdsSection>
  </div>
</template>

<style scoped>
.ag {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
