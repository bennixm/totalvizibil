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
| POST | `/api/v1/auth/login` | — | Start session |
| POST | `/api/v1/auth/logout` | cookie | Revoke session |
| GET | `/api/v1/auth/me` | cookie | Current user |
| GET | `/api/v1/categories` | — | Active categories |
| POST | `/api/v1/companies` | cookie | Create a company (caller becomes `owner`) |
| GET | `/api/v1/companies` | cookie | Companies the caller belongs to |
| GET | `/api/v1/companies/:id` | cookie (member) | One company + profile |
| PATCH | `/api/v1/companies/:id` | cookie (owner/manager) | Update core profile fields |
| GET | `/api/v1/companies/:id/dashboard` | cookie (member) | Dashboard payload (metrics are explicit `null` until later milestones) |

## Scripts

`npm run start:dev` · `build` · `typecheck` · `lint` / `lint:check` · `test` ·
`prisma:migrate` · `prisma:deploy` · `db:seed` · `prisma:studio`
