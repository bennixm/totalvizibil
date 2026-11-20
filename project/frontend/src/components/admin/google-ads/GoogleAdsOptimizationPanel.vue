<script setup lang="ts">
/**
 * Overview of the agent's optimization state, built from the latest real
 * monitor snapshots (`summary`, loaded by the page so its header can use it
 * too): the account score, one strip of key counts, account-level issues
 * and the most recent agent activity. Explanations live in tooltips; the
 * details live in the Campaigns / Activity / Proposals tabs.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AdminHintText from '@/components/admin/AdminHintText.vue'
import GoogleAdsScoreRing from './GoogleAdsScoreRing.vue'
import GoogleAdsIssueList from './GoogleAdsIssueList.vue'
import GoogleAdsActivityFeed from './GoogleAdsActivityFeed.vue'
import type {
  GoogleAdsOptimizationSummary,
  IssuePriority,
} from '@/services/google-ads-optimization'

defineProps<{ summary: GoogleAdsOptimizationSummary }>()
const emit = defineEmits<{
  (e: 'goto', tab: 'activity' | 'campaigns' | 'proposals'): void
  (e: 'running', value: boolean): void
}>()
const { t } = useI18n()

const feed = ref<InstanceType<typeof GoogleAdsActivityFeed> | null>(null)
defineExpose({ refreshFeed: () => feed.value?.refresh() })

const PRIORITIES: IssuePriority[] = ['critical', 'high', 'medium', 'low']
</script>

<template>
  <div class="gop">
    <!-- Score + key counts, one strip -->
    <section class="gop__strip">
      <div class="gop__score">
        <GoogleAdsScoreRing :score="summary.accountScore" :size="88" :stroke="8" />
        <div class="gop__scoreText">
          <AdminHintText
            :label="t('adminGoogleAdsOpt.accountScore')"
            :hint="
              t('adminGoogleAdsOpt.scoreExplainer') +
              ' ' +
              (summary.accountScoreWeighting === 'spend'
                ? t('adminGoogleAdsOpt.accountScoreHintSpend')
                : t('adminGoogleAdsOpt.accountScoreHintAverage'))
            "
          />
        </div>
      </div>

      <dl class="gop__kpis">
        <button
          type="button"
          class="gop__kpi"
          :title="t('adminGoogleAdsOpt.statManaged', { n: summary.managedCampaigns })"
          @click="emit('goto', 'campaigns')"
        >
          <dt>{{ t('adminGoogleAdsOpt.statCampaigns') }}</dt>
          <dd>{{ summary.campaigns }}</dd>
          <span class="gop__sub">{{
            t('adminGoogleAdsOpt.activeOf', { n: summary.activeCampaigns })
          }}</span>
        </button>
        <div class="gop__kpi">
          <dt>
            <AdminHintText
              :label="t('adminGoogleAdsOpt.statOptimized')"
              :hint="t('adminGoogleAdsOpt.statOptimizedSub')"
            />
          </dt>
          <dd class="tone-success">{{ summary.optimizedCampaigns }}</dd>
          <span
            class="gop__sub"
            :class="{ 'tone-warning': summary.attentionCampaigns }"
            :title="t('adminGoogleAdsOpt.statAttentionSub')"
          >
            {{ summary.attentionCampaigns }}
            {{ t('adminGoogleAdsOpt.statAttention').toLowerCase() }}
          </span>
        </div>
        <div class="gop__kpi">
          <dt>{{ t('adminGoogleAdsOpt.statOpportunities') }}</dt>
          <dd>{{ summary.opportunities }}</dd>
          <span class="gop__prio">
            <span
              v-for="p in PRIORITIES"
              :key="p"
              class="gop__prioItem"
              :title="t(`adminGoogleAdsOpt.priority.${p}`)"
            >
              <i :class="`dot dot--${p}`" />{{ summary.issuesByPriority[p] ?? 0 }}
            </span>
          </span>
        </div>
        <button type="button" class="gop__kpi" @click="emit('goto', 'proposals')">
          <dt>{{ t('adminGoogleAdsOpt.statPending') }}</dt>
          <dd :class="{ 'tone-warning': summary.pendingApprovals }">
            {{ summary.pendingApprovals }}
          </dd>
        </button>
      </dl>
    </section>

    <div class="gop__cols">
      <section v-if="summary.accountIssues.length" class="gop__block">
        <h3 class="gop__h">{{ t('adminGoogleAdsOpt.accountIssuesTitle') }}</h3>
        <GoogleAdsIssueList :issues="summary.accountIssues" />
      </section>

      <section class="gop__block" :class="{ 'gop__block--wide': !summary.accountIssues.length }">
        <div class="gop__hrow">
          <h3 class="gop__h">{{ t('adminGoogleAdsOpt.activityTitle') }}</h3>
          <v-btn
            size="small"
            variant="text"
            append-icon="mdi-arrow-right"
            @click="emit('goto', 'activity')"
          >
            {{ t('adminGoogleAdsOpt.seeAll') }}
          </v-btn>
        </div>
        <GoogleAdsActivityFeed ref="feed" :limit="6" compact @running="(v) => emit('running', v)" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.gop {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

/* Score + KPI strip: one surface with dividers instead of six bordered cards */
.gop__strip {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.gop__score {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem 1.25rem;
  border-right: 1px solid var(--tvz-hairline);
  flex: none;
}
.gop__scoreText {
  max-width: 9rem;
  font-weight: 600;
  font-size: var(--tvz-fs-small);
}
.gop__kpis {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
}
.gop__kpi {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.9rem 1.1rem;
  border: 0;
  border-left: 1px solid var(--tvz-hairline);
  background: none;
  text-align: left;
  font: inherit;
  color: inherit;
  min-width: 0;
}
.gop__kpi:first-child {
  border-left: 0;
}
button.gop__kpi {
  cursor: pointer;
}
button.gop__kpi:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}
.gop__kpi dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gop__kpi dd {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.gop__sub {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tone-success {
  color: rgb(var(--v-theme-success));
}
.tone-warning {
  color: rgb(var(--v-theme-warning));
}
.gop__prio {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.5rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-variant-numeric: tabular-nums;
}
.gop__prioItem {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot--critical {
  background: rgb(var(--v-theme-error));
}
.dot--high {
  background: rgb(var(--v-theme-warning));
}
.dot--medium {
  background: rgb(var(--v-theme-primary));
}
.dot--low {
  background: rgba(var(--v-theme-on-surface), 0.3);
}

.gop__cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 1.75rem;
  align-items: start;
}
.gop__block {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}
.gop__block--wide {
  grid-column: 1 / -1;
}
.gop__hrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gop__h {
  margin: 0;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}

@media (max-width: 1100px) {
  .gop__strip {
    flex-direction: column;
  }
  .gop__score {
    border-right: 0;
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .gop__cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 700px) {
  .gop__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .gop__kpi {
    border-left: 0;
    border-top: 1px solid var(--tvz-hairline);
  }
  .gop__kpi:nth-child(even) {
    border-left: 1px solid var(--tvz-hairline);
  }
  .gop__kpi:first-child,
  .gop__kpi:nth-child(2) {
    border-top: 0;
  }
  .gop__kpi:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}
</style>
