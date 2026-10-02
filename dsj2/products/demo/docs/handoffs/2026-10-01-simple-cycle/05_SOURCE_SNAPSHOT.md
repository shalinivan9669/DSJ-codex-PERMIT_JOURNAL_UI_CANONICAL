# Контрольный снимок файлов и Git

Снят 2026-10-01T18:53:10.416Z. Branch `codex/first-live-iteration`, HEAD `0a44022e7962f32fef4b0d03edb18349ad2ef0b9`.

Хеши фиксируют существующие bytes на момент передачи. Это не patch и не backup: исходники остаются в указанном worktree. Статус объединяет предшествующую работу и изменения текущего чата; нельзя считать каждый файл результатом последней доработки. После передачи возможны дальнейшие изменения пользователя. Секреты и содержимое приватного config не читались для упаковки.

| Файл относительно products/demo | Bytes | SHA256 |
|---|---:|---|
| `apps/web/components/editor.tsx` | 74664 | `09fc0311ef1d7b392c4e08bf3ddd5622b7afd8e8866287290488f0c1076a6fe2` |
| `apps/web/components/approvals.tsx` | 20906 | `989567caa69b95f672c82f1730bd133b39cc7a109cefa793005461fe1230aa51` |
| `apps/web/components/recipient-details.tsx` | 74721 | `eeadcce02aaabb68ff43bc58f0e613f0aeea92629ba1452860f25a60e7bce8ec` |
| `apps/web/components/recipient-grid.tsx` | 10828 | `b05bedde9b1a9617b05d4b33b3379aa6d9cea1a27fbda063ba60c9bfa96e018e` |
| `apps/web/components/recipient-grid-row.tsx` | 10670 | `5fd54f601146e219d31cbea6b629b40bf31a2c7d5d3c4b0fb293261e6ffa6bff` |
| `apps/web/components/recipient-grid.css` | 7635 | `362614b837b09581e2b27f6f7cdd2b43639e0cf01539a265c3190ae438ee47cd` |
| `apps/web/components/event-context.tsx` | 41787 | `f328d3e28a8252a8220d5e600d8a934bad4a092551039816cb29193b3c1094dd` |
| `apps/web/components/customer-review.tsx` | 20770 | `b6ac4e9389d5342dfd237dfb100d3608ea78f6bbdcc5422a5f805019cb747d2a` |
| `apps/web/components/customer-output.tsx` | 28055 | `f5e78ab6fd431447139c7511ff21255c279dc8914c4834bcb3ddc928cb67d278` |
| `apps/web/components/request-operations.tsx` | 11271 | `6fda1d892e8b784a6849373b65fd7e65514dd41dc87a429581aa94be26186bcd` |
| `apps/web/components/files-panel.tsx` | 28055 | `7ef751a7cc75b8a4f8c069f30808ee4d1076013975bc3a0e60663ad7e038fd10` |
| `apps/web/components/request-list.tsx` | 13451 | `23d8b9e038a5581b72823bd0783898e9283a77b34bcf49c923e6316122689186` |
| `apps/web/lib/types.ts` | 5652 | `2b09801b44b4348c81b66c5163172f0bdc359bb8b87f34d8cd70500d57755fff` |
| `apps/web/lib/request-actions.ts` | 1201 | `784b39c0a7f39594b0ac033f8d7cfc3ab4583c34923553fa205b4623720dd592` |
| `apps/web/lib/validation-errors.ts` | 825 | `894cae7d08b5e0c47c05cc282bc305c10b95c5d816f94fd406604d8e1539963f` |
| `apps/web/lib/training-assignment-edit.ts` | 2017 | `7c3deb2302e9ce51279010fc31315e62da09e71dd49eccb75a7847cfc4e3348b` |
| `apps/web/app/first-live-iteration.css` | 4381 | `e6981a2ba81f21dcd93240b5f02d5da39cc63597c497efac8a8f0f41c1f5bc5a` |
| `apps/web/test/request-actions.test.ts` | 6154 | `2558fd60324470942470b4e2b30fe61fa2f03837deba611ff906d40ab51d6aa0` |
| `apps/web/test/compact-entry.test.ts` | 1380 | `8a0a4114a43f508d2532a28c63f50fe58f75e9c058919f44e536dd185f22dd34` |
| `apps/web/test/training-assignment-edit.test.ts` | 5646 | `e222c9f5fce78a0f1df79f2482b90cb75e5d6e146152b7c7bc6a11ed4810fd5f` |
| `apps/api/src/approvals.ts` | 20478 | `99006010a860fbd1aa617546afbcfdc7b2f9011ab865087983f591a74c2d5e2d` |
| `apps/api/src/requests.ts` | 73825 | `ac92da6b6d2cf59be9e68cc42caac039a6bb21e6e22a4c6ec13230fa0c1b43dc` |
| `apps/api/src/request-customer.ts` | 799 | `40b876e3d9643e0b71ed2e22ea3d5d43381e7553fcc42eb97d5994d4faa5c6fe` |
| `apps/api/src/files.ts` | 34290 | `61ec2e1578612e48dc1cdc44ece6c41cde6adbeeb8a1dd9f96f4af3483c7e9a8` |
| `packages/contracts/src/resolution.ts` | 13385 | `6419ab55d2c04e3ec79924ba940bc045963335a0098a55f24b4b8e58fe30a0c4` |
| `tests/resolution.test.ts` | 6179 | `65a55bb79dc730f88993e91b671e4a1347fdb616c6a9e55adbb314df19c72347` |
| `tests/request-customer.test.ts` | 6282 | `fcd415f0168b572502349cdacac50e1133f2eaf240b2fdd8083c90fae553e4d7` |
| `tests/approval-data-readiness.test.ts` | 5704 | `108e514e9f7a622896d5ccc1137505174038636cdc685a897092775d19227446` |
| `tests/approval-signing-contracts.test.ts` | 4816 | `827aabcfe527c221189c8d8c3e4f37bb0b2faa12df7158bddb0b7e3f1487197b` |
| `scripts/render/renderer.py` | 59737 | `929d624adfca2284e76b16efb6e19c7fb8bc11a7b589623acdd22677f9a2fa8f` |
| `tests/render/test_render.py` | 32099 | `880b7ca511d159d4cfa8311077a765328a10f571e2670bbc6608248001733b7c` |
| `docs/evidence/first-live-iteration/compact-entry/more-menu-current.jpg` | 48100 | `c82e46552a916cd05cf8a25d0f5efe193098840aaa064ac97b0d2d2340011e1a` |
| `docs/evidence/first-live-iteration/compact-entry/persistence.json` | 1545 | `ad807e96a2dc1a30252f8f1fce1f7fe09350dbb8546303956fbfbc00301be98d` |
| `docs/evidence/first-live-iteration/expiry-fix/verification.json` | 455 | `0c85cf70e088f657fd03e7df1d3cf933ba1d214488016c2971267000ce6d3e2c` |
| `docs/evidence/first-live-iteration/expiry-fix/ptm-expiry-fixed.pdf` | 85269 | `c7afd65278a8984104f4dbce10bc6cfb91ae07c5cadd4c32ad4c0da4e1ed013e` |

## Git status для продукта

```text
 M .env.example
 M apps/api/src/center-dossier.ts
 M apps/api/src/controller.ts
 M apps/api/src/delivery-approval.ts
 M apps/api/src/duplicate-issuance.ts
 M apps/api/src/files.ts
 M apps/api/src/imports.ts
 M apps/api/src/operator-value.ts
 M apps/api/src/public-verification.ts
 M apps/api/src/renewal-matrix.ts
 M apps/api/src/requests.ts
 M apps/api/src/staff-directory.ts
 M apps/web/app/feedback-workflow.css
 M apps/web/app/layout.tsx
 M apps/web/components/customer-output.tsx
 M apps/web/components/customer-review.tsx
 M apps/web/components/editor.tsx
 M apps/web/components/event-context.tsx
 M apps/web/components/files-panel.tsx
 M apps/web/components/import-dialog.tsx
 M apps/web/components/recipient-details.tsx
 M apps/web/components/recipient-grid-row.tsx
 M apps/web/components/recipient-grid.css
 M apps/web/components/recipient-grid.tsx
 M apps/web/components/request-list.tsx
 M apps/web/components/request-operations.tsx
 M apps/web/components/saved-print-set.tsx
 M apps/web/components/settings.tsx
 M apps/web/components/workspace.tsx
 M apps/web/lib/imports.ts
 M apps/web/lib/request-bundles.ts
 M apps/web/lib/types.ts
 M apps/web/middleware.ts
 M apps/web/next-env.d.ts
 M apps/web/package.json
 M apps/web/test/imports.test.ts
 M apps/web/test/operator-workflow.test.ts
 M apps/web/test/request-bundles.test.ts
 M apps/web/tsconfig.json
 M assets/templates/manifest.json
 M docs/evidence/commercial-acceptance/matrix.json
 M docs/evidence/progress.md
 M packages/contracts/src/index.ts
 M packages/contracts/src/product-policy.json
 M packages/contracts/src/resolution.ts
 M packages/database/prisma/schema.prisma
 M packages/printing/src/index.ts
 M pnpm-lock.yaml
 M scripts/render/group_protocol.py
 M scripts/render/renderer.py
 M tests/contracts.test.ts
 M tests/import-delivery.test.ts
 M tests/integration/finalize-races.test.ts
 M tests/integration/lifecycle.test.ts
 M tests/integration/registration.test.ts
 M tests/integration/security-acceptance.test.ts
 M tests/render/test_render.py
 M tests/resolution.test.ts
?? apps/api/src/approvals.ts
?? apps/api/src/request-customer.ts
?? apps/api/src/signing.ts
?? apps/api/src/translation-suggestions.ts
?? apps/web/app/first-live-iteration.css
?? apps/web/components/approvals.tsx
?? apps/web/components/pdf-preview.tsx
?? apps/web/components/request-activity.tsx
?? apps/web/components/signatory-settings.tsx
?? apps/web/components/signing-panel.tsx
?? apps/web/components/training-bundle-dialog.tsx
?? apps/web/components/training-overview.tsx
?? apps/web/components/translation-suggestion.tsx
?? apps/web/lib/ncalayer.ts
?? apps/web/lib/request-actions.ts
?? apps/web/lib/training-assignment-edit.ts
?? apps/web/lib/validation-errors.ts
?? apps/web/test/compact-entry.test.ts
?? apps/web/test/request-actions.test.ts
?? apps/web/test/training-assignment-edit.test.ts
?? assets/templates/biot-itr-certificate.v16.docx
?? assets/templates/biot-itr-protocol.group-v3.docx
?? assets/templates/biot-itr-protocol.v3.docx
?? assets/templates/biot-protocol.group-v3.docx
?? assets/templates/biot-protocol.v12.docx
?? assets/templates/biot-worker-card.v18.docx
?? assets/templates/original-form-restoration.json
?? assets/templates/pb-card.v15.docx
?? assets/templates/pb-protocol.group-v2.docx
?? assets/templates/pb-protocol.v10.docx
?? assets/templates/ps-card.v16.docx
?? assets/templates/ps-protocol.group-v2.docx
?? assets/templates/ps-protocol.v10.docx
?? assets/templates/ps-witness.v12.docx
?? assets/templates/ptm-card.v15.docx
?? assets/templates/ptm-protocol.group-v2.docx
?? assets/templates/ptm-protocol.v10.docx
?? docs/FIRST_LIVE_ITERATION_RU.md
?? docs/FUNCTIONAL_AUDIT_2026-09-30.md
?? docs/handoffs/
?? output/
?? outputs/
?? packages/contracts/src/business-rules.ts
?? packages/database/prisma/migrations/202610010016_director_approval/
?? packages/database/prisma/migrations/202610010017_approval_lifecycle_guard/
?? scripts/render/english_appendix.py
?? scripts/render/restore_original_forms.py
?? scripts/verification/verify_original_forms.py
?? tests/approval-data-readiness.test.ts
?? tests/approval-signing-contracts.test.ts
?? tests/business-rules.test.ts
?? tests/integration/director-approval.test.ts
?? tests/integration/live-approval-fixture.ts
?? tests/integration/live-import-contract.test.ts
?? tests/render/test_original_forms.py
?? tests/request-customer.test.ts
?? tests/translation-suggestions.test.ts
```
