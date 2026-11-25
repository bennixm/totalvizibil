<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import { healthOf } from '@/components/ads/format'
import '@/components/ads/ads.css'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import type { UserCampaignSummary } from '@/services/googleAdsUser'

/**
 * Home of the Google Ads area: every campaign of the owner with what it
 * needs now, or (none yet) the three steps to get started.
 */
const { t } = useI18n()
const ads = useGoogleAdsUserStore()

const add = computed(() => ({ name: ads.campaigns.length ? 'ads-connections' : 'ads-connect' }))

function state(c: UserCampaignSummary): { tone: 'success' | 'warning' | 'error' | 'neutral'; text: string } {
  if (c.status === 'disconnected') return { tone: 'error', text: t('ads.list.reconnect') }
  if (c.pendingApprovals) return { tone: 'warning', text: t('ads.list.approve', { n: c.pendingApprovals }) }
  if (c.status === 'paused') return { tone: 'neutral', text: t('ads.list.paused') }
  const h = healthOf(c.score)
  return { tone: h === 'weak' ? 'error' : h === 'fair' ? 'warning' : h ? 'success' : 'neutral', text: h ? t(`ads.home.health.${h}`) : t('ads.list.new') }
}

onMounted(() => void ads.fetch(true))
</script>

<template>
  <v-container class="al" fluid>
    <AdminPageHeader eyebrow="Google Ads" :title="t('ads.list.title')">
      <template v-if="ads.campaigns.length" #actions>
        <v-btn color="primary" prepend-icon="mdi-plus" :to="add">{{ t('ads.list.add') }}</v-btn>
      </template>
    </AdminPageHeader>

    <div v-if="!ads.loaded" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>

    <p v-else-if="ads.failed && !ads.campaigns.length" class="ab-note ab-note--warn">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <span>{{ t('ads.dash.loadError') }}</span>
      <v-btn size="small" variant="text" @click="ads.fetch(true)">{{ t('common.retry') }}</v-btn>
    </p>

    <section v-else-if="!ads.campaigns.length" class="al__empty">
      <span class="al__icon"><v-icon icon="mdi-google-ads" size="30" /></span>
      <h2>{{ t('ads.list.emptyTitle') }}</h2>
      <p>{{ t('ads.list.emptyText') }}</p>
      <ol>
        <li v-for="i in 3" :key="i"><span>{{ i }}</span>{{ t(`ads.list.step${i}`) }}</li>
      </ol>
      <v-btn color="primary" size="large" prepend-icon="mdi-google" :to="{ name: 'ads-connect' }">{{ t('ads.list.emptyCta') }}</v-btn>
    </section>

    <div v-else class="al__list">
      <RouterLink v-for="c in ads.campaigns" :key="c.id" :to="{ name: 'ads-dashboard', params: { id: c.id } }" class="cd">
        <span class="cd__icon"><v-icon icon="mdi-bullhorn-outline" size="20" /></span>
        <span class="cd__main">
          <b>{{ c.name }}</b>
          <small v-if="c.customerName">{{ t('ads.list.account', { name: c.customerName }) }}</small>
        </span>
        <GaChip :tone="state(c).tone">{{ state(c).text }}</GaChip>
        <span class="cd__open">{{ t('ads.list.open') }} <v-icon icon="mdi-arrow-right" size="16" /></span>
      </RouterLink>
    </div>
  </v-container>
</template>

<style scoped>
.al__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.cd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 0.9rem;
  padding: 1rem 1.15rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  text-decoration: none;
  transition: border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.cd:hover,
.cd:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.cd__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.cd__main {
  flex: 1 1 12rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-wrap: anywhere;
}
.cd__main small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cd__open {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 600;
  font-size: var(--tvz-fs-small);
  color: rgb(var(--v-theme-primary));
}
.al__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
  padding: 2.2rem 1.4rem;
  text-align: center;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.al__icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.al__empty h2 {
  margin: 0;
  font-size: 1.3rem;
}
.al__empty p {
  margin: 0;
  max-width: 52ch;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.al__empty ol {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 0.2rem 0 0.4rem;
  padding: 0;
  list-style: none;
  text-align: left;
}
.al__empty li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.al__empty li span {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
</style>
