import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { defineConfig, type Plugin } from 'vite'

/**
 * The Website Builder's in-browser WebContainer sandbox needs the HOST page
 * to be cross-origin isolated (COOP+COEP), which requires every cross-origin
 * resource on that page to opt in via CORP/CORS. The rest of the app loads
 * cross-origin resources that don't (e.g. Leaflet's OSM map tiles), so these
 * headers are scoped to the builder document only — never applied globally.
 */
function crossOriginIsolatedForWebsiteBuilder(): Plugin {
  return {
    name: 'cross-origin-isolated-website-builder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/website/builder')) {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        }
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
    crossOriginIsolatedForWebsiteBuilder(),
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
    },
  },
})
