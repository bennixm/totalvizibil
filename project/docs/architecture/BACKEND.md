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
  - `POST /website-drafts` → `GET /:token` → `PATCH /:token` → `POST /:token/claim`
    — the pre-account "Create your business" flow. `claim` = register-at-the-end:
    creates the user + company + website from the draft and starts a session.
  - `POST /companies/:id/publish` · `/unpublish` — flips company + website to
    publicly visible in the feed.

`GET /companies/:id/dashboard` returns a **real** website block; advertising /
analytics metrics stay explicit `null` with `_status: "not_implemented"` — never faked.

## Website generation

`src/website/` holds the block-tree types (PRD §11.1) and a `WebsiteGenerator`
interface. The current implementation is **rule-based** (`rule-based-v1`): it composes
a real, previewable, editable site from the user's Easy/Advanced answers. It sits
behind the interface so an LLM-backed generator can replace it without touching
callers (PRD §10). No LLM is called yet.

## Schema

Added: `websites` (1:1 company; block tree as JSON), `website_drafts` (anonymous,
token-keyed, claimed on sign-up), plus `companies.quality_score` and
`companies.featured` (feed ranking inputs; `featured` is a stand-in for "has an
active sponsored campaign" until the campaigns/credit tables land).
Migrations: `project/backend/prisma/migrations/`.
