import { defineStore } from 'pinia'

import { apiFetch, ApiError } from '@/services/api'
import type { ProjectFile, ExecutionError, BundleFile } from '@/lib/webcontainer'
import { decideRepairAction, normalizeErrorKey } from '@/lib/repair-loop'

export interface ProV2Step {
  tool: string
  summary: string
}

export interface ProV2Usage {
  inputTokens?: number | null
  outputTokens?: number | null
  iterations?: number | null
  durationMs?: number | null
  cacheReadTokens?: number
  toolCalls?: number
  estimatedCostUsd?: number
  /** Which provider/model actually produced the final result, and how many
   *  times the router escalated to a stronger tier before that. */
  provider?: string
  model?: string
  escalations?: number
}

/** Internal-only cost breakdown (see ai-usage.service.ts) — never rendered
 *  in the builder UI; the owner only ever sees their wallet balance. Kept
 *  fetchable for future admin/debug tooling. */
export interface AiUsageSummary {
  dailySpendUsd: number
  monthlySpendUsd: number
  byProvider: { provider: string; calls: number; costUsd: number; inputTokens: number; outputTokens: number }[]
  byCategory: { taskCategory: string; calls: number; costUsd: number }[]
}

export interface ProV2Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ProV2Step[] | null
  usage?: ProV2Usage
  createdAt?: string
}

interface ViewResponse {
  aiConfigured: boolean
  projectId: string
  publishedAt: string | null
  files: ProjectFile[]
  messages: ProV2Message[]
}

interface MessageResponse {
  reply: string
  steps: ProV2Step[]
  files: ProjectFile[]
  changedPaths: string[]
  usage: ProV2Usage
}

export interface RepairLogEntry {
  kind: ExecutionError['kind']
  errorSummary: string
  path?: string
  status: 'fixing' | 'fixed' | 'failed'
  fixSummary?: string
  toolCalls?: ProV2Step[]
}

export interface RepairOutcome {
  shouldRetry: boolean
}

export type ResumeResult = 'not_needed' | 'resolved' | 'timed_out'

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('file_read_failed'))
    reader.readAsDataURL(file)
  })
}

interface State {
  projectId: string | null
  files: ProjectFile[]
  messages: ProV2Message[]
  aiConfigured: boolean
  loading: boolean
  sending: boolean
  error: string
  activeFilePath: string | null
  lastChangedPaths: string[]
  repairAttempts: number
  lastRepairedErrorKey: string | null
  repairLog: RepairLogEntry[]
  usageSummary: AiUsageSummary | null
  publishing: boolean
  publishedAt: string | null
  publishError: string
}

export const useProV2Store = defineStore('pro-v2', {
  state: (): State => ({
    projectId: null,
    files: [],
    messages: [],
    aiConfigured: true,
    loading: false,
    sending: false,
    error: '',
    activeFilePath: null,
    lastChangedPaths: [],
    repairAttempts: 0,
    lastRepairedErrorKey: null,
    repairLog: [],
    usageSummary: null,
    publishing: false,
    publishedAt: null,
    publishError: '',
  }),

  getters: {
    activeFile(state): ProjectFile | null {
      return state.files.find((f) => f.path === state.activeFilePath) ?? state.files[0] ?? null
    },
  },

  actions: {
    async load(companyId: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        const res = await apiFetch<ViewResponse>(`/companies/${companyId}/pro-v2`)
        this.projectId = res.projectId
        this.files = res.files
        this.messages = res.messages
        this.aiConfigured = res.aiConfigured
        this.publishedAt = res.publishedAt
        if (!this.activeFilePath) {
          this.activeFilePath = res.files.find((f) => f.path === 'src/App.vue')?.path ?? res.files[0]?.path ?? null
        }
        void this.loadUsage(companyId)
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async send(companyId: string, content: string): Promise<boolean> {
      const text = content.trim()
      if (!text || this.sending) return false
      this.sending = true
      this.error = ''
      // A fresh user-initiated request starts a new generation/edit turn —
      // it gets its own budget of repair attempts.
      this.resetRepairState()
      this.messages.push({ role: 'user', content: text })
      try {
        // A full initial generation writes several complete files (more real
        // work per turn than V1's structured edits) and can legitimately run
        // past two minutes — a live test's backend call took 136s.
        const res = await apiFetch<MessageResponse>(`/companies/${companyId}/pro-v2/message`, {
          method: 'POST',
          body: { content: text },
          timeoutMs: 240_000,
        })
        this.files = res.files
        this.lastChangedPaths = res.changedPaths
        this.messages.push({ role: 'assistant', content: res.reply, toolCalls: res.steps, usage: res.usage })
        if (res.changedPaths.length) this.activeFilePath = res.changedPaths[0]
        void this.loadUsage(companyId)
        return true
      } catch (err) {
        const status = err instanceof ApiError ? err.status : -1
        this.error = err instanceof ApiError ? err.message : 'error'
        // A 4xx here is always a fast rejection from BEFORE the turn's user
        // message is even persisted (DTO validation, no AI configured, empty
        // wallet — see runTurn() in pro-v2-agent.service.ts) — nothing to
        // reconcile, safe to discard the optimistic message immediately.
        // Anything else (status 0 = client-side timeout/dropped connection,
        // 5xx = an upstream proxy gave up on a slow response) tells us
        // NOTHING about whether the turn actually started — the backend
        // persists the user message and may finish the turn regardless of
        // whether the client is still there to see it. Reconcile with the
        // server instead of silently discarding what might already be a
        // real exchange — same recovery path a page reload mid-turn uses.
        if (status >= 400 && status < 500) {
          this.messages.pop()
          return false
        }
        const outcome = await this.resumeIfInFlight(companyId)
        if (outcome === 'not_needed') {
          this.messages.pop()
          return false
        }
        if (outcome === 'timed_out') this.error = 'resume_timed_out'
        return outcome === 'resolved'
      } finally {
        this.sending = false
      }
    },

    selectFile(path: string): void {
      this.activeFilePath = path
    },

    /** Called right after `load()` on mount. The backend now persists the
     *  user's message BEFORE running the (possibly multi-minute) agent turn,
     *  so a reload mid-turn shows that message with no assistant reply yet —
     *  detect that shape and poll the same `load()` endpoint until the reply
     *  lands, instead of leaving the chat looking finished/empty. Reuses the
     *  existing `sending` flag so the UI's "thinking…" indicator just works. */
    async resumeIfInFlight(companyId: string): Promise<ResumeResult> {
      const last = this.messages.at(-1)
      if (!last || last.role !== 'user') return 'not_needed'
      this.sending = true
      const POLL_MS = 4000
      const MAX_POLLS = 90 // ~6 minutes — comfortably past the longest observed real turn
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        try {
          const res = await apiFetch<ViewResponse>(`/companies/${companyId}/pro-v2`)
          this.files = res.files
          this.messages = res.messages
          this.publishedAt = res.publishedAt
          if (res.messages.at(-1)?.role !== 'user') {
            this.sending = false
            void this.loadUsage(companyId)
            return 'resolved'
          }
        } catch {
          /* a single failed poll is not fatal — the turn may still be running server-side */
        }
      }
      // Given up — the server-side call most likely died without replying.
      // Never claim "still working" forever; let the owner try again.
      this.sending = false
      return 'timed_out'
    },

    /** Uploads an image attached in the chat composer (portfolio/product/
     *  team/logo/etc.) and returns its public URL, or null on failure. The
     *  caller weaves the URL into the plain chat message text — the agent
     *  isn't aware of "uploads" as a separate concept, keeping this simple. */
    async uploadAsset(companyId: string, file: File): Promise<string | null> {
      try {
        const dataUri = await readFileAsDataUri(file)
        const res = await apiFetch<{ id: string; url: string }>(
          `/companies/${companyId}/pro-v2/assets`,
          { method: 'POST', body: { dataUri }, timeoutMs: 30_000 },
        )
        // This URL is woven into the chat message and used verbatim as an
        // <img src> by the generated Vue file — which runs inside the
        // WebContainer sandbox, a COMPLETELY different origin
        // (*.webcontainer-api.io) than this app. The backend returns a bare
        // relative path (correct once published, same-origin as this app),
        // but a relative path resolves against the SANDBOX's own origin and
        // 404s there. Absolute here so it works in both places — <img>
        // doesn't need CORS to just display a cross-origin image.
        return new URL(res.url, window.location.origin).toString()
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'error'
        return null
      }
    },

    resetRepairState(): void {
      this.repairAttempts = 0
      this.lastRepairedErrorKey = null
    },

    /** §5 self-correction: called when the sandbox reports a real
     *  install/build/runtime failure. Decides (via the same pure rules the
     *  backend's own duplicate-failure guard is built on) whether to spend
     *  another repair turn or give up, and if so, sends the labeled error
     *  report through the SAME agent as a normal message — no new Claude
     *  client. Returns whether the caller should sync + keep watching. */
    async handleExecutionError(companyId: string, error: ExecutionError): Promise<RepairOutcome> {
      const key = normalizeErrorKey(error.summary)
      const action = decideRepairAction(
        { attempts: this.repairAttempts, lastErrorKey: this.lastRepairedErrorKey },
        key,
      )
      if (action.type !== 'repair') {
        this.repairLog.push({
          kind: error.kind,
          errorSummary: error.summary,
          path: error.path,
          status: 'failed',
        })
        return { shouldRetry: false }
      }

      this.repairAttempts++
      this.lastRepairedErrorKey = key
      const index =
        this.repairLog.push({
          kind: error.kind,
          errorSummary: error.summary,
          path: error.path,
          status: 'fixing',
        }) - 1

      try {
        const res = await apiFetch<MessageResponse>(`/companies/${companyId}/pro-v2/repair`, {
          method: 'POST',
          body: { kind: error.kind, summary: error.summary, path: error.path, attempt: this.repairAttempts },
          timeoutMs: 240_000,
        })
        this.files = res.files
        this.lastChangedPaths = res.changedPaths
        this.repairLog[index] = { ...this.repairLog[index], status: 'fixed', fixSummary: res.reply, toolCalls: res.steps }
        void this.loadUsage(companyId)
        return { shouldRetry: true }
      } catch {
        this.repairLog[index] = { ...this.repairLog[index], status: 'failed' }
        return { shouldRetry: false }
      }
    },

    /** Publishes an already-built `dist/` output (see `ProV2Sandbox.build()`)
     *  as the company's live static bundle. The build itself runs in the
     *  browser's WebContainer — this just uploads the result. */
    async publish(companyId: string, files: BundleFile[]): Promise<boolean> {
      this.publishing = true
      this.publishError = ''
      try {
        const res = await apiFetch<{ publishedAt: string; fileCount: number }>(
          `/companies/${companyId}/pro-v2/publish`,
          { method: 'POST', body: { files }, timeoutMs: 60_000 },
        )
        this.publishedAt = res.publishedAt
        return true
      } catch (err) {
        this.publishError = err instanceof ApiError ? err.message : 'error'
        return false
      } finally {
        this.publishing = false
      }
    },

    /** Current request/day/month AI spend (item 11) — best-effort, never
     *  blocks the chat UI if it fails. */
    async loadUsage(companyId: string): Promise<void> {
      try {
        this.usageSummary = await apiFetch<AiUsageSummary>(`/companies/${companyId}/pro-v2/usage`)
      } catch {
        /* usage display is a nice-to-have, not worth surfacing an error for */
      }
    },
  },
})
