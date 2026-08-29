import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { vuetify } from './plugins/vuetify'

import './assets/styles.css'

import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura';

const app = createApp(App)

app.use(router)
app.use(i18n)
app.use(vuetify)
app.use(PrimeVue, {
    theme: {
        preset: Aura
    }
});

app.mount('#app')