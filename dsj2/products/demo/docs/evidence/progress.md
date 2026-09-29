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

## 22.09.2026 — важные изменения завершены, оставшиеся тесты остановлены

По запросу «доделай … чтобы было качественно» исправлены постоянное сохранение ручных часов/сроков, обязательный явный выбор категории БиОТ и неоднозначные связи протокола с несколькими удостоверениями. Четыре новых формы прошли ограниченные LibreOffice/Word проверки (8 коротких/длинных вариантов в каждом приложении); root отдельно просмотрел четыре длинных PDF-страницы. Новые шаблоны, API и worker применены к localhost3200; прежние 153 файла и хеши семи таблиц сохранены. Очистка 956 генерируемых файлов из индекса закреплена отдельным коммитом30eeb00, файлы на диске сохранены.

Пользователь повторно указал «заканчивай … не делай тесты». Оставшиеся два браузерных сценария и выпуск all4 через UI не запускались, новый tenant/профиль не создавался. Все агенты остановили проверки. Обязательных незавершённых изменений продуктового кода нет. Фактические результаты и границы: docs/BIOT_FINISH_RU.md. Полная коммерческая приёмка остаётся остановленной; новый shipping image, нагрузка, физическая печать и утверждение эмитентом не заявляются выполненными.

## 24.09.2026 — OT Center V2, отдельная ветка от последней DEMO

Новый запрос пользователя: реализовать полный приложенный пакет V2, продолжить последнюю ветку, поднять локально и завершить функции. Создан отдельный worktree `codex/ot-center-business-value` от fetched `origin/codex/demo-print-2-0@59a961a`; исходный checkout/main не переключался. Пакет требований рассматривается как входная спецификация, авторизация действий берётся из запроса пользователя.

Реализованы F01–F32: общий контекст и источники, массовые изменения/отмена, самостоятельные события и групповые протоколы, исходы и отдельная пересдача, постоянные люди/работодатели, сверка списков, согласование, профили реестра и комплекты, заказы/обязательства, повторы/сроки, ограниченный кабинет работодателя, внешние документы/матрица, досье/вложения/паспорта, QR/обращения, точные расчёты KZT и экспорт. Добавлены миграции 006–011; 11 исходных индивидуальных шаблонов и миграции 001–005 сохранены.

Выполнены основные 37 + 25 unit, 89 интеграционных, 33 render проверки; отдельно новые ежедневные бизнес-сценарии, контролируемые гонки finalize, customer-scoped выдача и браузерные повторные прогоны. Актуальное полное число дополнительных тестов и точные границы отражаются в `operator-value/Verification.md` и сводных матрицах. Большие реальные выпуски G1/G2 дали соответственно 101/203 документа; хеши, реестры и все страницы групповых PDF проверены. Для G1 сохранена явная реконструкция двух файлов с неизменными оригиналами и номерами.

В отдельные пустые БД выполнены обновление старой наполненной схемы и полное восстановление резервной копии с authenticated HTTP readback. Локальный стенд http://localhost:3109/login использует отдельную синтетическую БД; доступ находится только в `.runtime/LOCAL_ACCESS.txt`.

Функциональная реализация не означает PASS всех 184 составных критериев. Новые групповые формы не открывались в Word и не печатались физически; юридическое утверждение, реальные клиенты/пилот, человеческое время/ROI и production не заявлены. Предыдущие записи этого журнала сохранены как история и не переносят прежние PASS на новую версию.

- 2026-09-25: OT Center V2 final completion, source 789c68116826899faa18253a99c9f8deff9c8781,183/184 engineering criteria PASS; AT121 human measurement PARTIAL. See operator-value/Verification.md; local source only, no production deployment.

## 25.09.2026 — восстановление ДСЖ и UX оформления

От актуального `97ffd06` создана ветка `codex/ot-center-dsj-forms-ux`. Реализованы today-only-on-create и общий resolver дат с явным графиком/исключениями, комплекты «Рабочие»/«ИТР» с одним протоколом события, структурированные имена организаций и аддитивная миграция014, шесть новых версий исторических шаблонов. Полное описание: `docs/OT_CENTER_DSJ_FORMS_UX_RU.md`; источники и14пар DOCX/PDF: `docs/OT_CENTER_DSJ_TEMPLATE_RESTORATION_RU.md`.

Свежие проверки: lint/typecheck/build PASS;133 unit,126 integration и37 render PASS (0fail,0skip). Проверены реальные UI-сценарии даты/ручного исключения, RU/KZ организации, группы100 без дубликатов, оформление двух синтетических групп по3 человека и authenticated downloads20файлов сSHA. Production-сборка `.next-forms-ux` работает на localhost3109 с прежней `demo_test_operator_browser`. При пустой очереди выполнен управляемый перезапуск. Первую блокировку Prisma DLL при ещё работающем renderer разрешили завершением проверки и успешным повтором сборки; исходный fail-лог сохранён.

Контрольная сверка:44старых выпуска,390документов,446снимков,222групповых участника,391резерв номера,891артефакт/файл —0изменений.16старыхDOCX и3историческихоригинала неизменны. Матрица текущего запроса: `forms-ux/acceptance-matrix.json`; старые183PASS не переиспользованы.

В источниках нет универсального графика часов в день; пользователь ответил «не подскажу». Настройка намеренно не задана по умолчанию. Пересчёт проверен с явно обозначенными синтетическими графиками. Не заявлены юридическое утверждение, Word/физическая печать или production.

## 25.09.2026 — баланс форм и удобство интерфейса

В рабочей копии codex/ot-center-dsj-forms-ux изменены только семь frontend-файлов DEMO: равные по высоте desktop-панели редактора, более широкая форма, разделы документа и клавиатурные переходы, адаптивные сетки/меню/диалоги, понятные состояния списков и сброс поиска. Свежие lint, typecheck, build и 133 unit PASS; 131 защищённый исходник/шаблон совпал по SHA-256. Новая версия ещё не проверена в браузере: автоматическая проверка отклонила команды запуска/перезапуска стенда, запрошено явное разрешение пользователя. Старый localhost:3109 продолжает работать. Подробная отдельная матрица: [UI_UX_REVIEW_2026-09-25.md](../UI_UX_REVIEW_2026-09-25.md). Исторические PASS не переиспользованы; production не менялся.

## 29.09.2026 — быстрый операторский ввод 100+ получателей

Проведён аудит текущего DEMO и прежнего строкового ввода DSJ; реализована полная редактируемая таблица ФИО/должности/места работы, RU/KZ, клавиатура Enter/Shift+Enter/Tab, фильтры/выбор видимых строк, безопасная вставка по видимым колонкам и восстановление удаления. Карточка документов открывается отдельно. Общие поля теперь сохраняются общей AutosaveLane; очередь ошибок переживает обычные правки, но сбрасывается при смене структуры. Новая пустая заявка фокусирует ФИО. Расширение до250 согласовано через contracts/API/новую миграцию015/Python.

Свежие результаты:137 unit (90+47),7 пакетов typecheck, lint, полный build и финальный web build PASS;6 новых UI,2 real150/250 UI,1 real251→250 import PASS;6 старых browser regression проверены (5+1 после исправления mock);7 capacity/files-import и8 import-delivery integration PASS. Выполнены boundary/render проверки DOCX/PDF250 по отдельному capacity report.38 активных template-файлов совпали поSHA,4 ранее изменённых UI-файла сохранены побайтно.

Доказательства: `.runtime/operator-ux-20260929`; отчёт [OPERATOR_INTERFACE_AUDIT_2026-09-29.md](../OPERATOR_INTERFACE_AUDIT_2026-09-29.md), вместимость [OPERATOR_CAPACITY_250.md](../OPERATOR_CAPACITY_250.md), новая ограниченная запись `operatorUx20260929` в commercial-acceptance/matrix.json. Локальный web3119/API4119/отдельная synthetic DB. Worker не запускался, /ready503; полная печатная готовность этого стенда не заявлена. Полный выпуск250 сZIP, физическая печать, замер скорости человека и production не выполнялись.
## 29.09.2026 — полный путь оператора, сохранение и выпуск

Продолжена именно dirty рабочая копия `codex/ot-center-dsj-forms-ux@8503079`, автономный `products/demo`. Исходный patch/38 файлов и38 SHA шаблонов сохранены. Исправлены возврат из карточки и точные поля ошибок, IME/narrow layout, явные массовые поля человека с preview/undo и ошибкой внутри диалога, Back/Forward/поздние autosave ответы, готовность preview перед подсветкой следующего действия. Мемоизация строк уменьшила измеренную лишнюю работу250 без virtualization. Исправлены фактический лимит1000 с общим протоколом и заголовки новых mixed snapshots; старые выпуски не переписаны.

Текущие результаты:149 unit; lint/typecheck/build PASS;33 различных целевых browser сценария на production-сборке, дополнительный standalone smoke2/2 PASS. Полный исходный integration128/128 и render40/40; последние backend изменения покрыты отдельными targeted reruns, новый mixed render3/3. HTTP-путь250:251 документ/504 artifacts, все hashes/content/ZIP/XLSX проверены; этот pre-fix snapshot не доказывает исправленный mixed header. Новые WORKER/ITR mixed выпуски проверены отдельно; всего552 HTTP artifacts. Реальный UI прошёл preview→явный finalize→PDF/DOCX/XLSX/ZIP→неизменный reload.

Рабочий локальный URL http://localhost:3119, build `6N-Szfx6WRphvUOueY02J`, generated standalone server на127.0.0.1, API4119 иworker этой рабочей копии. Windows directory symlinks generated bundle исправлены по исходным package targets. PostgreSQL изолирован, production не затронут. Шаблоны38/38 SHA прежние; diff/staged checks PASS. Подготовлены12 заданий оператора и8 файлов в ZIP; человеческие времена/Excel-Word сравнение ещё не получены.

Отдельная граница evidence: `--list` перезаписал прежний ignored `docs/evidence/browser/results.json` списком skipped, оригинала в точных резервах нет. Он не считается историческим PASS; датированные результаты и бизнес-данные не затронуты. Полное описание и все ограничения: `docs/OPERATOR_COMPLETION_AUDIT_2026-09-29.md`, печатный отчёт и новая `operatorCompletion20260929` в матрице. Прежние записи матрицы сохранены без изменения значений.
