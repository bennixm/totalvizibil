<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import CreditsValue from '@/components/CreditsValue.vue'
import { useWalletStore } from '@/stores/wallet'

const { t } = useI18n()
const wallet = useWalletStore()
const { transactions, nextCursor, loading, working } = storeToRefs(wallet)

onMounted(() => wallet.loadTransactions(false))
</script>

<template>
  <v-container class="txn">
    <header class="txn__head">
      <div>
        <p class="txn__eyebrow">{{ t('transactions.eyebrow') }}</p>
        <h1>{{ t('transactions.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'wallet' }">
        {{ t('transactions.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !transactions.length" class="txn__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <section class="txn__list">
        <p v-if="!transactions.length" class="txn__empty">{{ t('wallet.historyEmpty') }}</p>
        <table v-else class="txn__table">
          <thead>
            <tr>
              <th>{{ t('wallet.colType') }}</th>
              <th>{{ t('wallet.colAmount') }}</th>
              <th>{{ t('wallet.colStatus') }}</th>
              <th>{{ t('wallet.colDate') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="txn in transactions" :key="txn.id">
              <td>
                {{ txn.clicks != null ? t('wallet.adClicks') : t('wallet.txnType.' + txn.type) }}
                <span v-if="txn.clicks != null" class="txn__biz">
                  · {{ t('wallet.nClicks', { n: txn.clicks }) }}
                </span>
                <span v-if="txn.companyName" class="txn__biz">· {{ txn.companyName }}</span>
              </td>
              <td :class="txn.amount.minor < 0 ? 'is-out' : 'is-in'">
                <CreditsValue :credits="txn.amount.credits" signed stacked />
              </td>
              <td>
                <span class="txn__badge" :class="'txn__badge--' + txn.status">
                  {{ t('wallet.txnStatus.' + txn.status) }}
                </span>
              </td>
              <td>{{ new Date(txn.createdAt).toLocaleDateString() }}</td>
            </tr>
          </tbody>
        </table>
        <v-btn
          v-if="nextCursor"
          variant="text"
          size="small"
          :loading="working"
          @click="wallet.loadTransactions(true)"
        >
          {{ t('wallet.loadMore') }}
        </v-btn>
      </section>
    </template>
  </v-container>
</template>

<style scoped>
.txn {
  max-width: 780px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.txn__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.txn__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.txn__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.txn__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.txn__empty {
  padding: 2.5rem 1rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.txn__biz {
  color: rgb(var(--v-theme-on-surface) / 0.5);
  font-size: 0.8rem;
}
.txn__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.txn__table th {
  text-align: left;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.txn__table td {
  padding: 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.txn__table .is-in {
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}
.txn__table .is-out {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.txn__badge {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
}
.txn__badge--completed {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.txn__badge--pending {
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}
</style>
