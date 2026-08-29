import { createVuetify, type ThemeDefinition } from 'vuetify'

import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

export const LIGHT_THEME = 'light'
export const DARK_THEME = 'dark'

/**
 * Palette notes — the "futuristic" system uses one cool triad:
 *   primary  = electric blue   (structure, primary actions)
 *   secondary = violet          (AI / intelligence surfaces)
 *   accent   = cyan            (highlights, live data, glow)
 * Keep raw gradient/glow values in src/styles/tokens.scss in sync with these.
 */
const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#F5F7FE',
    surface: '#FFFFFF',
    'surface-bright': '#FFFFFF',
    'surface-light': '#EEF2FC',
    'surface-variant': '#E4E9F7',
    'on-surface-variant': '#3A4256',
    primary: '#3B6EF5',
    'primary-darken-1': '#2C55D4',
    secondary: '#7C3AED',
    accent: '#0891B2',
    error: '#E11D48',
    info: '#0284C7',
    success: '#059669',
    warning: '#D97706',
  },
  variables: {
    'border-color': '#0F1729',
    'border-opacity': 0.1,
    'high-emphasis-opacity': 0.92,
    'medium-emphasis-opacity': 0.66,
    'theme-surface-elevated': '#FFFFFF',
  },
}

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#06080F',
    surface: '#0E1327',
    'surface-bright': '#1A2138',
    'surface-light': '#161C33',
    'surface-variant': '#232C46',
    'on-surface-variant': '#AEB7CE',
    primary: '#5B8DFF',
    'primary-darken-1': '#3E6FE6',
    secondary: '#A78BFA',
    accent: '#22D3EE',
    error: '#FB7185',
    info: '#38BDF8',
    success: '#34D399',
    warning: '#FBBF24',
  },
  variables: {
    'border-color': '#FFFFFF',
    'border-opacity': 0.1,
    'high-emphasis-opacity': 0.96,
    'medium-emphasis-opacity': 0.68,
    'theme-surface-elevated': '#131A31',
  },
}

export const vuetify = createVuetify({
  theme: {
    defaultTheme: LIGHT_THEME,
    themes: { light, dark },
  },
  defaults: {
    global: {
      // Softer, faster ripple; large tap targets read as "app-like".
      ripple: true,
    },
    VBtn: {
      rounded: 'pill',
      class: 'text-none',
      style: 'letter-spacing: 0.01em;',
    },
    VCard: {
      rounded: 'lg',
      elevation: 0,
      border: true,
    },
    VSheet: {
      rounded: 'lg',
    },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      color: 'primary',
    },
    VSelect: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'lg',
      color: 'primary',
    },
    VChip: {
      rounded: 'pill',
    },
    VList: {
      rounded: 'lg',
    },
    VAppBar: {
      flat: true,
    },
  },
  icons: {
    defaultSet: 'mdi',
  },
})
