import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createVuetify } from 'vuetify'
import { vi } from 'vitest'
import type { Component } from 'vue'

import { i18n } from '@/plugins/i18n'

/**
 * Mounts a component with the global plugins wired up (Vuetify, i18n, a fresh
 * testing Pinia). Store actions run for real unless a test overrides them.
 */
export function renderComponent<C extends Component>(
  component: C,
  options: ComponentMountingOptions<C> = {},
) {
  const vuetify = createVuetify()
  const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })

  return mount(component, {
    ...options,
    global: {
      plugins: [vuetify, i18n, pinia],
      ...(options.global ?? {}),
    },
  })
}
