<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'

import { useAuthStore } from '@/stores/auth'
import {
  useSupportStore,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketMessage,
} from '@/stores/support'

const { t, locale } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const support = useSupportStore()
const { ticket, staff, loading, working, error } = storeToRefs(support)

const id = computed(() => String(route.params.id))
const draft = ref('')
const internal = ref(false)

const isStaff = computed(() => ticket.value?.viewerIsStaff ?? false)
const isRequester = computed(() => ticket.value?.viewerIsRequester ?? false)
const closed = computed(() => ticket.value?.status === 'closed')
// The admin panel (users / businesses) requires the `admin` role, not just any
// staff — only then do the "open in admin" shortcuts lead somewhere useful.
const canAdmin = computed(() => (auth.user?.platformRoles ?? []).includes('admin'))
const userAdminRoute = computed(() =>
  ticket.value ? { name: 'admin-user', params: { id: ticket.value.requester.id } } : null,
)
const companyAdminRoute = computed(() =>
  ticket.value?.company
    ? { name: 'admin-company', params: { id: ticket.value.company.id } }
    : null,
)

const statusOptions = computed(() =>
  TICKET_STATUSES.map((s) => ({ title: t(`support.status.${s}`), value: s })),
)
const priorityOptions = computed(() =>
  TICKET_PRIORITIES.map((p) => ({ title: t(`support.priority.${p}`), value: p })),
)
const categoryOptions = computed(() =>
  TICKET_CATEGORIES.map((c) => ({ title: t(`support.category.${c}`), value: c })),
)
const assigneeOptions = computed(() => [
  { title: t('support.unassigned'), value: '' },
  ...staff.value.map((s) => ({ title: s.name, value: s.id })),
])

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** System messages carry a machine code in `body` — render it localized. */
function systemText(m: TicketMessage): string {
  const [head, rest] = m.body.split(/:(.*)/s)
  if (head === 'status') return t('support.event.status', { value: t(`support.status.${rest}`) })
  if (head === 'priority')
    return t('support.event.priority', { value: t(`support.priority.${rest}`) })
  if (head === 'assigned')
    return rest ? t('support.event.assignedTo', { name: rest }) : t('support.event.assigned')
  if (m.body === 'unassigned') return t('support.event.unassigned')
  return m.body
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || working.value) return
  const ok = await support.reply(id.value, text, internal.value && isStaff.value)
  if (ok) {
    draft.value = ''
    internal.value = false
  }
}

function setStatus(value: string): void {
  if (value && value !== ticket.value?.status) void support.patch(id.value, { status: value as never })
}
function setPriority(value: string): void {
  if (value && value !== ticket.value?.priority)
    void support.patch(id.value, { priority: value as never })
}
function setCategory(value: string): void {
  if (value && value !== ticket.value?.category)
    void support.patch(id.value, { category: value as never })
}
function setAssignee(value: string): void {
  void support.patch(id.value, { assigneeId: value })
}
function assignToMe(): void {
  void support.patch(id.value, { assigneeId: 'me' })
}
function closeTicket(): void {
  void support.patch(id.value, { status: 'closed' })
}
function reopenTicket(): void {
  void support.patch(id.value, { status: 'open' })
}

watch(id, (v) => v && support.loadTicket(v))
onMounted(() => {
  void support.loadTicket(id.value)
  void support.loadStaff()
})
</script>

<template>
  <div class="tv">
    <v-btn
      variant="text"
      size="small"
      prepend-icon="mdi-arrow-left"
      class="tv__back"
      :to="{ name: 'support' }"
    >
      {{ t('support.back') }}
    </v-btn>

    <div v-if="loading && !ticket" class="tv__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!ticket" class="tv__center tv__center--err">
      <v-icon icon="mdi-alert-circle-outline" size="26" />
      <p>{{ t('support.notFound') }}</p>
      <v-btn variant="tonal" :to="{ name: 'support' }">{{ t('support.back') }}</v-btn>
    </div>

    <template v-else>
      <header class="tv__head">
        <div class="tv__headTags">
          <span class="tv__num">#{{ ticket.number }}</span>
          <span class="tag" :class="`tag--${ticket.status}`">{{
            t('support.status.' + ticket.status)
          }}</span>
          <span
            v-if="ticket.priority !== 'normal'"
            class="tag"
            :class="`tag--prio-${ticket.priority}`"
          >{{ t('support.priority.' + ticket.priority) }}</span>
          <span class="tv__cat">{{ t('support.category.' + ticket.category) }}</span>
        </div>
        <h1>{{ ticket.subject }}</h1>
        <p class="tv__sub">
          {{
            t('support.openedBy', {
              name: ticket.requester.name,
              when: fmtDateTime(ticket.createdAt),
            })
          }}
          <span v-if="ticket.company"> · {{ ticket.company.name }}</span>
        </p>
      </header>

      <div class="tv__grid">
        <!-- Thread + composer -->
        <div class="tv__main">
          <ol class="thread">
            <li
              v-for="m in ticket.messages"
              :key="m.id"
              class="msg"
              :class="{
                'msg--mine': m.mine && m.kind !== 'system',
                'msg--system': m.kind === 'system',
                'msg--note': m.kind === 'note',
              }"
            >
              <template v-if="m.kind === 'system'">
                <span class="msg__sys">
                  <span class="msg__sysDot" />
                  {{ systemText(m) }}
                  <span class="msg__sysWhen">{{ fmtDateTime(m.createdAt) }}</span>
                </span>
              </template>
              <template v-else>
                <div class="msg__head">
                  <span class="msg__who">{{
                    m.author ? m.author.name : t('support.systemUser')
                  }}</span>
                  <span v-if="m.author?.staff" class="mini mini--agent">{{
                    t('support.agent')
                  }}</span>
                  <span v-if="m.kind === 'note'" class="mini mini--note">{{
                    t('support.internalNote')
                  }}</span>
                  <span class="msg__when">{{ fmtDateTime(m.createdAt) }}</span>
                </div>
                <p class="msg__body">{{ m.body }}</p>
              </template>
            </li>
          </ol>

          <div v-if="!closed" class="composer" :class="{ 'composer--note': internal }">
            <v-textarea
              v-model="draft"
              :placeholder="
                internal ? t('support.notePlaceholder') : t('support.replyPlaceholder')
              "
              variant="outlined"
              auto-grow
              rows="3"
              hide-details
            />
            <div class="composer__row">
              <label v-if="isStaff" class="composer__toggle">
                <input v-model="internal" type="checkbox" />
                <span>{{ t('support.internalNote') }}</span>
              </label>
              <v-spacer />
              <v-btn
                color="primary"
                variant="flat"
                class="composer__send"
                :loading="working"
                :disabled="!draft.trim()"
                append-icon="mdi-send"
                @click="send"
              >
                {{ internal ? t('support.addNote') : t('support.sendReply') }}
              </v-btn>
            </div>
          </div>
          <div v-else class="closedbar">
            <v-icon icon="mdi-lock-outline" size="16" />
            <span>{{ t('support.closedNote') }}</span>
            <v-spacer />
            <v-btn
              v-if="isStaff || isRequester"
              size="small"
              variant="tonal"
              @click="reopenTicket"
            >
              {{ t('support.reopen') }}
            </v-btn>
          </div>

          <p v-if="error" class="tv__err">
            <v-icon icon="mdi-alert-circle-outline" size="15" /> {{ error }}
          </p>
        </div>

        <!-- Sidebar -->
        <aside class="tv__side">
          <section v-if="isStaff" class="panel">
            <p class="panel__label">{{ t('support.manage') }}</p>
            <v-select
              :model-value="ticket.status"
              :items="statusOptions"
              :label="t('support.colStatus')"
              variant="outlined"
              density="compact"
              hide-details
              class="mb-2"
              @update:model-value="setStatus"
            />
            <v-select
              :model-value="ticket.priority"
              :items="priorityOptions"
              :label="t('support.colPriority')"
              variant="outlined"
              density="compact"
              hide-details
              class="mb-2"
              @update:model-value="setPriority"
            />
            <v-select
              :model-value="ticket.category"
              :items="categoryOptions"
              :label="t('support.colCategory')"
              variant="outlined"
              density="compact"
              hide-details
              class="mb-2"
              @update:model-value="setCategory"
            />
            <v-select
              :model-value="ticket.assignee?.id ?? ''"
              :items="assigneeOptions"
              :label="t('support.colAssignee')"
              variant="outlined"
              density="compact"
              hide-details
              @update:model-value="setAssignee"
            />
            <button
              v-if="!ticket.assignee"
              type="button"
              class="panel__link"
              @click="assignToMe"
            >
              <v-icon icon="mdi-account-arrow-left-outline" size="15" />
              {{ t('support.assignToMe') }}
            </button>
          </section>

          <!-- Shortcuts into the admin panel to check what actually happened -->
          <section v-if="canAdmin" class="panel">
            <p class="panel__label">{{ t('support.investigate') }}</p>
            <router-link
              v-if="userAdminRoute"
              :to="userAdminRoute"
              class="jump"
            >
              <span class="jump__ic"><v-icon icon="mdi-account-search-outline" size="16" /></span>
              <span class="jump__body">
                <span class="jump__t">{{ t('support.openUserAdmin') }}</span>
                <span class="jump__s">{{ ticket.requester.name }}</span>
              </span>
              <v-icon icon="mdi-arrow-top-right" size="15" class="jump__go" />
            </router-link>
            <router-link
              v-if="companyAdminRoute && ticket.company"
              :to="companyAdminRoute"
              class="jump"
            >
              <span class="jump__ic"><v-icon icon="mdi-domain" size="16" /></span>
              <span class="jump__body">
                <span class="jump__t">{{ t('support.openBusinessAdmin') }}</span>
                <span class="jump__s">{{ ticket.company.name }}</span>
              </span>
              <v-icon icon="mdi-arrow-top-right" size="15" class="jump__go" />
            </router-link>
          </section>

          <section class="panel">
            <p class="panel__label">{{ t('support.details') }}</p>
            <dl class="meta">
              <div>
                <dt>{{ t('support.requester') }}</dt>
                <dd>
                  <router-link v-if="canAdmin && userAdminRoute" :to="userAdminRoute" class="meta__link">
                    {{ ticket.requester.name }}
                  </router-link>
                  <template v-else>{{ ticket.requester.name }}</template>
                </dd>
              </div>
              <div v-if="ticket.company">
                <dt>{{ t('support.business') }}</dt>
                <dd>
                  <router-link
                    v-if="canAdmin && companyAdminRoute"
                    :to="companyAdminRoute"
                    class="meta__link"
                  >
                    {{ ticket.company.name }}
                  </router-link>
                  <template v-else>{{ ticket.company.name }}</template>
                </dd>
              </div>
              <div v-if="!isStaff">
                <dt>{{ t('support.colCategory') }}</dt>
                <dd>{{ t('support.category.' + ticket.category) }}</dd>
              </div>
              <div>
                <dt>{{ t('support.assignee') }}</dt>
                <dd>{{ ticket.assignee ? ticket.assignee.name : t('support.unassigned') }}</dd>
              </div>
              <div>
                <dt>{{ t('support.opened') }}</dt>
                <dd>{{ fmtDateTime(ticket.createdAt) }}</dd>
              </div>
              <div v-if="ticket.resolvedAt">
                <dt>{{ t('support.resolvedAt') }}</dt>
                <dd>{{ fmtDateTime(ticket.resolvedAt) }}</dd>
              </div>
            </dl>

            <div v-if="isRequester && !closed" class="panel__owner">
              <v-btn
                v-if="ticket.status !== 'resolved'"
                block
                variant="tonal"
                color="success"
                size="small"
                prepend-icon="mdi-check"
                @click="setStatus('resolved')"
              >
                {{ t('support.markResolved') }}
              </v-btn>
              <v-btn
                block
                variant="text"
                size="small"
                prepend-icon="mdi-close"
                class="mt-1"
                @click="closeTicket"
              >
                {{ t('support.closeTicket') }}
              </v-btn>
            </div>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tv {
  max-width: 940px;
  margin-inline: auto;
  padding: clamp(1rem, 4vw, 2rem) clamp(1rem, 4vw, 1.5rem) 4rem;
}
.tv__back {
  margin: 0 0 0.75rem -0.5rem;
}
.tv__center {
  display: grid;
  place-items: center;
  gap: 0.6rem;
  min-height: 260px;
  text-align: center;
}
.tv__center--err {
  color: rgb(var(--v-theme-error));
}

/* Header ---------------------------------------------------------------- */
.tv__head {
  padding-bottom: 1.4rem;
  margin-bottom: 1.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.tv__headTags {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.tv__num {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface) / 0.4);
  font-variant-numeric: tabular-nums;
}
.tv__cat {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.42);
}
.tv__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.3rem, 3.5vw, 1.75rem);
  letter-spacing: -0.025em;
  margin: 0.65rem 0 0;
}
.tv__sub {
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.58);
}

/* Layout -------------------------------------------------------------- */
.tv__grid {
  display: grid;
  grid-template-columns: 1fr 16.5rem;
  gap: 1.75rem;
  align-items: start;
}

/* Thread ------------------------------------------------------------ */
.thread {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.msg {
  max-width: 88%;
  padding: 0.9rem 1.05rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
}
.msg--mine {
  align-self: flex-end;
  background: rgb(var(--v-theme-primary) / 0.08);
  border-color: rgb(var(--v-theme-primary) / 0.28);
}
.msg--note {
  align-self: stretch;
  max-width: 100%;
  background: rgb(var(--v-theme-warning) / 0.07);
  border-color: rgb(var(--v-theme-warning) / 0.35);
  border-style: dashed;
}
.msg--system {
  align-self: center;
  max-width: 100%;
  padding: 0.2rem 0;
  border: 0;
  background: transparent;
}
.msg__sys {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.msg__sysDot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface) / 0.3);
}
.msg__sysWhen {
  opacity: 0.65;
}
.msg__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.35rem;
  font-size: 0.76rem;
}
.msg__who {
  font-weight: 700;
}
.msg__when {
  margin-left: auto;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.msg__body {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.mini {
  font-size: 0.56rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
}
.mini--agent {
  background: rgb(var(--v-theme-primary) / 0.16);
  color: rgb(var(--v-theme-primary));
}
.mini--note {
  background: rgb(var(--v-theme-warning) / 0.18);
  color: rgb(var(--v-theme-warning));
}

/* Composer -------------------------------------------------------- */
.composer {
  margin-top: 1.4rem;
  padding: 0.9rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
}
.composer--note {
  border-color: rgb(var(--v-theme-warning) / 0.4);
  background: rgb(var(--v-theme-warning) / 0.05);
}
.composer__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.6rem;
}
.composer__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
  cursor: pointer;
  user-select: none;
}
.composer__toggle input {
  accent-color: rgb(var(--v-theme-warning));
}
.composer__send {
  border-radius: 8px;
}
.closedbar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 1.4rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  font-size: 0.85rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.tv__err {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.7rem 0 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-error));
}

/* Sidebar --------------------------------------------------------- */
.tv__side {
  position: sticky;
  top: 5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.panel {
  padding: 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
}
.panel__label {
  margin: 0 0 0.7rem;
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgb(var(--v-theme-on-surface) / 0.42);
}
.panel__link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.7rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

/* Admin jump shortcuts ------------------------------------------------- */
.jump {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.65rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1),
    background 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.jump + .jump {
  margin-top: 0.5rem;
}
.jump:hover {
  border-color: rgb(var(--v-theme-primary) / 0.5);
  background: rgb(var(--v-theme-primary) / 0.05);
}
.jump__ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 7px;
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}
.jump__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.jump__t {
  font-size: 0.82rem;
  font-weight: 600;
}
.jump__s {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jump__go {
  flex: none;
  color: rgb(var(--v-theme-on-surface) / 0.4);
}
.meta__link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.meta__link:hover {
  text-decoration: underline;
}

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.meta div {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.meta dt {
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.meta dd {
  margin: 0;
  font-size: 0.86rem;
}
.panel__owner {
  margin-top: 1rem;
}

/* Tags ---------------------------------------------------------------- */
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
.tag--prio-high {
  background: rgb(var(--v-theme-warning) / 0.14);
  color: rgb(var(--v-theme-warning));
}
.tag--prio-urgent {
  background: rgb(var(--v-theme-error) / 0.14);
  color: rgb(var(--v-theme-error));
}

@media (max-width: 800px) {
  .tv__grid {
    grid-template-columns: 1fr;
  }
  .tv__side {
    position: static;
    order: -1;
  }
  .msg {
    max-width: 94%;
  }
}
</style>
