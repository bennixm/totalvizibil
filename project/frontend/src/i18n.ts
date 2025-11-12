import { createI18n } from 'vue-i18n'

import en from './locales/en.json'
import de from './locales/de.json'
import ro from './locales/ro.json'

export const i18n = createI18n({
    legacy: false,
    locale: 'ro',
    fallbackLocale: 'en',
    messages: {
        en,
        de,
        ro,
    },
})
