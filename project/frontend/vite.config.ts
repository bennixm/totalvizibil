import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Auto-imports Vuetify components + styles on demand (tree-shaking).
    vuetify({ autoImport: true, styles: { configFile: 'src/styles/settings.scss' } }),
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
