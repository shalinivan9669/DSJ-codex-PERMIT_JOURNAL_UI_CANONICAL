# Web App

`apps/web` owns the Next.js App Router frontend for DSJ. It contains admin/company workflows, employee self-service pages, server actions, auth redirects, route-level data loading, and `app/api` proxy routes for backend downloads and helper endpoints.

## Repo Context

`apps/web` is the presentation layer for the current compliance contour.

Current account contours:

- `COMPANY_ADMIN` / `SAFETY_ENGINEER` -> `/dashboard`
- `EMPLOYEE_SIGNER` -> `/my-instructions`

Current boundary:

- do not add new auth roles here
- keep director, safety engineer, and shop chief as personas or capabilities inside the existing admin contour
- keep employee self-service separate from the admin contour

Read first:

- `../../README.md`
- `../../docs/context/start-here-for-codex.md`
- `../../docs/context/current-product-status.md`
- `../../docs/signing.md` when touching signing, provider selection, QR polling, NCALayer, evidence downloads, or signature history UI

## Route Groups

- `app/(app)` - authenticated product shell, dashboard, companies, departments, contractors, employees, journal, documents, certificates, compliance, protocols, responsibility orders, training, testing, correspondence, audit, and employee self-service pages.
- `app/login` - login entry point and seed-access copy.
- `app/invite/[token]` - public invite flow for briefing signing.
- `app/api` - proxy routes and web-side helper endpoints. Preserve status, headers, content type, and binary bodies when editing these routes.

Current route surfaces include:

- admin/detail flows for `journal`, `protocols`, `orders/responsibility`, `certificates/biot-experimental`, and `training/regulations-prototype`
- employee self-service flows for `my-instructions`, `my-training`, `my-testing`, `my-documents`, and `my-certificates`
- proxy downloads under `app/api` for briefings, company documents, correspondence, documents, certificates, responsibility orders, protocols, BIOT card generation, translation helper, and document-envelope evidence packages

## Signing UI

Current signing UI uses the shared `SigningForm` and the active server-side signing runtime:

- `MOCK_NCALAYER` for explicit local/demo fallback paths
- `NCALAYER` for the local NCALayer bridge flow

The briefing journal now uses generic signing sessions for employee eGov Mobile QR and in-person tablet signing. Instructor signing remains an NCALayer-only computer flow. Production eGov transport still requires the official Smart Bridge technical passport and credentials described in `../../docs/signing.md`.

When adding the roadmap UI:

- reuse existing protocol, responsibility-order, employee-document, briefing, and employee self-service pages;
- keep server components responsible for loading document/signing state;
- use same-origin `app/api/*` proxies only when client-side polling needs them, and preserve status, headers, content type, and binary bodies;
- never expose provider secrets, raw CMS payloads, raw provider responses, or full employee identifiers in browser payloads;
- keep evidence downloads behind existing authenticated proxy patterns.

## Key Responsibilities

- Use `getCurrentSession`, `requireSession`, and `requireRoleAccess` for route gates.
- Use `apiFetch` for server-side calls into `apps/api`.
- Use `resolveCompanyContext` and `CompanySwitcher` for company-scoped pages.
- Keep UI and server contracts aligned with `@dsj/types`.
- Keep authorization and tenant enforcement on the server; client validation is only a usability layer.

## Product Boundary Reminder

- Reuse the existing admin contour first.
- Keep employee work in the self-service contour.
- Do not split briefing or document flows into parallel stacks on the client.

## Environment

Web-side variables used by current code:

- `API_URL` - backend API base URL. Required for production builds.
- `COOKIE_NAME` - auth cookie name, defaulting to `dsj_session`.
- `SIGNING_PROVIDER`, `NCALAYER_BRIDGE_URL`, `NCALAYER_BRIDGE_TIMEOUT_MS`, `SIGNING_TEST_MODE` - server-side signing configuration mirrored for web signing UI and route behavior.
- `SIGNING_PROVIDER_DEFAULT`, `SIGNING_MOCK_ENABLED`, `SIGNING_REQUIRE_LEGAL_PROVIDER_IN_PROD`, `NCALAYER_ENABLED`, `EGOV_MOBILE_QR_*`, `SIGNING_SESSION_TTL_SECONDS`, `SIGNATURE_EVIDENCE_*`, `SIGNATURE_HASH_ALGORITHM` - planned generic signing/session/evidence settings; do not expose provider secrets with `NEXT_PUBLIC_*`.
- `NEXT_PUBLIC_ENABLE_LOCATOR` - optional development locator integration.

`APP_URL` belongs to cross-service deployment configuration and is documented at the repo root.

## Local Development

Run from the repo root unless you intentionally filter to this package.

```bash
pnpm dev
pnpm --filter @dsj/web dev
pnpm --filter @dsj/web typecheck
pnpm --filter @dsj/web build
```

For deployment-style web builds from a clean environment, generate Prisma and build shared packages first:

```bash
pnpm --filter @dsj/database db:generate
pnpm --filter @dsj/types build
pnpm --filter @dsj/ui build
pnpm --filter @dsj/utils build
pnpm --filter @dsj/web build
```

For full monorepo validation use `pnpm verify`.

## Verification Checklist

- Touched route renders or redirects as expected.
- Main happy path for the changed page/action is smoke-checked.
- Auth and company context still route through existing helpers.
- Binary proxy routes preserve headers and body.
- `pnpm --filter @dsj/web typecheck` and build are run when frontend source changes.
