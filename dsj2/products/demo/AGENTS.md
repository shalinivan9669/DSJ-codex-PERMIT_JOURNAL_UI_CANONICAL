# DEMO printing product

This is an autonomous Next/React + Nest/Prisma/PostgreSQL + Python workspace. The implementation request dated 2026-09-22 authorizes its auth, tenancy, schema, numbering, durable queue, storage and deployment changes. Preserve user changes and legacy DSJ data.

Only printing BIOT/PTM/PB/PS and its customers, recipients, requests, immutable issuances, files, auth, settings and operations belong here. Never import `@dsj/*`, paths outside this directory, old controllers/actions/workers, LMS, signing, journals, permits, correspondence or notifications. Frozen code may be restored only by an explicit user request naming it.

Tenant comes from the session. Deny unknown routes before auth. Server assigns numbers transactionally; history and artifacts are immutable. No production migrations or cutover without environment-specific authorization. Use disposable databases for tests; no destructive seed or db push. Do not silently skip required tests.

Keep `docs/evidence/progress.md` and the acceptance matrix current with measured evidence. PASS means executed, never planned. Production boundary and legal approval are separate from local engineering verification.
