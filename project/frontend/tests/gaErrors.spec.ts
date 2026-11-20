import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api'
import { gaErrorText, settingProblem } from '@/components/admin/google-ads/gaErrors'

// Echo translator: shows which key + params were used.
const t = (k: string, p?: Record<string, unknown>) => (p ? `${k}${JSON.stringify(p)}` : k)

describe('Google Ads agent error texts', () => {
  it('turns raw class-validator messages into labelled sentences', () => {
    const e = new ApiError(400, 'x', {
      message: ['googleAdsAgentMonitorIntervalMinutes must not be less than 60'],
    })
    expect(gaErrorText(e, t)).toBe(
      'adminGoogleAdsErr.fieldMin{"field":"adminGoogleAdsOpt.monitorInterval","min":"60"}',
    )
  })

  it('explains timeouts and network failures instead of the request path', () => {
    expect(gaErrorText(new ApiError(0, 'Request to /x timed out'), t)).toBe(
      'adminGoogleAdsErr.timeout',
    )
    expect(gaErrorText(new ApiError(0, 'Network error on /x'), t)).toBe('adminGoogleAdsErr.network')
  })

  it('keeps the agent’s own readable messages and maps bare statuses', () => {
    expect(gaErrorText(new ApiError(409, 'Propunerea a fost deja aprobată.'), t)).toBe(
      'Propunerea a fost deja aprobată.',
    )
    expect(gaErrorText(new ApiError(500, 'Internal server error'), t)).toBe(
      'adminGoogleAdsErr.server',
    )
    expect(gaErrorText(new ApiError(404, 'API 404 on /x'), t)).toBe('adminGoogleAdsErr.notFound')
  })

  it('validates settings against the backend limits', () => {
    expect(settingProblem('googleAdsAgentMonitorIntervalMinutes', 30, t)).toBe(
      'adminGoogleAdsErr.min{"min":60}',
    )
    expect(settingProblem('googleAdsAgentCreativeCooldownDays', 7.5, t)).toBe(
      'adminGoogleAdsErr.integer',
    )
    expect(settingProblem('googleAdsAgentMaxCpcCapCredits', '', t)).toBe(
      'adminGoogleAdsErr.required',
    )
    expect(settingProblem('googleAdsAgentDefaultMaxCpcCredits', 0.5, t)).toBeNull()
  })
})
