<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import { useBillingStore } from '@/stores/billing'

const { t, n } = useI18n()
const billing = useBillingStore()
const { profile, isComplete, unbilledCount, invoices, loading, working } = storeToRefs(billing)

onMounted(() => billing.load())

function total(minor: number): string {
  return `${n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`
}
async function issueMissing(): Promise<void> {
  await billing.backfill()
}

// Everything loads in one page-load — filtering happens client-side, no
// extra requests needed.
const search = ref('')
const kind = ref<'topup' | 'affiliate_reward' | null>(null)
const kindItems = computed(() => [
  { value: null, title: t('invoices.filterAnyKind') },
  { value: 'topup', title: t('invoices.filterTopup') },
  { value: 'affiliate_reward', title: t('invoices.kindReward') },
])
const filteredInvoices = computed(() => {
  const q = search.value.trim().toLowerCase()
  return invoices.value.filter((inv) => {
    if (kind.value && inv.kind !== kind.value) return false
    if (q && !inv.number.toLowerCase().includes(q)) return false
    return true
  })
})
</script>

<template>
  <v-container class="inv">
    <AdminPageHeader
      :eyebrow="t('invoices.eyebrow')"
      :title="t('invoices.title')"
      :count="invoices.length || undefined"
    />

    <div v-if="loading" class="inv__center"><v-progress-circular indeterminate color="primary" /></div>

    <template v-else>
      <div v-if="!isComplete" class="inv__notice inv__notice--warn">
        <v-icon icon="mdi-file-document-alert-outline" size="18" />
        <div>
          <strong>{{ t('invoices.incompleteTitle') }}</strong>
          <p>{{ t('invoices.incompleteText') }}</p>
          <v-btn
            class="mt-2"
            color="primary"
            size="small"
            variant="tonal"
            append-icon="mdi-arrow-right"
            :to="{ name: 'account', query: { tab: 'billing' } }"
          >
            {{ t('invoices.incompleteCta') }}
          </v-btn>
        </div>
      </div>

      <div v-else-if="unbilledCount > 0" class="inv__notice inv__notice--warn">
        <v-icon icon="mdi-receipt-text-remove-outline" size="18" />
        <div>
          <strong>{{ t('invoices.unbilledTitle') }}</strong>
          <p>{{ t('invoices.unbilledText', { n: unbilledCount }) }}</p>
          <v-btn class="mt-2" size="small" variant="tonal" :loading="working" @click="issueMissing">
            {{ t('invoices.issueMissing') }}
          </v-btn>
        </div>
      </div>

      <div v-if="invoices.length" class="inv__filters">
        <v-text-field
          v-model="search"
          :placeholder="t('invoices.searchPlaceholder')"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="inv__search"
        />
        <v-select
          v-model="kind"
          :items="kindItems"
          variant="outlined"
          density="compact"
          hide-details
          class="inv__sel"
        />
      </div>

      <section class="inv__list">
        <p v-if="!invoices.length" class="inv__empty">{{ t('invoices.empty') }}</p>
        <p v-else-if="!filteredInvoices.length" class="inv__empty">{{ t('invoices.noResults') }}</p>
        <ul v-else class="inv__rows">
          <li v-for="inv in filteredInvoices" :key="inv.id" class="irow">
            <span class="irow__icon">
              <v-icon icon="mdi-receipt-text-outline" size="18" />
            </span>
            <div class="irow__main">
              <p class="irow__label">
                {{ inv.number }}
                <v-chip
                  v-if="inv.kind === 'affiliate_reward'"
                  size="x-small"
                  variant="tonal"
                  color="primary"
                  class="ms-1"
                >
                  {{ t('invoices.kindReward') }}
                </v-chip>
              </p>
              <p class="irow__date">{{ new Date(inv.issuedAt).toLocaleDateString() }}</p>
            </div>
            <div class="irow__end">
              <span class="irow__total">{{ total(inv.totalMinor) }}</span>
              <a
                :href="`/account/invoices/${inv.id}`"
                target="_blank"
                rel="noopener"
                class="irow__link"
              >
                {{ t('invoices.view') }} <v-icon icon="mdi-open-in-new" size="13" />
              </a>
            </div>
          </li>
        </ul>
      </section>

      <p v-if="profile" class="inv__foot">
        {{ t('invoices.profileNote', { name: profile.name }) }}
        <router-link :to="{ name: 'account', query: { tab: 'billing' } }">
          {{ t('invoices.editProfile') }}
        </router-link>
      </p>
    </template>
  </v-container>
</template>

<style scoped>
.inv {
  max-width: 820px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.inv__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.inv__filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.inv__search {
  flex: 1 1 220px;
}
.inv__sel {
  max-width: 12rem;
}
.inv__notice {
  display: flex;
  gap: 0.6rem;
  padding: 0.9rem 1.1rem;
  margin-bottom: 1.25rem;
  border-radius: var(--tvz-radius-md);
}
.inv__notice--warn {
  background: rgba(var(--v-theme-warning), 0.1);
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  color: rgb(var(--v-theme-warning));
}
.inv__notice strong {
  display: block;
  margin-bottom: 0.15rem;
}
.inv__notice p {
  margin: 0.1rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.inv__empty {
  padding: 2.5rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.inv__rows {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.irow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  transition: background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.irow:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.irow + .irow {
  border-top: 1px solid var(--tvz-hairline);
}
.irow__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.irow__main {
  flex: 1;
  min-width: 0;
}
.irow__label {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}
.irow__date {
  margin: 0.1rem 0 0;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.irow__end {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.2rem;
}
.irow__total {
  font-size: 0.9rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.irow__link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.inv__foot {
  margin-top: 1.25rem;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
</style>
