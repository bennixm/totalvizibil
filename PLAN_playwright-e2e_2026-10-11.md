# Playwright E2E Test Setup for Totalvizibil

**Date:** 2026-10-11
**Status:** PLANNED
**Chain:** none / seq 1
**Context:** See `HANDOFF_playwright-e2e_2026-10-11.md` for session data, architecture, and schema details.

---

## Problem Statement

Unit tests (654) and integration tests (104) cover logic and wiring. k6 covers load. Neither catches UI regressions or verifies the full user journey through the browser. The revenue-critical path — visitor finds a company in the feed, views their AI-built website, submits a lead — has never been tested end-to-end in a real browser. Playwright fills this gap by driving the Vue 3 frontend against a real backend with a seeded database, skipping only the AI builder (covered by existing tests, costs API credits per run).

---

## Key Findings

- Frontend is Vue 3 + Vuetify, port 5173; Vite proxies `/api` → backend (same-origin, cookies work) → drives Phase 1 config
- Company public page route: `/:seg1/:seg2?/:seg3?` (BrowseView.vue) — need to know the exact URL shape for the visitor flow test
- Website content is stored as JSON in `websites.content`; seeding a `status: 'published'` row bypasses the AI builder entirely → drives seeding strategy
- Lead submission: `POST /public/companies/:slug/lead` returns 202, throttled at 15/min → visitor flow test must check 202
- Throttler is active in all environments (no bypass for E2E); integration tests clear it via `resetThrottler` → E2E tests must avoid hammering throttled endpoints
- `test/load/seed.ts` has exact Prisma create patterns for company + campaign → reuse for E2E seed
- Playwright not yet installed in `project/frontend`

## Anti-Goals

- **Do NOT test the AI website builder** — costs Anthropic API credits per run; already covered by unit + integration tests
- **Do NOT share `tvz_test` or `tvz_load`** — E2E needs its own `tvz_e2e` DB to avoid contaminating integration and load test data
- **Do NOT put Playwright in the backend** — it drives the Vue frontend, belongs in `project/frontend`
- **Do NOT override ThrottlerGuard** — E2E tests run slowly enough (human-speed) to stay under throttle limits naturally; no bypass needed

---

## Plan

### Phase 1: Infrastructure

**Goal:** Install Playwright, create `tvz_e2e` DB, configure `playwright.config.ts` to start both Vite frontend and NestJS backend automatically.

**Why this approach:** Playwright's `webServer` option starts dependent servers before tests run and tears them down after — no manual server management. Placing config in `project/frontend/` keeps it colocated with the app it tests, matching standard Playwright project layout.

- Install Playwright in `project/frontend`: `npm install -D @playwright/test && npx playwright install chromium`
- Create `project/backend/.env.e2e` — copy `.env.load` pattern, set `DATABASE_URL=tvz_e2e`, `PORT=3000` (Vite proxy points to 3000 by default)
- Create `tvz_e2e` DB: `docker exec tvz_db psql -U tvz -c "CREATE DATABASE tvz_e2e;"`
- Run migrations: `export $(grep -v '^#' .env.e2e | xargs) && npx prisma migrate deploy`
- Create `project/frontend/playwright.config.ts`:
  ```ts
  export default defineConfig({
    testDir: './test/e2e',
    use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
    webServer: [
      {
        command: 'export $(grep -v "^#" ../.env.e2e | xargs) && cd ../backend && nest start',
        url: 'http://localhost:3000/api/v1/health',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
      {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
      },
    ],
  });
  ```
- Add npm scripts to `project/frontend/package.json`:
  ```json
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:headed": "playwright test --headed",
  "test:e2e:seed": "export $(grep -v '^#' ../.env.e2e | xargs) && ts-node --transpile-only test/e2e/seed.ts"
  ```

**Files:** `project/frontend/playwright.config.ts` (new), `project/frontend/package.json` (scripts), `project/backend/.env.e2e` (new)
**Validates with:** `cd project/frontend && npx playwright test --list` — should list test files without error (even if empty)
**Rollback:** Remove `playwright.config.ts`, revert `package.json`, drop `tvz_e2e` DB

---

### Phase 2: Seed

**Goal:** Create `test/e2e/seed.ts` that populates `tvz_e2e` with the minimum data for all E2E test personas.

**Why this approach:** Same pattern as `test/load/seed.ts` (already verified working). Seeding directly into Prisma avoids HTTP register calls and their throttle limits. Pre-built website avoids AI costs.

- Seed creates in order (FK dependencies respected):
  1. 1 parent category + 1 leaf category (`slug: 'curatenie-e2e'`) — use unique slugs to not conflict with other seeds
  2. `owner@e2e.test` / `password123` — test business owner (with wallet)
  3. `stranger@e2e.test` / `password123` — separate user for IDOR tests
  4. Company: `slug: 'e2e-company-test'`, status `active`, owned by owner user
  5. CompanyCategory, CompanyLocation (nationwide)
  6. Campaign: status `active`, cpcMinor 200, dailyBudgetMinor 10000, activatedAt now
  7. Website: `status: 'published'`, `mode: 'easy'`, `generator: 'rule-based-v1'`, with content containing a `hero` section and a `contact` section (required for lead form to render)
- Output the company slug and ID so tests can reference them
- Script is idempotent (TRUNCATE relevant tables first, same pattern as load seed)

**Website content to seed** (see Schema in handoff):
```ts
content: {
  seo: { title: 'E2E Test Cleaning', description: 'Test company', schemaType: 'LocalBusiness' },
  pages: [{ slug: 'home', title: 'Home', isHome: true, sections: [
    { id: randomUUID(), type: 'hero', visible: true, headline: 'E2E Cleaning Services', subheadline: 'Test subheadline', primaryCta: 'Get a quote' },
    { id: randomUUID(), type: 'contact', visible: true, title: 'Contact us', city: 'Bucharest' },
  ]}]
}
```

**Files:** `project/frontend/test/e2e/seed.ts` (new), imports `@prisma/client` and `argon2`
**Validates with:** `cd project/frontend && npm run test:e2e:seed` — should print seed summary with company slug
**Rollback:** Delete `seed.ts`, drop `tvz_e2e` DB

---

### Phase 3: Visitor Flow Test

**Goal:** Test the revenue-critical path — anonymous visitor finds a company in the feed, views their website, submits a lead.

**Why this approach:** This is the most important user journey for the business. Validates feed ranking renders, company page loads, lead form works end-to-end.

- Test file: `project/frontend/test/e2e/visitor-flow.spec.ts`
- `beforeAll`: run seed (or call seed function directly)
- Step 1 — Browse feed:
  - Navigate to `http://localhost:5173/curatenie-e2e` (category feed)
  - Assert company card for `e2e-company-test` is visible
  - Click the company card
- Step 2 — Company page:
  - Assert URL changes to include `e2e-company-test`
  - Assert hero headline `E2E Cleaning Services` is visible
  - Assert contact section renders
- Step 3 — Submit lead:
  - Fill contact form: name, email, message
  - Submit
  - Assert success state (thank-you message or 202 confirmation)
- Use `page.waitForResponse` to confirm the `POST /api/v1/public/companies/e2e-company-test/lead` returns 202

**Files:** `project/frontend/test/e2e/visitor-flow.spec.ts` (new)
**Validates with:** `npx playwright test visitor-flow --headed` — watch browser navigate, fill form, submit
**Rollback:** Delete test file

---

### Phase 4: Owner Flow Test

**Goal:** Verify business owner can log in and see their dashboard with live campaign stats.

**Why this approach:** Validates session auth, dashboard data load, campaign status display — the owner's daily interaction with the platform.

- Test file: `project/frontend/test/e2e/owner-flow.spec.ts`
- Navigate to `/login`
- Fill email `owner@e2e.test`, password `password123`, submit
- Assert redirect to dashboard (not `/login`)
- Navigate to company dashboard page
- Assert campaign status shows as `active`
- Assert no error states

**Files:** `project/frontend/test/e2e/owner-flow.spec.ts` (new)
**Validates with:** `npx playwright test owner-flow --headed`
**Rollback:** Delete test file

---

### Phase 5: Auth + IDOR Tests

**Goal:** Verify unauthenticated redirects and cross-tenant access protection in the browser.

**Why this approach:** IDOR already has backend integration tests (15 passing). These E2E tests verify the frontend also enforces them (redirects, 404 pages render correctly, no data leaks in UI).

- Test file: `project/frontend/test/e2e/auth-idor.spec.ts`
- Unauthenticated → protected route → assert redirect to `/login`
- Login as `stranger@e2e.test` → navigate to owner's company dashboard URL → assert 404 or redirect
- Logout → session cookie cleared → protected route redirects again

**Files:** `project/frontend/test/e2e/auth-idor.spec.ts` (new)
**Validates with:** `npx playwright test auth-idor --headed`
**Rollback:** Delete test file

---

## Dependencies & Order

- Phase 1 (infrastructure) must complete before all others — playwright.config.ts and DB are prerequisites
- Phase 2 (seed) must complete before Phases 3–5 — tests need seeded data
- Phases 3, 4, 5 can be written in parallel once Phase 2 is done
- Each phase validates independently; don't batch into one big test run until all pass individually

---

## Risks & Mitigations

- **BrowseView URL shape unknown** — need to verify whether company page URL is `/:category/:slug` or just `/:slug`. Check by inspecting how `BrowseView.vue` builds the company link. Low risk — router is documented in handoff.
- **Contact form selectors** — need to inspect actual rendered HTML for form field selectors. Likely Vuetify `v-text-field` which uses `input[type=text]` internally. Use `page.getByLabel()` (more resilient than CSS selectors).
- **Backend startup time** — `nest start` compiles TypeScript, takes 15-20s. The `playwright.config.ts` `timeout: 60_000` on the webServer handles this.
- **Throttler in E2E** — lead submit throttle (15/min) is fine for E2E (1 request per test run). Auth register (10/min) is fine (1-2 per test file). No bypass needed.
- **Vue hydration timing** — Playwright's auto-wait handles most async, but deep nested Vuetify components may need explicit `waitFor`. Use `expect(locator).toBeVisible()` not `waitForTimeout`.

---

## Success Criteria

- `npx playwright test` runs all tests green with no manual server startup
- Visitor flow test completes: feed loads → company card visible → website renders → lead submits 202
- Owner flow test completes: login → dashboard renders → campaign shows active
- IDOR test completes: stranger redirected or shown 404 on owner's URL
- Tests run in < 2 minutes total (headed) in < 30s (headless)
- All 4 test files run against `tvz_e2e` DB without touching `tvz_test` or `tvz_load`

---

## Quick Start

```bash
# Read full context
cat /Users/I750248/IdeaProjects/totalvizibil/HANDOFF_playwright-e2e_2026-10-11.md

# Key source files for Phase 1
# project/frontend/package.json          — add scripts
# project/frontend/vite.config.ts        — understand dev server setup
# project/backend/.env.load              — copy as .env.e2e pattern
# project/frontend/src/router/index.ts   — route map for URL patterns
# project/backend/test/load/seed.ts      — seed pattern to reuse

# Phase 1 first action
cd project/frontend
npm install -D @playwright/test
npx playwright install chromium

# Create tvz_e2e DB
docker exec tvz_db psql -U tvz -c "CREATE DATABASE tvz_e2e;"

# Copy .env.load as .env.e2e base (then edit PORT=3000 and tvz_load→tvz_e2e)
cp project/backend/.env.load project/backend/.env.e2e
# Edit: DATABASE_URL tvz_load → tvz_e2e, PORT=3099 → PORT=3000

cd project/backend
export $(grep -v '^#' .env.e2e | xargs) && npx prisma migrate deploy
```
