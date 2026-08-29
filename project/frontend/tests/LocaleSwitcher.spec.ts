import { describe, expect, it } from 'vitest'

import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import { usePreferencesStore } from '@/stores/preferences'
import { renderComponent } from './helpers/render'

describe('LocaleSwitcher', () => {
  it('shows the active locale on the activator button', () => {
    const wrapper = renderComponent(LocaleSwitcher)
    const prefs = usePreferencesStore()
    prefs.setLocale('en')

    expect(wrapper.text()).toContain('EN')
  })

  it('writes the chosen locale to the preferences store', async () => {
    const wrapper = renderComponent(LocaleSwitcher, { attachTo: document.body })
    const prefs = usePreferencesStore()

    await wrapper.get('button').trigger('click')
    const items = document.querySelectorAll('.v-list-item')
    const german = Array.from(items).find((el) => el.textContent?.includes('🇩🇪'))
    expect(german, 'German option rendered').toBeTruthy()
    ;(german as HTMLElement).click()

    expect(prefs.locale).toBe('de')
    wrapper.unmount()
  })
})
