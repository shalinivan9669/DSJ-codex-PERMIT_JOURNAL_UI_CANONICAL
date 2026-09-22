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

### Independent commercial acceptance — current checkpoints

The user committed the in-progress work as `3ad8e6bb5aba016df01da8f387c1bbe19a93011f`; the initial `161c5ed` baseline remains historical evidence. Final uncommitted changes will be bound to a fresh manifest.

Fresh API integration: 41/41; contracts: 7/7. Fresh browser: 14/14, plus final-card/settings focused checks. Root code unit check: 10/10 + 7/7 web. Subsystem results are merged into the working matrix with their scope and limitations.

Actual Linux build uncovered missing LibreOffice shared libraries and actual non-root nginx startup uncovered missing writable fastcgi/uwsgi/scgi temporary directories; both causes were fixed. Dedicated engine DNS required the missing host iptables dependency; restart and `db` DNS readback confirmed repair. Existing user Docker data were not reset. First container HTTP issuance completed four artifacts with exact hashes in 7.052 s (exploratory renderer3/v7, not final load proof).

Actual Word control opens original source but rejects sanitized v4/output. Pairwise probes show two required fixes: undefined mc:Ignorable prefixes and empty typed metadata. Word packaging correction is in progress; earlier LibreOffice PASS does not prove Word compatibility.

User clarified that upper bands carry the issuing company. Their removal is superseded: restore the dynamic issuer name in a readable bounded upper strip, with new layout/Word/PDF acceptance. Do not present the earlier strip-free v7 images as final user-approved output.

Actual image CVE scans found fixable vulnerabilities missed by npm-only audit. Product pnpm updated to10.34.5; redundant older web tsx removed. OS, PostgreSQL and nginx images are under fresh build/scan; no final security PASS yet. Hosted CI unavailable through current unauthenticated gh CLI; no claim that YAML jobs ran.

Independent real storage fault drill passed on non-root Linux with a dedicated 32 MiB tmpfs and demo_test_storage_20260922_b. Actual ENOSPC after 18,968,576 filler bytes and actual EACCES both produced authenticated readiness503/STORAGE_NOT_READY, no published artifact during fault, real worker retry and recovery to readiness200. All four recovered artifacts per case downloaded twice with matching hashes; issued documents and numbering sequences unchanged. Earlier 8 MiB provisioning failure preserved separately (templates require approximately14 MiB); no host disk was filled.

Independent backup/restore passed on dedicated PostgreSQL18.6 databases and three fresh private volumes: 25 table row hashes/counts,16 private files,38 template/font/resource files; one photo and10 template versions. Measured backup4.980s, restore plus reconciliation3.489s on this local synthetic fixture. All DOCX/PDF/XLSX/ZIP originals downloaded twice through the restored HTTP application; photo downloaded/hash matched. Earlier malformed CRLF test credentials caused the HTTP harness400 and were preserved as a harness failure, then corrected and rerun against entirely new databases/volumes. These local measurements are not production RTO/RPO commitments.

User-requested imagegen portrait was generated and saved under commercial-acceptance/generated-photo, then uploaded through the real browser to a separate synthetic PB issuance on the isolated8080 stack. Crop, refresh, preview, issuance, six downloads/hash comparisons and exact embedded normalized-photo bytes passed; both PDF pages and the downloaded Word document were visually checked. Historical source and user inputs remain intact. Windows3200 stays available for the user's review.

Remaining final acceptance is in progress: Word-vs-LibreOffice layout corrections, PS100 converter timeout, pnpm bundled dependency security remediation, final load measurements and complete source/evidence manifest. Current individual passing drills do not constitute a blanket commercial readiness statement.

## 2026-09-22 — independent final checks and repository hygiene

Three gitignore files now exclude build/cache/private runtime and generated binary evidence. Explicit index-only cleanup removed657 tracked generated files (318298810bytes); all remain on disk,37rulechecksPASS,trackedignored0. Source fixtures/templates/fonts preserved.

Current print matrix96/1394recipients/1830PDFpagesPASS; manual84basepages+186selectedstresspages SHA reconciliation completed. Word20/20currentDOCX(28pages)PASS. Final Linux source candidate r4 has205files, SHA6886a94802289d3e9c4086a1d1cf1e8283bce8b8431681c5cecfef31f2b47602. Production readiness not declared: final API image, HTTPS cycle, repeated load/resource measurements and image review remain in progress. Local3200oldrenderer3 discovered and bounded update prepared, preserving user data and Next process.

### 2026-09-22 — current r5 evidence and user BIOT refinement

- r5 source210files SHA93a82ecaa4d14e647dd03e3c6820c298844c2a457f0abbecd9d209ac00e6a131: API399a6212...,web3eb90b05... built outsideDSJ and actually deployed localTLS. lint/typecheck17unit/42integration/fresh+upgrade migrations PASS.23render+6XML separate suites PASS. Word20/28 and full96print/1394recipients/1830pages revalidated;84base+186selectedstress pages manually covered.
- Gitignore final665 index-only removals,320664555bytes retained on disk,41rulechecksPASS. Data/source/migrations/assets remain.
- load-final actual14runs503recipients/1034artifacts pass issuance/download SHA with0retries. Serial100 total109.643–122.927s, concurrent10+10 total22.451/23.521s. Resource telemetry FAILED(lowercase kB unsupported),0samples; corrected collector+2regressions PASS, resource retest required. Historical failing telemetry evidence retained.
- New photo decoder finding: non-PNG/JPEG was passed to Sharp.metadata before format rejection. Source pre-decoder signature fix and before/after regression prepared; r5 image does not yet include it, next image required.
- User explicitly clarified workers and managers/ITR,1year vs3years and different hours. Official new2026order223 source downloaded from zan.gov.kz/api/documents/225864/rus/download/pdf,56pages,SHA864c4ceac4ceb06e3bb385f229491da2ab2366e91c032424807991dbfed07c3d. Confirmed worker10academic theory+16production hours separately; responsible category hours16/40/etc and exceptions. Optional backward-compatible category fields/UI presets being implemented; original snapshots remain immutable. Normative form mapping in progress; no external ECS registration fabricated.
- Native29license roottexts now collected, corresponding-source/relink/full Rust attribution obligations remain distinct; client-only fulltext provenance unresolved. No unconditional distribution approval asserted.

## 22.09.2026 — остановка проверок по просьбе пользователя

Пользователь остановил все проверки и разрешил закончить уже начатые изменения. Агенты остановлены; новых сборок, Word/LibreOffice-прогонов, браузерных сценариев, нагрузочных тестов и сканирований не запускали. Рабочие web/API/worker, БД и Docker Engine сохранены. Завершается только согласованность исходников категорий БиОТ, нового протокола ИТР и четырёх новых шаблонов; их итоговая проверка — NOT RUN. Предыдущие PASS относятся исключительно к записанным прежним версиям. Коммерческая приёмка не завершена.

По отдельному запросу пользователя очищен индекс Git: правила docs/evidence теперь исключают также логи, JSON/CSV результатов, временные скрипты аудита и отчёты отдельных прогонов. В Git остаются журнал и сводная матрица. Дополнительно исключён 291 ранее отслеживаемый служебный файл; суммарно 956 файлов удалены только из индекса, включая 205 изображений. Все 956 файлов сохранены на диске. Отслеживаемых файлов, попадающих под .gitignore, осталось 0. Исходные шаблоны, шрифты, лицензии, fixtures и safe env examples остаются доступны для версионирования. Staged deletions будут видны в diff до коммита; история Git не переписывалась.
