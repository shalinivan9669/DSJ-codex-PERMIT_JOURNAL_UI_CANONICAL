# Deployment: Vercel and Railway

This repository deploys `apps/web` to Vercel and `apps/api` plus `apps/worker` to Railway. The current package scripts are the source of truth. Do not use old docs that mention `build:web:deploy` or `build:vercel`; those scripts are not present in the current `package.json` files.

**Database prerequisite:** the checked-in migration history is incomplete and `prisma migrate deploy` fails on a new empty PostgreSQL database. Do not reset an existing database, mark historical migrations as applied, or bypass this failure. See `docs/migration-recovery-notes.md`; use a separate, tested bootstrap strategy for a new database only when it is ready and explicitly verified.

The Git repository contains `dsj2/` below its root. Platform root directories must therefore include the `dsj2/` prefix when the platform connects directly to the Git repository.

## Current Script Reality

Run from the `dsj2` repository root unless a platform command explicitly starts inside an app directory.

```bash
corepack enable && pnpm install --frozen-lockfile
pnpm build
pnpm verify
pnpm build:api:deploy
pnpm build:worker:deploy
pnpm --filter @dsj/web build
pnpm --filter @dsj/api build
pnpm --filter @dsj/worker build
```

Current root placeholders:

- `pnpm lint` intentionally exits with a placeholder message.
- `pnpm test` runs database generation and the workspace tests.
- `pnpm verify` runs the stability checks and workspace tests.

## Local Services

PostgreSQL and Redis are defined in `docker-compose.yml`.

```bash
docker compose up -d postgres redis
corepack enable && pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev
```

Default local service URLs from `.env.example`:

```env
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
CORS_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dsj
REDIS_URL=redis://localhost:6379
```

NCALayer is optional for local development. When enabled, the signer machine must run the local bridge and the browser must be able to reach `NCALAYER_BRIDGE_URL`.

## Vercel Web

Recommended project:

- App root: `dsj2/apps/web` relative to the Git repository root.
- Framework: Next.js
- Install command: `corepack enable && pnpm install --frozen-lockfile`
- Build command:

```bash
cd ../.. && pnpm --filter @dsj/database db:generate && pnpm --filter @dsj/types build && pnpm --filter @dsj/ui build && pnpm --filter @dsj/utils build && pnpm --filter @dsj/web build
```

If the Vercel project is configured from the `dsj2` workspace root instead of `apps/web`, use:

```bash
pnpm --filter @dsj/database db:generate && pnpm --filter @dsj/types build && pnpm --filter @dsj/ui build && pnpm --filter @dsj/utils build && pnpm --filter @dsj/web build
```

Required environment:

```env
NODE_ENV=production
APP_URL=https://your-web-domain.vercel.app
API_URL=https://your-api-domain.up.railway.app
COOKIE_NAME=dsj_session
```

Notes:

- `API_URL` is server-side config used by the web app to call the Railway API.
- Add `NEXT_PUBLIC_API_URL` only if a future client-side polling path deliberately calls the API directly.
- Never expose signing provider secrets, eGov credentials, JWT secrets, or encryption keys through `NEXT_PUBLIC_*`.

## Railway API

Recommended service:

- Git root directory: `dsj2`.
- Use the workspace `Dockerfile`, which supplies Python document-generation dependencies and builds the API and worker. Its default command runs `pnpm --filter @dsj/api start:railway`.
- The default command fails closed if `db:deploy` fails. It is not a solution for an empty database with the incomplete historical migration chain.

`apps/api/package.json` maps:

- `build:railway` -> root `build:api:deploy`
- `start:railway` -> root `db:deploy`, then `node dist/apps/api/src/main.js`

Minimum environment:

```env
NODE_ENV=production
PORT=4000
APP_URL=https://your-web-domain.vercel.app
CORS_ORIGIN=https://your-web-domain.vercel.app
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
JWT_EXPIRES_IN=8h
COOKIE_NAME=dsj_session
FIELD_ENCRYPTION_KEY=...
FIELD_HASH_PEPPER=...
```

`JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, and `FIELD_HASH_PEPPER` must each be at least 32 characters and must not be placeholders. Preserve the existing encryption key and hash pepper when connecting to an existing database. Configure signing explicitly only after its deployment path is validated; disable mock and test signing in production:

```env
SIGNING_TEST_MODE=false
SIGNING_MOCK_ENABLED=false
SIGNING_REQUIRE_LEGAL_PROVIDER_IN_PROD=true
ALLOW_PUBLIC_INVITE_MOCK_SIGNING=false
EGOV_MOBILE_QR_ENABLED=false
```

Future legal signing environment is documented in `docs/signing.md`. Do not enable eGov QR in production until provider credentials, callback validation, evidence storage, and production mock refusal are implemented.

Runtime notes:

- API uses the `/v1` global prefix.
- No dedicated `/v1/health` endpoint is present at this Phase 0 checkpoint.
- `CORS_ORIGIN` accepts a comma-separated list of allowed origins. Only add intended origins.
- The Dockerfile installs Python runtime dependencies from `scripts/requirements-runtime.txt` for document generation.
- A bridge URL using `localhost` from a server-side Vercel function points to that function, not the signer's computer. The real three-signature NCALayer flow has not been verified in this deployment.

## Railway Worker

Recommended service:

- Use the same workspace Dockerfile with root directory `dsj2` and override the start command with `pnpm --filter @dsj/worker start:railway`.

`apps/worker/package.json` maps:

- `build:railway` -> root `build:worker:deploy`
- `start:railway` -> `node dist/apps/worker/src/main.js`

Minimum environment:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
FIELD_ENCRYPTION_KEY=...
```

The current worker handles:

- `dsj-compliance`
- `dsj-notifications`
- `dsj-signing-expiration`
- `dsj-signing-callback-reconcile`
- `dsj-work-permit-expiration`

Use an isolated Redis instance with a private `redis://` URL. The worker currently does not configure TLS for `rediss://` URLs. Start the worker only after the correct database schema is ready. Email notification transport is not configured.

## Production Checklist

- PostgreSQL and Redis are provisioned per environment.
- `DATABASE_URL` points to the intended production or AB test database.
- API service starts only after a verified migration strategy has established the correct database schema.
- Vercel `APP_URL` matches the public frontend URL.
- Railway API `APP_URL` and `CORS_ORIGIN` match the frontend URL.
- Vercel `API_URL` points to the Railway API URL.
- `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, and `FIELD_HASH_PEPPER` are strong secrets appropriate for the database and are not exposed to the client.
- Demo seed data is not loaded into production automatically.
- Mock signing remains disabled in production legal flows.
- Worker connects to Redis without errors.

## Minimal Smoke Check

After deploy:

- Login works.
- Employee list opens.
- Briefing journal opens.
- Protocol, responsibility order, and employee document detail pages open.
- Existing NCALayer or mock signing behavior matches the configured environment.
- Evidence package download returns JSON for an envelope with evidence.
- Worker processes Redis-backed compliance/notification jobs without startup errors.
