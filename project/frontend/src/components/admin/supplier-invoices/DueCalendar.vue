<script setup lang="ts">
/**
 * Due-date calendar: every invoice with a due date in the month, on its
 * day. Overdue / unpaid / paid read from colour AND an icon. A month grid
 * where there's room, a list grouped by day on narrow screens.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useExternalInvoicesStore, type CalendarItem } from '@/stores/externalInvoices'

import { useInvoiceFormat } from './useInvoiceFormat'

const emit = defineEmits<{ open: [id: string] }>()

const { t, locale } = useI18n()
const store = useExternalInvoicesStore()
const fmt = useInvoiceFormat()

const now = new Date()
const month = ref(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`)
const items = ref<CalendarItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = (await store.fetchCalendar(month.value)).items
    error.value = null
  } catch (e) {
    error.value = fmt.errText(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(month, load)

function shift(delta: number): void {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  month.value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const title = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return fmt.monthName(m, y)
})
const todayKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10)

/** Monday-first weekday labels in the UI language. */
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale.value, { weekday: 'short', timeZone: 'UTC' }),
  ),
)

const byDay = computed(() => {
  const m = new Map<string, CalendarItem[]>()
  for (const it of items.value) m.set(it.dueDate, [...(m.get(it.dueDate) ?? []), it])
  return m
})

const cells = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: { key: string; day: number | null }[] = []
  for (let i = 0; i < lead; i++) out.push({ key: `pad-${i}`, day: null })
  for (let d = 1; d <= days; d++) {
    out.push({ key: `${month.value}-${String(d).padStart(2, '0')}`, day: d })
  }
  while (out.length % 7) out.push({ key: `pad-end-${out.length}`, day: null })
  return out
})

function tone(it: CalendarItem): 'overdue' | 'unpaid' | 'paid' | 'unknown' {
  if (it.paymentStatus === 'paid') return 'paid'
  if (it.overdue) return 'overdue'
  return it.paymentStatus === 'unpaid' ? 'unpaid' : 'unknown'
}
function icon(it: CalendarItem): string {
  return { overdue: 'mdi-alert-circle-outline', unpaid: 'mdi-clock-outline', paid: 'mdi-check-circle-outline', unknown: 'mdi-help-circle-outline' }[tone(it)]
}

/** Month totals still to pay, per currency. */
const toPay = computed(() => {
  const m = new Map<string, number>()
  for (const it of items.value) if (it.paymentStatus !== 'paid') m.set(it.currency, (m.get(it.currency) ?? 0) + it.totalMinor)
  return [...m.entries()].map(([c, v]) => fmt.amount(v, c)).join(' · ')
})
const daysWithItems = computed(() => [...byDay.value.entries()].sort(([a], [b]) => a.localeCompare(b)))
</script>

<template>
  <section class="cal">
    <header class="cal__bar">
      <v-btn icon="mdi-chevron-left" size="small" variant="text" :aria-label="t('supplierInvoices.prevMonth')" @click="shift(-1)" />
      <h2 class="cal__title">{{ title }}</h2>
      <v-btn icon="mdi-chevron-right" size="small" variant="text" :aria-label="t('supplierInvoices.nextMonth')" @click="shift(1)" />
      <v-progress-circular v-if="loading" indeterminate size="16" width="2" class="ml-1" />
      <span class="cal__sum">
        {{ t('supplierInvoices.calCount', { n: items.length }) }}<template v-if="toPay"> · {{ t('supplierInvoices.calToPay', { amount: toPay }) }}</template>
      </span>
    </header>
    <ul class="cal__legend" :aria-label="t('supplierInvoices.legend')">
      <li class="lg lg--overdue"><v-icon icon="mdi-alert-circle-outline" size="13" /> {{ t('supplierInvoices.kpiOverdue') }}</li>
      <li class="lg lg--unpaid"><v-icon icon="mdi-clock-outline" size="13" /> {{ t('supplierInvoices.statusUnpaid') }}</li>
      <li class="lg lg--paid"><v-icon icon="mdi-check-circle-outline" size="13" /> {{ t('supplierInvoices.statusPaid') }}</li>
      <li class="lg lg--unknown"><v-icon icon="mdi-help-circle-outline" size="13" /> {{ t('supplierInvoices.statusUnknown') }}</li>
    </ul>

    <p v-if="error" class="cal__error">{{ error }}</p>

    <!-- Grid (wide) -->
    <div class="grid" role="grid" :aria-label="title">
      <div v-for="w in weekdays" :key="w" class="grid__wd" role="columnheader">{{ w }}</div>
      <div
        v-for="c in cells"
        :key="c.key"
        class="day"
        :class="{ 'day--pad': !c.day, 'day--today': c.key === todayKey }"
        role="gridcell"
      >
        <template v-if="c.day">
          <span class="day__n">{{ c.day }}</span>
          <button
            v-for="it in byDay.get(c.key) ?? []"
            :key="it.id"
            type="button"
            class="ev"
            :class="`ev--${tone(it)}`"
            :title="`${it.supplierName} ${it.invoiceNumber ?? ''}`"
            @click="emit('open', it.id)"
          >
            <v-icon :icon="icon(it)" size="11" />
            <span class="ev__name">{{ it.supplierName }}</span>
            <span class="ev__amt">{{ fmt.amount(it.totalMinor, it.currency) }}</span>
          </button>
        </template>
      </div>
    </div>

    <!-- List (narrow) -->
    <ol class="agenda">
      <li v-if="!daysWithItems.length && !loading" class="agenda__empty">{{ t('supplierInvoices.calEmpty') }}</li>
      <li v-for="[day, list] in daysWithItems" :key="day" class="agenda__day">
        <span class="agenda__date" :class="{ 'is-today': day === todayKey }">{{ fmt.date(day) }}</span>
        <button v-for="it in list" :key="it.id" type="button" class="ev ev--row" :class="`ev--${tone(it)}`" @click="emit('open', it.id)">
          <v-icon :icon="icon(it)" size="14" />
          <span class="ev__name">{{ it.supplierName }} <small>{{ it.invoiceNumber }}</small></span>
          <span class="ev__amt">{{ fmt.amount(it.totalMinor, it.currency) }}</span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.cal {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  container-type: inline-size;
}
.cal__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}
.cal__title {
  margin: 0;
  min-width: 9rem;
  text-align: center;
  font-size: var(--tvz-fs-section);
  font-weight: 700;
}
.cal__sum {
  margin-left: auto;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cal__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.9rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--tvz-fs-caption);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.cal__error {
  color: rgb(var(--v-theme-error));
  font-size: var(--tvz-fs-small);
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.grid__wd {
  padding: 0.4rem 0.5rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.day {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-height: 6rem;
  min-width: 0;
  padding: 0.3rem;
  border-right: 1px solid var(--tvz-hairline);
  border-bottom: 1px solid var(--tvz-hairline);
}
.day:nth-child(7n + 7) {
  border-right: 0;
}
.day--pad {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.day__n {
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.day--today .day__n {
  align-self: flex-start;
  padding: 0 0.35rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.ev {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  width: 100%;
  padding: 0.15rem 0.3rem;
  border: 0;
  border-left: 3px solid currentColor;
  border-radius: 4px;
  font: inherit;
  font-size: var(--tvz-fs-micro);
  text-align: left;
  cursor: pointer;
}
.ev:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}
.ev__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--v-theme-on-surface));
}
.ev__amt {
  flex-shrink: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface));
}
.ev--overdue,
.lg--overdue {
  color: rgb(var(--v-theme-error));
}
.ev--overdue {
  background: rgba(var(--v-theme-error), 0.1);
}
.ev--unpaid,
.lg--unpaid {
  color: rgb(var(--v-theme-info));
}
.ev--unpaid {
  background: rgba(var(--v-theme-info), 0.1);
}
.ev--paid,
.lg--paid {
  color: rgb(var(--v-theme-success));
}
.ev--paid {
  background: rgba(var(--v-theme-success), 0.08);
}
.ev--unknown,
.lg--unknown {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ev--unknown {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.agenda {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
}
.agenda__empty {
  padding: 1.5rem;
  text-align: center;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.agenda__day {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--tvz-hairline);
}
.agenda__date {
  font-size: var(--tvz-fs-caption);
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.agenda__date.is-today {
  color: rgb(var(--v-theme-primary));
}
.ev--row {
  padding: 0.45rem 0.6rem;
  font-size: var(--tvz-fs-small);
}
.ev--row small {
  margin-left: 0.3rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

@container (max-width: 700px) {
  .grid {
    display: none;
  }
  .agenda {
    display: block;
  }
  .cal__sum {
    margin-left: 0;
    flex-basis: 100%;
  }
}
</style>
