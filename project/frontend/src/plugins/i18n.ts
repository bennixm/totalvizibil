import { createI18n } from 'vue-i18n'

import de from '@/locales/de.json'
import en from '@/locales/en.json'
import ro from '@/locales/ro.json'

export const SUPPORTED_LOCALES = ['ro', 'en', 'de'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = ((): AppLocale => {
  const fromEnv = import.meta.env.VITE_DEFAULT_LOCALE
  return isSupportedLocale(fromEnv) ? fromEnv : 'ro'
})()

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Picks the best starting locale: an explicit stored preference wins, then the
 * browser languages, then the configured default.
 */
export function resolveInitialLocale(stored?: string | null): AppLocale {
  if (isSupportedLocale(stored)) return stored

  if (typeof navigator !== 'undefined') {
    for (const lang of navigator.languages ?? [navigator.language]) {
      const short = lang?.slice(0, 2).toLowerCase()
      if (isSupportedLocale(short)) return short
    }
  }

  return DEFAULT_LOCALE
}

// Type-safe message schema derived from the Romanian (reference) locale.
type MessageSchema = typeof ro

export const i18n = createI18n<[MessageSchema], AppLocale, false>({
  legacy: false,
  globalInjection: true,
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'ro',
  messages: { ro, en, de },
})

/** Keeps vue-i18n and the <html lang> attribute in sync. */
export function applyLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', locale)
  }
}
