/** The file tree a brand-new PRO V2 project starts from — a minimal, real,
 *  runnable Vue 3 + Vite app. Claude replaces `src/App.vue` (and adds
 *  components) on the first real generation turn; the scaffold just needs to
 *  boot cleanly in WebContainer before that happens. Versions match this
 *  monorepo's own frontend (`project/frontend/package.json`) since those are
 *  already known-good together.
 */
export const STARTER_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'pro-v2-site',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite --host',
        build: 'vite build',
      },
      dependencies: {
        vue: '^3.5.13',
      },
      devDependencies: {
        '@vitejs/plugin-vue': '^5.2.1',
        vite: '^6.0.7',
      },
    },
    null,
    2,
  ),

  'vite.config.ts': `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Relative so the built output works when published under any URL prefix
  // (the public site route), not just when served from a domain root.
  base: './',
})
`,

  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Site</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,

  'src/main.ts': `import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')
`,

  'src/style.css': `* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
`,

  'src/App.vue': `<template>
  <main class="placeholder">
    <h1>New project</h1>
    <p>Describe what you want to build in the chat.</p>
  </main>
</template>

<script setup lang="ts"></script>

<style scoped>
.placeholder {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #333;
  text-align: center;
  padding: 24px;
}
</style>
`,
};
