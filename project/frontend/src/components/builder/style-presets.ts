import type { WebsiteTheme } from '@/types/website'

/** One-click style bundles for the Advanced builder. Applying one writes the
 *  concrete theme fields; `preset` is stored so the UI can highlight it. */
export type PresetId = 'studio' | 'bold' | 'editorial' | 'soft' | 'tech' | 'warm' | 'mono'

export const PRESET_IDS: PresetId[] = [
  'studio',
  'bold',
  'editorial',
  'soft',
  'tech',
  'warm',
  'mono',
]

type PresetTheme = Partial<Omit<WebsiteTheme, 'accent'>>

export const STYLE_PRESETS: Record<PresetId, PresetTheme> = {
  studio: {
    palette: 'indigo',
    background: 'tinted',
    headingFont: 'grotesk',
    bodyFont: 'inter',
    radius: 'rounded',
    buttonStyle: 'solid',
    shadow: 'soft',
    density: 'comfortable',
  },
  bold: {
    palette: 'orange',
    background: 'light',
    headingFont: 'grotesk',
    bodyFont: 'grotesk',
    radius: 'none',
    buttonStyle: 'pill',
    shadow: 'bold',
    density: 'compact',
  },
  editorial: {
    palette: 'slate',
    background: 'light',
    headingFont: 'fraunces',
    bodyFont: 'inter',
    radius: 'subtle',
    buttonStyle: 'outline',
    shadow: 'none',
    density: 'spacious',
  },
  soft: {
    palette: 'violet',
    background: 'tinted',
    headingFont: 'inter',
    bodyFont: 'inter',
    radius: 'large',
    buttonStyle: 'soft',
    shadow: 'soft',
    density: 'comfortable',
  },
  tech: {
    palette: 'cyan',
    background: 'dark',
    headingFont: 'grotesk',
    bodyFont: 'inter',
    radius: 'subtle',
    buttonStyle: 'solid',
    shadow: 'soft',
    density: 'comfortable',
  },
  warm: {
    palette: 'amber',
    background: 'tinted',
    headingFont: 'fraunces',
    bodyFont: 'inter',
    radius: 'rounded',
    buttonStyle: 'solid',
    shadow: 'soft',
    density: 'comfortable',
  },
  mono: {
    palette: 'slate',
    background: 'light',
    headingFont: 'jetbrains',
    bodyFont: 'inter',
    radius: 'none',
    buttonStyle: 'outline',
    shadow: 'none',
    density: 'comfortable',
  },
}

/** Accent hex per palette id — mirrors WebsiteRenderer PALETTE_ACCENT (for swatches). */
export const PALETTE_HEX: Record<WebsiteTheme['palette'], string> = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  blue: '#2563eb',
  cyan: '#0891b2',
  teal: '#0d9488',
  emerald: '#059669',
  lime: '#65a30d',
  amber: '#d97706',
  orange: '#ea580c',
  rose: '#e11d48',
  fuchsia: '#c026d3',
  slate: '#475569',
}
