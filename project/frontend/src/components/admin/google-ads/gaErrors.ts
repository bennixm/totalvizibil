/**
 * Human-readable error text for the Google Ads agent pages. The API can
 * answer with raw class-validator messages ("googleAdsAgentMonitorInterval
 * Minutes must not be less than 60"), with a bare HTTP status, or the
 * client can time out / lose the network; none of that should reach an
 * admin verbatim. Field names become their on-screen labels.
 */
import { ApiError } from '@/services/api'

type T = (key: string, params?: Record<string, unknown>) => string

/** Limits mirrored from the backend DTO (`UpdateSettingsDto`). */
export const AGENT_SETTING_LIMITS = {
  googleAdsAgentMonitorIntervalMinutes: { min: 60, max: 10_080, int: true },
  googleAdsAgentCreativeCooldownDays: { min: 7, max: 90, int: true },
  googleAdsAgentDefaultDailyBudgetCredits: { min: 0.5, max: 100_000, int: false },
  googleAdsAgentDefaultMaxCpcCredits: { min: 0.01, max: 1000, int: false },
  googleAdsAgentMaxDailyBudgetCapCredits: { min: 0.5, max: 100_000, int: false },
  googleAdsAgentMaxCpcCapCredits: { min: 0.01, max: 1000, int: false },
  googleAdsAgentStructuralIntervalMinutes: { min: 15, max: 10_080, int: true },
  googleAdsAgentContentIntervalMinutes: { min: 15, max: 10_080, int: true },
  googleAdsAgentIntelligenceIntervalMinutes: { min: 15, max: 10_080, int: true },
} as const
export type LimitedSetting = keyof typeof AGENT_SETTING_LIMITS

/** i18n key of each field's on-screen label. */
export const AGENT_FIELD_LABELS: Record<string, string> = {
  googleAdsAgentMonitorIntervalMinutes: 'adminGoogleAdsOpt.monitorInterval',
  googleAdsAgentCreativeCooldownDays: 'adminGoogleAdsOpt.cooldown',
  googleAdsAgentDefaultDailyBudgetCredits: 'adminGoogleAds.settingDefaultBudget',
  googleAdsAgentDefaultMaxCpcCredits: 'adminGoogleAds.settingDefaultCpc',
  googleAdsAgentMaxDailyBudgetCapCredits: 'adminGoogleAds.settingBudgetCap',
  googleAdsAgentMaxCpcCapCredits: 'adminGoogleAds.settingCpcCap',
  googleAdsAgentStructuralIntervalMinutes: 'adminGoogleAds.cadenceStructural',
  googleAdsAgentContentIntervalMinutes: 'adminGoogleAds.cadenceContent',
  googleAdsAgentIntelligenceIntervalMinutes: 'adminGoogleAds.cadenceIntelligence',
  googleAdsAgentEnabled: 'adminGoogleAds.settingEnabled',
  googleAdsAgentAutoFillGapsEnabled: 'adminGoogleAdsOpt.autoFill',
  instructions: 'adminGoogleAdsOpt.reviseTitle',
}

/** Validation message for one numeric setting, or null when valid. */
export function settingProblem(key: LimitedSetting, value: unknown, t: T): string | null {
  const l = AGENT_SETTING_LIMITS[key]
  const n = typeof value === 'number' ? value : Number(value)
  if (value === '' || value == null || !Number.isFinite(n)) return t('adminGoogleAdsErr.required')
  if (l.int && !Number.isInteger(n)) return t('adminGoogleAdsErr.integer')
  if (n < l.min) return t('adminGoogleAdsErr.min', { min: l.min })
  if (n > l.max) return t('adminGoogleAdsErr.max', { max: l.max })
  return null
}

/** One class-validator message → readable sentence (null if unknown). */
function validatorMessage(msg: string, t: T): string | null {
  const m = /^(\w+) (.+)$/.exec(msg.trim())
  if (!m) return null
  const [, field, rest] = m
  const labelKey = AGENT_FIELD_LABELS[field]
  if (!labelKey && !/^[a-z]+[A-Z]\w*$/.test(field)) return null
  const label = labelKey ? t(labelKey) : field
  let r: RegExpExecArray | null
  if ((r = /^must not be less than (\S+)/.exec(rest)))
    return t('adminGoogleAdsErr.fieldMin', { field: label, min: r[1] })
  if ((r = /^must not be greater than (\S+)/.exec(rest)))
    return t('adminGoogleAdsErr.fieldMax', { field: label, max: r[1] })
  if (/must be an integer/.test(rest)) return t('adminGoogleAdsErr.fieldInteger', { field: label })
  if (/must be a number/.test(rest)) return t('adminGoogleAdsErr.fieldNumber', { field: label })
  if (/must be a boolean/.test(rest)) return t('adminGoogleAdsErr.fieldInvalid', { field: label })
  if ((r = /must be longer than or equal to (\d+)/.exec(rest)))
    return t('adminGoogleAdsErr.fieldMinLength', { field: label, n: r[1] })
  if ((r = /must be shorter than or equal to (\d+)/.exec(rest)))
    return t('adminGoogleAdsErr.fieldMaxLength', { field: label, n: r[1] })
  if (/should not exist/.test(rest)) return t('adminGoogleAdsErr.fieldUnknown', { field: label })
  return t('adminGoogleAdsErr.fieldInvalid', { field: label })
}

/** Looks like an internal/technical message rather than one written for
 *  admins (the agent's own messages are Romanian sentences). */
function technical(msg: string): boolean {
  return (
    /^(API \d{3} on |Request to .* timed out|Network error on )/.test(msg) ||
    /^(Bad Request|Not Found|Forbidden|Unauthorized|Internal server error)$/i.test(msg) ||
    /^Cannot (GET|POST|PATCH|PUT|DELETE) /.test(msg)
  )
}

export function gaErrorText(e: unknown, t: T, fallback?: string): string {
  const generic = fallback ?? t('adminGoogleAdsErr.generic')
  if (!(e instanceof ApiError)) return generic
  if (e.status === 0) {
    return /timed out/.test(e.message)
      ? t('adminGoogleAdsErr.timeout')
      : t('adminGoogleAdsErr.network')
  }
  const body = e.body as { message?: unknown } | undefined
  const raw = Array.isArray(body?.message) ? (body!.message as unknown[]).map(String) : null
  if (raw?.length) {
    const lines = raw.map((m) => validatorMessage(m, t) ?? m)
    return lines.join(' ')
  }
  if (e.status === 400 && e.message.includes(' must ')) {
    const v = e.message
      .split(', ')
      .map((m) => validatorMessage(m, t))
      .filter(Boolean)
    if (v.length) return v.join(' ')
  }
  if (!technical(e.message) && e.message) return e.message
  if (e.status === 401) return t('adminGoogleAdsErr.unauthorized')
  if (e.status === 403) return t('adminGoogleAdsErr.forbidden')
  if (e.status === 404) return t('adminGoogleAdsErr.notFound')
  if (e.status === 409) return t('adminGoogleAdsErr.conflict')
  if (e.status === 429) return t('adminGoogleAdsErr.rateLimited')
  if (e.status >= 500) return t('adminGoogleAdsErr.server')
  return generic
}
