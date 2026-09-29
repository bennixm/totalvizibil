<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { useCompaniesStore } from '@/stores/companies'
import { useConfirmStore } from '@/stores/confirm'
import {
  useAppointmentsStore,
  type Appointment,
  type AppointmentStatus,
  type AvailabilityWindow,
} from '@/stores/appointments'
import { useToastStore } from '@/stores/toast'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const appointments = useAppointmentsStore()
const { items, summary, settings, filters, loading, working, nextCursor, error } =
  storeToRefs(appointments)
const toasts = useToastStore()
const confirmStore = useConfirmStore()
watch(error, (v) => {
  if (v) toasts.error(v)
})

const companyId = ref<string | null>(null)
const scheduleOpen = ref(false)

const STATUS_TABS: Array<{ v: '' | AppointmentStatus; key: string }> = [
  { v: '', key: 'appointments.filterAll' },
  { v: 'pending', key: 'appointments.filterPending' },
  { v: 'confirmed', key: 'appointments.filterConfirmed' },
  { v: 'completed', key: 'appointments.filterCompleted' },
  { v: 'canceled', key: 'appointments.filterCanceled' },
]
const WEEKDAY_KEYS = [
  'appointments.sun',
  'appointments.mon',
  'appointments.tue',
  'appointments.wed',
  'appointments.thu',
  'appointments.fri',
  'appointments.sat',
]
const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120]

// Explicit timeZone: an appointment is a fixed Romania-local commitment (the
// client shows up at 9am Cluj time) — it shouldn't reinterpret as a
// different hour just because the owner happens to be browsing from abroad.
const dtf = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Bucharest',
    }),
)
function when(iso: string): string {
  return dtf.value.format(new Date(iso))
}
function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const STATUS_TONE: Record<AppointmentStatus, string> = {
  pending: 'warning',
  confirmed: 'success',
  canceled: 'error',
  completed: 'primary',
}

const hasDateFilter = computed(() => !!filters.value.from || !!filters.value.to)
async function clearDateFilter(): Promise<void> {
  if (!companyId.value) return
  appointments.filters.from = ''
  appointments.filters.to = ''
  await appointments.load(companyId.value)
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value) return
  await appointments.loadMore()
}

function askCancel(appt: Appointment): void {
  confirmStore.ask(
    t('appointments.cancelConfirmTitle'),
    t('appointments.cancelConfirmText', { name: appt.name }),
    () => appointments.cancel(appt.id),
    { tone: 'warning', confirmLabel: t('appointments.cancelAction') },
  )
}
function askDelete(appt: Appointment): void {
  confirmStore.ask(
    t('appointments.deleteConfirmTitle'),
    t('appointments.deleteConfirmText'),
    () => appointments.remove(appt.id),
    { confirmLabel: t('common.delete') },
  )
}

// --- schedule editor (local draft, saved explicitly) ---------------------
const draftWindows = ref<AvailabilityWindow[]>([])
watch(
  settings,
  (s) => {
    if (s) draftWindows.value = s.windows.map((w) => ({ ...w }))
  },
  { immediate: true },
)

function addWindow(weekday: number): void {
  draftWindows.value.push({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 })
}
function removeWindow(index: number): void {
  draftWindows.value.splice(index, 1)
}
function windowsFor(weekday: number): { w: AvailabilityWindow; index: number }[] {
  return draftWindows.value
    .map((w, index) => ({ w, index }))
    .filter(({ w }) => w.weekday === weekday)
}

async function saveSchedule(): Promise<void> {
  for (const w of draftWindows.value) {
    if (w.endMinute <= w.startMinute) {
      toasts.error(t('appointments.windowInvalid'))
      return
    }
  }
  await appointments.saveAvailability(draftWindows.value)
  if (!appointments.error) toasts.success(t('appointments.scheduleSaved'))
}

async function toggleEnabled(v: boolean | null): Promise<void> {
  await appointments.saveSettings({ enabled: !!v })
}
async function changeSlotMinutes(v: number): Promise<void> {
  await appointments.saveSettings({ slotMinutes: v })
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await appointments.load(id)
})

// A notification or the nav dropdown can change ?c= while this view stays
// mounted (same route, only the query differs) — reload for the new company.
watch(
  () => route.query.c,
  (raw) => {
    const next = typeof raw === 'string' ? raw : null
    if (next && next !== companyId.value) {
      companyId.value = next
      void appointments.load(next)
    }
  },
)
</script>

<template>
  <v-container class="apt">
    <header class="apt__head">
      <div>
        <p class="apt__eyebrow">{{ t('appointments.eyebrow') }}</p>
        <h1>{{ t('appointments.title') }}</h1>
      </div>
    </header>

    <div v-if="loading && !summary" class="apt__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Summary -->
      <div v-if="summary" class="apt__stats">
        <div><span>{{ t('appointments.statUpcoming') }}</span><strong>{{ summary.upcoming }}</strong></div>
        <div><span>{{ t('appointments.statPending') }}</span><strong>{{ summary.pending }}</strong></div>
        <div><span>{{ t('appointments.statConfirmed') }}</span><strong>{{ summary.confirmed }}</strong></div>
        <div><span>{{ t('appointments.statCompleted') }}</span><strong>{{ summary.completed }}</strong></div>
        <div><span>{{ t('appointments.statTotal') }}</span><strong>{{ summary.total }}</strong></div>
      </div>

      <!-- Schedule -->
      <section class="apt__schedule">
        <button type="button" class="apt__scheduleToggle" @click="scheduleOpen = !scheduleOpen">
          <v-icon icon="mdi-calendar-edit-outline" size="18" />
          {{ t('appointments.scheduleTitle') }}
          <v-icon :icon="scheduleOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="18" class="apt__chev" />
        </button>

        <div v-if="scheduleOpen" class="apt__scheduleBody">
          <div class="apt__scheduleRow">
            <v-switch
              :model-value="settings?.enabled ?? false"
              :label="t('appointments.enableToggle')"
              color="primary"
              density="comfortable"
              hide-details
              @update:model-value="toggleEnabled"
            />
            <v-select
              :model-value="settings?.slotMinutes ?? 30"
              :items="SLOT_OPTIONS.map((m) => ({ title: t('appointments.slotMinutesLabel', { m }), value: m }))"
              :label="t('appointments.slotDuration')"
              density="comfortable"
              variant="outlined"
              hide-details
              style="max-width: 220px"
              @update:model-value="changeSlotMinutes"
            />
          </div>
          <p v-if="!settings?.enabled" class="apt__disabledHint">
            {{ t('appointments.disabledHint') }}
          </p>

          <div class="apt__week">
            <div v-for="wd in 7" :key="wd" class="apt__day">
              <div class="apt__dayHead">
                <strong>{{ t(WEEKDAY_KEYS[wd - 1]) }}</strong>
                <button type="button" class="apt__addWindow" @click="addWindow(wd - 1)">
                  <v-icon icon="mdi-plus" size="14" /> {{ t('appointments.addWindow') }}
                </button>
              </div>
              <div
                v-for="{ w, index } in windowsFor(wd - 1)"
                :key="index"
                class="apt__windowRow"
              >
                <input
                  type="time"
                  :value="minutesToHHMM(w.startMinute)"
                  @change="w.startMinute = hhmmToMinutes(($event.target as HTMLInputElement).value)"
                />
                <span>—</span>
                <input
                  type="time"
                  :value="minutesToHHMM(w.endMinute)"
                  @change="w.endMinute = hhmmToMinutes(($event.target as HTMLInputElement).value)"
                />
                <button type="button" class="apt__removeWindow" @click="removeWindow(index)">
                  <v-icon icon="mdi-close" size="14" />
                </button>
              </div>
              <p v-if="!windowsFor(wd - 1).length" class="apt__dayClosed">
                {{ t('appointments.closed') }}
              </p>
            </div>
          </div>

          <v-btn color="primary" variant="flat" :loading="working" @click="saveSchedule">
            {{ t('appointments.saveSchedule') }}
          </v-btn>
        </div>
      </section>

      <!-- Filters -->
      <div class="apt__filters">
        <div class="apt__seg">
          <button
            v-for="tab in STATUS_TABS"
            :key="tab.v || 'all'"
            type="button"
            :class="{ 'is-on': filters.status === tab.v }"
            @click="appointments.setFilter('status', tab.v)"
          >
            {{ t(tab.key) }}
          </button>
        </div>
        <label class="apt__upcomingOnly">
          <input
            type="checkbox"
            :checked="filters.upcomingOnly"
            @change="appointments.setFilter('upcomingOnly', ($event.target as HTMLInputElement).checked)"
          />
          {{ t('appointments.upcomingOnly') }}
        </label>
      </div>

      <!-- Date range filter -->
      <div class="apt__dateFilter">
        <label class="apt__dateField">
          <span>{{ t('appointments.filterFrom') }}</span>
          <input
            type="date"
            :value="filters.from"
            @change="appointments.setFilter('from', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="apt__dateField">
          <span>{{ t('appointments.filterTo') }}</span>
          <input
            type="date"
            :value="filters.to"
            @change="appointments.setFilter('to', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <button v-if="hasDateFilter" type="button" class="apt__dateClear" @click="clearDateFilter">
          <v-icon icon="mdi-close" size="14" /> {{ t('appointments.filterClearDates') }}
        </button>
      </div>

      <!-- Empty -->
      <div v-if="!items.length" class="apt__empty">
        <v-icon icon="mdi-calendar-blank-outline" size="36" />
        <p>{{ t('appointments.empty') }}</p>
        <span>{{ t('appointments.emptyHint') }}</span>
      </div>

      <!-- List -->
      <ul v-else class="apt__list">
        <li v-for="appt in items" :key="appt.id" class="apt__row">
          <span class="apt__ic" :class="`apt__ic--${STATUS_TONE[appt.status]}`">
            <v-icon icon="mdi-calendar-clock-outline" size="20" />
          </span>
          <div class="apt__who">
            <strong>{{ appt.name }}</strong>
            <span class="apt__when">{{ when(appt.startsAt) }} · {{ appt.durationMinutes }} min</span>
            <span v-if="appt.email || appt.phone" class="apt__contact">
              {{ [appt.email, appt.phone].filter(Boolean).join(' · ') }}
            </span>
            <span v-if="appt.notes" class="apt__notes">{{ appt.notes }}</span>
          </div>
          <span class="apt__badge" :class="`apt__badge--${STATUS_TONE[appt.status]}`">
            {{ t(`appointments.status.${appt.status}`) }}
          </span>
          <div class="apt__actions">
            <v-btn
              v-if="appt.status === 'pending'"
              size="small"
              variant="tonal"
              color="success"
              :disabled="working"
              @click="appointments.confirm(appt.id)"
            >
              {{ t('appointments.confirmAction') }}
            </v-btn>
            <v-btn
              v-if="appt.status === 'pending' || appt.status === 'confirmed'"
              size="small"
              variant="text"
              color="warning"
              :disabled="working"
              @click="askCancel(appt)"
            >
              {{ t('appointments.cancelAction') }}
            </v-btn>
            <v-btn
              v-if="appt.status === 'confirmed'"
              size="small"
              variant="text"
              :disabled="working"
              @click="appointments.complete(appt.id)"
            >
              {{ t('appointments.completeAction') }}
            </v-btn>
            <button type="button" class="apt__del" :aria-label="t('common.delete')" @click="askDelete(appt)">
              <v-icon icon="mdi-trash-can-outline" size="16" />
            </button>
          </div>
        </li>
      </ul>
      <button v-if="nextCursor" type="button" class="apt__more" :disabled="loading" @click="loadMore">
        {{ t('appointments.loadMore') }}
      </button>
    </template>
  </v-container>
</template>

<style scoped>
.apt {
  max-width: 920px;
  padding-block: clamp(1.25rem, 3vw, 2rem);
}
.apt__head {
  margin-bottom: 1.25rem;
}
.apt__eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-primary));
}
.apt__head h1 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.35rem, 3vw, 1.7rem);
}
.apt__center {
  display: grid;
  place-items: center;
  padding: 4rem 0;
}

.apt__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.apt__stats > div {
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.1));
  border-radius: var(--tvz-radius-lg, 12px);
  background: rgb(var(--v-theme-surface));
}
.apt__stats span {
  display: block;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apt__stats strong {
  font-size: 1.3rem;
  font-weight: 700;
}

.apt__schedule {
  margin-bottom: 1.25rem;
  border: 1px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.1));
  border-radius: var(--tvz-radius-lg, 12px);
  overflow: hidden;
}
.apt__scheduleToggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.9rem 1rem;
  background: rgb(var(--v-theme-surface));
  font-weight: 600;
  font-size: 0.9rem;
}
.apt__chev {
  margin-left: auto;
}
.apt__scheduleBody {
  padding: 1rem;
  border-top: 1px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.1));
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.apt__scheduleRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.25rem;
}
.apt__disabledHint {
  margin: -0.5rem 0 0;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apt__week {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}
.apt__day {
  /* Grid items default to min-width: auto — without this, a day whose rows
     can't shrink below their content (two time inputs side by side) refuses
     to shrink with its track and spills out over the neighboring column
     instead of wrapping inside its own. */
  min-width: 0;
  padding: 0.6rem 0.7rem;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.apt__dayHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
  font-size: 0.85rem;
}
.apt__addWindow {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.apt__windowRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.3rem;
  font-size: 0.8rem;
}
.apt__windowRow input[type='time'] {
  flex: 1 1 76px;
  min-width: 0;
  max-width: 92px;
  padding: 0.2rem 0.3rem;
  border: 1px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.15));
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.78rem;
}
.apt__removeWindow {
  margin-left: auto;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.apt__dayClosed {
  margin: 0;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.apt__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.apt__seg {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  max-width: 100%;
  overflow-x: auto;
}
.apt__seg button {
  flex: none;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.apt__seg button.is-on {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.08));
}
.apt__upcomingOnly {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.apt__dateFilter {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.apt__dateField {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apt__dateField input[type='date'] {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.15));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.82rem;
}
.apt__dateClear {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apt__dateClear:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.apt__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 3rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.apt__empty p {
  margin: 0;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.apt__empty span {
  font-size: 0.85rem;
}

.apt__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.apt__row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.8rem;
  border: 1px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.1));
  border-radius: var(--tvz-radius-lg, 12px);
  background: rgb(var(--v-theme-surface));
}
.apt__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apt__ic--primary {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.apt__ic--success {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.apt__ic--warning {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.apt__ic--error {
  background: rgba(var(--v-theme-error), 0.14);
  color: rgb(var(--v-theme-error));
}
.apt__who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.apt__when {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.apt__contact,
.apt__notes {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.apt__badge {
  flex: none;
  align-self: center;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.apt__badge--primary {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.apt__badge--success {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.apt__badge--warning {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.apt__badge--error {
  background: rgba(var(--v-theme-error), 0.14);
  color: rgb(var(--v-theme-error));
}
.apt__actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
}
.apt__del {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.apt__del:hover {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.apt__more {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.6rem;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.82rem;
  font-weight: 600;
}
.apt__more:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

@media (max-width: 640px) {
  .apt__row {
    flex-wrap: wrap;
  }
  .apt__badge {
    order: 3;
  }
  .apt__actions {
    order: 4;
    width: 100%;
  }
}
</style>
