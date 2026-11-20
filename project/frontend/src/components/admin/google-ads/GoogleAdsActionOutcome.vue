<script setup lang="ts">
/**
 * What happened to one agent action, from real data only: the admin's
 * manual instructions it was revised from, the outcome Google reported /
 * the verification re-read found, the failure, and the campaign's 30-day
 * metrics at execution vs ~30 days later (observational).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GoogleAdsAgentActionRow } from '@/stores/admin'

const props = defineProps<{ action: GoogleAdsAgentActionRow }>()
const { t } = useI18n()

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const rows = computed(() => {
  const a = props.action.metricsAtApply
  const b = props.action.metricsObserved
  if (!a || !b) return []
  const ctr = (m: Record<string, unknown>) =>
    n(m.impressions) ? n(m.clicks) / n(m.impressions) : null
  const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(2)}%`)
  return [
    {
      label: t('adminGoogleAdsOpt.colImpressions'),
      before: n(a.impressions).toLocaleString(),
      after: n(b.impressions).toLocaleString(),
    },
    {
      label: t('adminGoogleAdsOpt.colClicks'),
      before: n(a.clicks).toLocaleString(),
      after: n(b.clicks).toLocaleString(),
    },
    { label: t('adminGoogleAdsOpt.colCtr'), before: pct(ctr(a)), after: pct(ctr(b)) },
    {
      label: t('adminGoogleAdsOpt.colConversions'),
      before: n(a.conversions).toLocaleString(),
      after: n(b.conversions).toLocaleString(),
    },
  ]
})
const awaitingObservation = computed(
  () =>
    props.action.status === 'applied' && !!props.action.metricsAtApply && !props.action.observedAt,
)
</script>

<template>
  <div
    v-if="
      action.manualInstructions ||
      action.executionResult ||
      action.errorMessage ||
      rows.length ||
      awaitingObservation
    "
    class="gao"
  >
    <p v-if="action.manualInstructions" class="gao__line gao__line--instr">
      <v-icon icon="mdi-account-edit-outline" size="15" />
      <span
        ><b>{{ t('adminGoogleAdsOpt.yourInstructions') }}:</b> „{{
          action.manualInstructions
        }}”</span
      >
    </p>
    <p v-if="action.executionResult" class="gao__line gao__line--ok">
      <v-icon
        :icon="action.verifiedAt ? 'mdi-check-decagram' : 'mdi-information-outline'"
        size="15"
      />
      <span
        ><b>{{ t('adminGoogleAdsOpt.executionResult') }}:</b> {{ action.executionResult }}</span
      >
    </p>
    <p v-if="action.errorMessage" class="gao__line gao__line--err">
      <v-icon icon="mdi-alert-circle-outline" size="15" />
      <span>{{ action.errorMessage }}</span>
    </p>
    <div v-if="rows.length" class="gao__obs">
      <div class="gao__obsTitle">{{ t('adminGoogleAdsOpt.observationTitle') }}</div>
      <table>
        <tbody>
          <tr v-for="r in rows" :key="r.label">
            <th>{{ r.label }}</th>
            <td>{{ r.before }}</td>
            <td class="gao__arrow">→</td>
            <td>
              <b>{{ r.after }}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="gao__note">{{ t('adminGoogleAdsOpt.observationNote') }}</p>
    </div>
    <p v-else-if="awaitingObservation" class="gao__note">
      {{ t('adminGoogleAdsOpt.observationPending') }}
    </p>
  </div>
</template>

<style scoped>
.gao {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.4rem;
}
.gao__line {
  display: flex;
  gap: 0.35rem;
  align-items: flex-start;
  margin: 0;
  font-size: var(--tvz-fs-small);
  overflow-wrap: anywhere;
}
.gao__line .v-icon {
  margin-top: 0.15rem;
  flex: none;
}
.gao__line--instr {
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.gao__line--ok .v-icon {
  color: rgb(var(--v-theme-success));
}
.gao__line--err {
  color: rgb(var(--v-theme-error));
}
.gao__obs {
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-sm);
  padding: 0.5rem 0.7rem;
  font-size: var(--tvz-fs-small);
}
.gao__obsTitle {
  font-weight: 600;
  margin-bottom: 0.3rem;
}
.gao__obs table {
  border-collapse: collapse;
}
.gao__obs th {
  text-align: left;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.6);
  padding: 0.1rem 1rem 0.1rem 0;
}
.gao__obs td {
  padding: 0.1rem 0.4rem;
  font-variant-numeric: tabular-nums;
}
.gao__arrow {
  opacity: 0.5;
}
.gao__note {
  margin: 0.3rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
</style>
