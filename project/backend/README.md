# Totalvizibil — Backend

NestJS + PostgreSQL (Prisma) API. Spec: [`../docs/00-PRD.md`](../docs/00-PRD.md).

## Stack (current milestone)

| Concern | Choice |
| --- | --- |
| Framework | NestJS 11 (modular monolith) |
| Database | PostgreSQL 16 |
| ORM / migrations | Prisma |
| Auth | DB-backed opaque session token in an httpOnly `SameSite=Lax` cookie |
| Passwords | argon2id |
| Rate limiting | `@nestjs/throttler` |

Deferred until a milestone needs them (PRD §17): Redis, BullMQ, the Vue SSR website
renderer, Stripe, the AI provider abstraction.

## Run it

```bash
# 1. Postgres (from project/)
cd .. && docker compose up -d db && cd backend

# 2. Install + configure
npm install
cp .env.example .env            # defaults already match docker-compose

# 3. Schema + seed
npm run prisma:migrate          # applies migrations, generates the client
npm run db:seed                 # seeds launch categories

# 4. Start
npm run start:dev               # http://localhost:3000/api/v1
```

## API (v1)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | — | Liveness + DB check |
| POST | `/api/v1/auth/register` | — | Create account, start session |
| POST | `/api/v1/auth/login` | — | Start session (optional `totpCode` when 2FA is on) |
| POST | `/api/v1/auth/logout` | cookie | Revoke session |
| GET | `/api/v1/auth/me` | cookie | Current user |
| POST | `/api/v1/auth/password/forgot` | — | Request a reset link (dev: returns `devResetUrl`) |
| POST | `/api/v1/auth/password/reset` | — | Reset with token; invalidates all sessions |
| GET | `/api/v1/account/security` | cookie | 2FA + password status |
| PATCH | `/api/v1/account/profile` | cookie | Update name / email (email needs current password) |
| POST | `/api/v1/account/password` | cookie | Change password (keeps this session) |
| POST | `/api/v1/account/totp/setup` \| `enable` \| `disable` | cookie | TOTP 2FA (RFC 6238) |
| GET | `/api/v1/account/sessions` | cookie | Active sessions |
| DELETE | `/api/v1/account/sessions/others` | cookie | Sign out other devices |
| GET | `/api/v1/categories` | — | Active categories |
| GET | `/api/v1/feed` \| `/feed/facets` | — | Discovery (facets back the filter bar) |
| GET | `/api/v1/public/companies/:slug` | — | Public company identity + website |
| POST/GET/PATCH | `/api/v1/companies` … | cookie | Company CRUD + `/:id/dashboard`, `/:id/publish`, `/:id/unpublish` |

## Scripts

`npm run start:dev` · `build` · `typecheck` · `lint` / `lint:check` · `test` ·
`prisma:migrate` · `prisma:deploy` · `db:seed` · `prisma:studio`
