import { createApp } from 'vue'

import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/jetbrains-mono'

import App from './App.vue'
import { i18n } from '@/plugins/i18n'
import { pinia } from '@/plugins/pinia'
import { vuetify } from '@/plugins/vuetify'
import { router } from '@/router'
import '@/styles/main.scss'

const app = createApp(App)

app.use(pinia)
app.use(router)
app.use(i18n)
app.use(vuetify)

app.mount('#app')
