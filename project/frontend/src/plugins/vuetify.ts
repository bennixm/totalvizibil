import { createVuetify, type ThemeDefinition } from 'vuetify'

import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'

export const LIGHT_THEME = 'light'
export const DARK_THEME = 'dark'

/**
 * Palette notes — cool, sapphire-led. One strong colour; calm cool neutrals.
 *   primary   = sapphire #0F52BA  (structure, links, primary actions, focus)
 *   secondary = deep sapphire     (ranges / "AI" moments)
 *   accent    = bright sapphire   (lit / active states — monochromatic, no amber)
 * Cool off-white ground, cool near-black ink. Dark theme = the same product,
 * lights down (cool night).
 * Keep raw shadow/gradient values in src/styles/tokens.scss in sync.
 */
const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#F7F8FA', // cool paper
    surface: '#FFFFFF', // raised card
    'surface-bright': '#FFFFFF',
    'surface-light': '#EEF1F6',
    'surface-variant': '#E8ECF3', // quiet "shelf"
    'on-surface-variant': '#5B6472', // label
    primary: '#0F52BA',
    'primary-darken-1': '#0A3E93',
    secondary: '#0A3E93',
    accent: '#3B74D6',
    error: '#CF3B3B',
    info: '#0F52BA',
    success: '#1E8E5A',
    warning: '#C77A11',
  },
  variables: {
    'border-color': '#131722',
    'border-opacity': 0.1,
    'high-emphasis-opacity': 0.94,
    'medium-emphasis-opacity': 0.66,
    'theme-surface-elevated': '#FFFFFF',
  },
}

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0C1220', // cool night
    surface: '#141B2D',
    'surface-bright': '#1D2740',
    'surface-light': '#18213A',
    'surface-variant': '#212C48',
    'on-surface-variant': '#93A0B5',
    primary: '#3D6FDB', // deep enough that white button text stays legible
    'primary-darken-1': '#2E56B0',
    secondary: '#9DB4D6',
    accent: '#6E9BF0',
    error: '#E58585',
    info: '#9DB4D6',
    success: '#5FC38C',
    warning: '#E6B25C',
  },
  variables: {
    'border-color': '#EEF1F7',
    'border-opacity': 0.1,
    'high-emphasis-opacity': 0.96,
    'medium-emphasis-opacity': 0.7,
    'theme-surface-elevated': '#19223A',
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
