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

`/api/v1` prefix. See `project/backend/README.md` for the endpoint table. Milestone 1
covers: `auth/{register,login,logout,me}`, `categories`, `companies`
(`POST` / `GET list` / `GET :id` / `PATCH :id` / `GET :id/dashboard`), `health`.

`GET /companies/:id/dashboard` returns advertising/analytics metrics as explicit
`null` with `_status: "not_implemented"` — placeholders are never faked (PRD §12, §19).

## Schema

Milestone 1 tables: `users`, `sessions`, `platform_roles`, `categories`, `companies`,
`company_users`, `company_locations`, `company_contacts`, `company_services`.
Migration: `project/backend/prisma/migrations/`.
