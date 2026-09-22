# DEMO web verification

Final local verification on 2026-09-22: **7 browser scenarios passed in one complete run, 0 failed, 0 skipped, 0 flaky**. It began at 11:03:19 UTC and took 259.443 seconds against the production Next build, real Nest API, PostgreSQL and render worker with an isolated synthetic tenant.

Evidence: [final summary](browser/final-summary.json), [unaltered Playwright result](browser/results.json), [browser environment](browser/environment.json), [visual review and image hashes](browser/visual-review.json).

## Executed checks

| Check | Result |
|---|---|
| Web production build | PASS after final import busy-control fix; Next 15.5.25, type validation included, first-load JS 154 kB |
| Web unit tests | PASS: 7 tests, 0 failed/skipped; serialization, final characters, network retention, no-op, conflict, Unicode/zeros/partial mapping, formula text, structured row-limit errors |
| ESLint apps/web + packages/ui | PASS; production build lint also completed after final two-select change |
| Person flow | PASS, 48.767 s: independent RU/KZ, rotated 3:4 photo and refresh, actual inline PDF, stale preview, last characters in immutable snapshot, original download byte equality, correction |
| Network/concurrent editor | PASS, 3.448 s: failed PATCH retains input, retry saves, second window revision conflict retains its text |
| Company 12/18 | PASS, 169.142 s: 12 recipients, 18 documents, 38 completed files, every SHA-256 verified; all 18 DOCX contain independent RU/KZ and exclude other recipients |
| 101 source rows / 100 applied | PASS, 4.010 s: explicit limit, exclude one, apply 100, refresh, repeated batch creates no duplicates, navigation and no localStorage persistence |
| Keyboard | PASS, 1.220 s: creation, input, validation and finalization; validation focus, six Tab and six Shift+Tab cycles contained in dialog |
| XLSX | PASS, 5.377 s: sheet selection, custom mapping save and reuse after refresh, independent KZ, leading zeros, partial rows, row CSV report |
| Reconstruction | PASS, 25.655 s: failed-download UI, explicit reason, real reconstruction job, original metadata/SHA retained, numbering unchanged |

Local command:

```powershell
$env:DEMO_E2E_CHANNEL='chrome'
pnpm --filter @demo/web exec playwright test -c playwright.config.ts --trace off
```

Ordinary CI command: `pnpm --filter @demo/web test:e2e`. It requires a running isolated stack at web 3100 / API 4100 with synthetic issuer/templates and render worker. No tests skip when infrastructure or the browser is missing.

## Actual files and counts

Company request `da4af342-0781-4d60-87da-ffb486ab6e86`: 12 recipients and 18 documents (12 BIOT worker cards, five individual BIOT protocols, one PS witness). The browser downloaded and saved **18 DOCX, 18 PDF, one XLSX, one ZIP**. Every file matches its API SHA-256. All 37 payload files inside ZIP exactly match the individually downloaded bytes. ZIP has 39 entries including manifest.json and STATUS.txt. The XLSX has 18 data rows plus a header.

- [Complete company ZIP](browser/company-da4af342-0781-4d60-87da-ffb486ab6e86/registry-da4af342-0781-4d60-87da-ffb486ab6e86.zip): 1,878,607 bytes; SHA-256 `a88f6404146848c2b05173f35640f4b30028dd7efd07f2f7c86510aa03fdea0f`.
- [Registry XLSX](browser/company-da4af342-0781-4d60-87da-ffb486ab6e86/registry-da4af342-0781-4d60-87da-ffb486ab6e86.xlsx): 8,283 bytes; SHA-256 `2f6d98ef409c50b1a264aba36cf5ef70c9b2dcb6143137844afac33a13da1fe0`.
- [Individual files, numbers and hashes](browser/company-12-18-result.json), [archive manifest](browser/company-zip-manifest.json).
- [Person evidence](browser/person-result.json): request `c3b192f6-a507-45ab-a9f7-3ae8de82f3a9`, one issuance/document, six artifacts including two preview artifacts.
- [100-row measurement](browser/import-100-timing.json): 2,236 ms from login through new request, preview101, exclude one, apply100, save and reload; zero defaults requests. This is one local workflow measurement, not a general performance guarantee.
- [Reconstruction evidence](browser/reconstruction-ui.json): one reconstructed artifact, original SHA and number retained. The browser GET failure was simulated HTTP503; reconstruction job and metadata checks used the real service. Physical storage-loss recovery is covered by separate backend/operations evidence.

## UI and visual inspection

The workbench uses white/pale blue surfaces, dark ink, restrained teal actions and Segoe UI/system sans. The recipient table sits beside selected document fields, with explicit selection for bulk defaults and a persistent action bar. RU/KZ remain independent. The synthetic tenant forces the test marker and disables its checkbox.

Autosave serializes PATCH with revision checks and flushes latest input before commands. Errors retain local changes. Conflicts offer a copy or server reload. Import exposes source rows, worksheets, tenant mapping presets, partial drafts, limits, exclusions, duplicate-batch detection and CSV reports. Mapping controls remain disabled while worksheet loading is pending. Photo controls expose crop, rotation and print resolution. Downloads show errors inside the editor and offer a separate reasoned reconstruction; history retains original metadata and numbers.

The final run's [1366 desktop](browser/editor-1366.png), [1920 desktop](browser/editor-1920.png), [390 narrow viewport](browser/editor-390.png), [photo crop](browser/photo-crop.png), [company editor](browser/company-12.png), [loaded PDF](browser/pdf-preview.png) and [file history](browser/files-history.png) were visually inspected. The narrow viewport has no document-level horizontal overflow; tables keep local scrolling and finalization actions remain available. The PDF screenshot shows populated native viewer pages, actual text and mandatory test watermark. Visual-review JSON records dimensions and hashes.

## Defects corrected during verification

Real browser checks exposed a structured ROW_LIMIT object rendered as a React child, validation focus scheduled before commit, native dialog Tab escaping, and preset mapping overwritten by a pending worksheet response. These were fixed and the final complete run passed. Company content assertions also detected missing independent KZ in historical BIOT protocol slots; the printing implementation corrected the fallback and all 18 final DOCX passed. Earlier failed-run diagnostics remain separate from the final result.

Provenance: Chrome152.0.7977.83 through Playwright1.58.2, Windows, Node24.16.0. Pinned Chromium extraction did not finish locally, so installed Chrome was selected explicitly. Local traces were disabled after failed-trace teardown hung on this host; PNG/JSON remain available. CI retains pinned browser and trace configuration. External production was not accessed; synthetic checks do not establish deployment or legal form approval.
