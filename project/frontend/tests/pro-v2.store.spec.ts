import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, ApiError } from '@/services/api'
import { useProV2Store } from '@/stores/pro-v2'
import { MAX_REPAIR_ATTEMPTS } from '@/lib/repair-loop'
import type { ExecutionError } from '@/lib/webcontainer'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, apiFetch: vi.fn() }
})

const apiFetchMock = vi.mocked(apiFetch)

function err(summary: string, kind: ExecutionError['kind'] = 'runtime'): ExecutionError {
  return { kind, summary }
}

describe('pro-v2 store — §5 self-correction orchestration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('sends a repair turn for a first-time error and applies the returned files', async () => {
    const v2 = useProV2Store()
    apiFetchMock.mockResolvedValueOnce({
      reply: 'Fixed the undefined reference.',
      steps: [{ tool: 'edit_file', summary: 'Edited Hero.vue' }],
      files: [{ path: 'src/components/Hero.vue', content: 'fixed' }],
      changedPaths: ['src/components/Hero.vue'],
      usage: { inputTokens: 10, outputTokens: 5, iterations: 1, durationMs: 100 },
    })

    const outcome = await v2.handleExecutionError('c1', err('TypeError: x is not defined'))

    expect(outcome.shouldRetry).toBe(true)
    expect(v2.repairAttempts).toBe(1)
    expect(v2.files).toEqual([{ path: 'src/components/Hero.vue', content: 'fixed' }])
    expect(v2.repairLog).toHaveLength(1)
    expect(v2.repairLog[0].status).toBe('fixed')
    expect(v2.repairLog[0].fixSummary).toBe('Fixed the undefined reference.')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/companies/c1/pro-v2/repair',
      expect.objectContaining({
        method: 'POST',
        body: { kind: 'runtime', summary: 'TypeError: x is not defined', path: undefined, attempt: 1 },
      }),
    )
  })

  it('stops immediately, without calling the API, when the identical error repeats', async () => {
    const v2 = useProV2Store()
    apiFetchMock.mockResolvedValueOnce({
      reply: 'Attempted a fix.',
      steps: [],
      files: [],
      changedPaths: [],
      usage: { inputTokens: 1, outputTokens: 1, iterations: 1, durationMs: 1 },
    })
    await v2.handleExecutionError('c1', err('TypeError: same thing'))
    apiFetchMock.mockClear()

    const outcome = await v2.handleExecutionError('c1', err('TypeError: same thing'))

    expect(outcome.shouldRetry).toBe(false)
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(v2.repairAttempts).toBe(1) // did not increment — no new attempt was spent
    expect(v2.repairLog.at(-1)?.status).toBe('failed')
  })

  it('never claims success and never retries indefinitely — stops after MAX_REPAIR_ATTEMPTS', async () => {
    const v2 = useProV2Store()
    apiFetchMock.mockResolvedValue({
      reply: 'Tried something.',
      steps: [],
      files: [],
      changedPaths: [],
      usage: { inputTokens: 1, outputTokens: 1, iterations: 1, durationMs: 1 },
    })

    // Distinct WORDS, not numbers — normalizeErrorKey collapses all digits,
    // so "error #0"/"error #1" would (correctly) normalize to the same key.
    const distinctErrors = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
    let lastOutcome
    for (let i = 0; i < MAX_REPAIR_ATTEMPTS + 2; i++) {
      lastOutcome = await v2.handleExecutionError('c1', err(`${distinctErrors[i]} error occurred`))
    }

    // Each successful repair hop also triggers a best-effort usage refresh —
    // count only the actual /repair calls, not the /usage ones alongside them.
    const repairCalls = apiFetchMock.mock.calls.filter(([url]) => String(url).endsWith('/repair'));
    expect(repairCalls).toHaveLength(MAX_REPAIR_ATTEMPTS)
    expect(lastOutcome?.shouldRetry).toBe(false)
    expect(v2.repairLog.at(-1)?.status).toBe('failed')
  })

  it('reports honestly (status "failed") when the repair call itself errors, without throwing', async () => {
    const v2 = useProV2Store()
    apiFetchMock.mockRejectedValueOnce(new ApiError(500, 'boom'))

    const outcome = await v2.handleExecutionError('c1', err('Internal server error'))

    expect(outcome.shouldRetry).toBe(false)
    expect(v2.repairLog.at(-1)?.status).toBe('failed')
  })

  it('resetRepairState clears attempts/last-error so a new manual message gets a fresh budget', async () => {
    const v2 = useProV2Store()
    apiFetchMock.mockResolvedValue({
      reply: 'ok',
      steps: [],
      files: [],
      changedPaths: [],
      usage: { inputTokens: 1, outputTokens: 1, iterations: 1, durationMs: 1 },
    })
    await v2.handleExecutionError('c1', err('some error'))
    expect(v2.repairAttempts).toBe(1)

    v2.resetRepairState()

    expect(v2.repairAttempts).toBe(0)
    expect(v2.lastRepairedErrorKey).toBeNull()
  })
})

describe('pro-v2 store — resuming a turn that was still running when the page reloaded', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('does nothing when the last message already has an assistant reply', async () => {
    const v2 = useProV2Store()
    v2.messages = [{ role: 'assistant', content: 'hi' }]
    const result = await v2.resumeIfInFlight('c1')
    expect(result).toBe('not_needed')
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(v2.sending).toBe(false)
  })

  it('shows "still working" immediately, then polls until the reply lands and updates files/messages', async () => {
    vi.useFakeTimers()
    try {
      const v2 = useProV2Store()
      v2.messages = [{ role: 'user', content: 'build me a site' }]

      apiFetchMock
        .mockResolvedValueOnce({
          projectId: 'p1',
          aiConfigured: true,
          publishedAt: null,
          files: [{ path: 'src/App.vue', content: 'old' }],
          messages: [{ role: 'user', content: 'build me a site' }],
        })
        .mockResolvedValueOnce({
          projectId: 'p1',
          aiConfigured: true,
          publishedAt: null,
          files: [{ path: 'src/App.vue', content: 'new' }],
          messages: [
            { role: 'user', content: 'build me a site' },
            { role: 'assistant', content: 'Done — built the site.' },
          ],
        })
        .mockResolvedValueOnce({
          dailySpendUsd: 0,
          dailyLimitUsd: 5,
          monthlySpendUsd: 0,
          monthlyLimitUsd: 50,
          byProvider: [],
          byCategory: [],
        })

      const resultPromise = v2.resumeIfInFlight('c1')
      expect(v2.sending).toBe(true) // "still working" is visible right away, before any poll fires

      await vi.advanceTimersByTimeAsync(4000)
      await vi.advanceTimersByTimeAsync(4000)
      const result = await resultPromise

      expect(result).toBe('resolved')
      expect(v2.sending).toBe(false)
      expect(v2.messages.at(-1)).toEqual({ role: 'assistant', content: 'Done — built the site.' })
      expect(v2.files).toEqual([{ path: 'src/App.vue', content: 'new' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after the timeout instead of claiming "still working" forever', async () => {
    vi.useFakeTimers()
    try {
      const v2 = useProV2Store()
      v2.messages = [{ role: 'user', content: 'build me a site' }]
      apiFetchMock.mockResolvedValue({
        projectId: 'p1',
        aiConfigured: true,
        publishedAt: null,
        files: [],
        messages: [{ role: 'user', content: 'build me a site' }],
      })

      const resultPromise = v2.resumeIfInFlight('c1')
      await vi.advanceTimersByTimeAsync(4000 * 91)
      const result = await resultPromise

      expect(result).toBe('timed_out')
      expect(v2.sending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('pro-v2 store — uploading a chat image attachment', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('reads the file, uploads it, and returns the public URL', async () => {
    const v2 = useProV2Store()
    apiFetchMock.mockResolvedValueOnce({ id: 'a1', url: '/api/v1/website-assets/a1' })

    const file = new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' })
    const url = await v2.uploadAsset('c1', file)

    expect(url).toBe('/api/v1/website-assets/a1')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/companies/c1/pro-v2/assets',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ dataUri: expect.stringMatching(/^data:image\/png;base64,/) }),
      }),
    )
  })

  it('returns null and records the error when the upload fails', async () => {
    const v2 = useProV2Store()
    apiFetchMock.mockRejectedValueOnce(new ApiError(400, 'image_too_large'))

    const file = new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' })
    const url = await v2.uploadAsset('c1', file)

    expect(url).toBeNull()
    expect(v2.error).toBe('image_too_large')
  })
})
