import { afterEach, describe, expect, it, vi } from 'vitest'

import de from '@/locales/de.json'
import en from '@/locales/en.json'
import ro from '@/locales/ro.json'
import { SUPPORTED_LOCALES, isSupportedLocale, resolveInitialLocale } from '@/plugins/i18n'

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object'
      ? flatKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('i18n locales', () => {
  it('exposes exactly ro, en, de', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['ro', 'en', 'de'])
  })

  it('en and de have the same key set as the ro reference', () => {
    const reference = flatKeys(ro).sort()
    expect(flatKeys(en).sort()).toEqual(reference)
    expect(flatKeys(de).sort()).toEqual(reference)
  })
})

describe('resolveInitialLocale', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubNavigatorLanguages(languages: string[]) {
    vi.stubGlobal('navigator', { language: languages[0] ?? '', languages })
  }

  it('prefers a valid stored value over everything else', () => {
    stubNavigatorLanguages(['en-US'])
    expect(resolveInitialLocale('de')).toBe('de')
  })

  it('uses a supported browser language when there is no stored value', () => {
    stubNavigatorLanguages(['de-DE', 'en'])
    expect(resolveInitialLocale(null)).toBe('de')
  })

  it('falls back to the default locale when nothing matches', () => {
    stubNavigatorLanguages(['fr-FR'])
    expect(resolveInitialLocale('xx')).toBe('ro')
    expect(resolveInitialLocale(null)).toBe('ro')
  })

  it('isSupportedLocale narrows correctly', () => {
    expect(isSupportedLocale('ro')).toBe(true)
    expect(isSupportedLocale('fr')).toBe(false)
    expect(isSupportedLocale(42)).toBe(false)
  })
})
