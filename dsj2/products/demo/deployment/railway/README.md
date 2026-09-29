# Railway backend for the autonomous DEMO product

Use the current release commit of `dsj2/products/demo`. This directory is the complete Docker build context; the wrapper and frozen DSJ workspace must not enter the image. The Vercel frontend is a separate release of the same commit.

The backend service runs two existing processes: Nest API and the render worker. Both use the same PostgreSQL queue, immutable snapshots and private filesystem at `/data/artifacts`. Both need Python and LibreOffice: the API performs render preflight, while the worker produces issued files. The service exposes only the API on Railway's `PORT`; there is no public directory for stored files.

## Service configuration

| Setting                 | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Source branch/commit    | Current release branch, pinned release commit recorded in release evidence                          |
| Root Directory          | `/dsj2/products/demo` for the wrapper repository                                                    |
| Builder                 | Dockerfile                                                                                          |
| Dockerfile path         | `deployment/Dockerfile` relative to that root                                                       |
| Final image stage       | `railway` (the last stage; no target override is needed)                                            |
| Start command           | Leave unset, preserving Docker CMD `node deployment/railway/start.mjs` and the Tini entrypoint      |
| Healthcheck             | `/health`, startup timeout 300 seconds                                                              |
| Replicas                | Exactly 1                                                                                           |
| Serverless/app sleeping | Disabled, because a persistent worker polls the queue                                               |
| Restart policy          | On failure                                                                                          |
| SIGTERM draining period | At least 60 seconds; supervisor allows 45 seconds before killing remaining process groups           |
| Volume mount            | `/data` on this backend service; persistent, private                                                |
| Database                | A dedicated DEMO PostgreSQL service in the same Railway project/environment; use private networking |

Do not create independent Railway API and worker services with separate volumes: files created by one would be absent for the other. Do not import the existing Compose topology assuming its named shared volume becomes a shared filesystem across Railway services. The image retains explicit `runtime`, `worker` and `web` stages for the existing Compose deployment.

Railway's current documentation says new services cannot opt into legacy `railway.json` / `railway.toml`; legacy support ends on 2026-12-01. Therefore this release supplies settings for the dashboard/CLI rather than an obsolete auto-discovered manifest. If adopting Railway IaC, first import/review the exact target project graph and preserve unrelated resources; the repository does not invent a project identity or an incomplete graph whose apply might delete existing resources. [Railway IaC](https://docs.railway.com/infrastructure-as-code), [Dockerfiles](https://docs.railway.com/builds/dockerfiles).

## Environment variables

Set service secrets directly in Railway. Do not commit credentials, copy local test tenants, or expose these variables with `NEXT_PUBLIC_` prefixes.

| Variable                                       | Required setting                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                 | Private reference to the dedicated Postgres service, e.g. `${{Postgres.DATABASE_URL}}` after confirming its actual service name |
| `DEMO_ORIGIN`                                  | Exact canonical HTTPS origin of the public Vercel frontend, without trailing slash/path; identical to the frontend setting      |
| `DEMO_ARTIFACT_ROOT`                           | `/data/artifacts` (already set by the image)                                                                                    |
| `RAILWAY_VOLUME_MOUNT_PATH`                    | `/data`, provided by Railway when the volume is attached; do not fake the variable without a volume                             |
| `PORT`                                         | Railway-provided listening port; defaults to 4100 only outside Railway                                                          |
| `HOST`                                         | `0.0.0.0`, already set by the image                                                                                             |
| `NODE_ENV`                                     | `production`, already set by the image                                                                                          |
| `DEMO_PRODUCT_ID`                              | `demo-product`, already set by the image                                                                                        |
| `DEMO_RENDER_CONCURRENCY`                      | `2` initially; existing supported range 1–4. Increasing it needs measured memory/CPU capacity                                   |
| `DEMO_PYTHON`                                  | `python3`, already set by the image                                                                                             |
| `DEMO_SOFFICE`                                 | `/opt/libreoffice26.2/program/soffice`, already set by the image                                                                |
| `DEMO_PG_DUMP`, `DEMO_PG_RESTORE`, `DEMO_PSQL` | PostgreSQL 18 utility paths already set by the image; review server/client major versions before backup/restore                 |

Use an appropriate memory/CPU allocation for concurrent API preflight and rendering; a lightweight HTTP-only service limit is not sufficient. Existing Compose limits are 2 GiB for API and 3 GiB for a worker, not a measured minimum for the combined Railway service. Confirm allocation with a real render and resource metrics before advertising throughput.

Railway mounts volumes as root at service start. The image starts its supervisor as root only to create and assign the top-level `/data` and `/data/artifacts` directories to UID/GID 1000, then permanently drops privileges before starting either process. It refuses a missing mount, a symlinked storage root, an unexpected owner or a noncanonical HTTPS origin. It does not recursively change existing files. Existing data must already have the correct ownership. Administrative storage writes must use the same UID helper below. [Railway volume permissions and lifecycle](https://docs.railway.com/volumes), [volume limitations](https://docs.railway.com/volumes/reference).

## Migrations and initial setup

The supervisor never migrates, seeds, provisions an account or approves templates during normal startup. Select and authorize the exact database/environment before running these commands. They are not executed by adding this documentation.

1. After database backup/target verification, configure Railway's **pre-deploy command** as `pnpm db:deploy` for that selected service. This invokes existing Prisma `migrate deploy` against only `packages/database/prisma`. Do not use `db push`, migration reset or legacy DSJ seeds. Railway runs pre-deploy in a separate container without the `/data` volume; database migrations are suitable there, template installation is not. [Pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command).
2. Attach the private volume and start the backend. `/health` is a liveness endpoint and does not prove tenant/template readiness.
3. For a new DEMO tenant, provide `DEMO_ADMIN_EMAIL`, a private `DEMO_ADMIN_PASSWORD` of at least 12 characters, and `DEMO_TENANT_NAME` only for explicit provisioning. Use `DEMO_SAMPLE_DATA=0` for real setup; do not label synthetic issuer data approved for production.
4. In a Railway shell **inside the running backend container**, run `node deployment/railway/start.mjs -- pnpm run setup`. The helper enforces the mounted volume and runs setup as the same UID as API/worker. Running local `railway run pnpm setup` would execute on the local host and write files to the wrong filesystem. Do not run setup as root via a bare `pnpm setup` in the container.
5. Remove one-time provisioning variables after use. Install/approve actual issuer profile and template versions through the existing authorized process. `DEMO_SAMPLE_DATA=0` deliberately does not provide a legally approved issuer profile.
6. Log in through Vercel and check authenticated `/api/ready`: database, fresh renderer heartbeat, all 11 tenant templates and storage checksums must pass. `/ready` remains authenticated; no healthcheck auth bypass is added.

Postgres and `/data` need coordinated backups. Railway volume snapshots alone do not prove a consistent database-plus-files recovery point. Use the existing `deployment/backup.mjs` maintenance-lock workflow and test recovery into a separate environment. Store backup copies outside the source database/files volume. Preserve old source templates and issued snapshots; rollback a code release without undoing committed issuance history.

## Acceptance before calling the release deployed

- Record the exact commit, Railway deployment ID, Docker build success and Vercel deployment ID.
- Confirm API and worker startup, durable mount, correct UID, authenticated readiness and the production origin/cookie path.
- Create a designated test request through the deployed UI; validate, preview, explicitly finalize and download DOCX/PDF plus exports. Verify content and hashes.
- Restart/redeploy the backend, then download the same issued artifact again and compare its SHA-256. Both metadata and bytes must persist.
- Check Vercel's current upload/download limits against the frontend proxy path, including a ZIP larger than a serverless response limit; backend availability alone does not prove that delivery path.
- Anonymous private downloads must remain denied; cross-tenant access must remain denied; frozen DSJ routes must remain absent.

Railway does not perform ongoing monitoring through its deployment healthcheck, and a volume service has a deployment interruption rather than overlapping mounts. Configure separate monitoring for ongoing operation. [Railway healthchecks](https://docs.railway.com/deployments/healthchecks).

Local checks for the startup module are `node --test tests/deployment/railway-start.test.mjs`, `node --check deployment/railway/start.mjs` and the product autonomy verifier. These do not replace a Linux image build, cloud startup, volume persistence, signal handling under Tini or a real render in the deployed environment.
