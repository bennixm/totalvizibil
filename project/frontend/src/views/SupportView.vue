<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import {
  useSupportStore,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketFilters,
} from '@/stores/support'

const { t, locale } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const support = useSupportStore()
const { list, overview, loading } = storeToRefs(support)

const isStaff = computed(() => auth.isPlatformStaff)

const filters = reactive<TicketFilters>({
  scope: 'all',
  status: '',
  priority: '',
  assignee: '',
  q: '',
})

const statusOptions = computed(() => [
  { title: t('support.filterAny'), value: '' },
  ...TICKET_STATUSES.map((s) => ({ title: t(`support.status.${s}`), value: s })),
])
const priorityOptions = computed(() => [
  { title: t('support.filterAny'), value: '' },
  ...TICKET_PRIORITIES.map((p) => ({ title: t(`support.priority.${p}`), value: p })),
])
const assigneeOptions = computed(() => [
  { title: t('support.filterAny'), value: '' },
  { title: t('support.assignedToMe'), value: 'me' },
  { title: t('support.unassigned'), value: 'unassigned' },
])

let debounce: ReturnType<typeof setTimeout> | undefined
function reload(): void {
  void support.loadList(isStaff.value ? { ...filters } : {})
}
watch(
  () => ({ ...filters }),
  () => {
    clearTimeout(debounce)
    debounce = setTimeout(reload, 220)
  },
  { deep: true },
)

const overviewTiles = computed(() => {
  const o = overview.value
  if (!o) return []
  return [
    { k: 'open', v: o.open, tone: 'primary' },
    { k: 'unassigned', v: o.unassigned, tone: o.unassigned ? 'warn' : 'muted' },
    { k: 'urgent', v: o.urgent, tone: o.urgent ? 'error' : 'muted' },
    { k: 'resolvedToday', v: o.resolvedToday, tone: 'ok' },
  ]
})

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
}

function open(id: string): void {
  void router.push({ name: 'support-ticket', params: { id } })
}

onMounted(() => {
  reload()
  if (isStaff.value) void support.loadOverview()
})
</script>

<template>
  <div class="sup">
    <header class="sup__head">
      <div class="sup__headText">
        <p class="sup__eyebrow">{{ t('support.eyebrow') }}</p>
        <h1>{{ isStaff ? t('support.queueTitle') : t('support.title') }}</h1>
        <p class="sup__lead">{{ isStaff ? t('support.queueLead') : t('support.lead') }}</p>
      </div>
      <!-- Staff work the queue; they don't file tickets from here. -->
      <v-btn
        v-if="!isStaff"
        color="primary"
        variant="flat"
        class="text-none sup__new"
        prepend-icon="mdi-plus"
        :to="{ name: 'support-new' }"
      >
        {{ t('support.newTicket') }}
      </v-btn>
    </header>

    <!-- Staff queue counters -->
    <div v-if="isStaff && overviewTiles.length" class="sup__stats">
      <div
        v-for="tile in overviewTiles"
        :key="tile.k"
        class="stat"
        :class="`stat--${tile.tone}`"
      >
        <span class="stat__v">{{ tile.v }}</span>
        <span class="stat__k">{{ t('support.stat.' + tile.k) }}</span>
      </div>
    </div>

    <!-- Filters (staff only) -->
    <div v-if="isStaff" class="sup__filters">
      <div class="seg">
        <button
          type="button"
          :class="{ 'is-on': filters.scope === 'all' }"
          @click="filters.scope = 'all'"
        >
          {{ t('support.scopeAll') }}
        </button>
        <button
          type="button"
          :class="{ 'is-on': filters.scope === 'mine' }"
          @click="filters.scope = 'mine'"
        >
          {{ t('support.scopeMine') }}
        </button>
      </div>
      <v-select
        v-model="filters.status"
        :items="statusOptions"
        :label="t('support.colStatus')"
        variant="outlined"
        density="compact"
        hide-details
        class="sup__filter"
      />
      <v-select
        v-model="filters.priority"
        :items="priorityOptions"
        :label="t('support.colPriority')"
        variant="outlined"
        density="compact"
        hide-details
        class="sup__filter"
      />
      <v-select
        v-model="filters.assignee"
        :items="assigneeOptions"
        :label="t('support.colAssignee')"
        variant="outlined"
        density="compact"
        hide-details
        class="sup__filter"
      />
      <v-text-field
        v-model="filters.q"
        :placeholder="t('support.searchPlaceholder')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="sup__search"
      />
    </div>

    <div v-if="loading && !list.length" class="sup__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!list.length" class="sup__empty">
      <span class="sup__emptyIco"><v-icon icon="mdi-lifebuoy" size="26" /></span>
      <p>{{ t('support.emptyTitle') }}</p>
      <span class="sup__emptyHint">{{ t('support.emptyHint') }}</span>
    </div>

    <ul v-else class="sup__list">
      <li
        v-for="tk in list"
        :key="tk.id"
        class="row"
        :class="`row--${tk.priority}`"
        role="button"
        tabindex="0"
        @click="open(tk.id)"
        @keydown.enter="open(tk.id)"
      >
        <span class="row__num">#{{ tk.number }}</span>
        <div class="row__body">
          <div class="row__line1">
            <span class="tag" :class="`tag--${tk.status}`">{{
              t('support.status.' + tk.status)
            }}</span>
            <span class="row__cat">{{ t('support.category.' + tk.category) }}</span>
          </div>
          <p class="row__subject">{{ tk.subject }}</p>
          <div class="row__meta">
            <span v-if="isStaff">
              <v-icon icon="mdi-account-outline" size="13" /> {{ tk.requester.name }}
            </span>
            <span v-if="tk.company">
              <v-icon icon="mdi-domain" size="13" /> {{ tk.company.name }}
            </span>
            <span><v-icon icon="mdi-comment-text-outline" size="13" /> {{ tk.messageCount }}</span>
          </div>
        </div>
        <div class="row__side">
          <span class="row__when">{{ fmtWhen(tk.lastActivityAt) }}</span>
          <span v-if="tk.priority !== 'normal'" class="row__prio" :class="`row__prio--${tk.priority}`">
            {{ t('support.priority.' + tk.priority) }}
          </span>
          <span v-if="isStaff" class="row__assignee">
            {{ tk.assignee ? tk.assignee.name : t('support.unassigned') }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sup {
  max-width: 860px;
  margin-inline: auto;
  padding: clamp(1.5rem, 5vw, 3rem) clamp(1rem, 4vw, 1.5rem) 4rem;
}

.sup__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.25rem;
  flex-wrap: wrap;
  margin-bottom: 1.75rem;
}
.sup__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.62rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  margin: 0 0 0.55rem;
}
.sup__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.6rem, 4vw, 2.15rem);
  letter-spacing: -0.025em;
  margin: 0;
}
.sup__lead {
  margin: 0.6rem 0 0;
  font-size: 0.92rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  max-width: 46ch;
}
.sup__new {
  border-radius: 9px;
  height: 40px;
}

/* Stat cards ---------------------------------------------------------------- */
.sup__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.1rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  border-top: 2px solid rgb(var(--v-theme-on-surface) / 0.14);
}
.stat--primary {
  border-top-color: rgb(var(--v-theme-primary));
}
.stat--warn {
  border-top-color: rgb(var(--v-theme-warning));
}
.stat--error {
  border-top-color: rgb(var(--v-theme-error));
}
.stat--ok {
  border-top-color: rgb(var(--v-theme-success));
}
.stat__v {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.7rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.stat__k {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}

/* Filters ----------------------------------------------------------------- */
.sup__filters {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.sup__filter {
  max-width: 10rem;
}
.sup__search {
  flex: 1;
  min-width: 12rem;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--tvz-hairline);
  border-radius: 9px;
  overflow: hidden;
  height: 40px;
}
.seg button {
  padding: 0 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.seg button + button {
  border-left: 1px solid var(--tvz-hairline);
}
.seg button.is-on {
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}

/* States ---------------------------------------------------------------- */
.sup__center {
  display: grid;
  place-items: center;
  min-height: 220px;
}
.sup__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
  padding: 3.5rem 1rem;
}
.sup__emptyIco {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  margin-bottom: 0.6rem;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.1);
}
.sup__empty p {
  margin: 0;
  font-weight: 600;
  font-size: 1rem;
}
.sup__emptyHint {
  font-size: 0.86rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}

/* Ticket rows --------------------------------------------------------------- */
.sup__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.row {
  display: flex;
  gap: 1rem;
  padding: 1rem 1.15rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  border-left-width: 3px;
  border-left-color: rgb(var(--v-theme-on-surface) / 0.1);
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.row--high {
  border-left-color: rgb(var(--v-theme-warning));
}
.row--urgent {
  border-left-color: rgb(var(--v-theme-error));
}
.row:hover,
.row:focus-visible {
  outline: none;
  border-color: rgb(var(--v-theme-primary) / 0.45);
  border-left-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.03);
}
.row__num {
  flex: none;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.4);
  font-variant-numeric: tabular-nums;
  padding-top: 0.1rem;
}
.row__body {
  flex: 1;
  min-width: 0;
}
.row__line1 {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.row__cat {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.42);
}
.row__subject {
  margin: 0.4rem 0 0;
  font-weight: 600;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row__meta {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.4rem;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.row__meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.row__side {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
  text-align: right;
}
.row__when {
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.row__prio {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-warning) / 0.14);
  color: rgb(var(--v-theme-warning));
}
.row__prio--urgent {
  background: rgb(var(--v-theme-error) / 0.14);
  color: rgb(var(--v-theme-error));
}
.row__assignee {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  max-width: 8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Status tag (shared) ---------------------------------------------------- */
.tag {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.16rem 0.45rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.tag--open {
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}
.tag--in_progress {
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}
.tag--resolved,
.tag--closed {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}

@media (max-width: 640px) {
  .sup__stats {
    grid-template-columns: 1fr 1fr;
  }
  .row__side {
    display: none;
  }
}
</style>
