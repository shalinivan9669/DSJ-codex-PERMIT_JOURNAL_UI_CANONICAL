# DEMO frontend on Vercel

This configuration deploys only the autonomous Next.js frontend and its existing same-origin API transport. The Nest API, PostgreSQL, private artifact store and render worker belong to the separately configured Railway deployment. No DSJ legacy runtime, migrations, setup/seed command or renderer runs during the frontend build.

## Project settings

| Setting                                                 | Value                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Root Directory, when importing this full Git repository | `dsj2/products/demo/apps/web`                                                                            |
| Framework                                               | Next.js (`nextjs`)                                                                                       |
| Include source files outside Root Directory             | Enabled; required for `products/demo/packages/contracts`, `packages/ui`, workspace manifest and lockfile |
| Node.js                                                 | `22.x` (within the autonomous workspace's `>=22.16 <25` range)                                           |
| Install Command                                         | `cd ../.. && corepack pnpm install --frozen-lockfile --filter @demo/web...`                              |
| Build Command                                           | `cd ../.. && corepack pnpm --filter @demo/web build`                                                     |
| Output Directory                                        | Next.js default; no override                                                                             |
| API transport                                           | Vercel external rewrite; the platform's proxy timeout is 120 seconds                                     |

The checked-in `apps/web/vercel.json` supplies framework/install/build settings. Root Directory and outside-source access remain project settings. Both commands change into **products/demo**, so Corepack reads its exact `pnpm@11.27.1` package-manager pin and its own lockfile. Automatic detection from the outer DSJ repository can choose the wrong workspace. The frontend has no database dependency and does not need `db:generate`, `db:deploy` or the product-wide `pnpm build` command.

On Vercel, Next's `output` and `outputFileTracingRoot` use the platform defaults. The Vercel builder supplies the repository tracing root to Next; overriding it with the nested `products/demo` directory makes `relativeAppDir` resolve from the wrong root during server packaging. Local/self-hosted builds retain the autonomous product tracing root and standalone output. The regression test loads the actual Next config in both environments and verifies the resulting roots. Sources: [Vercel builder environment](https://github.com/vercel/vercel/blob/main/packages/next/src/index.ts), [server-build path resolution](https://github.com/vercel/vercel/blob/main/packages/next/src/server-build.ts), [Next output tracing](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output).

For a deployment archive containing only the autonomous `products/demo` directory, the corresponding Root Directory is `apps/web`. Do not upload only `apps/web`; that omits its workspace dependencies. Prefer a cloud source build from the verified commit. The local Windows `.next-operator-complete` standalone output is local acceptance evidence, not a Vercel Build Output API package.

Sources: [Vercel monorepos](https://vercel.com/docs/monorepos), [outside-root source access](https://vercel.com/docs/monorepos/monorepo-faq), [build settings and Corepack](https://vercel.com/docs/builds/configure-a-build), [package-manager selection](https://vercel.com/docs/package-managers), [proxy timeout](https://vercel.com/docs/limits#proxied-request-timeout). Reviewed 2026-09-29.

## Environment variables

| Name                           | Scope and value                                                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_EXPERIMENTAL_COREPACK` | Build: `1`, so the pinned package manager is available.                                                                                                                                                                                                                 |
| `DEMO_ORIGIN`                  | Runtime: the one canonical **frontend** HTTPS origin, e.g. `https://demo.example.com`, with no trailing slash or path. Set exactly the same value on the Railway API.                                                                                                   |
| `DEMO_API_ORIGIN`              | **Build and runtime**, server only: publicly reachable Railway API HTTPS origin, e.g. `https://demo-api-production.example.up.railway.app`, with no `/api` path, credentials, query or fragment. It is compiled into the external rewrite; change requires a new build. |
| `NEXT_TELEMETRY_DISABLED`      | Optional build: `1`.                                                                                                                                                                                                                                                    |

Vercel supplies `VERCEL=1`, which enables the external API rewrite. A missing or invalid `DEMO_API_ORIGIN` fails the build instead of using localhost. Railway private `*.railway.internal` hostnames are not reachable from ordinary Vercel proxy infrastructure. `DEMO_EXTERNAL_API_PROXY=1` is an optional local parity-test switch; it permits an explicit HTTP loopback upstream outside Vercel. It is not needed on Vercel, where HTTPS is mandatory.

Do not configure `DEMO_NEXT_DIST_DIR` on Vercel: it is a local concurrent-build override. `DEMO_API_URL` remains a compatibility fallback only for the default local route handler; the Vercel rewrite requires `DEMO_API_ORIGIN`. There are no required `NEXT_PUBLIC_*` settings. Database URL, admin password, tenant provisioning inputs, artifact filesystem paths and Python/LibreOffice settings belong to the backend, not this frontend. Tracked TypeScript config includes only canonical `.next/types`; custom `.next-*` acceptance output and generated next-env references must not be committed.

`DEMO_ORIGIN` is deliberately a single exact origin. An arbitrary generated preview URL cannot write to an API configured for the production frontend origin. Use the canonical production alias for production acceptance. If a functional preview is required, pair its fixed frontend origin with a separate backend environment configured for that exact origin; do not broaden the existing checks to wildcard Vercel domains. Changing the canonical origin also affects backend-issued verification/QR links and invitation URLs, so coordinate it before issuing documents.

## Preserved transport and security behavior

Browser requests remain relative `/api/...`. On Vercel, `next.config.ts` emits a `beforeFiles` rewrite from `/api/:path*` to the validated fixed Railway HTTPS origin. This takes precedence over the local catch-all route handler. The browser stays on the frontend domain; this is a reverse proxy, not a redirect or a new cross-origin auth surface. Destination is build configuration, never request data. [Next.js rewrite order](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), [Vercel external origins](https://vercel.com/docs/routing/rewrites).

`middleware.ts` excludes `/api` to avoid its own 4 MB body limit. The API already applies the same DEMO allowlist before body parsing and authentication, and rejects frozen routes and `next-action` replay independently of frontend middleware. It retains exact write-origin checks, session/tenant authorization, CSRF, JSON/file limits and `Cache-Control: no-store`. Web pages remain guarded by middleware. In default local/self-hosted mode, the existing catch-all route handler still applies its own allowlist, origin and bounded-body checks before forwarding.

The API returns `demo_session` (HttpOnly) and `demo_csrf` cookies with `Path=/`, `SameSite=Strict`, and `Secure` under `NODE_ENV=production`. They have no Domain attribute. Both transport modes preserve separate `Set-Cookie` headers, so the browser stores them on the frontend host. Origin, cookie, CSRF and idempotency headers pass through unchanged. Keep backend `NODE_ENV=production`; do not redirect login or authenticated file downloads to the Railway host. No additional CORS policy is needed for this same-origin browser path.

External rewrites relay the API's no-store and private-file response headers. No CDN cache opt-in is configured. Rendering remains queued on Railway and is not moved into a frontend function. Vercel's external proxy timeout is 120 seconds; the default local route-handler upstream timeout remains 60 seconds. Backend rate-limit behavior behind the deployed proxies needs live confirmation; no trust-proxy or client-IP authorization changes are introduced here.

## Platform size limits and release checks

Vercel Functions have a **4.5 MB request-body limit** and Routing Middleware has a **4 MB limit**. API uploads and downloads therefore use the external rewrite, bypassing both compute paths. DEMO's backend retains its 2 MiB JSON and 5 MiB photo/import limits. No product limit is silently reduced. [Function limits](https://vercel.com/docs/functions/limitations), [middleware limits](https://vercel.com/docs/routing-middleware).

The maintained local parity script `pnpm exec tsx --tsconfig tsconfig.base.json scripts/verification/vercel-transport.ts` starts an isolated real Next.js server with the actual rewrite configuration and a synthetic upstream. It checks the bytes of a 5 MiB multipart upload and 6 MiB response, Origin/cookie/CSRF/idempotency preservation, two production cookie headers, no-store and rejection using the actual backend origin/route policy helpers. It does not write to a database or prove Vercel's cloud routing. Verify the same size boundaries through the actual deployment, including byte length and SHA-256; small files or local success alone are insufficient.

After deploy, retain the deployment ID, source commit and canonical URL, then verify from that canonical frontend origin:

1. `/login`, loaded JS/CSS, `/api/health`, and anonymous protected-route rejection; unknown/frozen paths remain 404.
2. Real login, both cookies, session reload, valid CSRF write, rejected wrong-origin/write-without-CSRF, and logout. Confirm cookie values are not recorded in public evidence.
3. A synthetic draft edit/save/reload and a valid photo/import file between 4.5 MB and the 5 MiB product limit. Confirm backend rejection over its own limit.
4. Validation and queued preview on the Railway worker, authenticated PDF viewer, PDF/DOCX/XLSX/ZIP downloads and matching hashes; include one file above the platform's buffered-response size.
5. Only with an approved synthetic issuance fixture, explicit issuance and immutable reopen. Deploying a frontend alone does not establish backend/database/worker readiness or immutable-document correctness.

No cloud deployment is claimed by this file. Local product tests/build and cloud end-to-end acceptance are separate evidence.
