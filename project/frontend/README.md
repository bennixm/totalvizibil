# Totalvizibil — Frontend

Vue 3 + Vite + TypeScript SPA for the Totalvizibil platform.
Product context lives in [`../docs`](../docs) (start with `01-VISION.md` and `02-PRODUCT.md`).

## Stack

| Concern        | Choice                                             |
| -------------- | ------------------------------------------------- |
| Framework      | Vue 3 (`<script setup>`, Composition API)          |
| Build tool     | Vite 6                                             |
| UI library     | Vuetify 3 + SASS (custom `light` / `dark` themes)  |
| Routing        | Vue Router 4                                       |
| State          | Pinia + `pinia-plugin-persistedstate`             |
| i18n           | vue-i18n 10 — **ro** (default), **en**, **de**     |
| Testing        | Vitest + Vue Test Utils (jsdom)                    |
| Lint / format  | ESLint (flat config) + Prettier                   |

## Getting started

```bash
cd project/frontend
cp .env.example .env
npm install
npm run dev
```

App runs on http://localhost:5173.

## Scripts

| Script               | Description                                  |
| -------------------- | -------------------------------------------- |
| `npm run dev`        | Start the dev server                         |
| `npm run build`      | Type-check then production build             |
| `npm run preview`    | Preview the production build                 |
| `npm run test`       | Run unit tests once                          |
| `npm run test:watch` | Run unit tests in watch mode                 |
| `npm run lint`       | ESLint with `--fix`                          |
| `npm run format`     | Prettier write over `src/`                   |
| `npm run typecheck`  | `vue-tsc --noEmit`                           |

## Design system

A "modern / futuristic" visual language layered on top of Vuetify.

- **Fonts** — `Space Grotesk Variable` for display/headings, `Inter Variable` for body.
  Self-hosted via `@fontsource-variable/*` (imported in `main.ts`), no external requests.
- **Palette** — one cool triad: `primary` electric blue, `secondary` violet (AI surfaces),
  `accent` cyan (highlights / glow). Defined per theme in `src/plugins/vuetify.ts`.
- **Tokens** — `src/styles/tokens.scss` is the single source of truth for radii, motion
  (`--tvz-ease-*`, `--tvz-dur-*`), gradients (`--tvz-gradient-brand` / `-text` / `-sheen`),
  glass (`--tvz-glass-*`), shadows/glow (`--tvz-shadow-*`, `--tvz-glow-*`) and the ambient
  background. Each token has a light and a dark value scoped to `.v-theme--light/dark`.
- **Globals** (`src/styles/main.scss`) — fixed ambient gradient + technical grid behind the
  whole app (`.v-application::before/::after`); utility classes:
  - `.tvz-glass` / `.tvz-glass--strong` — frosted glass surface
  - `.tvz-card` (+ `--interactive`) — elevated panel with top sheen and hover glow
  - `.text-gradient`, `.text-glow`, `.font-display`, `.text-balance`
  - `.tvz-glow`, `.section`, `.page-container`
- **Components** — `AppBar` / `AppFooter` use frosted glass; `AuroraBackdrop.vue` is an
  opt-in animated glow field for hero-style sections (`intensity="subtle" | "bold"`).
- All decorative animation is disabled under `prefers-reduced-motion`.

## How theming works

- `src/plugins/vuetify.ts` defines two themes — `light` and `dark` — with the brand palette.
- `src/stores/preferences.ts` persists a `themeMode` of `light | dark | system` to
  `localStorage` (key `tvz.preferences`).
- `src/composables/useThemeSync.ts` (mounted once in `App.vue`) maps that preference to
  the active Vuetify theme and live-tracks the OS setting while mode is `system`.
- `ThemeToggle.vue` (a 3-way segmented control) lives in the **footer**.

## How i18n works

- Message catalogs: `src/locales/{ro,en,de}.json`. `ro.json` is the reference — a unit
  test fails if `en`/`de` drift from its key set.
- Initial locale resolution (`src/plugins/i18n.ts`): stored preference → browser language
  → `VITE_DEFAULT_LOCALE` → `ro`.
- `src/composables/useLocaleSync.ts` applies the persisted locale to vue-i18n and the
  `<html lang>` attribute.
- `LocaleSwitcher.vue` (app bar + footer) changes the language.

## Project layout

```
src/
  components/     # AppBar, AppFooter, ThemeToggle, LocaleSwitcher, AuroraBackdrop, PagePlaceholder
  composables/    # useThemeSync, useLocaleSync
  locales/        # ro.json (reference), en.json, de.json
  plugins/        # vuetify, i18n, pinia
  router/         # routes + guard scaffold (customer / business / admin areas)
  services/       # api.ts — typed fetch wrapper for the backend
  stores/         # preferences (theme + locale), auth (skeleton)
  styles/         # settings.scss (Vuetify vars), tokens.scss (design tokens), main.scss (globals)
  views/          # one per route
tests/            # Vitest specs + helpers
```
