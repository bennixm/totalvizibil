<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

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
</script>

<template>
  <v-container class="inv">
    <header class="inv__head">
      <div>
        <p class="inv__eyebrow">{{ t('invoices.eyebrow') }}</p>
        <h1>{{ t('invoices.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'dashboard' }">
        {{ t('wallet.backToDashboard') }}
      </v-btn>
    </header>

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

      <section class="inv__list">
        <p v-if="!invoices.length" class="inv__empty">{{ t('invoices.empty') }}</p>
        <table v-else class="inv__table">
          <thead>
            <tr>
              <th>{{ t('invoices.colNumber') }}</th>
              <th>{{ t('invoices.colDate') }}</th>
              <th>{{ t('invoices.colTotal') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in invoices" :key="inv.id">
              <td>{{ inv.number }}</td>
              <td>{{ new Date(inv.issuedAt).toLocaleDateString() }}</td>
              <td>{{ total(inv.totalMinor) }}</td>
              <td class="text-right">
                <a :href="`/account/invoices/${inv.id}`" target="_blank" rel="noopener" class="inv__link">
                  {{ t('invoices.view') }}
                  <v-icon icon="mdi-open-in-new" size="13" />
                </a>
              </td>
            </tr>
          </tbody>
        </table>
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
  max-width: 780px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.inv__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.inv__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.inv__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.inv__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.inv__notice {
  display: flex;
  gap: 0.6rem;
  padding: 0.9rem 1.1rem;
  margin-bottom: 1.25rem;
  border-radius: var(--tvz-radius-md);
}
.inv__notice--warn {
  background: rgb(var(--v-theme-warning) / 0.1);
  border: 1px solid rgb(var(--v-theme-warning) / 0.35);
  color: rgb(var(--v-theme-warning));
}
.inv__notice strong {
  display: block;
  margin-bottom: 0.15rem;
}
.inv__notice p {
  margin: 0.1rem 0 0;
  color: rgb(var(--v-theme-on-surface) / 0.75);
}
.inv__empty {
  padding: 2.5rem 1rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.inv__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.inv__table th {
  text-align: left;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.inv__table td {
  padding: 0.7rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.inv__link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.inv__foot {
  margin-top: 1.25rem;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
</style>
