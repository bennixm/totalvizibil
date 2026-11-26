<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import SupportAvatar from '@/components/support/SupportAvatar.vue'
import SupportRoleBadge from '@/components/support/SupportRoleBadge.vue'
import { useSupportRoutes } from '@/composables/useSupportRoutes'
import { useSupportTime } from '@/composables/useSupportTime'
import {
  useSupportStore,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_SORTS,
  type SupportCounts,
  type TicketCategory,
  type TicketFilters,
  type TicketListItem,
  type TicketPriority,
  type TicketSort,
  type TicketStatus,
} from '@/stores/support'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { ticketRoute, perspective } = useSupportRoutes()
const { ago, dateTime } = useSupportTime()
const support = useSupportStore()
const { list, counts, loading, loadingMore, moreError, nextCursor, error } = storeToRefs(support)

/**
 * Admin panel (`/admin/support`) = the staff queue. Normal panel (`/support`)
 * = the customer view, for every account, support agents included. The
 * perspective is also sent to the API, which enforces the same split.
 */
const isStaff = computed(() => perspective.value === 'staff')
// Set synchronously, before anything loads, so the first request already
// goes out with the right perspective.
support.setPerspective(perspective.value)

// --- views (the tab row) ------------------------------------------------
type StaffView = 'active' | 'mine' | 'unassigned' | 'urgent' | 'waiting' | 'done' | 'all'
type RequesterView = 'active' | 'waiting' | 'done' | 'all'
type View = StaffView | RequesterView

const STAFF_VIEWS: StaffView[] = [
  'active',
  'mine',
  'unassigned',
  'urgent',
  'waiting',
  'done',
  'all',
]
const REQUESTER_VIEWS: RequesterView[] = ['active', 'waiting', 'done', 'all']
const views = computed<View[]>(() => (isStaff.value ? STAFF_VIEWS : REQUESTER_VIEWS))

/** Each view is a preset over the API filters. */
function viewFilters(v: View): TicketFilters {
  switch (v) {
    case 'active':
      return { statusGroup: 'active' }
    case 'mine':
      return { statusGroup: 'active', assignee: 'me' }
    case 'unassigned':
      return { statusGroup: 'active', assignee: 'unassigned' }
    case 'urgent':
      return { statusGroup: 'active', priority: 'urgent' }
    case 'waiting':
      return { status: 'waiting' }
    case 'done':
      return { statusGroup: 'done' }
    default:
      return {}
  }
}

/** Statuses that make sense as a refinement inside each view. */
function statusesFor(v: View): TicketStatus[] {
  if (v === 'active' || v === 'mine' || v === 'unassigned' || v === 'urgent')
    return ['open', 'in_progress', 'waiting']
  if (v === 'done') return ['resolved', 'closed']
  if (v === 'all') return ['open', 'in_progress', 'waiting', 'resolved', 'closed']
  return []
}

function viewLabel(v: View): string {
  if (v === 'waiting' && !isStaff.value) return t('support.view.waitingYou')
  return t('support.view.' + v)
}
function viewCount(v: View): number | null {
  const c = counts.value as SupportCounts | null
  if (!c) return null
  const n = c[v as keyof SupportCounts]
  return typeof n === 'number' ? n : null
}
/** Tabs whose count deserves attention (work waiting for the viewer). */
function viewAlert(v: View): boolean {
  const n = viewCount(v) ?? 0
  if (!n) return false
  return isStaff.value ? v === 'unassigned' || v === 'urgent' : v === 'waiting'
}

// --- state, mirrored in the URL so "back" from a ticket restores it -------
interface State {
  view: View
  status: TicketStatus | ''
  priority: TicketPriority | ''
  category: TicketCategory | ''
  sort: TicketSort
  q: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function fromQuery(): State {
  const q = route.query
  const view = views.value.includes(str(q.view) as View) ? (str(q.view) as View) : 'active'
  const status = statusesFor(view).includes(str(q.status) as TicketStatus)
    ? (str(q.status) as TicketStatus)
    : ''
  const priority =
    isStaff.value && TICKET_PRIORITIES.includes(str(q.priority) as TicketPriority)
      ? (str(q.priority) as TicketPriority)
      : ''
  const category = TICKET_CATEGORIES.includes(str(q.category) as TicketCategory)
    ? (str(q.category) as TicketCategory)
    : ''
  const sort = sortOptions.value.some((s) => s === str(q.sort))
    ? (str(q.sort) as TicketSort)
    : 'activity'
  return { view, status, priority, category, sort, q: str(q.q) }
}

const sortOptions = computed<TicketSort[]>(() =>
  isStaff.value ? TICKET_SORTS : TICKET_SORTS.filter((s) => s !== 'priority'),
)

const state = reactive<State>(fromQuery())

function setView(v: View): void {
  if (state.view === v) return
  state.view = v
  // A refinement from the previous view may not exist in this one.
  if (!statusesFor(v).includes(state.status as TicketStatus)) state.status = ''
  if (v === 'urgent') state.priority = ''
}

const apiFilters = computed<TicketFilters>(() => {
  const base = viewFilters(state.view)
  return {
    ...base,
    ...(state.status ? { status: state.status, statusGroup: '' } : {}),
    ...(state.priority && state.view !== 'urgent' ? { priority: state.priority } : {}),
    ...(state.category ? { category: state.category } : {}),
    ...(state.sort !== 'activity' ? { sort: state.sort } : {}),
    ...(state.q.trim() ? { q: state.q.trim() } : {}),
  }
})

/** Extra filters on top of the view, shown as removable chips. */
const activeChips = computed(() => {
  const chips: { key: 'status' | 'priority' | 'category'; label: string }[] = []
  if (state.status) chips.push({ key: 'status', label: t('support.status.' + state.status) })
  if (state.priority)
    chips.push({ key: 'priority', label: t('support.priority.' + state.priority) })
  if (state.category)
    chips.push({ key: 'category', label: t('support.category.' + state.category) })
  return chips
})
const filterCount = computed(() => activeChips.value.length)
const hasRefinement = computed(() => filterCount.value > 0 || !!state.q.trim())

/** Drops the filter-panel refinements, keeping the view and the search. */
function clearFilters(): void {
  state.status = ''
  state.priority = ''
  state.category = ''
}
function clearRefinements(): void {
  state.status = ''
  state.priority = ''
  state.category = ''
  state.q = ''
}
function toggle<K extends 'status' | 'priority' | 'category'>(key: K, value: State[K]): void {
  state[key] = (state[key] === value ? '' : value) as State[K]
}

// --- loading -------------------------------------------------------------
let debounce: ReturnType<typeof setTimeout> | undefined
function reload(): void {
  void support.loadList(apiFilters.value)
}
function refreshAll(): void {
  reload()
  void support.loadCounts()
}

watch(
  () => JSON.stringify(apiFilters.value),
  () => {
    clearTimeout(debounce)
    // Typing debounces; clicking a tab or chip should feel instant.
    debounce = setTimeout(reload, state.q ? 260 : 0)
    const query: Record<string, string> = {}
    if (state.view !== 'active') query.view = state.view
    if (state.status) query.status = state.status
    if (state.priority) query.priority = state.priority
    if (state.category) query.category = state.category
    if (state.sort !== 'activity') query.sort = state.sort
    if (state.q.trim()) query.q = state.q.trim()
    support.listQuery[perspective.value] = query
    void router.replace({ query })
  },
)

function open(tk: TicketListItem): void {
  void router.push(ticketRoute(tk.id))
}

/** Whose turn it is, from this viewer's side. */
function turnBadge(tk: TicketListItem): { text: string; tone: 'accent' | 'warn' } | null {
  const active = tk.status === 'open' || tk.status === 'in_progress' || tk.status === 'waiting'
  if (!active) return null
  if (isStaff.value) {
    return tk.lastReplyBy === 'requester' && tk.messageCount > 1
      ? { text: t('support.replyFromCustomer'), tone: 'accent' }
      : null
  }
  if (tk.status === 'waiting') return { text: t('support.view.waitingYou'), tone: 'warn' }
  return tk.lastReplyBy === 'team' ? { text: t('support.replyFromTeam'), tone: 'accent' } : null
}

// "/" jumps to search, like most queue tools.
const searchRef = ref<{ focus: () => void } | null>(null)
function onKey(e: KeyboardEvent): void {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const el = e.target as HTMLElement | null
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
  e.preventDefault()
  searchRef.value?.focus()
}

onMounted(() => {
  refreshAll()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(debounce)
})
</script>

<template>
  <div class="sup" :class="{ 'sup--staff': isStaff }">
    <header class="sup__head">
      <div class="sup__headText">
        <p class="sup__eyebrow">{{ t('support.eyebrow') }}</p>
        <h1>{{ isStaff ? t('support.queueTitle') : t('support.title') }}</h1>
        <p class="sup__lead">{{ isStaff ? t('support.leadStaff') : t('support.leadRequester') }}</p>
      </div>
      <div class="sup__headActions">
        <span v-if="isStaff && counts?.resolvedToday != null" class="sup__today">
          <v-icon icon="mdi-check-decagram-outline" size="15" />
          {{ counts.resolvedToday }} {{ t('support.stat.resolvedToday').toLowerCase() }}
        </span>
        <v-btn
          v-if="isStaff"
          variant="tonal"
          icon="mdi-refresh"
          size="small"
          :title="t('support.refresh')"
          :aria-label="t('support.refresh')"
          :loading="loading"
          @click="refreshAll"
        />
        <v-btn
          v-else
          color="primary"
          variant="flat"
          class="text-none sup__new"
          prepend-icon="mdi-plus"
          :to="{ name: 'support-new' }"
        >
          {{ t('support.newTicket') }}
        </v-btn>
      </div>
    </header>

    <!-- Views: one click to the list you need, each with its live count -->
    <nav class="tabs" role="tablist" :aria-label="t('support.filters')">
      <button
        v-for="v in views"
        :key="v"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-on': state.view === v, 'tab--alert': viewAlert(v) }"
        :aria-selected="state.view === v"
        @click="setView(v)"
      >
        <span>{{ viewLabel(v) }}</span>
        <span v-if="viewCount(v) !== null" class="tab__n">{{ viewCount(v) }}</span>
      </button>
    </nav>

    <!-- Search + refinements -->
    <div class="tools">
      <v-text-field
        ref="searchRef"
        v-model="state.q"
        :placeholder="isStaff ? t('support.searchStaff') : t('support.searchRequester')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="tools__search"
        @click:clear="state.q = ''"
      >
        <template #append-inner>
          <kbd v-if="!state.q" class="tools__kbd">/</kbd>
        </template>
      </v-text-field>

      <v-menu location="bottom end" :close-on-content-click="false">
        <template #activator="{ props: act }">
          <button v-bind="act" type="button" class="tbtn" :class="{ 'is-on': filterCount }">
            <v-icon icon="mdi-tune-variant" size="17" />
            <span>{{ t('support.filters') }}</span>
            <span v-if="filterCount" class="tbtn__n">{{ filterCount }}</span>
          </button>
        </template>
        <v-card class="fpanel" rounded="lg">
          <section v-if="statusesFor(state.view).length > 1" class="fpanel__group">
            <p class="fpanel__label">{{ t('support.colStatus') }}</p>
            <div class="fpanel__chips">
              <button
                v-for="s in statusesFor(state.view)"
                :key="s"
                type="button"
                class="fchip"
                :class="[`fchip--${s}`, { 'is-on': state.status === s }]"
                @click="toggle('status', s)"
              >
                {{ t('support.status.' + s) }}
              </button>
            </div>
          </section>
          <section v-if="isStaff && state.view !== 'urgent'" class="fpanel__group">
            <p class="fpanel__label">{{ t('support.colPriority') }}</p>
            <div class="fpanel__chips">
              <button
                v-for="p in TICKET_PRIORITIES"
                :key="p"
                type="button"
                class="fchip"
                :class="[`fchip--p-${p}`, { 'is-on': state.priority === p }]"
                @click="toggle('priority', p)"
              >
                {{ t('support.priority.' + p) }}
              </button>
            </div>
          </section>
          <section class="fpanel__group">
            <p class="fpanel__label">{{ t('support.colCategory') }}</p>
            <div class="fpanel__chips">
              <button
                v-for="c in TICKET_CATEGORIES"
                :key="c"
                type="button"
                class="fchip"
                :class="{ 'is-on': state.category === c }"
                @click="toggle('category', c)"
              >
                {{ t('support.category.' + c) }}
              </button>
            </div>
          </section>
          <button v-if="filterCount" type="button" class="fpanel__clear" @click="clearFilters">
            <v-icon icon="mdi-filter-remove-outline" size="15" /> {{ t('support.clearFilters') }}
          </button>
        </v-card>
      </v-menu>

      <v-menu location="bottom end">
        <template #activator="{ props: act }">
          <button v-bind="act" type="button" class="tbtn" :title="t('support.sortBy')">
            <v-icon icon="mdi-sort" size="17" />
            <span class="tbtn__sort">{{ t('support.sort.' + state.sort) }}</span>
          </button>
        </template>
        <v-card class="fpanel fpanel--menu" rounded="lg">
          <button
            v-for="s in sortOptions"
            :key="s"
            type="button"
            class="mitem"
            :class="{ 'is-on': state.sort === s }"
            @click="state.sort = s"
          >
            <span>{{ t('support.sort.' + s) }}</span>
            <v-icon v-if="state.sort === s" icon="mdi-check" size="15" />
          </button>
        </v-card>
      </v-menu>
    </div>

    <div v-if="activeChips.length" class="chips">
      <span v-for="c in activeChips" :key="c.key" class="chip">
        {{ c.label }}
        <button type="button" :aria-label="t('common.close')" @click="state[c.key] = ''">
          <v-icon icon="mdi-close" size="13" />
        </button>
      </span>
      <button type="button" class="chips__clear" @click="clearRefinements">
        {{ t('support.clearFilters') }}
      </button>
    </div>

    <!-- List -------------------------------------------------------------- -->
    <div v-if="loading && !list.length" class="sup__skel">
      <div v-for="i in 4" :key="i" class="skel" />
    </div>

    <div v-else-if="error && !list.length" class="sup__empty sup__empty--err">
      <span class="sup__emptyIco"><v-icon icon="mdi-alert-circle-outline" size="24" /></span>
      <p>{{ error }}</p>
      <v-btn variant="tonal" size="small" class="text-none" @click="refreshAll">
        {{ t('support.refresh') }}
      </v-btn>
    </div>

    <div v-else-if="!list.length" class="sup__empty">
      <span class="sup__emptyIco">
        <v-icon :icon="hasRefinement ? 'mdi-magnify-close' : 'mdi-lifebuoy'" size="26" />
      </span>
      <template v-if="hasRefinement">
        <p>{{ t('support.noMatchTitle') }}</p>
        <span class="sup__emptyHint">{{ t('support.noMatchHint') }}</span>
        <v-btn variant="tonal" size="small" class="text-none mt-2" @click="clearRefinements">
          {{ t('support.clearFilters') }}
        </v-btn>
      </template>
      <template v-else-if="isStaff">
        <p>{{ t('support.emptyStaffTitle') }}</p>
        <span class="sup__emptyHint">{{ t('support.emptyStaffHint') }}</span>
      </template>
      <template v-else>
        <p>{{ t('support.emptyTitle') }}</p>
        <span class="sup__emptyHint">{{ t('support.emptyHint') }}</span>
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          class="text-none mt-2"
          prepend-icon="mdi-plus"
          :to="{ name: 'support-new' }"
        >
          {{ t('support.newTicket') }}
        </v-btn>
      </template>
    </div>

    <ul v-else class="list" :class="{ 'is-busy': loading }">
      <li
        v-for="tk in list"
        :key="tk.id"
        class="row"
        :class="`row--${tk.priority}`"
        role="button"
        tabindex="0"
        @click="open(tk)"
        @keydown.enter="open(tk)"
      >
        <span class="row__prio" :title="t('support.priority.' + tk.priority)" />

        <div class="row__main">
          <div class="row__top">
            <span class="row__num">#{{ tk.number }}</span>
            <span class="pill" :class="`pill--${tk.status}`">
              <span class="pill__dot" />{{ t('support.status.' + tk.status) }}
            </span>
            <span
              v-if="tk.priority === 'high' || tk.priority === 'urgent'"
              class="prio"
              :class="`prio--${tk.priority}`"
            >
              <v-icon
                :icon="tk.priority === 'urgent' ? 'mdi-alert' : 'mdi-chevron-double-up'"
                size="12"
              />
              {{ t('support.priority.' + tk.priority) }}
            </span>
            <span class="row__cat">{{ t('support.category.' + tk.category) }}</span>
            <span v-if="turnBadge(tk)" class="turn" :class="`turn--${turnBadge(tk)!.tone}`">
              <span class="turn__dot" />{{ turnBadge(tk)!.text }}
            </span>
          </div>
          <p class="row__subject">{{ tk.subject }}</p>
          <div class="row__meta">
            <span v-if="isStaff" class="who">
              <SupportAvatar :name="tk.requester.name" :role="tk.requester.role" :size="20" />
              <span class="who__name">{{ tk.requester.name }}</span>
              <SupportRoleBadge :role="tk.requester.role" />
            </span>
            <span v-if="tk.adsCampaign" class="meta">
              <v-icon icon="mdi-google-ads" size="13" /> {{ tk.adsCampaign.name }}
            </span>
            <span v-if="tk.company" class="meta">
              <v-icon icon="mdi-domain" size="13" /> {{ tk.company.name }}
            </span>
            <span class="meta">
              <v-icon icon="mdi-message-text-outline" size="13" /> {{ tk.messageCount }}
            </span>
          </div>
        </div>

        <div class="row__side">
          <span class="row__when" :title="dateTime(tk.lastActivityAt)">{{
            ago(tk.lastActivityAt)
          }}</span>
          <span v-if="isStaff" class="assignee" :class="{ 'assignee--none': !tk.assignee }">
            <SupportAvatar :name="tk.assignee?.name" :role="tk.assignee?.role" :size="22" />
            <span class="assignee__name">{{
              tk.assignee ? tk.assignee.name : t('support.unassigned')
            }}</span>
          </span>
          <span v-else-if="tk.assignee" class="assignee">
            <SupportAvatar :name="tk.assignee.name" :role="tk.assignee.role" :size="22" />
            <span class="assignee__name">{{ tk.assignee.name }}</span>
          </span>
        </div>
      </li>
    </ul>

    <template v-if="list.length">
      <p v-if="moreError" class="sup__moreErr">
        <v-icon icon="mdi-alert-circle-outline" size="14" /> {{ t('support.loadMoreError') }}
      </p>
      <button
        v-if="nextCursor"
        type="button"
        class="sup__more"
        :disabled="loadingMore"
        @click="support.loadMore()"
      >
        <v-progress-circular v-if="loadingMore" indeterminate size="14" width="2" />
        <template v-else>{{ t('support.loadMore') }}</template>
      </button>
    </template>
  </div>
</template>

<style scoped>
.sup {
  max-width: 920px;
  margin-inline: auto;
  padding: clamp(1.5rem, 5vw, 3rem) clamp(1rem, 4vw, 1.5rem) 4rem;
}
/* The admin layout already pads its content; the queue uses the full
   content width like every other admin list (it was a narrower, centred
   column). */
.sup--staff {
  max-width: none;
  margin-inline: 0;
  padding: 0 0 4rem;
}

/* Header ------------------------------------------------------------------ */
.sup__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.25rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
.sup__eyebrow {
  /* Same muted eyebrow as every other panel page header (AdminPageHeader). */
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: var(--tvz-fs-micro);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.35rem;
}
.sup__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: var(--tvz-fs-title);
  letter-spacing: -0.025em;
  margin: 0;
}
.sup__lead {
  margin: 0.45rem 0 0;
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.58);
}
.sup__headActions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.sup__today {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}
.sup__new {
  border-radius: 9px;
  height: 40px;
}

/* View tabs --------------------------------------------------------------- */
.tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.3rem;
  margin-bottom: 0.85rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex: none;
  padding: 0.5rem 0.8rem;
  border-radius: 9px;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.62);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.tab:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgb(var(--v-theme-on-surface));
}
.tab.is-on {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.tab__n {
  min-width: 1.35rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  line-height: 1.35rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.tab.is-on .tab__n {
  background: rgba(var(--v-theme-primary), 0.2);
}
.tab--alert .tab__n {
  background: rgba(var(--v-theme-warning), 0.2);
  color: rgb(var(--v-theme-warning));
}

/* Tools row --------------------------------------------------------------- */
.tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.tools__search {
  flex: 1;
  min-width: 0;
}
.tools__kbd {
  display: inline-grid;
  place-items: center;
  min-width: 1.3rem;
  height: 1.3rem;
  border-radius: 5px;
  border: 1px solid var(--tvz-hairline);
  font-family: inherit;
  font-size: var(--tvz-fs-micro);
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.tbtn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: none;
  height: 40px;
  padding: 0 0.85rem;
  border-radius: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.22);
  background: rgb(var(--v-theme-surface));
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
  transition: border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.tbtn:hover,
.tbtn[aria-expanded='true'] {
  border-color: rgba(var(--v-theme-on-surface), 0.4);
}
.tbtn.is-on {
  border-color: rgba(var(--v-theme-primary), 0.6);
  color: rgb(var(--v-theme-primary));
}
.tbtn__n {
  min-width: 1.15rem;
  height: 1.15rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-micro);
  line-height: 1.15rem;
  text-align: center;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

/* Active refinement chips ------------------------------------------------ */
.chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.3rem 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.chip button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
}
.chip button:hover {
  background: rgba(var(--v-theme-primary), 0.18);
}
.chips__clear {
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  padding: 0.2rem 0.4rem;
}
.chips__clear:hover {
  color: rgb(var(--v-theme-on-surface));
}

/* List -------------------------------------------------------------------- */
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
  transition: opacity var(--tvz-dur-fast) var(--tvz-ease-out);
}
.list.is-busy {
  opacity: 0.6;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.95rem 1.1rem 0.95rem 1.3rem;
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.row + .row {
  border-top: 1px solid var(--tvz-hairline);
}
.row:hover,
.row:focus-visible {
  outline: none;
  background: rgba(var(--v-theme-primary), 0.05);
}
.row:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.5);
}
/* Priority as a slim left rail: invisible for normal/low, loud for urgent. */
.row__prio {
  position: absolute;
  left: 0;
  top: 0.7rem;
  bottom: 0.7rem;
  width: 3px;
  border-radius: 0 3px 3px 0;
}
.row--high .row__prio {
  background: rgb(var(--v-theme-warning));
}
.row--urgent .row__prio {
  background: rgb(var(--v-theme-error));
}
.row__main {
  flex: 1;
  min-width: 0;
}
.row__top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.row__num {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-variant-numeric: tabular-nums;
}
.row__cat {
  font-size: var(--tvz-fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.row__subject {
  margin: 0.35rem 0 0;
  font-weight: 600;
  font-size: var(--tvz-fs-section);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin-top: 0.45rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.58);
}
.meta,
.who {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}
.who__name {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.row__side {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.45rem;
  max-width: 11rem;
}
.row__when {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}
.assignee {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.assignee__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.assignee--none {
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-style: italic;
}

/* Status pill, priority, "whose turn" ----------------------------------- */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.pill--open {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.pill--in_progress {
  background: rgba(var(--v-theme-info), 0.14);
  color: rgb(var(--v-theme-info));
}
.pill--waiting {
  background: rgba(var(--v-theme-warning), 0.15);
  color: rgb(var(--v-theme-warning));
}
.pill--resolved {
  background: rgba(var(--v-theme-success), 0.15);
  color: rgb(var(--v-theme-success));
}
.prio {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.prio--high {
  color: rgb(var(--v-theme-warning));
}
.prio--urgent {
  color: rgb(var(--v-theme-error));
}
.turn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
}
.turn__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.18);
}
.turn--accent {
  color: rgb(var(--v-theme-primary));
}
.turn--warn {
  color: rgb(var(--v-theme-warning));
}
.turn--warn .turn__dot {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-warning), 0.2);
}

/* Filter / sort menus (teleported, but scoped attrs still apply) -------- */
.fpanel {
  width: 20rem;
  max-width: calc(100vw - 2rem);
  padding: 0.9rem;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: var(--tvz-shadow-lg);
}
.fpanel--menu {
  width: 14rem;
  padding: 0.35rem;
}
.fpanel__group + .fpanel__group {
  margin-top: 0.9rem;
}
.fpanel__label {
  margin: 0 0 0.45rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.fpanel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.fchip {
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.72);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.fchip:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.35);
}
.fchip.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.fpanel__clear {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 1rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.fpanel__clear:hover {
  color: rgb(var(--v-theme-on-surface));
}
.mitem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  font-size: var(--tvz-fs-body);
  text-align: left;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.mitem:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.mitem.is-on {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

/* States ---------------------------------------------------------------- */
.sup__skel {
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  overflow: hidden;
}
.skel {
  height: 84px;
  background: linear-gradient(
    90deg,
    rgba(var(--v-theme-on-surface), 0.03) 0%,
    rgba(var(--v-theme-on-surface), 0.07) 50%,
    rgba(var(--v-theme-on-surface), 0.03) 100%
  );
  background-size: 200% 100%;
  animation: skel 1.3s ease-in-out infinite;
}
@keyframes skel {
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skel {
    animation: none;
  }
}
.sup__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
  padding: 3.5rem 1rem;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 12px;
}
.sup__empty--err {
  color: rgb(var(--v-theme-error));
}
.sup__emptyIco {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  margin-bottom: 0.6rem;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.sup__empty p {
  margin: 0;
  font-weight: 600;
  font-size: var(--tvz-fs-lead);
}
.sup__emptyHint {
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* Load more ------------------------------------------------------------- */
.sup__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 2.4rem;
  margin-top: 0.75rem;
  padding: 0.6rem;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  font-size: var(--tvz-fs-small);
  font-weight: 600;
}
.sup__more:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.sup__more:disabled {
  opacity: 0.7;
}
.sup__moreErr {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin: 0.75rem 0 0;
  font-size: var(--tvz-fs-small);
  color: rgb(var(--v-theme-error));
}

@media (max-width: 640px) {
  .tools {
    flex-wrap: wrap;
  }
  .tools__search {
    flex-basis: 100%;
  }
  .tools__kbd {
    display: none;
  }
  .tbtn {
    flex: 1;
    justify-content: center;
  }
  .row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
  }
  .row__side {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    max-width: none;
    padding-top: 0.55rem;
    border-top: 1px dashed var(--tvz-hairline);
  }
}
</style>
