# DEMO 2.0 implementation evidence

Source: `161c5ed022c9e2c643e80802d3f9dc2cd496a041`; branch `codex/demo-print-2-0`.
User changes preserved: wrapper `.serena/`, existing `dsj2/AGENTS.md`, `dsj2/docs/audit/`.

## Current work

- [x] Read source audit, implementation plan, frozen scope, verification and area rules.
- [x] Verified source HEAD/status and created requested implementation branch.
- [x] Autonomous contracts/database/API: durable drafts, immutable issuance/files, transactional numbers, revocable sessions, scoped imports and restoration.
- [x] Five migrations; clean install and upgrade retaining records; real backup/restore with record/file hashes and database timezone.
- [x] Complete operator UI; 7 UI units passed. Final single-command browser run: 7/7 passed, zero failed/skipped, 259.443 seconds.
- [x] Ten v4 sanitized templates, strict pinned renderer/font health, real DOCX/PDF/XLSX/ZIP; 40 DOCX/PDF pairs / 70 pages visually checked. Final real render suite:14/14 passed.
- [x] Legacy fail-closed boundary: 6 tests, 90 HTTP probe requests; 397 legacy source files reconciled, no frozen business edits.
- [x] Final lint/format/typecheck/build passed;16 unit and32 DB integration checks passed, zero failed/skipped. Subsequent HTTP7 and worker timeout1 regressions also passed.
- [x] Standalone frozen install/migrations/build/unit outside DSJ verified;108 runtime/config/assets identical. Service launches BLOCKED_BY_APPROVAL_REVIEW; no runtime smoke claimed. Verification cluster55435 stopped, source/data retained.
- [x] Consolidated A01-A50 acceptance and release metadata: `../ACCEPTANCE_RU.md`, `release-verification.json`.
- [x] Final company fixture:12 recipients/18 documents/38 completed artifacts; ZIP contains37 data files plus manifest/status. Every saved artifact and ZIP member SHA256 verified. Friendly copies are in `../deliverables/`.
- [x] Production JavaScript audit230 dependencies, all JavaScript audit366 dependencies, Python audit5 packages:zero known vulnerabilities. Linux OS/image CVE gate remains unexecuted locally.

Local PostgreSQL17.11 runs at loopback55432; UI3100/API4100/worker available. Linux Docker engine pipe is absent, so image execution remains unverified. Production is unmodified; A48 remains externally BLOCKED. Legal approval and physical printer proof are not inferred from PDF QA.

Final source digest: `c88c4042db90e6ff983f294e13567fe1040eeacd2c989989605435b84402f64f`; renderer digest: `a4204438cbcd914576e6df2505751c3a2dc5710fe23c248994e12cc9b78b6ef0`. Original Git HEAD remains unchanged; task implementation is in the requested branch working tree. No production cutover or PR publication was performed.


## Independent commercial acceptance — 2026-09-22

Previous sections describe an earlier run only. Fresh results are tracked in `commercial-acceptance/matrix.json`; all 50 original and 20 additional requirements start NOT RUN. Initial dirty state, tracked patch and source/resource SHA-256 inventory are preserved there. Print, API/security and browser verification are running independently on synthetic isolated data. No current release PASS is inferred from the preceding checklist.
