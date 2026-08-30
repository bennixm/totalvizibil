# Backend — implementation decisions

Log of concrete choices made while building the backend. The target design is
`00-PRD.md` §16–§20; this records where the build deviates or defers, and why.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **NestJS 11** (modular monolith) | Per PRD §17. |
| Database | **PostgreSQL 16** | Local dev via `project/docker-compose.yml`. |
| ORM / migrations | **Prisma** | PRD does not mandate an ORM. Prisma was chosen for its first-class migration workflow (a hard requirement) and type-safe client. PostGIS / table partitioning, when needed, go in raw migration SQL. |
| Passwords | **argon2id** | PRD §20. |
| Sessions | **DB-backed opaque token in an httpOnly `SameSite=Lax` cookie** | PRD §20 lists "httpOnly SameSite=Lax session cookies" *and* short-lived JWT + refresh rotation. For a same-site browser SPA the cookie session is sufficient and revocable (logout = revoke row). JWT/refresh rotation is deferred until there is a non-browser API consumer. Raw token is never stored — only its SHA-256. |
| Rate limiting | `@nestjs/throttler` | Global 120/min; auth endpoints 10/min. |
| Headers | `helmet` | |

## Deferred (introduce when a milestone needs them)

Redis, BullMQ, the Vue SSR website renderer, Stripe, the AI provider abstraction.
Nothing in the Company Foundation slice uses them; adding them now would be dead
infrastructure. All are in the PRD §17 target design.

## Authorization model

- **Company roles** (`company_users.role`): `owner | manager | editor | billing`.
  Company data is scoped by active membership; a non-member gets `404`. `owner` and
  `manager` can edit the profile.
- **Platform roles** (`platform_roles.role`): `admin | support | finance | moderator`.
  `PlatformRolesGuard` + `@PlatformRoles(...)` gate staff routes (none shipped yet).

## API surface implemented (v1)

`/api/v1` prefix. See `project/backend/README.md` for the full endpoint table.

- **Milestone 1** — `auth/{register,login,logout,me}`, `categories`, `companies`
  (`POST` / `GET list` / `GET :id` / `PATCH :id` / `GET :id/dashboard`), `health`.
- **Milestone 2 (redesign + AI-first flow)** —
  - `GET /feed`, `GET /feed/facets` — public discovery. **A business is in the
    feed only while its campaign is funded and `active`** (no "sponsored" tier or
    reserved slot). Order among them is the **Visibility Score** (M12,
    `src/analytics/visibility.ts` — pure, unit-tested):
    `CPC×0.35 + ResponseRate×0.30 + Plan×0.20 + Age×0.15`, each sub-score 0..1 —
    CPC = daily budget vs a reference, ResponseRate = how reliably + fast the
    business answers its leads (neutral 0.5 with no history), Plan = advanced 1 /
    easy 0.5, Age = days the campaign has run vs a reference. A search query
    multiplies by relevance; a funded `appear_first` adds a fixed lift. Per-item
    `scoreBreakdown` carries `visibility / cpc / response / plan / age`.
  - `GET /public/companies/:slug` — the company's public identity + generated
    website content (active companies only).
  - `GET /feed/facets` returns a **two-level category tree** (`categories[].children[]`)
    — parent groups (`constructii`, `instalatii`, …) and their exact service
    niches (`acoperisuri`, `instalatii-sanitare`, …). `GET /feed?category=<slug>`
    accepts either level: a parent slug matches the group and all its niches.
    Feed items carry `category.parent` for the breadcrumb. The taxonomy (9 groups
    / 26 niches) lives in `prisma/seed.ts` (`TAXONOMY`); retired categories are
    kept but `isActive: false`.
  - `POST /companies/:id/publish` · `/unpublish` — flips company + website to
    publicly visible in the feed.
- **Milestone 3 (account & security; feed + create-flow trimmed)** —
  - `POST /auth/password/forgot` — always 200 (no enumeration); in non-production
    returns `devResetUrl` and logs it (no email provider wired yet — PRD §17).
  - `POST /auth/password/reset` — single-use token, 1h TTL, invalidates **all**
    sessions.
  - `POST /auth/login` accepts an optional `totpCode`; when 2FA is on, login
    fails with message `totp_required` / `totp_invalid` (frontend keys off these).
  - `/account/*` (auth'd): `GET security`, `PATCH profile` (email change needs
    the current password), `POST password` (keeps the current session, drops the
    rest), `POST totp/{setup,enable,disable}` (RFC 6238 via `otplib`),
    `GET sessions`, `DELETE sessions/others`.
  - **Removed**: the whole `website-drafts` module + table + the register-at-the-end
    claim flow (product direction changed — the create flow stops at the
    Easy/Advanced choice for now).
- **Milestone 4 (admin panel)** — `src/admin/`, guarded by `AuthGuard` +
  `PlatformRolesGuard` with `@PlatformRoles('admin')`:
  - `GET /admin/stats` — user / company / session counts, companies-by-country,
    staff-by-role, a 14-day sign-up time series, and a `listings` block explicitly
    marked `{ _status: 'not_defined' }` (the listing/ad model isn't decided yet).
  - `GET /admin/users` (paginated, `search` / `status` / `role` / `staffOnly`
    filters), `GET /admin/users/:id` (full detail incl. companies + sessions),
    `PATCH /admin/users/:id` (name, email, status, platform roles reconciled to a
    desired set, optional `disableTotp` / `revokeSessions`),
    `POST /admin/users/:id/password` (admin-set password → all sessions revoked).
  - Guardrails: an admin cannot suspend their own account or drop their own
    `admin` role. Suspending a user revokes their sessions (and
    `SessionService.resolve` already rejects non-active users).
  - Admin bootstrap: `prisma/seed.ts` seeds `admin@totalvizibil.local` /
    `admin1234` with the `admin` platform role.
- **Milestone 5 (website creation — free one-pager studio, M1 of the creation flow)** —
  `src/website/` gains a `WebsiteModule` with the anonymous draft studio. No auth:
  a draft is held by an opaque token the client stores locally and sends back as
  `X-Draft-Token` (only the SHA-256 is stored; 7-day TTL).
  - `POST /website-drafts` — start a draft; returns `{ id, token, draft }` (token
    returned once).
  - `GET /website-drafts/:id` — fetch the draft view (needs the token header).
  - `POST /website-drafts/:id/messages` `{ text }` — one visitor message. A
    **scripted** assistant (`website-draft.script.ts` — deterministic state
    machine, *not* an LLM) walks `business → name → city → services → contact →
    refine → done`, re-runs `RuleBasedWebsiteGenerator` after each step, and
    persists the block tree so the frontend preview updates live. Assistant turns
    are returned as i18n keys (`studio.msg.*`), never baked strings.
  - Free-plan cap: `FREE_MAX_TURNS = 12` visitor messages, then further messages
    are refused with `403 free_plan_turn_limit`.
  - Not yet built (later milestones of the creation flow): account-at-the-end
    that claims the draft into a real `Website`, budget/CPC, wallet/credits, and
    the advanced (multi-page, LLM) builder.
- **Milestone 6 (creation flow — category + location step, M2)** —
  - `GET /categories` — public **two-level tree** (parent groups + their
    exact-niche children), powers the create-flow category selector.
  - `GET /geo/cities?q=` — accent-insensitive type-ahead over a static list of
    ~65 Romanian cities (`src/geo/ro-cities.ts` — code, not seeded; a geocoder
    can slot in behind `GeoService` later). Public.
  - `PATCH /website-drafts/:id/location` `{ categorySlug, city, region?, country?,
    lat, lng, radiusKm }` — the category **(required)** plus the service area
    (1–200 km) that decide where the business surfaces in the feed. `categorySlug`
    may be an exact-niche child **or** a whole parent group ("all of
    Construction"). `400 unknown_category` if it isn't an active category; `400
    generate_website_first` until the one-pager exists. Stored on `website_drafts`
    (`category_slug`, `location_*`); the draft view gains `categorySlug` +
    `location`.
- **Milestone 7 (creation flow — account + persist, M3)** —
  - `POST /companies/from-draft` `{ draftToken }` (auth'd) — end of the create
    flow. In one transaction: creates the `Company` (owner membership, its
    `category` from the draft, phone/email contacts from the draft answers), its
    `Website` (mode `easy`/`advanced`, status `draft`, the generated
    `content`/`theme`), and — if the location step was done — its primary
    `CompanyLocation` (with `lat`/`lng`); then marks the draft `claimed`.
    `409 draft_already_claimed` on a second call, `400 website_not_generated` if
    there's no one-pager yet, `400 category_required` if the category step was
    skipped. `PATCH /companies/:id/location` takes the same `categorySlug` and
    updates `company.categoryId` too — the dashboard `set_location` task is
    `done` only once category **and** located.
  - `GET /companies/:id/dashboard` now also returns the website `content`/`theme`
    (so the dashboard can preview the draft) and a `tasks` array. The only task
    so far — `set_campaign_budget` — is `status: "blocked"` because budget/wallet
    are later milestones; it is surfaced, not faked.
- **Milestone 8 (Wallet & Credits, M4)** — `src/wallet/` + `src/platform-settings/`.
  Credits are the internal currency, EUR-denominated (**1 Credit = 1 EUR**). Money
  is stored as integer minor units (hundredths of a credit = euro cents) so the
  ledger is exact. The wallet is **prepaid — the balance can never go negative**.
  - **One wallet per user** (`wallets.user_id` unique), not per company. It funds
    every business the user owns. Campaigns have no balance of their own — each
    spend is tagged with `wallet_transactions.company_id` (FK `onDelete: SetNull`)
    so per-business / per-campaign consumption is reported exactly
    (`WalletService.consumedByCompany` / `consumedByCompanies`). Migration
    `20260830220622_wallet_per_user` backfills + merges the old per-company rows.
  - `GET /wallet` — balance + `eurRonRate` + aggregates (deposited EUR, credits
    bought, credits spent). Lazily creates the wallet row for the caller.
  - `GET /wallet/transactions?limit=&cursor=&companyId=` — the ledger, newest
    first, cursor-paginated; each row carries `companyId` + `companyName`.
  - `POST /wallet/purchases` `{ credits }` — creates a `pending` `WalletTransaction`
    and returns the EUR + RON amounts at the current rate. **The balance is not
    moved until the payment is confirmed.**
  - `POST /wallet/purchases/:txnId/confirm` — stands in for the PSP webhook (no
    real provider wired — PRD §17): applies the credits to the balance atomically
    and completes the transaction. `400` if not pending.
  - `WalletService.canAfford(userId, minor)` / `spend(userId, minor, { description,
    companyId })` — prepaid guard + debit for campaign spend, the advanced-builder
    unlock and the additional-business fee.
  - EUR/RON rate lives in `platform_settings` (`eur_ron_rate`), read via
    `PlatformSettingsService` (30 s cache, sane fallback `5.05`, validated 1–50) —
    **not hardcoded**. `GET`/`PATCH /admin/settings` expose it to platform admins.
  - The additional-business fee (`from-draft`, 2nd business onward) is debited
    from the user's wallet inside the claim transaction; `insufficient_credits`
    aborts the whole claim. **Waived when `draft.mode === 'advanced'`** — that
    business already pays the advanced-builder fee.
- **Milestone 9 (Campaign — budget + CPC + "appear first", M5)** — `src/campaigns/`.
  One `Campaign` per company. A company is in the feed **only while its campaign
  is `active`**, and the wallet must hold at least one day's budget (prepaid).
  - `GET /companies/:companyId/campaign` — the campaign (or `null`), rule-based
    `suggestions` (`standard` + `appearFirst` tiers from `campaign-advisor.ts` —
    no auction/ML), the wallet balance, the `required` daily budget, `canActivate`
    and `runnable` flags. Reconciles active↔depleted against the balance on read.
  - `PUT /companies/:companyId/campaign` `{ dailyBudget, cpc, appearFirst }`
    (credits) — upserts the campaign; `cpc` must be ≤ the daily budget. **Editing
    an already-configured campaign (`status !== draft`) forces it to `paused`** —
    it leaves the feed until the owner re-activates with the new numbers.
  - `POST .../campaign/activate` — requires `wallet.canAfford(dailyBudget)` (the
    owner's wallet) else `400 insufficient_credits`; in one transaction sets
    campaign `active`, company `active`, website `published` → the listing goes
    live. `400 set_budget_first` if no campaign, `403` if the company is suspended.
  - `POST .../campaign/pause` — reverses all of that (out of the feed).
  - Roles `owner | manager | billing` can edit; any member can view.
  - The dashboard `set_campaign_budget` task is now `todo` / `done` (was
    `blocked`) and its payload carries a `campaign` summary.
  - **CPC metering** — `POST /feed/click` `{ companyId }` (public, throttled
    40/min/IP). Fired by the feed card on click; the client doesn't wait on it.
    `CampaignService.registerClick(companyId, ip, ua)` bills one `cpcMinor` from
    the owner's wallet **in a single transaction** (click row + wallet debit +
    daily counter) and returns `{ billed, reason? }`. The debit uses
    `WalletService.chargeClickWithin` which **rolls up into one "Ad clicks"
    ledger row per company per UTC day** (amount + click count accumulate on it —
    `provider = 'cpc'`, `providerRef` = count) rather than one transaction per
    click, so the wallet history stays readable under real traffic.
    - **One charge per person per listing per UTC day.** `ad_clicks` has a
      `UNIQUE(company_id, visitor_hash)` where `visitor_hash =
      sha256(ip | ua | companyId | yyyy-mm-dd)` (only the hash is stored). A
      repeat that day collides → free (`reason: repeat`).
    - Not billed (row still recorded for analytics): `bot` (UA looks like a
      crawler / is empty — `src/campaigns/ad-click.ts`), `no_campaign` (campaign
      not `active`), `budget` (would exceed `dailyBudgetMinor` for the day),
      `insufficient` (wallet can't cover one more click).
    - Hitting the daily budget or an empty wallet **depletes** the campaign
      (out of the feed). `spentTodayMinor` / `spendDay` reset lazily at the UTC
      day boundary in `reconcile()`, which also auto-revives a `depleted`
      campaign once funded and under budget again.
    - `GET .../campaign` and the dashboard `campaign` summary now include
      `spentToday` and lifetime billed `clicks`.
    - `req.ip` is the socket address in dev; set `trust proxy` behind a real
      load balancer so the per-visitor hash uses the true client IP.
- **Milestone 10 (Advanced plan — paid multi-page builder, M7)** —
  - `POST /website-drafts` now takes `{ mode?: 'advanced', seed?: {businessName,
    businessType, city?} }`. An advanced draft is `plan: advanced`; a `seed`
    generates a starter site immediately so the preview is never empty.
  - `GET /platform/pricing` (public) — `{ advancedBuilderPriceCredits, eurRonRate }`.
  - `Company.advancedUnlockedAt` (migration `advanced_builder`), `Website.builderSpec`
    / `builderChat` (JSON) hold the advanced-builder state.
  - `GET /companies/:id/website-builder` — `{ unlocked, priceCredits, wallet,
    step, complete, transcript, theme, content }`.
  - `POST .../website-builder/unlock` — one-time fee: `WalletService.spend()`
    debits the price in credits (atomic, prepaid — `400 insufficient_credits`)
    and sets `advancedUnlockedAt`. Records a `spend` `WalletTransaction`.
  - `POST .../website-builder/messages` `{ text }` — a scripted advanced assistant
    (`builder/builder-script.ts` — deterministic, not an LLM) walks pages / tone /
    palette / typography / portfolio and re-runs the generator on the real
    `Website`. Requires the unlock (`403 advanced_builder_locked`).
  - Generator: `generateAdvanced()` composes **multiple pages** (`home` + any of
    `about/services/portfolio/faq/contact`) and a `gallery` (portfolio) section.
  - `set_campaign_budget` is preceded by an `unlock_advanced_builder` task for
    advanced websites.
  - `GET/PATCH /admin/settings` gains `advancedBuilderPriceCredits`.
  - Not wired: a real LLM behind the advanced builder (the rule-based generator
    stands in, same interface); real PSP for the unlock (paid from wallet credits).

- **Milestone 11 (Leads — contact form + call tracking, "Cereri")** — `src/leads/`
  + `src/mail/`.
  - `POST /public/companies/:slug/lead` `{ channel: 'form'|'call', name?, email?,
    phone?, message? }` (public, throttled 15/min/IP, `202`). Fired by the
    generated site's contact form / "call" button. **De-duplicated per visitor
    per window** (`lead.util.ts`): a `call` tap once/hour, a `form` submit once
    per 2-minute bucket — `visitor_hash = sha256(ip | ua | companyId | channel |
    window)`, only the hash stored, `@@unique([companyId, visitor_hash])` → a
    repeat is a silent no-op. Bot UAs are accepted but not stored. A `form`
    submit emails the owner via `MailService` (logs in dev, "pending dispatch"
    in prod — no provider wired, nothing faked as sent). `400 message_required`
    / `contact_required` / `invalid_email` for a bad form.
  - `GET /companies/:companyId/leads?status=&channel=&cursor=&limit=` — the
    panel inbox, newest first, cursor-paginated. Any active member can view.
  - `GET .../leads/summary` — `{ total, new, resolved, form, call, responded,
    avgResponseMinutes }`. Also folded into `GET /companies/:id/dashboard` as
    `leads`.
  - `GET .../leads/:leadId` — detail; flips a `new` lead to `seen`.
  - `PATCH .../leads/:leadId` `{ status?: 'new'|'seen'|'resolved', responded?:
    true }` — `responded` stamps `firstResponseAt` (→ `responseMinutes`);
    `resolved` stamps `resolvedAt` (and `firstResponseAt` if still unset).
  - `DELETE .../leads/:leadId` — `204`.
  - `firstResponseAt` / `resolvedAt` feed the Response Rate input of the
    Visibility Score (M12).
- **Milestone 12 (Analytics + Visibility Score)** — `src/analytics/`.
  - `AnalyticsService.companyAnalytics(companyId)` → the panel **Analiză**
    section, folded into `GET /companies/:id/dashboard` as `analytics`:
    `clicks {total, today}`, `calls {total}`, `messages {total, new}`,
    `campaign {consumedTotal, consumedToday, activeDays}`,
    `response {avgMinutes, ratePct, responded, total}`,
    `visibility {score /100, parts{cpc,response,plan,age}, weights}`, and a
    14-day `series {days, clicks, messages}` (one `date_trunc` query each). The
    old placeholder `metrics` block is gone.
  - `AnalyticsService.visibilityInputsFor(ids)` batches campaign budget /
    `activatedAt`, website `mode` and per-company lead response stats for the
    feed to score in one pass.
  - The score weights (`0.35 / 0.30 / 0.20 / 0.15`) are the algorithm and fixed;
    the normalisation references (`DEFAULT_REFS`: 20 cr/day budget, 12 h response
    floor, 30-day age) are tuning knobs, currently consts.

The dashboard returns real analytics — nothing is faked.

## Website generation

`src/website/` holds the block-tree types (PRD §11.1) and a `WebsiteGenerator`
interface with a **rule-based** implementation (`rule-based-v1`) — no LLM is
called. Used by the seed for demo companies and by the free one-pager studio
(`WebsiteModule`, see Milestone 5 above). `EasyInput` carries optional `tone` /
`phone` / `email` so the studio's "refine" step and contact answers reach the
generated contact section. The generator's boilerplate copy is still English —
localising it by draft locale is a known follow-up.

## Schema

- `websites` (1:1 company; block tree as JSON), `companies.quality_score` (feed
  ranking input). `companies.featured` still exists as a legacy mirror of
  `campaign.status === 'active'` but is no longer read — the feed selects on
  `companies.status = 'active'` alone.
- `password_reset_tokens`; `users.password_changed_at`, `users.totp_secret`,
  `users.totp_enabled_at`.
- `website_drafts` (re-added for the studio, new shape): `token_hash`, `step`,
  `answers` / `transcript` JSON, `turns_used`, nullable `theme` / `content` /
  `generator`, `category_slug` + `location_{city,region,country,lat,lng,radius_km}`
  (M2), `claimed_company_id`, `expires_at`. Enum `WebsiteDraftStatus`
  (`in_progress | ready | claimed`).
- `company_locations.lat` / `.lng` (M3) — coordinates carried over from the
  draft's location step.
- `wallets` (**1:1 user**, `balance_minor` in hundredths of a credit),
  `wallet_transactions` (append-only ledger: `type` purchase/spend/refund/
  adjustment, `status` pending/completed/failed/canceled, signed `amount_minor`,
  nullable `company_id` for spend attribution, `eur_cents` / `ron_bani` /
  `fx_rate` for purchases), `platform_settings` (key/value; currently
  `eur_ron_rate`). Seeded default rate in `prisma/seed.ts`.
- `campaigns` (1:1 company, M5): `status` draft/active/paused/depleted,
  `daily_budget_minor`, `cpc_minor`, `appear_first` (funded → fixed feed-score
  boost, not a separate slot), `spent_today_minor` + `spend_day` (DATE — CPC
  metering, reset lazily per UTC day).
- `ad_clicks` (CPC ledger): `company_id`, `visitor_hash`, `billed`, `cost_minor`,
  `reason` (null = billed). `UNIQUE(company_id, visitor_hash)` = one row per
  visitor per listing per UTC day.
- `leads` (M11): `channel` form/call, `status` new/seen/resolved, visitor-supplied
  `name`/`email`/`phone`/`message`, `visitor_hash`, `first_response_at` /
  `resolved_at`. `UNIQUE(company_id, visitor_hash)` = one row per visitor per
  dedupe window. Enums `LeadChannel`, `LeadStatus`.
- `Company.advanced_unlocked_at`, `Website.builder_spec` / `builder_chat` (M7).
  `platform_settings` gains `advanced_builder_price_credits`.

Migrations: `project/backend/prisma/migrations/`.
