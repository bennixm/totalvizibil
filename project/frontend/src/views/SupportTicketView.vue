<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import SupportAvatar from '@/components/support/SupportAvatar.vue'
import SupportAdsPanel from '@/components/support/SupportAdsPanel.vue'
import SupportRoleBadge from '@/components/support/SupportRoleBadge.vue'
import { useSupportRoutes } from '@/composables/useSupportRoutes'
import { useSupportTime } from '@/composables/useSupportTime'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import {
  useSupportStore,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketMessage,
  type TicketStatus,
} from '@/stores/support'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { listRoute, perspective } = useSupportRoutes()
const { dateTime, time, dayKey, dayLabel } = useSupportTime()
const auth = useAuthStore()
const support = useSupportStore()
const notifications = useNotificationsStore()
const { ticket, staff, loading, working, error } = storeToRefs(support)

// Before the first load: the normal panel asks the API as a customer
// (`as=requester`), the admin panel as staff. See useSupportRoutes.ts.
support.setPerspective(perspective.value)

const id = computed(() => String(route.params.id))
/** Back to the list exactly as it was left (view, filters, search). */
const backRoute = computed(() => ({
  ...listRoute.value,
  query: support.listQuery[perspective.value],
}))
const draft = ref('')
const internal = ref(false)

/** Backend error codes this page knows how to phrase for a human. Anything
 *  outside this set falls through as-is (a server message, not a code) —
 *  same convention as SupportNewView. */
const KNOWN_ERRORS = new Set([
  'ticket_closed',
  'invalid_attachments',
  'assignee_not_staff',
  'invalid_assignee',
  'too_many_attachments',
  'attachment_too_large',
  'unsupported_attachment_type',
  'staff_only',
  'already_claimed',
  'not_a_member',
])
function errorText(code: string): string {
  return KNOWN_ERRORS.has(code) ? t('support.err.' + code) : code
}
const errText = computed(() => (error.value ? errorText(error.value) : ''))

// --- attachments (composer) --------------------------------------------
const MAX_FILES = 5
const MAX_FILE_BYTES = 6_000_000
const pendingFiles = ref<File[]>([])
/** Attachments that already made it to the server but whose message hasn't
 *  been posted yet (a failure later in the batch, or a failed `reply`). Kept
 *  across retries so the next attempt references them instead of uploading
 *  the same files again — re-uploading was both duplicating attachments and
 *  burning through the per-ticket cap. */
const uploadedIds = ref<string[]>([])
const uploadingAttachments = ref(false)
const attachError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

/** Everything that would ride along on the next message — files still to
 *  upload plus the ones already stored. */
const attachCount = computed(() => pendingFiles.value.length + uploadedIds.value.length)

function onAttachClick(): void {
  fileInput.value?.click()
}
function onFilesPicked(e: Event): void {
  const input = e.target as HTMLInputElement
  attachError.value = ''
  for (const file of Array.from(input.files ?? [])) {
    if (attachCount.value >= MAX_FILES) {
      attachError.value = t('support.attachTooMany', { n: MAX_FILES })
      break
    }
    if (file.size > MAX_FILE_BYTES) {
      attachError.value = t('support.attachTooLarge', { n: Math.round(MAX_FILE_BYTES / 1_000_000) })
      continue
    }
    pendingFiles.value.push(file)
  }
  input.value = ''
}
function removeFile(i: number): void {
  pendingFiles.value.splice(i, 1)
}
function fileSize(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1000)} KB`
}
function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read_failed'))
    r.readAsDataURL(file)
  })
}

// --- perspective ---------------------------------------------------------
/** Staff tools only in the admin panel, and only for real queue staff. A
 *  support agent looking at their OWN ticket from the normal panel gets the
 *  plain customer view (the API already answers them as a customer there). */
const isStaff = computed(
  () => perspective.value === 'staff' && (ticket.value?.viewerIsStaff ?? false),
)
const isRequester = computed(() => ticket.value?.viewerIsRequester ?? false)
const closed = computed(() => ticket.value?.status === 'closed')
const done = computed(() => ticket.value?.status === 'resolved' || closed.value)
// The admin user/business pages need the `admin` role, and are only offered
// from the admin panel, so following one never flips the panel.
const canAdmin = computed(() => isStaff.value && (auth.user?.platformRoles ?? []).includes('admin'))
const userAdminRoute = computed(() =>
  ticket.value ? { name: 'admin-user', params: { id: ticket.value.requester.id } } : null,
)
const companyAdminRoute = computed(() =>
  ticket.value?.company ? { name: 'admin-company', params: { id: ticket.value.company.id } } : null,
)
const assignedToMe = computed(
  () => !!ticket.value?.assignee && ticket.value.assignee.id === auth.user?.id,
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

// --- thread --------------------------------------------------------------
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
function systemIcon(m: TicketMessage): string {
  if (m.body.startsWith('status:')) return 'mdi-swap-horizontal'
  if (m.body.startsWith('priority:')) return 'mdi-flag-outline'
  if (m.body.startsWith('assigned') || m.body === 'unassigned') return 'mdi-account-switch-outline'
  return 'mdi-information-outline'
}

type ThreadItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; m: TicketMessage; grouped: boolean }

/** Messages with a date separator wherever the day changes, and consecutive
 *  messages by the same author (within 5 min) visually grouped. */
const thread = computed<ThreadItem[]>(() => {
  const out: ThreadItem[] = []
  let lastDay = ''
  let prev: TicketMessage | null = null
  for (const m of ticket.value?.messages ?? []) {
    const day = dayKey(m.createdAt)
    if (day !== lastDay) {
      out.push({ kind: 'day', key: 'd' + day, label: dayLabel(m.createdAt) })
      lastDay = day
      prev = null
    }
    const grouped =
      !!prev &&
      prev.kind === m.kind &&
      m.kind !== 'system' &&
      prev.author?.id === m.author?.id &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
    out.push({ kind: 'msg', key: m.id, m, grouped })
    prev = m
  }
  return out
})

// --- actions -------------------------------------------------------------
async function send(): Promise<void> {
  const text = draft.value.trim()
  if ((!text && !attachCount.value) || working.value || uploadingAttachments.value) return

  if (pendingFiles.value.length) {
    uploadingAttachments.value = true
    attachError.value = ''
    try {
      // Iterate a snapshot and drop each file from `pendingFiles` the moment
      // its upload lands, so a failure partway through leaves exactly the
      // files that still need sending. Previously the whole batch stayed
      // queued and a retry re-uploaded the successful ones as duplicates.
      for (const file of [...pendingFiles.value]) {
        let attachmentId: string
        try {
          const dataUri = await readFileAsDataUri(file)
          const att = await support.uploadAttachment(id.value, dataUri, file.name)
          if (!att) {
            attachError.value = support.error ? errorText(support.error) : t('support.attachFailed')
            return
          }
          attachmentId = att.id
        } catch {
          attachError.value = t('support.attachFailed')
          return
        }
        const at = pendingFiles.value.indexOf(file)
        if (at !== -1) pendingFiles.value.splice(at, 1)
        uploadedIds.value.push(attachmentId)
      }
    } finally {
      uploadingAttachments.value = false
    }
  }

  const ok = await support.reply(
    id.value,
    text || t('support.attachOnlyBody'),
    internal.value && isStaff.value,
    uploadedIds.value,
  )
  if (ok) {
    draft.value = ''
    internal.value = false
    pendingFiles.value = []
    uploadedIds.value = []
    attachError.value = ''
    await nextTick()
    endRef.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }
}
function onComposerKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void send()
  }
}

function setStatus(value: string): void {
  if (value && value !== ticket.value?.status)
    void support.patch(id.value, { status: value as TicketStatus })
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

const endRef = ref<HTMLElement | null>(null)

/**
 * Opened in the normal panel but not the viewer's own ticket: the API (asked
 * as a customer) says "not found". For queue staff that's a ticket they
 * reached through the wrong door, so send them to the admin panel's copy
 * instead of showing a dead end. Everyone else just sees "not found".
 */
async function load(ticketId: string): Promise<void> {
  await support.loadTicket(ticketId)
  if (!ticket.value && perspective.value === 'requester' && auth.isSupportStaff) {
    void router.replace({ name: 'admin-support-ticket', params: { id: ticketId } })
  }
}

watch(id, (v) => {
  // A different ticket: anything staged for the previous one must not ride
  // along on this one's next reply.
  pendingFiles.value = []
  uploadedIds.value = []
  attachError.value = ''
  if (v) void load(v)
})

/**
 * Live-refresh this thread when a support notification for it arrives.
 * `watch(id)` alone never fires when the toast's "Open ticket" action points
 * at the ticket already on screen (same route), so a staff reply stayed
 * invisible until a manual refresh. The notifications store prepends every
 * push to `items`, so watching the newest row's id catches them all.
 */
const SUPPORT_NOTIFICATION_TYPES = new Set([
  'ticket_created',
  'ticket_reply',
  'ticket_assigned',
  'support_ticket_update',
  'ticket_reopened',
  'ticket_assigned_requester',
  'ticket_unassigned',
  'ticket_closed_by_user',
])
watch(
  () => notifications.items[0]?.id ?? null,
  (newestId) => {
    if (!newestId) return
    const latest = notifications.items[0]
    if (!latest || !SUPPORT_NOTIFICATION_TYPES.has(latest.type)) return
    const ticketId = latest.data?.ticketId
    if (typeof ticketId !== 'string' || ticketId !== id.value) return
    void support.loadTicket(id.value)
  },
)

onMounted(() => {
  void load(id.value)
  // Staff-only endpoint, and only needed for the admin panel's assignee picker.
  if (perspective.value === 'staff') void support.loadStaff()
})
</script>

<template>
  <div class="tv" :class="{ 'tv--staff': perspective === 'staff' }">
    <v-btn
      variant="text"
      size="small"
      prepend-icon="mdi-arrow-left"
      class="tv__back text-none"
      :to="backRoute"
    >
      {{ t('support.back') }}
    </v-btn>

    <div v-if="loading && !ticket" class="tv__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!ticket" class="tv__center tv__center--err">
      <v-icon icon="mdi-alert-circle-outline" size="26" />
      <p>{{ t('support.notFound') }}</p>
      <v-btn variant="tonal" :to="backRoute">{{ t('support.back') }}</v-btn>
    </div>

    <template v-else>
      <!-- Header -------------------------------------------------------- -->
      <header class="head">
        <div class="head__tags">
          <span class="head__num">#{{ ticket.number }}</span>
          <span class="pill" :class="`pill--${ticket.status}`">
            <span class="pill__dot" />{{ t('support.status.' + ticket.status) }}
          </span>
          <span
            v-if="ticket.priority !== 'normal'"
            class="prio"
            :class="`prio--${ticket.priority}`"
          >
            <v-icon icon="mdi-flag" size="12" /> {{ t('support.priority.' + ticket.priority) }}
          </span>
          <span class="head__cat">{{ t('support.category.' + ticket.category) }}</span>
        </div>
        <h1>{{ ticket.subject }}</h1>
        <div class="head__by">
          <SupportAvatar :name="ticket.requester.name" :role="ticket.requester.role" :size="24" />
          <span class="head__name">{{ ticket.requester.name }}</span>
          <SupportRoleBadge :role="ticket.requester.role" />
          <span class="head__dot">·</span>
          <span>{{ dateTime(ticket.createdAt) }}</span>
          <template v-if="ticket.adsCampaign">
            <span class="head__dot">·</span>
            <span class="head__co"><v-icon icon="mdi-google-ads" size="14" /> {{ ticket.adsCampaign.name }}</span>
          </template>
          <template v-if="ticket.company">
            <span class="head__dot">·</span>
            <span class="head__co"
              ><v-icon icon="mdi-domain" size="14" /> {{ ticket.company.name }}</span
            >
          </template>
        </div>

        <!-- Staff quick actions: the three moves an agent makes most -->
        <div v-if="isStaff" class="quick">
          <v-btn
            v-if="!assignedToMe"
            size="small"
            variant="tonal"
            color="primary"
            class="text-none"
            prepend-icon="mdi-account-arrow-left-outline"
            :disabled="working"
            @click="assignToMe"
          >
            {{ t('support.quick.take') }}
          </v-btn>
          <span v-else class="quick__mine">
            <v-icon icon="mdi-account-check-outline" size="15" /> {{ t('support.assignedToYou') }}
          </span>
          <template v-if="!done">
            <v-btn
              v-if="ticket.status !== 'waiting'"
              size="small"
              variant="tonal"
              class="text-none"
              prepend-icon="mdi-timer-sand"
              :disabled="working"
              @click="setStatus('waiting')"
            >
              {{ t('support.quick.waiting') }}
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              color="success"
              class="text-none"
              prepend-icon="mdi-check"
              :disabled="working"
              @click="setStatus('resolved')"
            >
              {{ t('support.quick.resolve') }}
            </v-btn>
          </template>
          <v-btn
            v-else
            size="small"
            variant="tonal"
            class="text-none"
            prepend-icon="mdi-restore"
            :disabled="working"
            @click="reopenTicket"
          >
            {{ t('support.quick.reopen') }}
          </v-btn>
        </div>
      </header>

      <!-- Customer status banner: what's happening, and what (if anything) they should do -->
      <div v-if="!isStaff" class="banner" :class="`banner--${ticket.status}`">
        <v-icon
          :icon="
            ticket.status === 'waiting'
              ? 'mdi-reply-outline'
              : ticket.status === 'resolved'
                ? 'mdi-check-circle-outline'
                : ticket.status === 'closed'
                  ? 'mdi-lock-outline'
                  : ticket.status === 'in_progress'
                    ? 'mdi-progress-wrench'
                    : 'mdi-email-check-outline'
          "
          size="18"
        />
        <span>{{ t('support.banner.' + ticket.status) }}</span>
      </div>

      <div class="grid">
        <!-- Conversation ------------------------------------------------- -->
        <div class="main">
          <!-- The thread is a card of its own, like the header and the
               sidebar panels, instead of floating on the page background. -->
          <section class="chat">
            <ol class="thread">
              <template v-for="item in thread" :key="item.key">
                <li v-if="item.kind === 'day'" class="day">
                  <span>{{ item.label }}</span>
                </li>

                <li v-else-if="item.m.kind === 'system'" class="sys">
                  <v-icon :icon="systemIcon(item.m)" size="13" />
                  <span>{{ systemText(item.m) }}</span>
                  <span class="sys__when">{{ time(item.m.createdAt) }}</span>
                </li>

                <li
                  v-else
                  class="msg"
                  :class="{
                    'msg--mine': item.m.mine,
                    'msg--note': item.m.kind === 'note',
                    'msg--team': !item.m.author?.requester,
                    'msg--grouped': item.grouped,
                  }"
                >
                  <SupportAvatar
                    v-if="!item.grouped"
                    class="msg__av"
                    :name="item.m.author?.name ?? t('support.systemUser')"
                    :role="item.m.author?.role ?? 'user'"
                    :size="34"
                  />
                  <span v-else class="msg__avGap" />
                  <div class="msg__col">
                    <div v-if="!item.grouped" class="msg__head">
                      <span class="msg__who">{{
                        item.m.author ? item.m.author.name : t('support.systemUser')
                      }}</span>
                      <SupportRoleBadge v-if="item.m.author" :role="item.m.author.role" />
                      <span v-if="item.m.mine" class="msg__you">{{ t('support.you') }}</span>
                      <span class="msg__when" :title="dateTime(item.m.createdAt)">{{
                        time(item.m.createdAt)
                      }}</span>
                    </div>
                    <div class="bubble">
                      <p v-if="item.m.kind === 'note'" class="bubble__note">
                        <v-icon icon="mdi-lock-outline" size="13" /> {{ t('support.internalNote') }}
                        <span>· {{ t('support.noteVisibility') }}</span>
                      </p>
                      <p class="bubble__body">{{ item.m.body }}</p>
                      <div v-if="item.m.attachments.length" class="files">
                        <a
                          v-for="a in item.m.attachments"
                          :key="a.id"
                          :href="support.attachmentUrl(id, a.id)"
                          target="_blank"
                          rel="noopener"
                          class="file"
                        >
                          <v-icon
                            :icon="
                              a.mime === 'application/pdf'
                                ? 'mdi-file-pdf-box'
                                : 'mdi-file-image-outline'
                            "
                            size="16"
                          />
                          <span class="file__name">{{ a.filename }}</span>
                          <span class="file__size">{{ fileSize(a.size) }}</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </li>
              </template>
            </ol>
            <div ref="endRef" />
          </section>

          <!-- Composer -->
          <div v-if="!closed" class="composer" :class="{ 'composer--note': internal }">
            <div v-if="isStaff" class="composer__mode" role="tablist">
              <button
                type="button"
                role="tab"
                :class="{ 'is-on': !internal }"
                :aria-selected="!internal"
                @click="internal = false"
              >
                <v-icon icon="mdi-reply-outline" size="15" /> {{ t('support.composerReply') }}
              </button>
              <button
                type="button"
                role="tab"
                class="composer__modeNote"
                :class="{ 'is-on': internal }"
                :aria-selected="internal"
                @click="internal = true"
              >
                <v-icon icon="mdi-lock-outline" size="15" /> {{ t('support.internalNote') }}
              </button>
            </div>
            <v-textarea
              v-model="draft"
              :placeholder="internal ? t('support.notePlaceholder') : t('support.replyPlaceholder')"
              variant="plain"
              auto-grow
              rows="3"
              max-rows="12"
              hide-details
              class="composer__input"
              @keydown="onComposerKey"
            />
            <div v-if="pendingFiles.length" class="composer__pending">
              <span v-for="(f, i) in pendingFiles" :key="i" class="composer__pendingChip">
                <v-icon icon="mdi-paperclip" size="13" />
                <span class="composer__pendingName">{{ f.name }}</span>
                <span class="composer__pendingSize">{{ fileSize(f.size) }}</span>
                <button
                  type="button"
                  class="composer__pendingRemove"
                  :aria-label="t('common.close')"
                  @click="removeFile(i)"
                >
                  <v-icon icon="mdi-close" size="13" />
                </button>
              </span>
            </div>
            <p v-if="attachError" class="composer__attachErr">
              <v-icon icon="mdi-alert-circle-outline" size="13" /> {{ attachError }}
            </p>
            <!-- Files that already landed server-side after a partial failure:
                 say so, so "only one chip left" doesn't read as data loss. -->
            <p v-if="uploadedIds.length && pendingFiles.length" class="composer__attachKept">
              <v-icon icon="mdi-cloud-check-outline" size="13" />
              {{ t('support.attachKept', { n: uploadedIds.length }) }}
            </p>
            <div class="composer__row">
              <input
                ref="fileInput"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                multiple
                class="composer__fileInput"
                @change="onFilesPicked"
              />
              <button
                type="button"
                class="composer__attachBtn"
                :disabled="attachCount >= MAX_FILES"
                :title="t('support.attachFile')"
                :aria-label="t('support.attachFile')"
                @click="onAttachClick"
              >
                <v-icon icon="mdi-paperclip" size="18" />
              </button>
              <span class="composer__hint">{{ t('support.sendHint') }}</span>
              <v-spacer />
              <v-btn
                :color="internal ? 'warning' : 'primary'"
                variant="flat"
                class="composer__send text-none"
                :loading="working || uploadingAttachments"
                :disabled="!draft.trim() && !attachCount"
                :append-icon="internal ? 'mdi-lock-outline' : 'mdi-send'"
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
              class="text-none"
              @click="reopenTicket"
            >
              {{ t('support.reopen') }}
            </v-btn>
          </div>

          <p v-if="errText" class="tv__err">
            <v-icon icon="mdi-alert-circle-outline" size="15" /> {{ errText }}
          </p>
        </div>

        <!-- Sidebar -------------------------------------------------------- -->
        <aside class="side">
          <section class="panel">
            <p class="panel__label">{{ t('support.people') }}</p>
            <div class="person">
              <SupportAvatar
                :name="ticket.requester.name"
                :role="ticket.requester.role"
                :size="36"
              />
              <div class="person__body">
                <span class="person__k">{{ t('support.requester') }}</span>
                <router-link
                  v-if="canAdmin && userAdminRoute"
                  :to="userAdminRoute"
                  class="person__name person__name--link"
                >
                  {{ ticket.requester.name }}
                </router-link>
                <span v-else class="person__name">{{ ticket.requester.name }}</span>
                <SupportRoleBadge :role="ticket.requester.role" />
              </div>
            </div>
            <div class="person">
              <SupportAvatar
                :name="ticket.assignee?.name"
                :role="ticket.assignee?.role"
                :size="36"
              />
              <div class="person__body">
                <span class="person__k">{{ t('support.assignee') }}</span>
                <template v-if="ticket.assignee">
                  <span class="person__name">{{ ticket.assignee.name }}</span>
                  <SupportRoleBadge :role="ticket.assignee.role" />
                </template>
                <span v-else class="person__none">{{ t('support.unassigned') }}</span>
              </div>
            </div>
          </section>

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
          </section>

          <!-- Shortcuts into the admin panel (admin role, admin panel only) -->
          <section v-if="canAdmin" class="panel">
            <p class="panel__label">{{ t('support.investigate') }}</p>
            <router-link v-if="userAdminRoute" :to="userAdminRoute" class="jump">
              <span class="jump__ic"><v-icon icon="mdi-account-search-outline" size="16" /></span>
              <span class="jump__body">
                <span class="jump__t">{{ t('support.openUserAdmin') }}</span>
                <span class="jump__s">{{ ticket.requester.name }}</span>
              </span>
              <v-icon icon="mdi-chevron-right" size="16" class="jump__go" />
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
              <v-icon icon="mdi-chevron-right" size="16" class="jump__go" />
            </router-link>
          </section>

          <section v-if="isStaff" class="panel">
            <p class="panel__label">{{ t('support.adsTitle') }}</p>
            <SupportAdsPanel :ticket-id="ticket.id" />
          </section>

          <section class="panel">
            <p class="panel__label">{{ t('support.details') }}</p>
            <dl class="meta">
              <div v-if="ticket.company">
                <dt>{{ t('support.business') }}</dt>
                <dd>{{ ticket.company.name }}</dd>
              </div>
              <div v-if="!isStaff">
                <dt>{{ t('support.colCategory') }}</dt>
                <dd>{{ t('support.category.' + ticket.category) }}</dd>
              </div>
              <div>
                <dt>{{ t('support.opened') }}</dt>
                <dd>{{ dateTime(ticket.createdAt) }}</dd>
              </div>
              <div>
                <dt>{{ t('support.lastActivity') }}</dt>
                <dd>{{ dateTime(ticket.lastActivityAt) }}</dd>
              </div>
              <div v-if="isStaff && ticket.firstResponseAt">
                <dt>{{ t('support.firstResponse') }}</dt>
                <dd>{{ dateTime(ticket.firstResponseAt) }}</dd>
              </div>
              <div v-if="ticket.resolvedAt">
                <dt>{{ t('support.resolvedAt') }}</dt>
                <dd>{{ dateTime(ticket.resolvedAt) }}</dd>
              </div>
            </dl>

            <div v-if="!isStaff && isRequester && !closed" class="panel__owner">
              <v-btn
                v-if="ticket.status !== 'resolved'"
                block
                variant="tonal"
                color="success"
                size="small"
                class="text-none"
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
                class="mt-1 text-none"
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
/* One spacing value for every gap between blocks on this page: the page
   column, the conversation/sidebar grid, the conversation column and the
   sidebar stack all use `--tv-gap`, and no block carries its own outer
   margin, so the space above and below each card is always identical. */
.tv {
  --tv-gap: 1rem;
  max-width: 1040px;
  margin-inline: auto;
  padding: clamp(1rem, 4vw, 2rem) clamp(1rem, 4vw, 1.5rem) 4rem;
  display: flex;
  flex-direction: column;
  gap: var(--tv-gap);
}
/* The admin layout already pads its content. */
.tv--staff {
  padding-top: 0;
}
.tv__back {
  align-self: flex-start;
  margin-left: -0.5rem;
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
.head {
  padding: 1.2rem 1.3rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
}
.head__tags {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.head__num {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-variant-numeric: tabular-nums;
}
.head__cat {
  font-size: var(--tvz-fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: var(--tvz-fs-title);
  letter-spacing: -0.025em;
  margin: 0.6rem 0 0;
  overflow-wrap: anywhere;
}
.head__by {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.7rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.head__name {
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.head__dot {
  opacity: 0.5;
}
.head__co {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.quick {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.quick__mine {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.4rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}

/* Status pill / priority (same language as the list) ------------------- */
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
  gap: 0.2rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.prio--high {
  color: rgb(var(--v-theme-warning));
}
.prio--urgent {
  color: rgb(var(--v-theme-error));
}

/* Customer banner ------------------------------------------------------- */
.banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  font-size: var(--tvz-fs-body);
  border: 1px solid rgba(var(--v-theme-primary), 0.25);
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgb(var(--v-theme-on-surface));
}
.banner .v-icon {
  color: rgb(var(--v-theme-primary));
}
.banner--waiting {
  border-color: rgba(var(--v-theme-warning), 0.35);
  background: rgba(var(--v-theme-warning), 0.09);
}
.banner--waiting .v-icon {
  color: rgb(var(--v-theme-warning));
}
.banner--resolved {
  border-color: rgba(var(--v-theme-success), 0.3);
  background: rgba(var(--v-theme-success), 0.08);
}
.banner--resolved .v-icon {
  color: rgb(var(--v-theme-success));
}
.banner--closed {
  border-color: var(--tvz-hairline);
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.banner--closed .v-icon {
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* Layout -------------------------------------------------------------- */
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 17rem;
  gap: var(--tv-gap);
  align-items: start;
}
.main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--tv-gap);
}

/* Thread ------------------------------------------------------------ */
/* Deliberately lighter than the solid cards around it (header, composer,
   sidebar panels): a translucent surface, so the conversation reads as its
   own area. Only the background is translucent, never `opacity`, which
   would also fade the messages themselves. */
.chat {
  padding: 1.2rem 1.3rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 14px;
  background: rgba(var(--v-theme-surface), 0.4);
}
/* The first date separator sits at the top edge of the card: no extra
   offset, so the card's padding is the same on all four sides. */
.thread > .day:first-child {
  margin-top: 0;
}
.thread {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.day {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.4rem 0 0.1rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.day::before,
.day::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--tvz-hairline);
}
.sys {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.52);
}
.sys__when {
  opacity: 0.7;
}
.msg {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  max-width: 90%;
}
.msg--grouped {
  margin-top: -0.55rem;
}
.msg--mine {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.msg--note {
  align-self: stretch;
  max-width: 100%;
}
.msg__avGap {
  width: 34px;
  flex: none;
}
.msg__col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.msg--mine .msg__col {
  align-items: flex-end;
}
.msg__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: var(--tvz-fs-caption);
}
.msg--mine .msg__head {
  flex-direction: row-reverse;
}
.msg__who {
  font-weight: 700;
}
.msg__you {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.msg__when {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.bubble {
  max-width: 100%;
  padding: 0.75rem 0.95rem;
  border-radius: 4px 14px 14px 14px;
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
}
.msg--team .bubble {
  background: rgba(var(--v-theme-info), 0.06);
  border-color: rgba(var(--v-theme-info), 0.22);
}
.msg--mine .bubble {
  border-radius: 14px 4px 14px 14px;
  background: rgba(var(--v-theme-primary), 0.1);
  border-color: rgba(var(--v-theme-primary), 0.3);
}
.msg--note .bubble {
  width: 100%;
  border-radius: 12px;
  border-style: dashed;
  background: rgba(var(--v-theme-warning), 0.07);
  border-color: rgba(var(--v-theme-warning), 0.45);
}
.bubble__note {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0 0.4rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  color: rgb(var(--v-theme-warning));
}
.bubble__note span {
  font-weight: 500;
  opacity: 0.8;
}
.bubble__body {
  margin: 0;
  font-size: var(--tvz-fs-section);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.6rem;
}
.file {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.55rem;
  border-radius: 7px;
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  font-size: var(--tvz-fs-caption);
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
  max-width: 100%;
}
.file:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  color: rgb(var(--v-theme-primary));
}
.file__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 16rem;
}
.file__size {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* Composer -------------------------------------------------------- */
.composer {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
  transition: border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.composer:focus-within {
  border-color: rgba(var(--v-theme-primary), 0.6);
}
.composer--note,
.composer--note:focus-within {
  border-color: rgba(var(--v-theme-warning), 0.55);
  background: rgba(var(--v-theme-warning), 0.04);
}
.composer__mode {
  display: flex;
  border-bottom: 1px solid var(--tvz-hairline);
}
.composer__mode button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.6rem 0.95rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.composer__mode button.is-on {
  color: rgb(var(--v-theme-primary));
  border-bottom-color: rgb(var(--v-theme-primary));
}
.composer__mode .composer__modeNote.is-on {
  color: rgb(var(--v-theme-warning));
  border-bottom-color: rgb(var(--v-theme-warning));
}
.composer__input {
  padding: 0.35rem 0.95rem 0;
}
.composer__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
}
.composer__hint {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.composer__send {
  border-radius: 9px;
}
.composer__pending {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0 0.95rem;
}
.composer__pendingChip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.3rem 0.25rem 0.5rem;
  border-radius: 7px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: var(--tvz-fs-caption);
  max-width: 100%;
}
.composer__pendingName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}
.composer__pendingSize {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.composer__pendingRemove {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.composer__pendingRemove:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
}
.composer__attachErr,
.composer__attachKept {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0.45rem 0 0;
  padding: 0 0.95rem;
  font-size: var(--tvz-fs-small);
}
.composer__attachErr {
  color: rgb(var(--v-theme-error));
}
.composer__attachKept {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.composer__fileInput {
  display: none;
}
.composer__attachBtn {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.composer__attachBtn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.composer__attachBtn:disabled {
  opacity: 0.4;
}
.closedbar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.85rem 1rem;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 12px;
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.tv__err {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgb(var(--v-theme-error));
}

/* Sidebar --------------------------------------------------------- */
.side {
  position: sticky;
  top: 5rem;
  display: flex;
  flex-direction: column;
  gap: var(--tv-gap);
}
.panel {
  padding: 1rem 1.05rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}
.panel__label {
  margin: 0 0 0.75rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.person {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}
.person + .person {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--tvz-hairline);
}
.person__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  min-width: 0;
}
.person__k {
  font-size: var(--tvz-fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.person__name {
  font-size: var(--tvz-fs-body);
  font-weight: 600;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
}
.person__name--link {
  color: rgb(var(--v-theme-primary));
}
.person__name--link:hover {
  text-decoration: underline;
}
.person__none {
  font-size: var(--tvz-fs-body);
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Admin jump shortcuts ------------------------------------------------- */
.jump {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.65rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 9px;
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.jump + .jump {
  margin-top: 0.5rem;
}
.jump:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.05);
}
.jump__ic {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.12);
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
  font-size: var(--tvz-fs-small);
  font-weight: 600;
}
.jump__s {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jump__go {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
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
  font-size: var(--tvz-fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.meta dd {
  margin: 0;
  font-size: var(--tvz-fs-body);
}
.panel__owner {
  margin-top: 1rem;
}

@media (max-width: 860px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Conversation first on a phone: it's what both sides came for. Staff
     still get their quick actions up top, in the header. */
  .side {
    position: static;
  }
  .msg {
    max-width: 100%;
  }
  .composer__hint {
    display: none;
  }
}
</style>
