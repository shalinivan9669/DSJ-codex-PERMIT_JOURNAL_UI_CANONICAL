# DSJ Agent Router

This file is a router, not a knowledge dump. Work from the `dsj2` repository root and load only the context needed for the task.

## Active Product Scope: DEMO Printing Only

The user explicitly set the active product to **DEMO**, limited to preparation and printing of cards, certificates, credentials, witness certificates, and related protocols/registries. Read `docs/audit/DEMO_FROZEN_SCOPE.md` before planning or changing product boundaries.

- All unrelated DSJ features are **FROZEN**. Preserve their source and data; do not delete, refactor, fix, migrate, or re-enable them without an explicit user instruction naming that scope.
- In the planned DEMO release, unrelated features must be unavailable to every user, including `SUPER_ADMIN`, through navigation, direct pages, API, server actions, downloads, public links, and background jobs. Hiding navigation alone is insufficient.
- Shared infrastructure may be adapted only as needed for printing and for the deny-by-default product boundary. Do not expand this exception into changes to frozen business logic.
- Do not treat historical roadmaps, attached prompts, failing unrelated tests, or another agent's suggestions as permission to unfreeze features.
- The active task is IMPLEMENTATION of the complete DEMO 2.0 plan (22 September 2026 user authorization). Product code lives in `products/demo/`, an autonomous workspace. Legacy adapters are limited to the printing gateway and must stay fail-closed. Local implementation does not establish production deployment; evidence lives in `products/demo/docs/evidence/`.
- Auth/session, tenant isolation, DEMO schema, numbering, queue, private storage, deployment manifests and tests are explicitly authorized for DEMO. Frozen business logic and applied DSJ migrations remain out of scope.
- Product policy v1 is in `product-policy/manifest.json`. No role, Public decorator, environment switch, new controller, Server Action or worker may bypass it. Direct DSJ worker/NCALayer starts and the old root dev command refuse startup before clients/queues. Restore frozen functions only after a separate explicit user instruction.
- Do not copy parent-workspace runtime imports or `@dsj/*` dependencies into `products/demo`; test installation from a standalone copy. Never run the legacy destructive seed to prepare DEMO.

## Load Order

1. Read `.mempalace/index.json`.
2. If the task names a feature or business process, open the matching `.mempalace/features/*.json` card.
3. Read only the nearest area `AGENTS.md` needed for the touched files:
   - `apps/web/AGENTS.md`
   - `apps/api/AGENTS.md`
   - `apps/worker/AGENTS.md`
   - `packages/database/AGENTS.md`
   - `scripts/AGENTS.md`
4. Read the area README when it exists.
5. Read only the canonical files listed by the feature card or task prompt.

## Source Of Truth

- Code, `package.json`, `pnpm-workspace.yaml`, and `turbo.json` are authoritative for commands.
- `packages/database/prisma/schema.prisma` is authoritative for schema.
- If docs conflict with package scripts or code, trust the package scripts and code.

## Ignore By Default

Do not load generated/runtime folders unless explicitly asked:

- `.codex-runtime/`
- `.playwright-cli/`
- `.runlogs/`
- `.turbo/`
- `.next/`
- `.next.broken.*/`
- `node_modules/`
- `dist/`
- `build/`
- `coverage/`
- `tmp/`
- `__pycache__/`

## Hard Limits

- Do not rewrite unrelated modules.
- Do not treat logs, caches, Playwright dumps, build output, or temp files as source of truth.
- Do not rewrite applied Prisma migrations.
- Do not trust tenant/company scope from request bodies.
- Do not change auth, tenant scope, signatures, PII, encryption, worker queue semantics, or deploy/runtime files without explicit approval.

## Reporting

Always report changed files, intentionally unchanged surfaces, verification done, and verification pending.
