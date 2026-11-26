<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import GaChip from '@/components/admin/google-ads/GaChip.vue'
import { creditsOf, dateTime } from '@/components/ads/format'
import { apiFetch } from '@/services/api'
import type { TicketAdsCampaign } from '@/stores/support'

/** Staff side of a ticket: the customer's Google Ads campaigns, read only. */
const props = defineProps<{ ticketId: string }>()
const { t, locale } = useI18n()

const items = ref<TicketAdsCampaign[]>([])
const failed = ref(false)
const loaded = ref(false)

async function load(): Promise<void> {
  const id = props.ticketId
  loaded.value = false
  try {
    const res = await apiFetch<{ items: TicketAdsCampaign[] }>(`/support/tickets/${id}/google-ads`)
    if (id !== props.ticketId) return
    items.value = res.items
    failed.value = false
  } catch {
    if (id !== props.ticketId) return
    failed.value = true
  }
  loaded.value = true
}
watch(() => props.ticketId, load, { immediate: true })

const tone = (s: string) => (s === 'active' ? 'success' : s === 'paused' ? 'neutral' : 'error')
</script>

<template>
  <div class="sap">
    <v-progress-circular v-if="!loaded" indeterminate size="18" width="2" color="primary" />
    <p v-else-if="failed" class="sap__muted">
      {{ t('admin.genericError') }}
      <v-btn size="x-small" variant="text" @click="load">{{ t('common.retry') }}</v-btn>
    </p>
    <p v-else-if="!items.length" class="sap__muted">{{ t('support.adsNone') }}</p>
    <details v-for="c in items" v-else :key="c.id" class="sap__c" :open="c.about">
      <summary>
        <b>{{ c.name }}</b>
        <GaChip :tone="tone(c.status)">{{ t(`ads.campaignStatus.${c.status}`) }}</GaChip>
      </summary>
      <p v-if="c.about" class="sap__about">{{ t('support.adsAbout') }}</p>
      <p class="sap__muted">
        <template v-if="c.score != null">{{ c.score }}/100 · </template>{{ c.googleEmail ?? '–' }}
        <template v-if="c.nextCycleAt"> · {{ t('ads.dash.nextCycle', { when: dateTime(c.nextCycleAt, locale) }) }}</template>
      </p>
      <p v-if="c.pendingApprovals" class="sap__muted">{{ t('ads.list.approve', { n: c.pendingApprovals }) }}</p>
      <p v-if="c.status === 'disconnected' && c.lastError" class="sap__err">{{ c.lastError }}</p>
      <ul>
        <li v-for="x in c.cycles" :key="x.id">
          <span>{{ dateTime(x.startedAt, locale) }} · {{ t(`ads.cycle.${x.status}`) }}</span>
          <small>{{ t('support.adsCycle', { applied: x.tasksApplied, proposed: x.tasksProposed, credits: creditsOf(x.chargedMinor, locale) }) }}</small>
          <small v-if="x.errorMessage" class="sap__err">{{ x.errorMessage }}</small>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.sap {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  font-size: var(--tvz-fs-small);
}
.sap__c summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.sap__c summary b {
  min-width: 0;
  overflow-wrap: anywhere;
}
.sap p {
  margin: 0.3rem 0 0;
}
.sap__muted,
.sap small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.sap__about {
  color: rgb(var(--v-theme-primary));
}
.sap .sap__err {
  color: rgb(var(--v-theme-error));
  overflow-wrap: anywhere;
}
.sap ul {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
}
.sap li {
  display: flex;
  flex-direction: column;
  padding: 0.35rem 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
</style>
