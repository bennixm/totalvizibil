import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { defineConfig, type Plugin } from 'vite'

/**
 * The Website Builder's in-browser WebContainer sandbox needs the HOST page
 * to be cross-origin isolated (COOP+COEP). `self.crossOriginIsolated` is
 * decided once, at the initial document load, and never changes afterward —
 * so scoping this to only the /website/builder response (as a previous
 * version of this plugin did) doesn't actually work: /website/builder is a
 * normal client-side Vue Router route reached via <router-link> from the
 * dashboard etc., not a fresh navigation, so almost no real user's document
 * request ever hits that path. These headers must be on every response that
 * can serve the SPA shell (i.e. every route), which is why this plugin now
 * applies unconditionally.
 *
 * Using COEP: 'credentialless' instead of 'require-corp' means the rest of
 * the app's cross-origin resources (Leaflet's OSM map tiles, Pexels images)
 * keep loading fine without needing CORP/CORS opt-in — credentialless only
 * strips credentials from cross-origin no-cors loads instead of blocking
 * them. WebContainer.boot() must be called with `coep: 'credentialless'` to
 * match (see src/lib/webcontainer.ts).
 */
function crossOriginIsolated(): Plugin {
  return {
    name: 'cross-origin-isolated',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Auto-imports Vuetify components + styles on demand (tree-shaking).
    vuetify({ autoImport: true, styles: { configFile: 'src/styles/settings.scss' } }),
    crossOriginIsolated(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // Proxy the API in dev so the app works same-origin (cookies, no CORS) even
    // when there's no .env — VITE_API_BASE_URL defaults to the relative "/api/v1".
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
