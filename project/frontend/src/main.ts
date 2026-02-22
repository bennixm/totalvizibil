import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import TVZ from './themes/TVZ'
import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { vuetify } from './plugins/vuetify'
import './assets/styles.css'
import './assets/theme.css'

const app = createApp(App)
app.use(router)
app.use(i18n)
app.use(vuetify)
app.use(PrimeVue, {
    theme: {
        preset: TVZ,
        options: {
            darkModeSelector: false
        }
    }
})
app.mount('#app')
