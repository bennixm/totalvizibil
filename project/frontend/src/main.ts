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

// A route/chunk built before the last deploy references a hashed asset
// filename that no longer exists on the server once a newer build has been
// published — clicking a link then throws "Failed to fetch dynamically
// imported module" and the navigation silently goes nowhere, fixed only by
// a manual refresh (which fetches the current index.html, pointing at the
// current hashes). Automate that refresh instead of leaving it to the user.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i
function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return CHUNK_ERROR.test(msg)
}
function reloadForStaleChunk(): void {
  // Guard against a reload loop if the failure turns out to be something
  // else entirely (e.g. a real network outage) rather than a stale build.
  const key = 'tvz.chunkReloadAt'
  const last = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last < 10_000) return
  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
}
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadForStaleChunk()
})
router.onError((err) => {
  if (isChunkLoadError(err)) reloadForStaleChunk()
})

const app = createApp(App)

app.use(pinia)
app.use(router)
app.use(i18n)
app.use(vuetify)

app.mount('#app')
