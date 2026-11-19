<script setup lang="ts">
/**
 * "Collection sources": how each paid provider delivers its invoices
 * (official API vs uploaded original), the last automatic import and its
 * outcome. Collapsible: once invoices flow, it's reference, not the task.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ExternalInvoiceProvider, ExternalInvoiceProviderKey } from '@/stores/externalInvoices'

import { useInvoiceFormat } from './useInvoiceFormat'

const props = defineProps<{
  providers: ExternalInvoiceProvider[]
  error: string | null
  syncing: boolean
  activeProvider: string | null
  /** Open by default (e.g. no invoices yet). */
  defaultOpen: boolean
}>()
const emit = defineEmits<{
  sync: []
  upload: [provider: ExternalInvoiceProviderKey]
  filter: [provider: ExternalInvoiceProviderKey | null]
}>()

const { t } = useI18n()
const fmt = useInvoiceFormat()

const STORAGE_KEY = 'tvz.supplierInvoices.sourcesOpen'
function stored(): boolean | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}
const open = ref(stored() ?? props.defaultOpen)
watch(
  () => props.defaultOpen,
  (v) => {
    if (stored() === null) open.value = v
  },
)
function toggle(): void {
  open.value = !open.value
  try {
    localStorage.setItem(STORAGE_KEY, open.value ? '1' : '0')
  } catch {
    /* private mode: just not remembered */
  }
}

function label(p: ExternalInvoiceProvider): string {
  return p.key === 'other' ? t('supplierInvoices.providerOther') : p.name
}
function status(p: ExternalInvoiceProvider): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!p.automated) return { text: t('supplierInvoices.sourceManualOnly'), tone: 'muted' }
  if (p.configured === false) return { text: fmt.reason('not_configured'), tone: 'warn' }
  if (!p.lastSync) return { text: t('supplierInvoices.neverSynced'), tone: 'muted' }
  const at = t('supplierInvoices.lastSync', { at: fmt.dateTime(p.lastSync.at) })
  return p.lastSync.ok
    ? { text: at, tone: 'ok' }
    : { text: `${at}: ${fmt.reason(p.lastSync.message)}`, tone: 'warn' }
}
</script>

<template>
  <section class="src">
    <button type="button" class="src__toggle" :aria-expanded="open" @click="toggle">
      <v-icon icon="mdi-source-branch" size="17" aria-hidden="true" />
      <span class="src__title">{{ t('supplierInvoices.providersTitle') }}</span>
      <span class="src__meta">
        {{ t('supplierInvoices.sourcesMeta', { auto: providers.filter((p) => p.automated).length, total: providers.length }) }}
      </span>
      <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="18" class="src__chev" aria-hidden="true" />
    </button>

    <v-expand-transition>
      <div v-show="open" class="src__body">
        <p v-if="error" class="src__error">{{ error }}</p>
        <ul class="src__list">
          <li v-for="p in providers" :key="p.key" class="srow" :class="{ 'is-active': activeProvider === p.key }">
            <div class="srow__main">
              <div class="srow__name">
                <strong>{{ label(p) }}</strong>
                <span class="srow__kind" :class="p.automated ? 'srow__kind--api' : ''">
                  {{ p.automated ? t('supplierInvoices.chipApi') : t('supplierInvoices.chipManual') }}
                </span>
              </div>
              <p class="srow__how">{{ t(`supplierInvoices.how.${p.key}`) }}</p>
              <p class="srow__status" :class="`srow__status--${status(p).tone}`">
                <v-icon
                  :icon="status(p).tone === 'ok' ? 'mdi-check-circle-outline' : status(p).tone === 'warn' ? 'mdi-alert-outline' : 'mdi-information-outline'"
                  size="14"
                  aria-hidden="true"
                />
                <span>{{ status(p).text }}</span>
              </p>
            </div>
            <div class="srow__side">
              <span class="srow__count">
                {{ t('supplierInvoices.countLine', { invoices: p.invoiceCount, documents: p.documentCount }) }}
              </span>
              <div class="srow__actions">
                <v-btn
                  v-if="p.automated"
                  size="small"
                  variant="tonal"
                  color="primary"
                  prepend-icon="mdi-sync"
                  :loading="syncing"
                  :disabled="p.configured === false"
                  @click="emit('sync')"
                >
                  {{ t('supplierInvoices.syncNow') }}
                </v-btn>
                <v-btn size="small" variant="text" prepend-icon="mdi-upload-outline" @click="emit('upload', p.key)">
                  {{ t('supplierInvoices.upload') }}
                </v-btn>
                <v-btn
                  v-if="p.portalUrl"
                  size="small"
                  variant="text"
                  icon="mdi-open-in-new"
                  :href="p.portalUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="t('supplierInvoices.portal')"
                  :title="t('supplierInvoices.portal')"
                />
                <v-btn
                  v-if="p.invoiceCount"
                  size="small"
                  variant="text"
                  icon="mdi-filter-outline"
                  :color="activeProvider === p.key ? 'primary' : undefined"
                  :aria-label="activeProvider === p.key ? t('supplierInvoices.showAll') : t('supplierInvoices.showOnly')"
                  :title="activeProvider === p.key ? t('supplierInvoices.showAll') : t('supplierInvoices.showOnly')"
                  @click="emit('filter', activeProvider === p.key ? null : p.key)"
                />
              </div>
            </div>
          </li>
        </ul>
      </div>
    </v-expand-transition>
  </section>
</template>

<style scoped>
.src {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  container-type: inline-size;
}
.src__toggle {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.75rem 1rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.src__toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
  border-radius: 12px;
}
.src__title {
  font-size: var(--tvz-fs-section);
  font-weight: 700;
}
.src__meta {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.src__chev {
  margin-left: auto;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.src__body {
  border-top: 1px solid var(--tvz-hairline);
}
.src__error {
  margin: 0;
  padding: 0.6rem 1rem;
  font-size: var(--tvz-fs-small);
  color: rgb(var(--v-theme-error));
}
.src__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.srow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem 1.2rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.srow:last-child {
  border-bottom: 0;
}
.srow.is-active {
  background: rgba(var(--v-theme-primary), 0.05);
}
.srow__main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.srow__name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--tvz-fs-body);
}
.srow__kind {
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.srow__kind--api {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.srow__how {
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.srow__status {
  display: flex;
  align-items: flex-start;
  gap: 0.3rem;
  margin: 0;
  font-size: var(--tvz-fs-caption);
}
.srow__status .v-icon {
  margin-top: 1px;
  flex-shrink: 0;
}
.srow__status--ok {
  color: rgb(var(--v-theme-success));
}
.srow__status--warn {
  color: rgb(var(--v-theme-warning));
}
.srow__status--muted {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.srow__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.3rem;
}
.srow__count {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
}
.srow__actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

@container (max-width: 640px) {
  .srow {
    grid-template-columns: 1fr;
  }
  .srow__side {
    align-items: flex-start;
  }
  .srow__actions {
    flex-wrap: wrap;
  }
}
</style>
