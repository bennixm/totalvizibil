<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import InfoHint from '@/components/InfoHint.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useLeadsStore, type Lead, type LeadStatus } from '@/stores/leads'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const leads = useLeadsStore()
const { items, summary, filters, loading, working, nextCursor, error } = storeToRefs(leads)

const companyId = ref<string | null>(null)
const expanded = ref<string | null>(null)
const toDelete = ref<Lead | null>(null)

const STATUS_TABS: Array<{ v: '' | LeadStatus; key: string }> = [
  { v: '', key: 'leads.filterAll' },
  { v: 'new', key: 'leads.filterNew' },
  { v: 'resolved', key: 'leads.filterResolved' },
]
const CHANNEL_TABS = [
  { v: '' as const, key: 'leads.chAll' },
  { v: 'form' as const, key: 'leads.chForm' },
  { v: 'call' as const, key: 'leads.chCall' },
]

const rtf = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }))
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 60) return rtf.value.format(-min, 'minute')
  const hr = Math.round(min / 60)
  if (hr < 24) return rtf.value.format(-hr, 'hour')
  return rtf.value.format(-Math.round(hr / 24), 'day')
}
function responseText(min: number): string {
  if (min < 60) return t('leads.respondedIn', { v: `${min} min` })
  if (min < 60 * 24) return t('leads.respondedIn', { v: `${Math.round(min / 60)} h` })
  return t('leads.respondedIn', { v: `${Math.round(min / 1440)} zile` })
}
function avgText(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  if (min < 60 * 24) return `${Math.round(min / 60)} h`
  return `${Math.round(min / 1440)} zile`
}

async function confirmDelete(): Promise<void> {
  if (!toDelete.value) return
  await leads.remove(toDelete.value.id)
  toDelete.value = null
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await leads.load(id)
})
</script>

<template>
  <v-container class="lds">
    <header class="lds__head">
      <div>
        <p class="lds__eyebrow">{{ t('leads.eyebrow') }}</p>
        <h1>{{ t('leads.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'dashboard' }">
        {{ t('leads.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !summary" class="lds__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Summary -->
      <div v-if="summary" class="lds__stats">
        <div><span>{{ t('leads.statNew') }}</span><strong>{{ summary.new }}</strong></div>
        <div><span>{{ t('leads.statTotal') }}</span><strong>{{ summary.total }}</strong></div>
        <div><span>{{ t('leads.statForm') }}</span><strong>{{ summary.form }}</strong></div>
        <div><span>{{ t('leads.statCall') }}</span><strong>{{ summary.call }}</strong></div>
        <div>
          <span>
            {{ t('leads.statAvg') }}
            <InfoHint :text="t('leads.statAvgHint')" />
          </span>
          <strong>{{ avgText(summary.avgResponseMinutes) }}</strong>
        </div>
      </div>

      <!-- Filters -->
      <div class="lds__filters">
        <div class="lds__seg">
          <button
            v-for="tab in STATUS_TABS"
            :key="tab.v || 'all'"
            type="button"
            :class="{ 'is-on': filters.status === tab.v }"
            @click="leads.setFilter('status', tab.v)"
          >
            {{ t(tab.key) }}
          </button>
        </div>
        <div class="lds__seg">
          <button
            v-for="tab in CHANNEL_TABS"
            :key="tab.v || 'all'"
            type="button"
            :class="{ 'is-on': filters.channel === tab.v }"
            @click="leads.setFilter('channel', tab.v)"
          >
            {{ t(tab.key) }}
          </button>
        </div>
      </div>

      <div v-if="error" class="lds__error">
        <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ error }}
      </div>

      <!-- Empty -->
      <div v-if="!items.length" class="lds__empty">
        <v-icon icon="mdi-inbox-outline" size="36" />
        <p>{{ t('leads.empty') }}</p>
        <span>{{ t('leads.emptyHint') }}</span>
      </div>

      <!-- List -->
      <ul v-else class="lds__list">
        <li
          v-for="lead in items"
          :key="lead.id"
          class="lead"
          :class="{ 'lead--new': lead.status === 'new' }"
        >
          <div class="lead__top">
            <span class="lead__ic" :class="`lead__ic--${lead.channel}`">
              <v-icon :icon="lead.channel === 'call' ? 'mdi-phone' : 'mdi-email-outline'" size="16" />
            </span>
            <div class="lead__who">
              <strong>{{ lead.name || (lead.channel === 'call' ? t('leads.aCall') : t('leads.aMessage')) }}</strong>
              <span class="lead__time">{{ ago(lead.createdAt) }}</span>
            </div>
            <span class="lead__badge" :class="`lead__badge--${lead.status}`">
              {{ t('leads.status.' + lead.status) }}
            </span>
          </div>

          <p
            v-if="lead.message"
            class="lead__msg"
            :class="{ 'is-clamped': expanded !== lead.id }"
            @click="expanded = expanded === lead.id ? null : lead.id"
          >
            {{ lead.message }}
          </p>

          <div class="lead__contacts">
            <a v-if="lead.email" :href="`mailto:${lead.email}`" class="lead__chip">
              <v-icon icon="mdi-email-outline" size="14" /> {{ lead.email }}
            </a>
            <a v-if="lead.phone" :href="`tel:${lead.phone}`" class="lead__chip">
              <v-icon icon="mdi-phone" size="14" /> {{ lead.phone }}
            </a>
            <span v-if="lead.responseMinutes != null" class="lead__resp">
              <v-icon icon="mdi-clock-fast" size="14" /> {{ responseText(lead.responseMinutes) }}
            </span>
          </div>

          <div class="lead__actions">
            <v-btn
              v-if="!lead.firstResponseAt"
              size="x-small"
              variant="tonal"
              :disabled="working"
              prepend-icon="mdi-reply"
              @click="leads.markResponded(lead.id)"
            >
              {{ lead.channel === 'call' ? t('leads.markCalled') : t('leads.markResponded') }}
            </v-btn>
            <v-btn
              v-if="lead.status !== 'resolved'"
              size="x-small"
              variant="tonal"
              color="success"
              :disabled="working"
              prepend-icon="mdi-check"
              @click="leads.markResolved(lead.id)"
            >
              {{ t('leads.markResolved') }}
            </v-btn>
            <v-btn
              v-else
              size="x-small"
              variant="text"
              :disabled="working"
              prepend-icon="mdi-restore"
              @click="leads.reopen(lead.id)"
            >
              {{ t('leads.reopen') }}
            </v-btn>
            <v-spacer />
            <v-btn
              size="x-small"
              variant="text"
              color="error"
              :disabled="working"
              icon="mdi-trash-can-outline"
              :aria-label="t('leads.delete')"
              @click="toDelete = lead"
            />
          </div>
        </li>
      </ul>

      <v-btn
        v-if="nextCursor"
        variant="text"
        size="small"
        class="mt-2"
        :loading="working"
        @click="leads.loadMore()"
      >
        {{ t('leads.loadMore') }}
      </v-btn>
    </template>

    <v-dialog :model-value="!!toDelete" max-width="400" @update:model-value="toDelete = null">
      <v-card>
        <v-card-title class="text-h6">{{ t('leads.deleteConfirmTitle') }}</v-card-title>
        <v-card-text>{{ t('leads.deleteConfirmText') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="working" @click="toDelete = null">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="error" variant="flat" :loading="working" @click="confirmDelete">
            {{ t('leads.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.lds {
  max-width: 720px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.lds__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.lds__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.lds__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.lds__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}

.lds__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 1px;
  background: var(--tvz-hairline);
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
  margin-bottom: 1.25rem;
}
.lds__stats > div {
  background: rgb(var(--v-theme-surface));
  padding: 0.7rem 0.85rem;
}
.lds__stats span {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.lds__stats strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}

.lds__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.lds__seg {
  display: inline-flex;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 999px;
  overflow: hidden;
}
.lds__seg button {
  padding: 0.32rem 0.8rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.lds__seg button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.lds__seg button.is-on {
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}

.lds__error {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: rgb(var(--v-theme-error));
  font-size: 0.82rem;
  margin-bottom: 0.75rem;
}
.lds__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
  padding: 3rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.lds__empty p {
  margin: 0;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.lds__empty span {
  font-size: 0.85rem;
}

.lds__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.lead {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  padding: 1rem 1.1rem;
  background: rgb(var(--v-theme-surface));
}
.lead--new {
  border-color: rgb(var(--v-theme-primary) / 0.4);
  background:
    linear-gradient(180deg, rgb(var(--v-theme-primary) / 0.05), transparent 40%),
    rgb(var(--v-theme-surface));
}
.lead__top {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.lead__ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  flex: none;
  color: #fff;
}
.lead__ic--form {
  background: rgb(var(--v-theme-primary));
}
.lead__ic--call {
  background: rgb(var(--v-theme-success));
}
.lead__who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.lead__who strong {
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lead__time {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.lead__badge {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.65);
  flex: none;
}
.lead__badge--new {
  background: rgb(var(--v-theme-primary) / 0.16);
  color: rgb(var(--v-theme-primary));
}
.lead__badge--resolved {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.lead__msg {
  margin: 0.7rem 0 0;
  font-size: 0.9rem;
  line-height: 1.55;
  color: rgb(var(--v-theme-on-surface) / 0.85);
  cursor: pointer;
  white-space: pre-wrap;
}
.lead__msg.is-clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lead__contacts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.7rem;
}
.lead__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  padding: 0.2rem 0.55rem;
  border-radius: 8px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  color: rgb(var(--v-theme-on-surface) / 0.8);
  text-decoration: none;
}
.lead__chip:hover {
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}
.lead__resp {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-success));
}
.lead__actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.9rem;
  flex-wrap: wrap;
}
</style>
