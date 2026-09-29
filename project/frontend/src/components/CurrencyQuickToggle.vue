<script setup lang="ts">
/**
 * Wallet display-currency (EUR/RON) switcher — lives in the navbar's quiet
 * utility strip (alongside ThemeQuickToggle/LocaleSwitcher) so it's always
 * reachable, same idea those two already establish.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useWalletStore } from '@/stores/wallet'

const { t } = useI18n()
const wallet = useWalletStore()
const { summary, working } = storeToRefs(wallet)

const CURRENCIES = ['EUR', 'RON'] as const

const currentCurrency = computed(() => summary.value?.currency ?? 'EUR')

function pick(c: (typeof CURRENCIES)[number]): void {
  void wallet.setCurrency(c)
}

onMounted(() => {
  void wallet.ensureSummary().catch(() => {})
})
</script>

<template>
  <v-menu location="bottom end">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        size="small"
        variant="text"
        class="text-none"
        :aria-label="t('wallet.currencyLabel')"
        prepend-icon="mdi-currency-eur"
      >
        {{ t('wallet.currency' + currentCurrency) }}
      </v-btn>
    </template>

    <v-list density="compact" min-width="140" nav>
      <v-list-item
        v-for="c in CURRENCIES"
        :key="c"
        :active="currentCurrency === c"
        :title="t('wallet.currency' + c)"
        :disabled="working"
        @click="pick(c)"
      />
    </v-list>
  </v-menu>
</template>
