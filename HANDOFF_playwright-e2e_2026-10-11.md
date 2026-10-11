# Handoff — Playwright E2E Setup

**Date:** 2026-10-11
**Session:** Playwright E2E planning (new work)
**Branch:** daniel
**Chain:** none / seq 1

---

## What We Accomplished This Session

### k6 Load Tests (completed)
- Created `project/backend/.env.load` with `tvz_load` DB on port 3099
- Created `tvz_load` DB via Docker postgres container (`docker exec tvz_db psql -U tvz`)
- Ran `prisma migrate deploy` against `tvz_load` — all migrations applied
- Created `test/load/seed.ts` — seeds 5 leaf categories + 20 active companies with campaigns + 1 test user (`load@test.com` / `password123`)
- Created 5 k6 scenario files: `feed.k6.js`, `lead-submit.k6.js`, `auth.k6.js`, `dashboard.k6.js`, `index.k6.js`
- Added npm scripts: `test:load:seed`, `test:load:start`, `test:load`
- Found and fixed throttle issue: `@SkipThrottle()` added to `FeedController` (public read endpoint shouldn't be rate-limited — correct prod fix)
- Verified feed scenario: **p95=83ms**, **0% error rate**, 1525 requests, 20 VUs, 100s run

### Feed Ranking Integration Tests + Authorization Tests (from prior session)
- 14 feed ranking tests including gauntlet with 5 companies
- 15 authorization/IDOR tests
- ThrottlerGuard fix: `resetThrottler(app)` clears in-memory Map between tests
- `createUserDirect` helper bypasses HTTP register for tests that only need `user.id`
- All 18 integration spec files updated to pass `app` to `resetDb`

---

## Architecture Context

### Stack
- **Backend**: NestJS + Prisma (PostgreSQL), session-cookie auth (express-session)
- **Frontend**: Vue 3 + Vuetify, Vite, port 5173
- **Frontend→Backend**: Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3000` (or `VITE_API_PROXY_TARGET`). Same-origin — cookies work transparently.
- **DB**: Docker postgres container `tvz_db` at `localhost:5432`, user `tvz`, pass `tvz`
  - `tvz` = dev, `tvz_test` = integration tests, `tvz_load` = load tests

### Key Files
```
project/
  backend/
    src/
      feed/feed.controller.ts            — @SkipThrottle() added this session
      leads/public-lead.controller.ts    — POST /public/companies/:slug/lead (202)
      companies/companies.controller.ts  — GET /companies/:id/dashboard (requiresAuth)
    prisma/schema.prisma                 — full data model
    test/
      integration/                       — 18 spec files, jest --runInBand
      load/
        seed.ts                          — seeding pattern to reuse for E2E
        scenarios/feed.k6.js             — verified working
    .env.load                            — tvz_load DB, port 3099
    .env.test                            — tvz_test DB, port 0
  frontend/
    src/
      router/index.ts                    — route map
      views/
        FeedView.vue                     — / (public)
        BrowseView.vue                   — /:seg1/:seg2?/:seg3? (feed + company pages)
        LoginView.vue                    — /login
        CreateBusinessView.vue           — /create (register flow start)
    vite.config.ts                       — port 5173, proxies /api → backend
    package.json                         — no playwright yet
```

### Company Public Page URL Pattern
Route: `/:seg1/:seg2?/:seg3?` → `BrowseView.vue`
- Feed category: `/curatenie`
- Company listing: `/curatenie/load-company-1` (category/slug) or `/load-company-1`
- BrowseView distinguishes feed vs company page by checking if the last segment is a company slug

### Website Schema (for E2E seed)
```typescript
// Website.content shape (WebsiteContent)
{
  seo: { title: string, description: string, schemaType: 'LocalBusiness' },
  pages: [{
    slug: 'home', title: 'Home', isHome: true,
    sections: [
      { id: string, type: 'hero', visible: true, headline, subheadline, primaryCta },
      { id: string, type: 'contact', visible: true, title, city },
    ]
  }]
}

// Website.theme shape (WebsiteTheme)
{ palette: 'indigo', fontPair: 'grotesk-inter', radius: 'rounded', density: 'comfortable' }

// Website model fields
mode: 'easy' | 'advanced'
status: 'draft' | 'published' | 'unpublished'
generator: 'rule-based-v1'  // or 'pro-v2'
```

### Lead Submission (public endpoint)
```
POST /api/v1/public/companies/:slug/lead
Body: { channel: 'form', name?, email?, phone?, message? }
→ 202 (always, even rate-limited)
Throttle: 15 req/min per IP (active, not skipped)
```

### Auth Flow
```
POST /api/v1/auth/register → 201 (throttle: 10/min)
POST /api/v1/auth/login    → 200 + Set-Cookie: tvz_session
POST /api/v1/auth/logout   → 200
```

### Throttler Config
- Global: 120 req/min (app.module.ts)
- Register: 10 req/min (override on controller)
- Lead submit: 15 req/min
- Feed: @SkipThrottle() (just added)

---

## Playwright Plan Discussion

### Why Playwright (not Cypress)
- Vue 3 + Vite — Playwright has better first-class support
- Need to test full-stack (browser → Vue frontend → NestJS backend → Postgres)
- Can watch tests run live in headed mode
- Auto-wait, good selectors, trace viewer

### Scope Decision
- **Skip**: AI website builder (Anthropic API costs per run)
- **Cover**: Everything else with pre-seeded data
  - Visitor browses feed → finds company → sees website → submits lead
  - Business owner logs in → sees dashboard → campaign active
  - IDOR: stranger can't access another owner's data
  - Unauthenticated redirects

### Seeding Strategy
- New `tvz_e2e` database (separate from `tvz_test` and `tvz_load`)
- `test/e2e/seed.ts` — creates: parent+leaf categories, 1 test user (owner), 1 company with active campaign + pre-built website, 1 stranger user
- Website seeded directly: `prisma.website.create({ data: { status: 'published', mode: 'easy', ... } })` — no AI call

### Where Playwright Lives
`project/frontend/` — since it drives the Vue app. Playwright config starts the Vite dev server and expects backend at `http://localhost:3000`.

### npm Scripts (to add to frontend package.json)
```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:headed": "playwright test --headed",
"test:e2e:seed": "export $(grep -v '^#' ../.env.e2e | xargs) && ts-node --transpile-only test/e2e/seed.ts"
```

### .env.e2e (backend)
Same pattern as `.env.test` and `.env.load`, pointing at `tvz_e2e` DB:
```
DATABASE_URL=postgresql://tvz:tvz@localhost:5432/tvz_e2e?schema=public
NODE_ENV=test
PORT=3000
SESSION_COOKIE_NAME=tvz_session
...
```

---

## Key Decisions Made This Session

1. **Playwright over Cypress** — better Vue 3 support, full-stack, headless + headed
2. **Skip AI builder in E2E** — costs Anthropic API per run; unit/integration already test it
3. **Pre-seeded website** — insert published `Website` row directly, no AI call
4. **Separate `tvz_e2e` DB** — avoid contaminating `tvz_test` (integration) or `tvz_load` (k6)
5. **Frontend-level placement** — `project/frontend/` owns Playwright since it drives Vue

---

## What Was NOT Done (next session work)

- [ ] Install Playwright (`@playwright/test`) in `project/frontend`
- [ ] Create `playwright.config.ts` with webServer for both Vite + NestJS backend
- [ ] Create `tvz_e2e` database and run migrations
- [ ] Create `.env.e2e` file
- [ ] Write `test/e2e/seed.ts`
- [ ] Write test files:
  - `test/e2e/visitor-flow.spec.ts` — browse feed → click company → view website → submit lead
  - `test/e2e/owner-flow.spec.ts` — login → dashboard → see campaign stats
  - `test/e2e/idor.spec.ts` — stranger can't access owner's company
  - `test/e2e/auth.spec.ts` — register, login, logout, redirect guard
- [ ] Add npm scripts to `frontend/package.json`

---

## Evidence & Data

### k6 Feed Scenario Results (this session)
```
p95 = 83ms  (threshold: <500ms) ✓
error rate = 0%  (threshold: <1%) ✓
requests: 1525 / 100s = 15.1 req/s
VUs: 20 concurrent
```

### First run failure (before fix)
- 85% error rate — ThrottlerGuard returning 429
- Root cause: 20 VUs × 1 req/s = 1200 req/min > 120 req/min global limit
- Fix: `@SkipThrottle()` on FeedController (public read, no side effects)

### Integration test count
- 18 spec files, ~104 tests total, all pass
- Run: `cd project/backend && npm run test:integration`

### Existing test patterns (reuse for E2E seed)
- `test/load/seed.ts` — shows exact Prisma create pattern for company + campaign + wallet
- `test/integration/helpers/auth.ts` — `createAndLoginUser`, `createUserDirect`
- `test/integration/helpers/db.ts` — `resetDb` with throttler clear
