<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { useCompaniesStore } from '@/stores/companies'
import { useProV2Store } from '@/stores/pro-v2'
import { useToastStore } from '@/stores/toast'
import type { ProV2Usage } from '@/stores/pro-v2'
import { ProV2Sandbox, type LogLine, type SandboxStatus, type ExecutionError } from '@/lib/webcontainer'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const v2 = useProV2Store()
const toasts = useToastStore()

const companyId = ref<string | null>(null)
const draft = ref('')
const messagesEl = ref<HTMLElement | null>(null)

// A platform admin opens this from the admin panel with `?companyId=` (not
// the owner-facing `?c=`) — that company isn't in the admin's own list, so it
// bypasses the normal resolver, and "back" returns to that admin page instead
// of the dashboard.
const adminMode = computed(() => typeof route.query.companyId === 'string')
const backTarget = computed(() =>
  adminMode.value && companyId.value
    ? { name: 'admin-company', params: { id: companyId.value } }
    : { name: 'dashboard' },
)

const sandbox = shallowRef<ProV2Sandbox | null>(null)
const status = ref<SandboxStatus>('booting')
const previewUrl = ref('')
const logLines = ref<LogLine[]>([])
const showLog = ref(false)
const showRepairLog = ref(false)
const isRepairing = ref(false)

/** Only hide the iframe behind a full spinner while there's genuinely
 *  nothing to show yet. Once it's rendered once, a later error/fixing/failed
 *  state keeps the (possibly broken) preview visible alongside the status
 *  pill + repair log — hiding a preview the user could otherwise see the
 *  problem in would be worse UX, not better. */
const isBootingPhase = computed(() => status.value === 'booting' || status.value === 'installing' || status.value === 'starting')

const statusLabel = computed(() => {
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
  if (typeof u.estimatedCostUsd === 'number' && u.estimatedCostUsd > 0) {
    parts.push(`~$${u.estimatedCostUsd.toFixed(3)}`)
  }
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
watch(() => v2.messages.length, scrollToEnd)

async function submit(): Promise<void> {
  if (!companyId.value || !draft.value.trim() || v2.sending) return
  const text = draft.value
  draft.value = ''
  await scrollToEnd()
  const ok = await v2.send(companyId.value, text)
  if (!ok) {
    draft.value = text
    toasts.error(v2.error === 'ai_not_configured' ? t('pro.noKey') : t('pro.sendError'))
    return
  }
  await sandbox.value?.sync(v2.files)
}
function onComposerKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void submit()
  }
}

/** Builds the CURRENT project in the same running sandbox and uploads the
 *  result as the company's live public bundle — only offered once the
 *  preview is actually healthy, so a broken site is never published. */
async function publish(): Promise<void> {
  if (!companyId.value || !sandbox.value || status.value !== 'ready') return
  const result = await sandbox.value.build()
  if (!result.ok) {
    toasts.error(t('proV2.publishBuildFailed'))
    return
  }
  const ok = await v2.publish(companyId.value, result.files)
  toasts[ok ? 'success' : 'error'](ok ? t('proV2.publishSuccess') : t('proV2.publishError'))
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = adminMode.value
    ? String(route.query.companyId)
    : companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await v2.load(id)
  // Direct navigation without having paid the one-time unlock fee — send the
  // owner to that step instead of showing a generic load-error screen.
  if (v2.error === 'advanced_builder_locked' && !adminMode.value) {
    void router.replace({ name: 'create-unlock', query: { c: id } })
    return
  }
  if (!v2.files.length) return

  const box = new ProV2Sandbox()
  box.onLog = pushLog
  box.onStatus = (s) => (status.value = s)
  box.onServerReady = (url) => (previewUrl.value = url)
  box.onExecutionError = (err) => void handleSandboxError(err)
  sandbox.value = box
  await box.start(v2.files)
})

onBeforeUnmount(() => {
  // The WebContainer instance itself is intentionally NOT torn down here —
  // only one may ever boot per tab, and StackBlitz's API has no explicit
  // "unboot"; it's released when the tab/navigation actually discards it.
})
</script>

<template>
  <div class="v2">
    <header class="v2__bar">
      <div class="v2__title">
        <p class="v2__eyebrow"><span class="v2__dot" /> {{ t('proV2.eyebrow') }}</p>
        <h1>{{ t('proV2.title') }}</h1>
      </div>
      <div class="v2__headerActions">
        <span v-if="v2.usageSummary" class="v2__usagePill" :title="t('proV2.usageTooltip')">
          {{ t('proV2.usageToday') }} ${{ v2.usageSummary.dailySpendUsd.toFixed(2) }}/${{ v2.usageSummary.dailyLimitUsd }}
          · {{ t('proV2.usageMonth') }} ${{ v2.usageSummary.monthlySpendUsd.toFixed(2) }}/${{ v2.usageSummary.monthlyLimitUsd }}
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
          :disabled="status !== 'ready' || v2.publishing"
          :loading="v2.publishing"
          @click="publish"
        >
          {{ v2.publishedAt ? t('proV2.republish') : t('proV2.publish') }}
        </v-btn>
        <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="backTarget">
          {{ adminMode ? t('builder.backAdmin') : t('builder.back') }}
        </v-btn>
      </div>
    </header>

    <div v-if="v2.loading && !v2.files.length" class="v2__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!v2.files.length" class="v2__center v2__lock">
      <v-icon icon="mdi-alert-circle-outline" size="34" />
      <h2>{{ t('pro.loadErrorTitle') }}</h2>
      <p>{{ t('pro.loadErrorText') }}</p>
    </div>

    <div v-else class="v2__grid">
      <!-- FILE TREE -->
      <aside class="v2__tree">
        <span class="v2__paneLabel">{{ t('proV2.files') }}</span>
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
      </aside>

      <!-- CODE VIEWER -->
      <main class="v2__code">
        <span class="v2__paneLabel v2__codePath">{{ v2.activeFile?.path }}</span>
        <pre class="v2__codeBody"><code>{{ v2.activeFile?.content }}</code></pre>
      </main>

      <!-- LIVE PREVIEW -->
      <section class="v2__preview">
        <div class="v2__previewBar">
          <span class="v2__statusPill" :class="`is-${status}`">
            <span class="v2__statusDot" />
            {{ statusLabel }}
          </span>
          <div class="v2__previewBarActions">
            <button
              v-if="v2.repairLog.length"
              type="button"
              class="v2__logToggle"
              @click="showRepairLog = !showRepairLog"
            >
              {{ showRepairLog ? t('proV2.hideRepairLog') : t('proV2.showRepairLog', v2.repairLog.length) }}
            </button>
            <button type="button" class="v2__logToggle" @click="showLog = !showLog">
              {{ showLog ? t('proV2.hideLog') : t('proV2.showLog') }}
            </button>
          </div>
        </div>
        <div v-if="isBootingPhase" class="v2__previewBooting">
          <v-progress-circular indeterminate color="primary" size="28" />
          <p>{{ statusLabel }}</p>
        </div>
        <iframe
          v-show="!isBootingPhase"
          :src="previewUrl"
          class="v2__iframe"
          title="Live preview"
        />
        <div v-if="showRepairLog" class="v2__repairLog">
          <div v-for="(r, i) in v2.repairLog" :key="i" class="v2__repairEntry" :class="`is-${r.status}`">
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

      <!-- CHAT -->
      <aside class="v2__chat">
        <div ref="messagesEl" class="v2__messages">
          <div v-if="!v2.messages.length" class="v2__intro">
            <v-icon icon="mdi-creation" size="26" />
            <p>{{ t('proV2.introText') }}</p>
          </div>
          <div v-for="(m, i) in v2.messages" :key="i" class="v2__msg" :class="`v2__msg--${m.role}`">
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

        <form class="v2__composer" @submit.prevent="submit">
          <textarea
            v-model="draft"
            class="v2__input"
            rows="2"
            :placeholder="t('proV2.placeholder')"
            :disabled="v2.sending || !v2.aiConfigured"
            @keydown="onComposerKeydown"
          />
          <button type="submit" class="v2__send" :disabled="v2.sending || !draft.trim() || !v2.aiConfigured">
            <v-progress-circular v-if="v2.sending" indeterminate size="16" width="2" />
            <v-icon v-else icon="mdi-arrow-up" size="18" />
          </button>
        </form>
        <p v-if="!v2.aiConfigured" class="v2__note">{{ t('pro.noKey') }}</p>
      </aside>
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

.v2__grid {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(170px, 210px) minmax(260px, 1fr) minmax(320px, 1fr);
  grid-template-rows: minmax(0, 1fr) minmax(220px, 300px);
  gap: 0.8rem;
}
@media (max-width: 1100px) {
  .v2__grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto;
  }
  .v2__preview {
    grid-column: 1;
    grid-row: auto;
    min-height: 320px;
  }
  .v2__chat {
    grid-column: 1;
  }
}

.v2__tree {
  grid-column: 1;
  grid-row: 1;
}
.v2__code {
  grid-column: 2;
  grid-row: 1;
}
.v2__preview {
  grid-column: 3;
  grid-row: 1 / span 2;
}
.v2__chat {
  grid-column: 1 / span 2;
  grid-row: 2;
}

.v2__tree,
.v2__code,
.v2__preview,
.v2__chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.v2__tree {
  padding: 0.8rem 0.5rem;
  gap: 0.15rem;
  overflow-y: auto;
}
.v2__paneLabel {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.3rem 0.65rem;
}
.v2__file {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  text-align: left;
  padding: 0.4rem 0.65rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-family: 'JetBrains Mono Variable', monospace;
  color: rgba(var(--v-theme-on-surface), 0.75);
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

.v2__code {
  padding: 0.8rem 0 0;
}
.v2__codePath {
  padding: 0 0.9rem;
  font-family: 'JetBrains Mono Variable', monospace;
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
  gap: 0.5rem;
  max-width: 30ch;
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

.v2__composer {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  border-top: 1px solid var(--tvz-hairline);
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
  width: 36px;
  height: 36px;
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
