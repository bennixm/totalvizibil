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
  - `GET /feed`, `GET /feed/facets` — public discovery. Ordering blends
    relevance + quality + popularity + freshness; `<=2` sponsored slots (companies
    with `featured=true`) + `1` exploration slot for the newest business. Full
    auction + fairness engine is still PRD §8–§9; the response carries a `_ranking`
    note and a per-item `scoreBreakdown`.
  - `GET /public/companies/:slug` — the company's public identity + generated
    website content (active companies only).
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

`GET /companies/:id/dashboard` still returns a real website block; advertising /
analytics metrics stay explicit `null` with `_status: "not_implemented"` — never faked.

## Website generation

`src/website/` holds the block-tree types (PRD §11.1) and a `WebsiteGenerator`
interface with a **rule-based** implementation (`rule-based-v1`). Still used by the
seed to give demo companies a real, rendered website; the interactive generation
UI is on hold pending a redesign. No LLM is called.

## Schema

- `websites` (1:1 company; block tree as JSON), `companies.quality_score` +
  `companies.featured` (feed ranking inputs; `featured` stands in for "has an
  active sponsored campaign").
- `password_reset_tokens`; `users.password_changed_at`, `users.totp_secret`,
  `users.totp_enabled_at`.
- Dropped `website_drafts`.

Migrations: `project/backend/prisma/migrations/`.
