<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'
import { useProV2Store } from '@/stores/pro-v2'
import { useToastStore } from '@/stores/toast'
import { useWalletStore } from '@/stores/wallet'
import type { ProV2Usage } from '@/stores/pro-v2'
import CreditsValue from '@/components/CreditsValue.vue'
import OnboardingSteps from '@/components/OnboardingSteps.vue'
import {
  ProV2Sandbox,
  SandboxBootError,
  bootContainer,
  type LogLine,
  type SandboxStatus,
  type SandboxBootFailure,
  type ExecutionError,
} from '@/lib/webcontainer'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const v2 = useProV2Store()
const toasts = useToastStore()
const wallet = useWalletStore()

const companyId = ref<string | null>(null)
const draft = ref('')
const messagesEl = ref<HTMLElement | null>(null)

// A platform admin opens this from the admin panel with `?companyId=` (not
// the owner-facing `?c=`) — that company isn't in the admin's own list, so it
// bypasses the normal resolver, and "back" returns to that admin page instead
// of the dashboard.
//
// This must be gated on the REAL platform role, not just the query param's
// presence: this route is (correctly) `requiresAuth` only, since ordinary
// business owners are its normal users, so without the role check ANY signed-in
// user — an owner, or a `support`/`finance`/`moderator` staffer, none of which
// should grant this — could type `?companyId=<any-uuid>` and flip themselves
// into "admin mode". `pro-v2.service.ts` re-checks membership/role server-side
// on every read and write, so that was never a data leak, but it did skip the
// protective client-side checks below (the local builder-unlock pre-check and
// the `advanced_builder_locked` → pay-screen redirect) and left the user in a
// broken-looking admin shell for a company they can't touch. With the role
// check, a non-admin carrying `?companyId=` falls through to exactly the normal
// owner path, as if the param weren't there at all. Open-coded the same way
// every other admin-only check in the app is (there is no `isAdmin` getter).
const adminMode = computed(
  () =>
    typeof route.query.companyId === 'string' &&
    (auth.user?.platformRoles.includes('admin') ?? false),
)
const backTarget = computed(() =>
  adminMode.value && companyId.value
    ? { name: 'admin-company', params: { id: companyId.value } }
    : { name: 'dashboard' },
)

// First-time setup only — this query flag is only ever present while the
// business is going through the create-a-business wizard, never on a later
// edit of an already-configured site. Advancing requires a successful
// publish first, so the owner never lands on the budget step with the
// builder-incomplete block that campaign activation already enforces.
const inFlow = computed(() => route.query.flow === 'onboarding')
const canContinue = computed(() => inFlow.value && !!v2.publishedAt)
function continueToBudget(): void {
  if (!companyId.value) return
  void router.push({ name: 'campaign-budget', query: { c: companyId.value, flow: 'onboarding' } })
}

const sandbox = shallowRef<ProV2Sandbox | null>(null)
const status = ref<SandboxStatus>('booting')
const previewUrl = ref('')
const logLines = ref<LogLine[]>([])
const showLog = ref(false)
const showRepairLog = ref(false)
const isRepairing = ref(false)
/** Set when the sandbox could not be started at all. Without this the view
 *  sat on its "booting the sandbox" spinner forever with no error and no way
 *  out — `WebContainer.boot()` never settles on a page that isn't
 *  cross-origin isolated. */
const bootFailure = ref<SandboxBootFailure | ''>('')
const bootRetrying = ref(false)

// Left panel: Chat is the primary surface, Files is opt-in. On narrow
// viewports the same idea extends to a 3-way switch (chat/files/preview) —
// `leftTab` picks which of chat/files shows inside the panel (used on both
// desktop and mobile), `mobileView` picks, mobile-only, whether the panel or
// the preview fills the screen.
const leftTab = ref<'chat' | 'files'>('chat')
const mobileView = ref<'panel' | 'preview'>('panel')
function selectMobileTab(tab: 'chat' | 'files' | 'preview'): void {
  if (tab === 'preview') {
    mobileView.value = 'preview'
  } else {
    leftTab.value = tab
    mobileView.value = 'panel'
  }
}

// --- image attachments (chat composer) --------------------------------
/** Mirrors the Easy Site upload flow's own pre-check (`MAX_UPLOAD` in
 *  `EasyStudioAgent.vue`) and the backend's real decoded-byte cap
 *  (`MAX_ASSET_BYTES` in `website-asset.service.ts`) — the SAME number in all
 *  three, so there is no band of files that pass the client check and then
 *  fail server-side with a generic error. */
const MAX_UPLOAD_BYTES = 4_500_000
/** Mirrors the Easy Site portfolio cap — a chat turn referencing more images
 *  than this is a mistake, and the backend caps a company at 60 assets. */
const MAX_ATTACHMENTS = 10

interface PendingAttachment {
  file: File
  previewUrl: string
}
const pendingAttachments = ref<PendingAttachment[]>([])
const uploadingAttachments = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function onAttachClick(): void {
  fileInput.value?.click()
}
function onFilesPicked(e: Event): void {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  let tooLarge = 0
  let overflow = 0
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    // Reject up front rather than letting a predictably-too-big photo fail
    // server-side with a generic error.
    if (file.size > MAX_UPLOAD_BYTES) {
      tooLarge++
      continue
    }
    if (pendingAttachments.value.length >= MAX_ATTACHMENTS) {
      overflow++
      continue
    }
    pendingAttachments.value.push({ file, previewUrl: URL.createObjectURL(file) })
  }
  input.value = ''
  if (tooLarge) {
    toasts.error(t('proV2.attachTooLarge', { n: tooLarge, mb: Math.floor(MAX_UPLOAD_BYTES / 1_000_000) }))
  }
  if (overflow) toasts.error(t('proV2.attachTooMany', { max: MAX_ATTACHMENTS }))
}
function removeAttachment(index: number): void {
  const [removed] = pendingAttachments.value.splice(index, 1)
  if (removed) URL.revokeObjectURL(removed.previewUrl)
}
function clearAttachments(): void {
  for (const a of pendingAttachments.value) URL.revokeObjectURL(a.previewUrl)
  pendingAttachments.value = []
}

/** Only hide the iframe behind a full spinner while there's genuinely
 *  nothing to show yet. Once it's rendered once, a later error/fixing/failed
 *  state keeps the (possibly broken) preview visible alongside the status
 *  pill + repair log — hiding a preview the user could otherwise see the
 *  problem in would be worse UX, not better. */
const isBootingPhase = computed(() => status.value === 'booting' || status.value === 'installing' || status.value === 'starting')

const statusLabel = computed(() => {
  // A failed BOOT is not a failed repair — don't let the status pill read
  // "Couldn't fix it" for a sandbox that never started.
  if (bootFailure.value) return t('proV2.bootErrorTitle')
  switch (status.value) {
    case 'booting':
      return t('proV2.statusBooting')
    case 'installing':
      return t('proV2.statusInstalling')
    case 'starting':
      return t('proV2.statusStarting')
    case 'error':
      return t('proV2.statusErrorDetected')
    case 'fixing':
      return t('proV2.statusFixing')
    case 'failed':
      return t('proV2.statusFailed')
    default:
      return t('proV2.statusReady')
  }
})

/** §5 self-correction: the sandbox detected a real install/build/runtime
 *  failure. Guarded against overlap — if a repair call is already in
 *  flight, a fresh signal for the same underlying issue will surface again
 *  once it resolves (the sandbox's own dedup already collapses rapid
 *  duplicates of the identical incident). */
async function handleSandboxError(err: ExecutionError): Promise<void> {
  if (!companyId.value || isRepairing.value) return
  isRepairing.value = true
  status.value = 'fixing'
  try {
    const { shouldRetry } = await v2.handleExecutionError(companyId.value, err)
    if (shouldRetry) {
      await sandbox.value?.sync(v2.files)
      if (status.value === 'fixing') status.value = 'ready'
    } else {
      status.value = 'failed'
    }
  } finally {
    isRepairing.value = false
  }
}

function pushLog(line: LogLine): void {
  logLines.value.push(line)
  if (logLines.value.length > 400) logLines.value.splice(0, logLines.value.length - 400)
}

function usageCaption(u?: ProV2Usage): string {
  if (!u) return ''
  const parts: string[] = []
  if (u.durationMs) parts.push(t('pro.seconds', { n: Math.round(u.durationMs / 1000) }))
  if (typeof u.toolCalls === 'number') parts.push(t('pro.toolCallsCount', u.toolCalls))
  if (u.iterations) parts.push(t('pro.iterations', u.iterations))
  if (u.provider) parts.push(u.escalations ? `${u.provider} (${t('proV2.escalated', u.escalations)})` : u.provider)
  return parts.join(' · ')
}

function fileDepth(path: string): number {
  return path.split('/').length - 1
}
function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

async function scrollToEnd(): Promise<void> {
  await nextTick()
  messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: 'smooth' })
}
watch(() => v2.chatMessages.length, scrollToEnd)

async function submit(): Promise<void> {
  if (!companyId.value || v2.sending || uploadingAttachments.value) return
  const hasText = !!draft.value.trim()
  const hasAttachments = pendingAttachments.value.length > 0
  if (!hasText && !hasAttachments) return

  let text = draft.value
  const attachments = pendingAttachments.value
  if (attachments.length) {
    uploadingAttachments.value = true
    try {
      const urls: string[] = []
      let failed = 0
      for (const a of attachments) {
        const url = await v2.uploadAsset(companyId.value, a.file)
        if (url) urls.push(url)
        else failed++
      }
      if (!urls.length) {
        toasts.error(t('proV2.attachUploadError'))
        return
      }
      // A PARTIAL failure used to be silently swallowed: the turn went ahead
      // referencing only what uploaded, and the agent built a site missing
      // images the owner believed they had attached. Always say so.
      if (failed) {
        toasts.error(t('proV2.attachPartialFailure', { ok: urls.length, failed }))
      }
      text = [text.trim(), ...urls.map((u) => `Uploaded image: ${u}`)].filter(Boolean).join('\n\n')
    } finally {
      uploadingAttachments.value = false
    }
  }

  draft.value = ''
  clearAttachments()
  await scrollToEnd()
  const ok = await v2.send(companyId.value, text)
  if (!ok) {
    // A confirmed timeout means the message really was sent and may still
    // get a real reply (v2.messages already reflects the true server state)
    // — restoring it into the composer would invite a confusing duplicate.
    if (v2.error !== 'resume_timed_out') draft.value = text
    if (v2.error === 'insufficient_credits') {
      // Stays up until dismissed (not the usual auto-hide) and hands the
      // owner straight to the wallet — this is the one AI-editor error that
      // needs action, not just an acknowledgement.
      toasts.error(t('pro.insufficientCredits'), {
        timeout: 0,
        action: { label: t('wallet.topUpCta'), to: { name: 'wallet' } },
      })
    } else {
      toasts.error(
        v2.error === 'ai_not_configured'
          ? t('pro.noKey')
          : v2.error === 'resume_timed_out'
            ? t('proV2.resumeTimedOut')
            : t('pro.sendError'),
      )
    }
    return
  }
  await sandbox.value?.sync(v2.files)
  void wallet.load()
}
function onComposerKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void submit()
  }
}

// --- publish ----------------------------------------------------------
/** The build step runs in the browser and can reject outright (a dead
 *  sandbox process). That rejection used to escape `publish()` entirely —
 *  so the button neither spun nor errored and clicking "Publish" visibly did
 *  nothing. Everything below is inside one try/catch/finally, and the
 *  SPECIFIC reason is kept rather than collapsed into one generic string. */
const publishing = ref(false)
const publishErrorReason = ref('')

/** Known machine reasons the publish endpoint rejects with, mapped to real
 *  copy. Anything unrecognised is shown verbatim rather than discarded —
 *  a raw backend sentence beats "something went wrong". */
function publishErrorText(reason: string): string {
  if (!reason || reason === 'error') return t('proV2.publishError')
  if (reason === 'advanced_builder_locked') return t('proV2.publishErr.locked')
  if (/no website yet to publish/i.test(reason)) return t('proV2.publishErr.noWebsite')
  if (/index\.html/i.test(reason)) return t('proV2.publishErr.noIndex')
  if (/too large|exceeds the/i.test(reason)) return t('proV2.publishErr.tooLarge')
  if (/at most .* files/i.test(reason)) return t('proV2.publishErr.tooManyFiles')
  if (/cannot edit this project/i.test(reason)) return t('proV2.publishErr.forbidden')
  return reason
}
const publishErrorDisplay = computed(() =>
  publishErrorReason.value ? publishErrorText(publishErrorReason.value) : '',
)

/** Builds the CURRENT project in the same running sandbox and uploads the
 *  result as the company's live public bundle — only offered once the
 *  preview is actually healthy, so a broken site is never published. */
async function publish(): Promise<void> {
  if (!companyId.value || !sandbox.value || status.value !== 'ready' || publishing.value) return
  publishing.value = true
  publishErrorReason.value = ''
  try {
    const result = await sandbox.value.build()
    if (!result.ok) {
      // The build's own stderr/stdout tail is the actionable part — keep it
      // instead of replacing it with the generic "build failed".
      publishErrorReason.value = result.error
      toasts.error(t('proV2.publishBuildFailed'))
      return
    }
    const ok = await v2.publish(companyId.value, result.files)
    if (ok) {
      toasts.success(t('proV2.publishSuccess'))
      return
    }
    publishErrorReason.value = v2.publishError
    toasts.error(publishErrorText(v2.publishError))
  } catch (err) {
    publishErrorReason.value = err instanceof Error ? err.message : String(err)
    toasts.error(publishErrorText(publishErrorReason.value))
  } finally {
    publishing.value = false
  }
}

// --- sandbox lifecycle -------------------------------------------------
async function startSandbox(id: string, resume = true): Promise<void> {
  bootFailure.value = ''
  const box = new ProV2Sandbox()
  box.onLog = pushLog
  box.onStatus = (s) => (status.value = s)
  box.onServerReady = (url) => (previewUrl.value = url)
  box.onExecutionError = (err) => void handleSandboxError(err)

  // If the last message is the user's own with no reply yet, a turn was
  // still running when this page was last closed/reloaded — resume watching
  // for it (sets `v2.sending` immediately, so the "thinking…" indicator
  // shows right away) in parallel with booting the sandbox, since neither
  // depends on the other until the reply actually lands.
  // Only on the first mount — a boot RETRY must not restart the (up to
  // 6-minute) in-flight poll, which has already run by then.
  const resumePromise = resume ? v2.resumeIfInFlight(id) : null
  try {
    await box.start(v2.files)
    sandbox.value = box
  } catch (err) {
    // No more infinite "Starting sandbox…" spinner: this surfaces a real,
    // distinct, retry-able error state.
    bootFailure.value = err instanceof SandboxBootError ? err.reason : 'boot_failed'
    status.value = 'failed'
    pushLog({ text: err instanceof Error ? err.message : String(err), kind: 'error' })
  }
  if (!resumePromise) return
  const resumeResult = await resumePromise
  if (resumeResult === 'resolved') {
    await sandbox.value?.sync(v2.files)
  } else if (resumeResult === 'timed_out') {
    toasts.error(t('proV2.resumeTimedOut'))
  }
}

function reloadPage(): void {
  window.location.reload()
}

/** Retry after a failed boot. Meaningful because `bootContainer()` no longer
 *  caches a rejected boot promise — this genuinely attempts a fresh boot. */
async function retryBoot(): Promise<void> {
  if (!companyId.value || bootRetrying.value) return
  bootRetrying.value = true
  status.value = 'booting'
  try {
    await startSandbox(companyId.value, false)
  } finally {
    bootRetrying.value = false
  }
}

/** Retry the initial project/file load (item: the permission/role dead-end
 *  pane had no retry and no way back). */
async function retryLoad(): Promise<void> {
  if (!companyId.value || v2.loading) return
  await v2.load(companyId.value)
  if (v2.files.length && !sandbox.value) await startSandbox(companyId.value, false)
}

const loadErrorIsPermission = computed(
  () => /cannot edit this project/i.test(v2.error) || v2.error === 'Company not found',
)

onMounted(async () => {
  void wallet.load()
  await companies.fetchOverview().catch(() => {})
  const id = adminMode.value
    ? String(route.query.companyId)
    : companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id

  // Check the unlock flag BEFORE touching the sandbox. Entry points elsewhere
  // route here on `website.mode === 'advanced'` alone, so an un-unlocked
  // company used to mount this view, fire off a real (slow, expensive)
  // WebContainer boot, and only then learn from the backend that it isn't
  // unlocked and bounce to the pay screen. A platform admin is exempt — the
  // backend heals the flag for them, and the company isn't in their list.
  if (!adminMode.value) {
    const entry = companies.overview.find((c) => c.id === id)
    if (entry && !entry.builderUnlocked) {
      void router.replace({ name: 'create-unlock', query: { c: id } })
      return
    }
  }

  // Only now is the boot worth starting — kicked off in parallel with the
  // file fetch below, since `ProV2Sandbox.start()` awaits this same cached
  // promise and the two waits were otherwise sequential.
  void bootContainer().catch(() => {
    /* reported through startSandbox()'s own catch below */
  })
  await v2.load(id)
  // Direct navigation without having paid the one-time unlock fee — send the
  // owner to that step instead of showing a generic load-error screen.
  if (v2.error === 'advanced_builder_locked' && !adminMode.value) {
    void router.replace({ name: 'create-unlock', query: { c: id } })
    return
  }
  if (!v2.files.length) return
  await startSandbox(id)
})

onBeforeUnmount(() => {
  // The WebContainer instance itself is intentionally NOT torn down here —
  // only one may ever boot per tab, and StackBlitz's API has no explicit
  // "unboot"; it's released when the tab/navigation actually discards it.
  clearAttachments()
})

// A notification or the nav dropdown can change ?c=/?companyId= to a
// DIFFERENT company while this view stays mounted (same route, only the
// query differs) — unlike the simpler list pages, this view can't just
// reload its data in place: only one WebContainer may ever boot per tab (see
// the note above), so re-running the boot for a new company here would try
// to boot a second one. A full page reload gives it the same clean slate a
// manual refresh already does, without touching the sandbox/boot logic.
watch(
  () => (adminMode.value ? route.query.companyId : route.query.c),
  (raw) => {
    const next = typeof raw === 'string' ? raw : null
    if (next && next !== companyId.value) window.location.reload()
  },
)
</script>

<template>
  <div class="v2">
    <OnboardingSteps v-if="inFlow" mode="advanced" current="build" class="v2__steps" />
    <header class="v2__bar">
      <div class="v2__title">
        <p class="v2__eyebrow"><span class="v2__dot" /> {{ t('proV2.eyebrow') }}</p>
        <h1>{{ t('proV2.title') }}</h1>
      </div>
      <div class="v2__headerActions">
        <span v-if="wallet.summary" class="v2__usagePill" :title="t('proV2.walletTooltip')">
          <v-icon icon="mdi-wallet-outline" size="14" />
          <CreditsValue :credits="wallet.summary.balance.credits" :approx="false" />
        </span>
        <span v-if="v2.publishedAt" class="v2__publishedPill">
          <v-icon icon="mdi-check-circle-outline" size="14" />
          {{ t('proV2.published') }}
        </span>
        <v-btn
          variant="tonal"
          color="primary"
          size="small"
          prepend-icon="mdi-cloud-upload-outline"
          :disabled="status !== 'ready' || publishing || v2.publishing"
          :loading="publishing || v2.publishing"
          @click="publish"
        >
          {{ v2.publishedAt ? t('proV2.republish') : t('proV2.publish') }}
        </v-btn>
        <v-btn
          v-if="inFlow"
          color="primary"
          size="small"
          append-icon="mdi-arrow-right"
          :disabled="!canContinue"
          :title="canContinue ? '' : t('proV2.continueNeedsPublish')"
          @click="continueToBudget"
        >
          {{ t('proV2.continueToBudget') }}
        </v-btn>
        <v-btn v-if="!inFlow" variant="text" size="small" prepend-icon="mdi-arrow-left" :to="backTarget">
          {{ adminMode ? t('builder.backAdmin') : t('builder.back') }}
        </v-btn>
      </div>
    </header>

    <!-- The specific publish-rejection reason, which used to be captured in
         the store and then never rendered anywhere. -->
    <p v-if="publishErrorDisplay" class="v2__publishError">
      <v-icon icon="mdi-alert-circle-outline" size="15" />
      <span>{{ publishErrorDisplay }}</span>
      <button type="button" class="v2__publishErrorX" @click="publishErrorReason = ''">×</button>
    </p>

    <div v-if="v2.loading && !v2.files.length" class="v2__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!v2.files.length" class="v2__center v2__lock">
      <v-icon icon="mdi-alert-circle-outline" size="34" />
      <h2>{{ loadErrorIsPermission ? t('proV2.loadForbiddenTitle') : t('pro.loadErrorTitle') }}</h2>
      <p>{{ loadErrorIsPermission ? t('proV2.loadForbiddenText') : t('pro.loadErrorText') }}</p>
      <div class="v2__lockActions">
        <v-btn
          v-if="!loadErrorIsPermission"
          color="primary"
          variant="tonal"
          size="small"
          prepend-icon="mdi-refresh"
          :loading="v2.loading"
          @click="retryLoad"
        >
          {{ t('common.retry') }}
        </v-btn>
        <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="backTarget">
          {{ adminMode ? t('builder.backAdmin') : t('builder.back') }}
        </v-btn>
      </div>
    </div>

    <div
      v-else
      class="v2__grid"
      :class="[
        mobileView === 'preview' ? 'is-mobile-preview' : 'is-mobile-panel',
        leftTab === 'files' ? 'is-files-mode' : 'is-chat-mode',
      ]"
    >
      <!-- MOBILE-ONLY: 3-way switch, static (not fixed) so it never fights
           the app's own fixed bottom nav — hidden on desktop via CSS. -->
      <nav class="v2__mobileTabs">
        <button
          type="button"
          :class="{ 'is-active': mobileView === 'panel' && leftTab === 'chat' }"
          @click="selectMobileTab('chat')"
        >
          <v-icon icon="mdi-chat-outline" size="18" />
          {{ t('proV2.tabChat') }}
        </button>
        <button
          type="button"
          :class="{ 'is-active': mobileView === 'panel' && leftTab === 'files' }"
          @click="selectMobileTab('files')"
        >
          <v-icon icon="mdi-file-code-outline" size="18" />
          {{ t('proV2.files') }}
        </button>
        <button
          type="button"
          :class="{ 'is-active': mobileView === 'preview' }"
          @click="selectMobileTab('preview')"
        >
          <v-icon icon="mdi-monitor" size="18" />
          {{ t('proV2.tabPreview') }}
        </button>
      </nav>

      <!-- LEFT PANEL: Chat (default) | Files -->
      <div class="v2__left">
        <div class="v2__tabs">
          <button
            type="button"
            class="v2__tab"
            :class="{ 'is-active': leftTab === 'chat' }"
            @click="leftTab = 'chat'"
          >
            <v-icon icon="mdi-chat-outline" size="16" />
            {{ t('proV2.tabChat') }}
          </button>
          <button
            type="button"
            class="v2__tab"
            :class="{ 'is-active': leftTab === 'files' }"
            @click="leftTab = 'files'"
          >
            <v-icon icon="mdi-file-code-outline" size="16" />
            {{ t('proV2.files') }}
          </button>
        </div>

        <!-- CHAT -->
        <div v-show="leftTab === 'chat'" class="v2__chatPane">
          <div ref="messagesEl" class="v2__messages">
            <div v-if="!v2.chatMessages.length" class="v2__intro">
              <v-icon icon="mdi-creation" size="26" />
              <h2>{{ t('proV2.introTitle') }}</h2>
              <p>{{ t('proV2.introText') }}</p>
            </div>
            <!-- `chatMessages` excludes the automatic sandbox repair reports
                 (persisted with role 'user'); those render in the compact
                 repair log instead of as fake user bubbles full of stack
                 traces. -->
            <div v-for="(m, i) in v2.chatMessages" :key="i" class="v2__msg" :class="`v2__msg--${m.role}`">
              <p class="v2__msgText">{{ m.content }}</p>
              <details v-if="m.toolCalls?.length" class="v2__steps">
                <summary>{{ t('pro.whatIDid', m.toolCalls.length) }}</summary>
                <ul>
                  <li v-for="(s, j) in m.toolCalls" :key="j">{{ s.summary }}</li>
                </ul>
              </details>
              <p v-if="m.usage" class="v2__usage">{{ usageCaption(m.usage) }}</p>
            </div>
            <div v-if="v2.sending" class="v2__msg v2__msg--assistant v2__thinking">
              <span class="v2__dots"><span /><span /><span /></span>
              {{ t('pro.working') }}
            </div>
          </div>

          <div v-if="pendingAttachments.length" class="v2__attachments">
            <div v-for="(a, i) in pendingAttachments" :key="i" class="v2__attachmentChip">
              <img :src="a.previewUrl" alt="" />
              <button
                type="button"
                class="v2__attachmentRemove"
                :aria-label="t('proV2.removeAttachment')"
                @click="removeAttachment(i)"
              >
                ×
              </button>
            </div>
          </div>

          <form class="v2__composer" @submit.prevent="submit">
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              multiple
              class="v2__fileInput"
              @change="onFilesPicked"
            />
            <button
              type="button"
              class="v2__attachBtn"
              :disabled="v2.sending || !v2.aiConfigured"
              :title="t('proV2.attachImage')"
              @click="onAttachClick"
            >
              <v-icon icon="mdi-paperclip" size="18" />
            </button>
            <textarea
              v-model="draft"
              class="v2__input"
              rows="2"
              :placeholder="t('proV2.placeholder')"
              :disabled="v2.sending || !v2.aiConfigured"
              @keydown="onComposerKeydown"
            />
            <button
              type="submit"
              class="v2__send"
              :disabled="
                v2.sending ||
                uploadingAttachments ||
                (!draft.trim() && !pendingAttachments.length) ||
                !v2.aiConfigured
              "
            >
              <v-progress-circular v-if="v2.sending || uploadingAttachments" indeterminate size="16" width="2" />
              <v-icon v-else icon="mdi-arrow-up" size="18" />
            </button>
          </form>
          <p v-if="!v2.aiConfigured" class="v2__note">{{ t('pro.noKey') }}</p>
        </div>

        <!-- FILES: just the file list here — the code viewer is its own
             top-level column (see .v2__codeViewer below) so files mode gets
             three real panes: list / file content / site preview. -->
        <div v-show="leftTab === 'files'" class="v2__fileList">
          <button
            v-for="f in v2.files"
            :key="f.path"
            type="button"
            class="v2__file"
            :style="{ paddingLeft: `${0.65 + fileDepth(f.path) * 0.85}rem` }"
            :class="{
              'is-active': f.path === v2.activeFilePath,
              'is-changed': v2.lastChangedPaths.includes(f.path),
            }"
            @click="v2.selectFile(f.path)"
          >
            <v-icon icon="mdi-file-code-outline" size="13" />
            {{ fileName(f.path) }}
          </button>
        </div>
      </div>

      <!-- FILE CONTENT — its own column, only while Files is selected -->
      <div v-if="leftTab === 'files'" class="v2__codeViewer">
        <span class="v2__codePath">{{ v2.activeFile?.path }}</span>
        <pre class="v2__codeBody"><code>{{ v2.activeFile?.content }}</code></pre>
      </div>

      <!-- LIVE PREVIEW — smaller while Files is open, wide otherwise -->
      <section class="v2__previewPane">
        <div class="v2__previewBar">
          <span class="v2__statusPill" :class="`is-${status}`">
            <span class="v2__statusDot" />
            {{ statusLabel }}
          </span>
          <div class="v2__previewBarActions">
            <button
              v-if="v2.allRepairs.length"
              type="button"
              class="v2__logToggle"
              @click="showRepairLog = !showRepairLog"
            >
              {{ showRepairLog ? t('proV2.hideRepairLog') : t('proV2.showRepairLog', v2.allRepairs.length) }}
            </button>
            <button type="button" class="v2__logToggle" @click="showLog = !showLog">
              {{ showLog ? t('proV2.hideLog') : t('proV2.showLog') }}
            </button>
          </div>
        </div>
        <!-- A failed boot is its own distinct, actionable, retry-able state —
             NOT the "booting…" spinner left running forever. -->
        <div v-if="bootFailure" class="v2__bootError">
          <v-icon icon="mdi-cloud-off-outline" size="32" />
          <h3>{{ t('proV2.bootErrorTitle') }}</h3>
          <p>
            {{
              bootFailure === 'not_isolated'
                ? t('proV2.bootErrorIsolation')
                : bootFailure === 'timeout'
                  ? t('proV2.bootErrorTimeout')
                  : t('proV2.bootErrorGeneric')
            }}
          </p>
          <div class="v2__bootErrorActions">
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              prepend-icon="mdi-refresh"
              :loading="bootRetrying"
              @click="retryBoot"
            >
              {{ t('common.retry') }}
            </v-btn>
            <v-btn variant="text" size="small" @click="reloadPage">
              {{ t('proV2.bootErrorReload') }}
            </v-btn>
          </div>
        </div>
        <div v-else-if="isBootingPhase" class="v2__previewBooting">
          <v-progress-circular indeterminate color="primary" size="28" />
          <p>{{ statusLabel }}</p>
        </div>
        <iframe
          v-show="!isBootingPhase && !bootFailure"
          :src="previewUrl"
          class="v2__iframe"
          title="Live preview"
        />
        <div v-if="showRepairLog" class="v2__repairLog">
          <div v-for="(r, i) in v2.allRepairs" :key="i" class="v2__repairEntry" :class="`is-${r.status}`">
            <p class="v2__repairError">
              <v-icon :icon="r.status === 'fixed' ? 'mdi-check-circle-outline' : r.status === 'failed' ? 'mdi-alert-circle-outline' : 'mdi-progress-wrench'" size="14" />
              {{ r.kind }}<span v-if="r.path"> · {{ r.path }}</span>
            </p>
            <p class="v2__repairSummary">{{ r.errorSummary.split('\n')[0].slice(0, 160) }}</p>
            <p v-if="r.fixSummary" class="v2__repairFix">{{ r.fixSummary }}</p>
            <p v-else-if="r.status === 'failed'" class="v2__repairFix">{{ t('proV2.repairGaveUp') }}</p>
          </div>
        </div>
        <div v-if="showLog" class="v2__log">
          <p v-for="(l, i) in logLines" :key="i" :class="{ 'is-error': l.kind === 'error' }">{{ l.text }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.v2 {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--tvz-topbar-h) - 2px);
  padding: clamp(1rem, 3vw, 1.75rem);
  gap: 0.9rem;
  overflow-x: hidden;
  max-width: 100%;
}
@media (max-width: 900px) {
  .v2 {
    padding: 0.75rem;
  }
}
.v2__steps {
  margin-bottom: 0.4rem;
}
.v2__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.v2__headerActions {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.v2__usagePill {
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
}
.v2__publishedPill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: #2e9e5b;
  white-space: nowrap;
}
.v2__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 0.35rem;
}
.v2__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.v2__title h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.35rem, 3.5vw, 1.9rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.v2__center {
  flex: 1;
  display: grid;
  place-items: center;
}
.v2__lock {
  text-align: center;
  gap: 0.5rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.v2__lockActions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.6rem;
}
.v2__publishError {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
  font-size: 0.8rem;
  word-break: break-word;
}
.v2__publishError span {
  flex: 1 1 auto;
  min-width: 0;
}
.v2__publishErrorX {
  flex: none;
  font-size: 1rem;
  line-height: 1;
  color: inherit;
}
.v2__bootError {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem 1.25rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.v2__bootError .v-icon {
  color: rgb(var(--v-theme-error));
}
.v2__bootError h3 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1rem;
  color: rgb(var(--v-theme-on-surface));
}
.v2__bootError p {
  margin: 0;
  max-width: 44ch;
  font-size: 0.84rem;
  line-height: 1.5;
}
.v2__bootErrorActions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

/* Desktop: Chat mode is 2 columns (chat 35% / preview 65% — the preview is
 * still the most important surface). Files mode is 3 columns (file list
 * 20% / file content 40% / site preview 40%) — opening Files trades some
 * preview width for a real, readable look at the open file instead of
 * squeezing it into the same narrow column as the file list. */
.v2__grid {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 35% 65%;
  gap: 0.8rem;
}
.v2__grid.is-files-mode {
  grid-template-columns: 20% 40% 40%;
}

.v2__left,
.v2__previewPane,
.v2__codeViewer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.v2__mobileTabs {
  display: none;
}

/* --- Left panel: Chat/Files tab switch --- */
.v2__tabs {
  flex: none;
  display: flex;
  gap: 0.3rem;
  padding: 0.6rem 0.6rem 0;
}
.v2__tab {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.5rem 0.6rem;
  border-radius: 9px;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  min-height: 40px;
}
.v2__tab:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.v2__tab.is-active {
  background: var(--tvz-ai-soft);
  color: rgb(var(--v-theme-on-surface));
}

.v2__chatPane {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* --- Files mode: the file list is its own full-height column now (the
 * code viewer lives in a separate top-level column, .v2__codeViewer). --- */
.v2__fileList {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.6rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.v2__file {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  text-align: left;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-family: 'JetBrains Mono Variable', monospace;
  color: rgba(var(--v-theme-on-surface), 0.75);
  min-height: 40px;
}
.v2__file:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.v2__file.is-active {
  background: var(--tvz-ai-soft);
  color: rgb(var(--v-theme-on-surface));
}
.v2__file.is-changed::after {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  margin-left: auto;
}
.v2__codeViewer {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0 0;
}
.v2__codePath {
  flex: none;
  padding: 0 0.9rem;
  font-size: 0.7rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-family: 'JetBrains Mono Variable', monospace;
  word-break: break-all;
}
.v2__codeBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  margin: 0.5rem 0 0;
  padding: 0.6rem 0.9rem 1rem;
  font-family: 'JetBrains Mono Variable', monospace;
  font-size: 0.78rem;
  line-height: 1.55;
  background: rgba(var(--v-theme-on-surface), 0.02);
  max-width: 100%;
}

/* --- Responsive: below this width, the grid collapses to a single column
 * and a static Chat/Files/Preview switch takes over. It's deliberately NOT
 * `position: fixed` — the app shell already has its own fixed bottom nav
 * (MobileTabBar, z-index 1000); a second fixed bar at the same edge would
 * either fight it for the same screen space or sit invisibly behind it. This
 * one lives in normal flow at the top of the builder instead. --- */
@media (max-width: 900px) {
  .v2__grid {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .v2__mobileTabs {
    flex: none;
    display: flex;
    gap: 0.3rem;
    padding: 0.1rem 0.1rem 0.6rem;
  }
  .v2__mobileTabs button {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.5rem 0.2rem;
    min-height: 48px;
    border-radius: 10px;
    font-size: 0.68rem;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.55);
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--tvz-hairline);
  }
  .v2__mobileTabs button.is-active {
    color: rgb(var(--v-theme-primary));
    background: var(--tvz-ai-soft);
    border-color: transparent;
  }
  .v2__left,
  .v2__previewPane,
  .v2__codeViewer {
    display: none;
    flex: 1 1 auto;
    min-height: 60vh;
  }
  .v2__grid.is-mobile-panel .v2__left {
    display: flex;
  }
  /* Files mode on mobile: file list (compact) stacked above the file
   * content (gets the rest of the space) — the desktop 3-column split
   * doesn't fit a phone width, so both panes share one vertical column. */
  .v2__grid.is-mobile-panel.is-files-mode .v2__left {
    flex: none;
    min-height: 0;
    max-height: 32vh;
  }
  .v2__grid.is-mobile-panel.is-files-mode .v2__codeViewer {
    display: flex;
    flex: 1 1 auto;
    min-height: 40vh;
  }
  .v2__grid.is-mobile-preview .v2__previewPane {
    display: flex;
  }
}

.v2__previewBar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.v2__statusPill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.v2__statusDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f0ad4e;
}
.v2__statusPill.is-ready .v2__statusDot {
  background: #2e9e5b;
}
.v2__statusPill.is-error .v2__statusDot,
.v2__statusPill.is-failed .v2__statusDot {
  background: #d64545;
}
.v2__statusPill.is-fixing .v2__statusDot {
  background: #f0ad4e;
  animation: v2-pulse 1s ease-in-out infinite;
}
@keyframes v2-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .v2__statusPill.is-fixing .v2__statusDot {
    animation: none;
  }
}
.v2__previewBarActions {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.v2__logToggle {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--tvz-ai);
}
.v2__repairLog {
  flex: none;
  max-height: 220px;
  overflow-y: auto;
  padding: 0.6rem 0.7rem;
  border-top: 1px solid var(--tvz-hairline);
  background: rgba(var(--v-theme-on-surface), 0.03);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.v2__repairEntry {
  font-size: 0.74rem;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--tvz-hairline);
}
.v2__repairEntry.is-fixed {
  border-color: #2e9e5b55;
}
.v2__repairEntry.is-failed {
  border-color: #d6454555;
}
.v2__repairError {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0 0.2rem;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.66rem;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.v2__repairSummary {
  margin: 0 0 0.25rem;
  font-family: 'JetBrains Mono Variable', monospace;
  color: rgba(var(--v-theme-on-surface), 0.75);
  word-break: break-word;
}
.v2__repairFix {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.v2__previewBooting {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.82rem;
}
.v2__iframe {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #fff;
}
.v2__log {
  flex: none;
  max-height: 160px;
  overflow-y: auto;
  padding: 0.5rem 0.7rem;
  border-top: 1px solid var(--tvz-hairline);
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-family: 'JetBrains Mono Variable', monospace;
  font-size: 0.68rem;
}
.v2__log p {
  margin: 0 0 0.15rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.v2__log p.is-error {
  color: #d64545;
}

.v2__messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.7rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.v2__intro {
  margin: auto;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  max-width: 34ch;
}
.v2__intro h2 {
  margin: 0.2rem 0 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.05rem;
  color: rgb(var(--v-theme-on-surface));
}
.v2__intro p {
  margin: 0;
}
.v2__msg {
  max-width: 92%;
  padding: 0.55rem 0.7rem;
  border-radius: 12px;
  font-size: 0.84rem;
  line-height: 1.4;
}
.v2__msg--user {
  align-self: flex-end;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.v2__msg--assistant {
  align-self: flex-start;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.v2__msgText {
  margin: 0;
  white-space: pre-wrap;
}
.v2__steps {
  margin-top: 0.35rem;
  font-size: 0.72rem;
}
.v2__steps summary {
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-weight: 600;
}
.v2__steps ul {
  margin: 0.3rem 0 0;
  padding-left: 1.1rem;
}
.v2__usage {
  margin: 0.3rem 0 0;
  font-size: 0.66rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.v2__thinking {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.v2__dots {
  display: inline-flex;
  gap: 3px;
}
.v2__dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: v2-bounce 1.1s ease-in-out infinite;
}
.v2__dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.v2__dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes v2-bounce {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .v2__dots span {
    animation: none;
  }
}

.v2__attachments {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.5rem 0.7rem 0;
}
.v2__attachmentChip {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--tvz-hairline);
}
.v2__attachmentChip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.v2__attachmentRemove {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 18px;
  height: 18px;
  line-height: 1;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  color: #fff;
  font-size: 13px;
  display: grid;
  place-items: center;
}
.v2__fileInput {
  display: none;
}

.v2__composer {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  border-top: 1px solid var(--tvz-hairline);
}
.v2__attachBtn {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.v2__attachBtn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.v2__attachBtn:disabled {
  opacity: 0.5;
}
.v2__input {
  flex: 1 1 auto;
  resize: none;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  padding: 0.5rem 0.65rem;
  font: inherit;
  font-size: 0.83rem;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
.v2__input:focus {
  outline: 2px solid var(--tvz-ai);
  outline-offset: 1px;
}
.v2__send {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.v2__send:disabled {
  opacity: 0.5;
}
.v2__note {
  padding: 0 0.9rem 0.6rem;
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
</style>
