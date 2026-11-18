<script setup lang="ts">
/**
 * One "Export" button for every finance report: PDF, Excel (.xlsx) and CSV.
 * The page passes a function that builds the download URL for a format
 * from the very same filters as the data on screen, so the file can never
 * cover a different slice than what is displayed.
 */
import { useI18n } from 'vue-i18n'

import type { ExportFormat } from '@/stores/adminFinance'

defineProps<{
  urlFor: (format: ExportFormat) => string
  label?: string
  disabled?: boolean
}>()

const { t } = useI18n()

const FORMATS: { format: ExportFormat; icon: string; key: string }[] = [
  { format: 'pdf', icon: 'mdi-file-pdf-box', key: 'adminFinance.exportPdf' },
  { format: 'xlsx', icon: 'mdi-microsoft-excel', key: 'adminFinance.exportXlsx' },
  { format: 'csv', icon: 'mdi-file-delimited-outline', key: 'adminFinance.exportCsv' },
]
</script>

<template>
  <v-menu location="bottom end">
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        variant="tonal"
        size="small"
        prepend-icon="mdi-download"
        append-icon="mdi-chevron-down"
        :disabled="disabled"
      >
        {{ label ?? t('adminFinance.export') }}
      </v-btn>
    </template>
    <v-list density="compact" min-width="210">
      <v-list-item
        v-for="f in FORMATS"
        :key="f.format"
        :href="urlFor(f.format)"
        :prepend-icon="f.icon"
        :title="t(f.key)"
      />
    </v-list>
  </v-menu>
</template>
