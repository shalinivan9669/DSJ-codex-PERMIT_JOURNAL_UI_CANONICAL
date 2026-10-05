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

## 29.09.2026 — упрощение по обратной связи Аника

На той же `codex/ot-center-dsj-forms-ux` после `c4e2f63` упрощены старт по типу заказчика, аддитивный выбор нескольких документов прямо в строке/для выделенной группы, общая организация, единое собственное наименование RU/KZ, дополнительные реквизиты и даты, группировка замечаний проверки. Обычный старт/новый человек/вставка/справочник не назначают БиОТ автоматически; явно выбранные готовые комплекты сохраняют общий протокол. Новая организация появляется в выборе без reload. Массовые операции сохраняются через прежнюю очередь и доступны для отмены; ручные даты и старые назначения сохраняются.

Свежие результаты:169 unit, lint, typecheck семи пакетов и web production build PASS;6 новых сценариев документов/старта,5 новых сценариев работодателя,8 регрессий таблицы150/250 и5 обновлённых сценариев фокуса/массовой правки/справочника/autosave PASS. Browser suites используют синтетический API; отдельно в изолированной локальной БД проверены реальное сохранение, reload и двуязычный работодатель. Desktop и390px просмотрены. Первоначальный unit-запуск без настроенного Python не считается PASS; окончательный запуск с существующим runtime-env прошёл. Непроверенные тяжёлые исторические печатные UI-сценарии не объявляются выполненными.

Дополнительно2/2 PASS после обновления общих E2E helpers: реальный десятичеловечный ввод30полей с клавиатуры/save/reload в изолированной БД и mocked добавление101-го человека без неявного документа. Всего26 различных целевых browser-сценариев. Изменения селекторов тяжёлых исторических сценариев не означают их повторную приёмку.

Подробности: `docs/ANIK_FEEDBACK_UX_2026-09-29.md`; новая ограниченная матрица `docs/evidence/feedback-ux-20260929/acceptance-matrix.json`. Цель выпуска — прежний Vercel URL; точные SHA/ID, готовность Vercel/Railway и authenticated read-only smoke сохраняются отдельно в `.runtime/anik-feedback-release`. Шаблоны, схема, API, renderer, нумерация и регистрация центра не менялись. Человеческий замер скорости и юридическая/физическая печатная приёмка не заявлены.

## 29.09.2026 — ответы Аника: регистрация, календарь и смешанная заявка

Продолжение после `e038b668` на той же ветке. Добавлены самостоятельная регистрация центра и настройка реквизитов, руководителя, комиссии и дополнительных людей. Новые tenant/profile/templates сохраняют проверки утверждения. Сохранение настроек больше не теряет commonFields. Новый график считает учебные дни строго до выдачи по явно указанным часам, поддерживает проверенный календарь Казахстана 2025–2026 и отдельные блоки теории/производства. Ручные, импортированные и очищенные даты сохраняются. Старый закреплённый профиль доступен точечным tenant-scoped запросом даже после 100 новых версий. Смешанные рабочие/ИТР и раздельные события подтверждены тестами.

Свежие результаты: 179/179 unit, полный lint, typecheck и build семи пакетов PASS. Регистрация 9/9 API, HTTP/security 13/13, старый профиль 1/1, даты 1 расширенная API-интеграция PASS. Новые браузерные сценарии: 4 onboarding, 3 календарь, 2 смешанная заявка с синтетическим API и 1 реальная регистрация→cookie→версия2→черновик через локальный web/API, все PASS. Desktop/mobile390 и расчётный период просмотрены визуально. По ID/SHA-256 все 2975 исходных неизменяемых записей сохранены. Миграции, шаблоны и renderer не менялись. Новые тестовые строки изолированы; production-регистрация и финальная выдача не выполнялись.

Отчёт: `docs/ANIK_FEEDBACK_ANSWERS_2026-09-29.md`, источники: `docs/TRAINING_CALENDAR_SOURCES_RU.md`, матрица: `docs/evidence/feedback-answers-20260929/acceptance-matrix.json`. Production выпускается на прежний адрес; точные SHA, provider deployment ID/alias и последующая read-only проверка фиксируются в `.runtime/anik-feedback-release`. Прежние результаты первого этапа не перезаписаны; полная печатная, юридическая и операторская приёмка здесь не заявлена.


## 30.09.2026 — текущая проверка основного функционала

Проверен автономный DEMO на `codex/ot-center-dsj-forms-ux@0a44022e7962f32fef4b0d03edb18349ad2ef0b9`. Код продукта не изменён; новые данные созданы только в двух изолированных тестовых БД. Свежая web-сборка, lint и package typecheck PASS; 179 unit PASS. Интеграционный полный запуск: 136 PASS/1 отказ из-за пропущенного DEMO_ORIGIN; исправленный environment дал целевой повтор 4/4 PASS. Все 137 уникальных сценариев закрыты по совокупности запусков, единого зелёного rerun не заявлено. Renderer: 25 PASS до прерывания инструментальной сессии и 18/18 PASS после; все 43 уникальных теста выполнены.

24 наблюдаемых браузерных сценария включают RU/KZ, ошибки валидации, preview, явный выпуск ПТМ, историю, связанное исправление, Back/Forward с последними символами, импорт/сохранение/поиск 250 человек и отказ при 251, мобильную ширину, сохранение при недоступном API с успешным retry. 168 HTTP статусов совпали с ожидаемыми. Восемь скачиваний четырёх финальных файлов совпали с API/БД по SHA256 и размерам; ZIP/XML/PDF проверены. После восстановления runtime повторно подтверждены ready200, свежий worker, сохранность трёх заявок и файлов.

Замечания: proxy не передаёт X-Content-SHA256 при корректных байтах; дополнительный корневой tsc дал 83 diagnostics вне успешного package typecheck; format:check отметил 105 файлов. Исходный web3119 не работал; аудит выполнен на3120/API4120. Внешний сайт дополнительно проверен только чтением: health/context/session/ready успешны; Railway deployment соответствует HEAD, Vercel metadata403 не позволяет подтвердить SHA текущего frontend. Production business-данные и deploy не менялись.

Подробности: [FUNCTIONAL_AUDIT_2026-09-30.md](../FUNCTIONAL_AUDIT_2026-09-30.md), [сводка](functional-audit-20260930/summary.json), новая запись `functionalAudit20260930` в acceptance matrix. Исторические записи сохранены. Полный Playwright suite, браузерный выпуск 250 отдельных документов, физическая печать, юридическая приёмка, backup restore и сравнительное исследование операторов не выполнялись.


## 01.10.2026 — компактная форма, заказчик физлица и общий работодатель

В активном worktree `ot-center-business-value`, ветка `codex/first-live-iteration`, основная таблица сокращена до ФИО, должности/профессии, категории, обучения и действий. Отдельные RU/KZ уточнения и старые исключения работодателя сохранены в деталях. Для отсутствующего отдельного KZ варианта разрешение печатных данных использует введённый текст дословно, без перевода или транслитерации; исходные поля и EN не заполняются автоматически. Физлицо сохраняется с собственным ФИО в названии предложения и в колонке заказчика. Компания задаётся один раз и наследуется пустыми строками; старые индивидуальные сведения сохраняются. `organizationSnapshots` и согласование директора сохранены.

Свежие проверки: 87 web tests, 6 resolution tests, 9 customer/approval tests PASS; scoped ESLint и typecheck API/web PASS; новая production web сборка PASS. На localhost3132 выполнены два настоящих браузерных сценария: новая заявка физлица и компания с двумя сотрудниками, сохранение, список, повторное открытие. Read-only проверка той же одноразовой БД подтвердила названия, PENDING предложения, сохранённые snapshots и единое наследование работодателя при пустых построчных полях. Доказательства: `first-live-iteration/compact-entry/persistence.json`, `person.jpg`, `company.jpg`. Обновлён только проверенный web процесс на3132; API/worker/другие runtime не останавливались.

Дубль срока ПТМ исправлен по полям Word across split runs. Две целевые renderer регрессии PASS; один новый synthetic DEMO PDF содержит ровно одну строку «Действительно до 01.10.2029 г.» при независимой дате протокола30.09.2026. PDF и точные проверки: `first-live-iteration/expiry-fix/`. Исходные шаблоны и ранее выпущенные артефакты не перезаписаны. Полный verify и большая renderer suite не запускались; прежний прерванный suite не считается PASS. Новые заявки не выпускались и не подписывались, production deployment/commit/push не выполнялись.


## 01.10.2026 — остановка и передача простого цикла двух ролей

По прямой просьбе пользователя дальнейшая доработка остановлена; создан пакет MD с одним промптом: docs/handoffs/2026-10-01-simple-cycle/. Последнее требование заменяет прежнюю схему супервайзера/ADMIN: обычный цикл только менеджер и директор, без третьих административных подтверждений. Полный переход прав/настроек/политики подписантов ещё не выполнен.

До остановки перенесены четыре дополнительных блока в «Прочее», убрана нижняя панель, ограничены действия по стадиям и архиву, добавлены явные исход/источник результата, стабильный путь к полю и автоперепроверка после сохранения. APPROVE+SAVE теперь проверяет полноту до записи решения; кабинет директора выводит ошибки и ссылку исправления. Последняя production web build .next-first-live-more PASS; 96 web tests PASS, 11 scoped API/customer/approval PASS, scoped lint/typecheck PASS. В новой сборке браузер подтвердил PENDING меню и отсутствие прежних блоков/панели/печати до согласования; точный путь исправления красных ошибок и последующее решение/печать НЕ завершены. Старые более узкие 6 resolution и 2 renderer PASS сохранены как отдельные измерения. Полный verify/CI/физическая печать/реальная ЭЦП не заявлены.

Создана отдельная synthetic fixture 5ef5e80b-784d-4b7b-9971-70e4b3442d85 для продолжения проверки. Пользовательская 0a3177e4-dfcb-4dae-9037-f9993d58acea при последнем чтении уже rev10 APPROVED с пустыми обучениями; восстановления/автоматического исправления не выполнялось. Исходники, старые документы, API/worker и локальный стенд сохранены. Commit/push/deploy не выполнялись.


## 02.10.2026 — первый продуктовый спринт, локальная реализация двух ролей

Исторические записи выше сохраняются. Актуальный отчёт: [FIRST_PRODUCT_SPRINT_2026-10-02.md](../FIRST_PRODUCT_SPRINT_2026-10-02.md); новая отдельная запись matrix: `firstProductSprint20261002`. Рабочая ветка `codex/first-live-iteration`, checkpoint `224c1bd`; последующая работа остаётся локальной. Состояние этого этапа: **LOCAL_ENGINEERING_PASS_BROWSER_IN_PROGRESS**.

Обычный цикл теперь использует менеджера и директора: автосохранение предлагаемой редакции → согласование/возврат директором → подготовка нумерованных документов → PDF и печать. Директор получил необходимые настройки центра; прежний ADMIN совместим с директором без переписывания аккаунтов/паролей, ограниченные прежние роли не повышаются. Комментарий возврата показывается в карточке. Сохранение без изменений не предлагается. Печать макета проверяет точную согласованную редакцию и актуальное серверное решение; история оригиналов сохраняется. Настройки ЭЦП и аккаунты комиссии не являются третьим административным этапом печати, однако `ISSUED` и официальный подписанный экспорт по-прежнему требуют действительных криптографических подтверждений.

Текущий полный `pnpm test`: **132 root + 107 web = 239 PASS**, 0 fail/skip/cancelled. `pnpm lint` и `pnpm -r typecheck` PASS; Prisma generate и работающий web dist этими проверками не изменялись. Логи: `.runtime/first-live-iteration/final-product-{lint,typecheck,unit}.log`. Окончательный единый scoped PostgreSQL/HTTP прогон: **61/61 PASS**, 0 fail/skip/cancelled, 211.956 с, exit 0; `.runtime/first-live-iteration/backend-scoped-final.log`. Он проверяет роли, регистрацию, безопасность, согласование, области работодателя/файлов, продления и архив, но не заменяет полную историческую integration suite из 46 файлов. Totals включают parent Node.js tests. Новый race-тест PASS: реальная блокировка строки при архивировании заставляет preview дождаться решения, затем получить `REQUEST_ARCHIVED`, без новых jobs/snapshots.

Печатная QA: **11 действующих форм / 15 PDF-страниц**, проверены manifest/SHA, содержимое и визуально все страницы. Исправлены узкие дубли SUBJECT/RESULT в ПС и независимые даты выдачи/протокола свидетельства, включая KZ-день решения. Регрессии исходных форм после исправлений **9/9 PASS**; ещё **2/2 PASS** для прежней mapping/date логики ПС. Baseline renderer **16/16 PASS** был до этих двух исправлений; затронутые формы пересобраны после них. Шаблоны и прежние выданные bytes не менялись. Доказательства: `.runtime/sprint-webqa/qa-summary.json`, `pdf-verification.json`, `ps-regressions-final.log`, `ps-existing-mapping-tests-final.log`.

Массовая интеграция **10/10 PASS**, 0 skip, 169.817 с: Рабочий/ИТР по 1/3/100/250 человек, две рабочие учётные записи, импорт 250 и отказ при 251; номера, состав групп и snapshot-даты проверены. Все 100/250 отдельных удостоверений не рендерились. Отдельный реальный ПТМ-протокол **250 человек / 26 страниц** проверен по всем именам/номерам и комиссии; первая/последняя страницы просмотрены. Scoped web bulk/import/bundle **41/41 PASS** входит в пересекающееся web-покрытие и не прибавляется к 239. Сохранены оговорки исходной геометрии ПС, без широкого редизайна.

Итоговые три браузерных пути — физлицо, компания с возвратом и повторным согласованием, массовый ввод — остаются **IN_PROGRESS** до финальных доказательств root. Полный исторический `pnpm verify`/CI, физическая печать, реальная ЭЦП, государственная регистрация, юридическая приёмка и comparative human trial не заявлены.

Первоначальный push checkpoint `224c1bd` создал пять отдельных Vercel Preview и один failed Preview. После запрета публикации новых push/deploy не выполнялось. Read-only аудит четырёх прежних Vercel Production Current и четырёх соответствующих Railway Active подтвердил прежний `0a44022` (deploy 29/30 сентября); production не обновлялся этим продолжением. Свидетельства: `.runtime/no-deploy-audit-20261002/*.txt`. Приватные config/пароли в отчёт не включены.


## 02.10.2026 — итоговая проверка кода после импорта и даты протокола

Предыдущие записи остаются историческими. После source freeze импорта и contracts повторён полный локальный контроль: **137 root + 111 web = 248 PASS**, 0 fail/skip/cancelled; pnpm lint и pnpm -r typecheck PASS. Логи .runtime/first-live-iteration/final-product-{lint,typecheck,unit}.log обновлены; длительность root 21.475 с, web 5.118 с. Prisma generate не запускался. Root подтвердил локальную production web build .next-sprint1-accepted-20261002 PASS, журнал .runtime/first-live-iteration/final-web-build.log; это не публикация.

Импорт 100/250 получателей заменяет единственную новую нетронутую пустую строку LIVE_V1 и даёт ровно 100/250 строк; частичные данные и ранее отредактированная, затем очищенная строка сохраняются. Предварительный текст замены условный, ошибка 250-строчного предела объясняет сохранённую строку и дальнейшее действие. По умолчанию импортируются получатели; явная форма сохраняется, фактическое обучение без формы требует выбора. Проверки: 30 unit, 10 web для финального текста и 8 PostgreSQL integration PASS; unit-наборы пересекаются с 248. Логи .runtime/sprint-webqa/import-scaffold-unit.log, import-message-unit.log, import-scaffold-integration.log.

Дата протокола при унаследованном пустом значении получает эффективную дату выдачи; явное значение и намеренное CLEARED различаются, последнее блокирует согласование с PROTOCOL_DATE_REQUIRED. Общий протокол получает общую дату, прежние snapshots/bytes неизменны. Targeted resolution/date/business-rules 37/37 PASS входит в полный прогон 248.

Базовая PDF QA 11 шаблонов / 15 страниц сохраняется как результат синтетических fixtures. Проверка реальных браузерных заявок обнаружила пустую дату протокола; после исправления contracts и отдельной корректировки KZ-токена БиОТ окончательная проверка новых PDF остаётся IN_PROGRESS. Финальный renderer original-forms набор с регрессией KZ-должности Рабочего: 10/10 PASS, 18.528 с, runner stdout review_roles. Просмотр PDF во встроенном браузере сработал; попытка нативной печати не подтверждает открытие системного диалога или физическую печать. Три финальных browser flow также остаются IN_PROGRESS до новых доказательств root. Новых push/deploy не выполнялось.


## 02.10.2026 — локальная приёмка первого продуктового спринта завершена

Итог **LOCAL_PRODUCT_SPRINT_ACCEPTED_WITH_STATED_LIMITS**. Полный актуальный отчёт FIRST_PRODUCT_SPRINT_2026-10-02.md и matrix.firstProductSprint20261002 согласованы. Person: первоначальная заявка 9164e407-569b-4a2b-af7e-2a174fdd8fd3 прошла 422 на неполной rev3, исправление/автосохранение, согласование rev5, изменение и повторное согласование rev6. Company: 8f813515-c85b-4cda-8fef-63a67004dc6e, отдельный KZ после reload, видимый комментарий возврата rev9, согласование rev10. После обнаружения дефектов PDF созданы отдельные исправления person 4d98230c-7941-48fb-9223-37ce6db51f57 и company b1c24d11-c03d-4f28-82e0-bfdfe0795dac: обе rev1 согласованы директором через UI и подготовлены менеджером.

Финальная QA **6 PDF / 7 страниц PASS**: даты 02.10.2026 во всех шести, номера, RU/KZ имена/работодатель, SHA-256, отсутствие незаменённых tokens/чужих участников/обрезки; срок ПТМ 02.10.2027 ровно один раз и KZ-должность в обеих лицевых копиях удостоверения Рабочего. Все семь страниц просмотрены. Исправленный двухстраничный PDF открыт в модальном просмотре и скачан кнопкой UI; SHA-256 загрузки совпал с оригинальным артефактом. Доказательства в .runtime/first-live-iteration/sprint-browser-evidence/: pdf-qa-corrected-evidence.json, pdf-qa-corrected-contactsheet.png, 21-corrected-pdf-browser.png/.txt, 22-final-pdf-preview.png, download-verification.json. Первоначальная неуспешная проверка сохранена отдельно, старые PDF не заменялись.

Массовый браузерный путь PASS: прежние 100 строк/план 101 документов, изолированная правка строки 100 и 13 проверок сохранённых данных; новый импорт b2a42370-12c8-4dc5-b175-46ac04299de9 в rev3 дал ровно 250 получателей без назначений. После явного ПТМ для 250, общего работодателя/программы и синтетического PASSED rev6 пережила reload, прошла проверку UI, фильтр строки 250 корректен, план 250 удостоверений + 1 общий протокол = 251. Независимые проверки сохранённых данных 17/17 PASS (mass250-qa-evidence.json). Массовые заявки остаются PENDING, полный рендер 251 PDF не заявляется.

Повторная immutable QA PASS: прежние 2 выпуска, 6 документов, 8 render snapshots, 16 метаданных артефактов и SHA-256 всех 16 сохранённых файлов неизменны; immutable-verification.json. Итог кода 248 unit PASS, lint/types и локальная web build PASS сохраняется; renderer original-forms 10/10 PASS указан отдельно. Системный диалог и физическая печать NOT_VERIFIED; реальная ЭЦП, юридическая/государственная/production приёмка и полный исторический verify/CI не заявлены. После 224c1bd новых push/deploy не было; прежние production сайты сохранены.

## 02.10.2026 — перенос исходных документов опубликованной версии

Перед сравнением первый спринт сохранён коммитом 8825dfa в codex/first-live-iteration; продолжение ведётся в codex/diff-deployed-templates. Source Vercel подтверждён: main@90d5b5e, dsj2/apps/web. SHA Railway backend отдельно не установлен; девять существующих DOCX скачаны для чтения. Production не изменялся.

Промежуточная адаптация SOURCE_FIDELITY_V2 не принята: она всё ещё меняла исходную вёрстку, тогда как пользователь требует готовые исходные бланки. Приёмка V2 остановлена. Локально зарегистрировано 16 V2 template versions, но issuedDocumentsUsingV2=0, snapshotsUsingV2=0; новых выпусков через них не создавалось.

Исправленный путь LEGACY_REFERENCE_90D5: исходные DOCX копируются побайтно, используются локальные копии исходных генераторов. Проверены SHA 11 соответствий форм / 10 уникальных DOCX и трёх генераторов. Независимое сравнение core direct-legacy versus adapter: 11/11 PASS; document.xml, styles, relationships и media совпадают; для PS учитывается только служебный modified timestamp. Применение текущих сохранённых данных и финальный локальный выпуск остаются IN_PROGRESS. UI-сравнение готово отдельно; редизайн формы не выполнялся. Push/deploy не выполнялись.

## 02.10.2026 — исходные документы подключены, локальная проверка завершена

Итог ORIGINAL_FORMS_RESTORED_LOCAL_ENGINEERING_PASS. Все 16 текущих версий — 11 индивидуальных форм и 5 групповых — используют исходные DOCX из 90d5b5e, побайтно совпадающие с источником; три исходных генератора также совпадают. V2 не выбрана ни в manifest, ни среди последних утверждённых шаблонов локальной базы. Исходные шрифты, рамки, геометрия и графика не переделаны. Адаптер передаёт фактические данные в существующие поля, фиксирует независимые даты и исправляет только служебные объявления XML/OPC для совместимости с LibreOffice.

Окончательный полный pnpm test:render: **90/90 PASS**, 0 failures/errors/skips, 988,675 с, exit 0. Проверены реальные DOCX/PDF всех форм и варианты с фото, пакет 2 получателей, 100 отдельных протоколов, DOCX 250 человек и отказ при 251, исходные поля, значения, файлы, XML и импорт. Сравнение core 11/11 и независимая проверка текущих данных/геометрии/media 11/11 PASS. Копии актуальных доказательств находятся в docs/evidence/deployed-template-diff-20261002/; engineering-verification.json содержит итог и точные SHA. Код продукта: 248 unit PASS, lint, typecheck printing и autonomy PASS; внешних runtime-зависимостей DSJ нет.

Контрольная синтетическая заявка 5dcf2386-a357-472d-928b-041b4466c1f6 прошла существующее согласование директора и подготовку менеджером: удостоверение рабочего БиОТ, сертификат ИТР и два соответствующих протокола, 10/10 готовых артефактов. Удостоверение и сертификат открыты в браузере и скачаны через UI; SHA обеих загрузок совпадает с сохранёнными файлами. Состояние AWAITING_SIGNATURE. Старые 52 файла и 32 версии шаблонов неизменны; 20 прежних snapshots воспроизведены побайтно, 16 V1 эталонов прошли полный тестовый набор, 38 прежних DOCX в Git не изменены.

Визуальная QA: 14 вариантов / 20 страниц и текущий БиОТ на 250 участников / 12 страниц — сохранность исходника и данных PASS. Все имена и номера группы присутствуют, фактические результаты/примечания сохранены, комиссия следует после списка, тестовая отметка видна на каждой странице. Эти визуальные наборы предшествуют финальному исправлению объявлений XML; на окончательном коде отдельно проверены семантика всех 14 пакетов, реальная конвертация всех форм, геометрия рабочего/ИТР и ПБ с фото. Граница указана в pdf-review.json; исходные ограничения не скрыты общим PASS.

Печатная приёмка остаётся **NOT_ACCEPTED_SOURCE_LIBREOFFICE_LIMITS**: у исходных бланков есть подтверждённые выходы за границы/наложения в LibreOffice и особенности переноса длинных значений. Физическая печать NOT_VERIFIED. Самовольная подгонка исходных макетов не выполнялась. Полные отчёты: DEPLOYED_TEMPLATE_DIFF_2026-10-02.md и DEPLOYED_REQUEST_FORM_COMPARISON_2026-10-02.md. Интерфейс заявки только сравнивался. Всё сохраняется локально в codex/diff-deployed-templates; push/deploy и изменения Vercel/Railway не выполнялись.

## 02.10.2026 — непрерывное заполнение заявки оператором

Отдельная ветка `codex/operator-continuous-form` от `436bffeaa62c65e2505f983f6a7bc9125cb7abf8`. Пользователь подтвердил приоритет удобства оператора и отклонил первоначальное расширение `/requests/new`: старт восстановлен из HEAD, в браузере проверены только два типа заказчика и «Далее». Изменения сосредоточены в существующем редакторе: встроенные форма/названия компании, компактные панели людей с табличной альтернативой, общие поля обучения и подтверждение результатов, ранние подсказки существующих contracts, защита несохранённого ввода и переходы к полям.

Локальная синтетическая компания `6190a89e-82ee-471e-a502-dac69caffe1c` сохранена в редакции 6: ТОО и отдельное KZ-название, получатель/должность, БиОТ, явные PASSED/источник; 4/4 preview jobs DOCX/PDF SUCCEEDED. Физлицо `3547d78e-65de-43ed-96ce-ca633d544bc9` прошло создание через UI, сохранение/повторное открытие и выбор ИТР с ранним показом БИН/адреса. На fixture `b9065773-908f-475b-a61a-b7a9c8810d36` проверены 250 строк, 10 панелей на странице, переход из замечания с фокусом `items.249.fullNameRu`, ввод последнего имени и табличный режим на 250 строк. Это проверка ввода/переходов, не массового выпуска или скорости оператора.

Свежие web tests **125/125 PASS**, 0 fail/skip/cancelled; web ESLint и TypeScript PASS. Финальная production web build **PASS**, exit 0, `.next-operator-continuous-final`, Build ID `Z4vQgxCy24sV51HlZgRy3`. Состояние этапа `LOCAL_ENGINEERING_AND_SCOPED_UI_PASS`; отчёт [OPERATOR_FORM_UX_2026-10-02.md](../OPERATOR_FORM_UX_2026-10-02.md), отдельная запись matrix `operatorContinuousForm20261002`. Данные и логи: `.runtime/operator-continuous-form/`; шесть браузерных снимков сохранены локально в `docs/evidence/operator-continuous-form/`.

Шаблоны, backend/схемы/миграции и frozen-модули не изменялись. Полный исторический verify/CI, новый цикл директора, физическая печать, юридическая приёмка, production deployment и измеренное преимущество в работе человека не заявлены. Исторические записи сохранены.

## 02.10.2026 — строковый ввод вместо отклонённых панелей

Итог текущей итерации **LOCAL_ENGINEERING_AND_SCOPED_UI_PASS**, ветка `codex/operator-continuous-form`, исходное состояние `6a9625d`. Пользователь отклонил крупные панели; прежний отчёт отмечен `REJECTED_AND_SUPERSEDED`. Основной ввод теперь — компактная строка человека, общие параметры над списком и детали в диалоге. `/requests/new` остаётся неизменённым относительно `436bffe`: только два типа заказчика и «Далее».

В браузере проверена компания `31e1f7c8-e5af-4ed7-9fd3-84bb71bee449`, редакция 11, три строки: названия RU/KZ сохранены после reload; Enter/Tab, возврат фокуса после закрытия деталей, открытие/отмена фото работают. Новые строки наследуют БиОТ/ПТМ. Личная дата 03.10.2026 сохранена после изменения общей на 04.10.2026, смешанные даты отображаются явно. БИН/адрес ИТР сохраняются, блок не закрывается во время последнего поля; ссылка замечания фокусирует общую программу. Физлицо `3547d78e-65de-43ed-96ce-ca633d544bc9` показывает одну строку без блока компании. На существующей fixture `b9065773-908f-475b-a61a-b7a9c8810d36` из 250 строк должность последней строки «Электрик — проверка строки 250» пережила сохранение/reload, поиск `250` дал одну строку.

Web tests **143/143 PASS**, ESLint, TypeScript и финальная production web build PASS. Проверенный dist `.next-operator-rows-reviewed`, Build ID `vpxN60XOqb8QSRgAlxAHP`, локальный web3132 PID47972, GET200; отдельная синтетическая БД `demo_test_first_live_ui`. Генерируемые конфиги Next восстановлены из HEAD. Логи `.runtime/operator-rows/`, снимки `docs/evidence/operator-rows/`. Отчёт [OPERATOR_ROW_ENTRY_2026-10-02.md](../OPERATOR_ROW_ENTRY_2026-10-02.md), матрица `operatorRowEntry20261002`.

Текущий импорт 250 строк и новый полный цикл директора/печати не выполнялись; fixture не считается новым импортом. Человеческая приёмка удобства и сравнительная скорость оператора не измерялись. Макеты, backend, схемы/миграции и frozen-модули сохранены; push/deploy не выполнялись. Исторические инженерные результаты предыдущих этапов не перезаписаны.

## 02.10.2026 — отступы и выравнивание операторской формы

CSS-коммит `1dc69a7` отправлен в `origin/codex/operator-continuous-form`. Изменены только `operator-form.css` и `recipient-grid.css`: согласованные отступы, поиск рядом с компанией, пропорции колонок и размеры полей, закрепление заголовка ФИО, внутренний scroll. Порядок ввода и действия не менялись; `/requests/new` в опубликованном браузере по-прежнему содержит два типа заказчика и «Далее».

Scoped Prettier и diff check PASS. Локальная production web build PASS (`uIecRo71N04T58Q-IozHo`); последние CSS-уточнения прошли финальную Vercel build: `dpl_EMiygRPsd86Au4D6JdCUMdWh4mFP` READY, canonical `https://dsj-demo-rows-20261002.vercel.app`, исходник — git archive `1dc69a7`. Браузер: desktop1280, mobile390 и финальный tablet768; переполнения страницы нет, таблица прокручивается внутри блока, Tab выводит поле в видимую область. На одной облачной fixture таблица поднялась с849.5px до801.5px, ФИО расширено с244px до304px. Компания, обе строки и редакция5 сохранены. Снимок: `C:/Users/Admin/Documents/DSJ-DEMO-cloud-20261002/layout-final-desktop.png`.

Новый Railway проверен отдельно чтением: deployment `4fd4e282-5899-4133-9f18-35dc678ddef6` SUCCESS, `/health` и авторизованный `/ready`200, DB SELECT1, актуальный heartbeat worker, storage ok и постоянный том `/data`. Backend, данные, шаблоны и миграции этой CSS-правкой не менялись. Новый выпуск/физическая печать и сравнительная скорость оператора в этом этапе не проверялись.

## 03.10.2026 — подготовка анализа удобства глазами оператора

От чистого `592d15c` создана локальная ветка `codex/operator-flow-refinement-20261003`. Пользователь указал два открытых дефекта: обучение можно назначить всем, но нельзя снять в том же месте; подсказки смещают основные поля относительно соседних. Причины подтверждены чтением `request-training-choices.tsx`, `recipient-grid-row.tsx` и CSS; новые браузерные измерения не выполнялись.

После уточнения пользователя подготовлен именно промпт **анализа**, без команды реализовывать исправления: [PROMPT_RU.md](../handoffs/2026-10-03-operator-flow-refinement/PROMPT_RU.md). Рядом сохранены контекст, история ограничений и две исходные картинки пользователя. Фокус — реальные задачи оператора, ожидаемое/фактическое поведение, исправление ошибок, визуальная устойчивость и приоритеты. Статус `PREPARED_FOR_ANALYSIS_NOT_IMPLEMENTED`: код, runtime, данные, шаблоны и публикации не менялись. Прежний инженерный PASS не считается приёмкой удобства этих сценариев.


## 03–04.10.2026 — полная локальная реализация UX-01…32 завершена

Фактически закрыты32/32 UX и R1…R4. Свежий FULL31 `89caa06e-a555-4695-8697-ced29b2256b1`, BUILD_ID `tRmlmp5O3h110hD5-uVvp`, web3134/API4134. Все155 тестов выполнены: 154PASS/1FAIL/0skip/0flaky, exit1. Единственный frozen company37 ZIP100МиБ разобран по фактическому jobID и75 saved files, без skip и изменения renderer. Все38 обязательных случаев PASS; 437 требований к свежим evidence проверены. Lint/types повторены после последней правки E2E helper31; build и unit317 PASS для неизменённого application runtime/dist v30. Integration184/render90 выполнены раньше и не перезапускались в v30/v31; результаты сохранены по current31-аудиту230 неизменённых входных файлов, без пропусков.

Новый импорт250 и граница251, восстановление после reload/конфликта, реальные две вкладки, раздельный оператор/директор, клавиатура, actual zoom200%, все указанные viewport и промежуточные/ошибочные/исправленные состояния проверены. G1:100 людей/100 фото/101 документ/204 files, whole mouse0; Common:105 документов/212 files. Все416 saved files и206 PDF content проверены, selected pages фактически просмотрены. Public unsigned409 и immutable/history сохраняются.

Матрица [UX_01_32_CLOSURE_MATRIX_RU.md](operator-flow-full-fix-20261003/UX_01_32_CLOSURE_MATRIX_RU.md), отчёт [IMPLEMENTATION_REPORT_RU.md](operator-flow-full-fix-20261003/IMPLEMENTATION_REPORT_RU.md), [fresh mandatory audit](operator-flow-full-fix-20261003/final-full-v31-89caa06e-a555-4695-8697-ced29b2256b1/fresh-mandatory-proof-audit.json). Все78 исходных SHA и исторические записи сохранены; frozen/template/KZ/длинные подписи и отсутствие физической/юридической/NCA приёмки раскрыты в отчёте. Production/push/deploy/PR не выполнялись.


## 04.10.2026 — оставшийся операторский процесс REM-01…08

Продолжена актуальная codex/operator-flow-refinement-20261003 от 648a6bd в worktree ot-center-business-value, только products/demo. Реализованы произвольные последовательные выпуски одной заявки, явная передача выбранного состава директору, программы/формулировки каждого курса и ПС, общий PDF/совместимый DOCX/части ZIP, курс и даты строки, inline RU/KZ, безопасная быстрая вставка, technical-blank, естественное сохранение компании. Сохранены original artifact IDs/SHA/номера, подписи и права. Подписание/реестр/история открытой многопартийной заявки и узкая совместимость старого employer proposal проверены предметно. Все18 удобств перечислены отдельно.

Текущий статус IMPLEMENTED_LOCAL_ACCEPTANCE_IN_PROGRESS: lint exit0, unit341/341, renderer101/101, чистый управляемый UI16/16. Свежие обязательные integration выполняются на новой demo_test_remaining_operator_integration_v6; FULL166 ещё ожидается после окончательной повторной проверки типов/сборки, включая последние тестовые снимки. Исторические отрицательные прогоны сохранены; skip/assertion weakening не применялись. Source template files не менялись, 131 затронутый путь внутри автономного продукта.

Отчёт: remaining-operator-flow-20261004/IMPLEMENTATION_REPORT_RU.md; таблица18: remaining-operator-flow-20261004/DSJ_CONVENIENCE_18_MATRIX_RU.md. Итоговый PASS будет добавлен только после фактического завершения всех mandatory gates. Production/push/PR, действительная НУЦ подпись, физическая/юридическая приёмка и измерение человеческой скорости в эту локальную проверку не входят.


### 04.10.2026 — окончание по указанию пользователя сократить проверки

Реализация REM-01…08 завершена, все18 удобств разобраны и предметно проверены. Финальные lint/typecheck/build PASS; unit341/341, integration203/203, renderer101/101, управляемый UI16/16. Последний реальный проход на .next-remaining-operator-v5/BUILD_IDIaZWxKNS7yKZA9n-T7KQc:2/2PASS за71.908с, без пропусков/повторов. Одна заявка e7e4b0de-564e-458a-a307-e4cfa3755a7d, два выпуска, прежние original hashes неизменны, общая печать и PDF из списка получены. Рабочая локальная ссылка http://127.0.0.1:3135.

По последнему указанию пользователя «Слишком много проверок… заканчивай» расширенный FULL166 и новый38/437 файловый аудит не запускались. Их подготовка не представлена как PASS; новая полная приёмка UX-01…32 не заявляется. Предыдущие исправления/исторические результаты сохранены. Итоговый отчёт и обе матрицы находятся в remaining-operator-flow-20261004/. Публикация/production/push/PR, физическая/юридическая/действительная НУЦ приёмка не выполнялись.


## 05.10.2026 — минимальные действия, общие данные и Excel 400

Обычные назначения PASSED с защищёнными исключениями, общее заполнение должности/работодателя/курсов/обязательных фактов, единый срок WORKER+1/ITR+3 и ручные исключения, свежие повторные заявки и очищенная пересдача реализованы. Реальный XLSX400 сохраняется одной заявкой, preflight1203 проверяет весь состав автоматически ограниченными пакетами, директор принимает одно решение.

Локальный UI20 завершил создание→autosave/reload→передачу→PDF директора→одно решение→автообновление→явный выпуск. 105 документов, 212/212 jobs SUCCEEDED, 22/22 образца PDF/DOCX сверены. Этот цикл подтверждён несколькими этапами одного request, а не одним непрерывным PASS; причины отрицательных запусков сохранены. Excel400 — один полный PASS, исключения — один PASS, финальная сводка директора — один PASS. Последний web v4 BUILD_ID SQm7fsNOUdnvAB22YEGeE, localhost origin фактически 127.0.0.1:3135 / API4135. Сборки/типы/lint и предметные тесты выполнены; весь исторический E2E/CI повторно не заявляется.

[Отчёт и фактические действия](operator-minimal-actions-20261004/IMPLEMENTATION_REPORT_RU.md), [источники полей](operator-minimal-actions-20261004/AUTOFILL_MATRIX_RU.md), [матрица](operator-minimal-actions-20261004/acceptance-matrix.json). Печать исходных форм сохраняет NOT_ACCEPTED_SOURCE_LIBREOFFICE_LIMITS; неизвестный реальный график отложен пользователем. Production backup подтверждён, состояние перед cutover неизменно; release будет зафиксирован отдельной записью после выполнения.


### 05.10.2026 — публикация минимального операторского сценария завершена

Application commit17aab8a и frontend packaging fbf69b2 отправлены в origin. Vercel READY dpl_EFyMu5RAWCShGRwBycR4aZVx8pAh подключён к прежнему canonical адресу; Railway SUCCESS8f79e67a-85c6-489b-910e-f552454fc2ed. Shipping269 source files, migrations22/CHECK10000, API/worker/heartbeat и неизменность исторических hashes/42files подтверждены. Browser login OPERATOR+DIRECTOR, полностью загруженные списки5заявок/2pending, sessions/context200, authenticated readiness11templates/storageok PASS. Данные smoke не создавались. Подробности и границы: [release-result.json](operator-minimal-actions-20261004/release-result.json), [итоговый отчёт](operator-minimal-actions-20261004/IMPLEMENTATION_REPORT_RU.md). Документальный followup commit не меняет deployed application code. SSH remote revoked; local keypair deletion rejected by automatic approval with blocked by policy, files remain outsideGit.

## 05.10.2026 — новая заявка20 со скриншотами каждого этапа

По прямой просьбе пользователя создана через UI новая локальная PERSON-заявка `6c9366cd-9595-4261-96a8-77609794d2a9`:19 WORKER+1ITR, БиОТ/ПТМ/ПБ/ПС. Настройки центра не изменялись, работодатель выбран из существующего синтетического справочника. Счёт ручного ввода:20 ФИО+1общая должность+3общие длительности+3ИТР факта=27полей данных; отдельно1поле поиска и7выборов значений. Не вводились PASSED, часы БиОТ, даты, сроки, программы, поля ПС, БИН/адрес работодателя. Проверка105документов:valid=true/issues[]/warnings[],21834ms. Director review issues[]; согласовано одним решением, оператор увидел статус без reload. Выпуск не запускался. Runtime3135/4135,BUILD_ID SQm7fsNOUdnvAB22YEGeE; код приложения не менялся.

11 настоящих PNG и полный счёт действий: `operator-walkthrough-20-20261005/walkthrough.json`. Вспомогательный сценарий дважды корректировался (exact label даты включал описание; reviewUnavailable возвращал false, а не undefined). Оба исправления только в harness; повторная заявка и повторный ввод не создавались, продолжена та же заявка. Результат доказывает отсутствие показанного красного блока для новой подготовленной заявки; это не обещание нулевого ввода неизвестных фактов и не новый print/CI прогон.

## 05.10.2026 — проверка названия центра и вёрстки всех форм

По запросу пользователя проверены 16 действующих форм (11 индивидуальных и 5 групповых) на HEAD a9c9ef2. Созданы только синтетические локальные образцы: 30 вариантов, 48 страниц Microsoft Word 16.0.17932, включая длинные значения, фото и группы по 25 человек. Проверены все страницы на обзорных листах, ключевые дефекты и фото — отдельно в полном размере. Исходные SHA всех 16 шаблонов совпали с manifest.

Дополнительно сверены 22 сохранённых файла последней локальной приёмки manual20 (11 DOCX + 11 PDF), все SHA совпали с readback. Просмотрены 21 страница PDF приложения (LibreOffice 26.2.6.3) и 21 страница свежего вывода тех же DOCX через Word. Исходные файлы после read-only экспорта не изменились. Это просмотр сохранённых файлов, а не новый запуск серверного PDF-конвертера.

Результат: FAIL_IDENTITY_AND_LAYOUT. В текстовых значениях 30 свежих образцов старое название не найдено, однако в 12 из 16 форм сохраняются изображения логотипа или печати «Стандарт»; в свидетельстве ПС также сохранено изображение исходной подписи. В пакетах ПБ/ПТМ есть лишняя картинка с реквизитами другой организации. Подтверждены обрезка текста сертификата в Word, выход текста карточек за рамки, пересечение полей при длинных данных, разрывы строк/комиссии и отсутствие повторяемых заголовков части групповых таблиц. Word и PDF приложения дают разную геометрию на одних и тех же DOCX.

[Матрица 16 форм и 10 находок](document-identity-layout-20261005/acceptance-matrix.json), [контрольные суммы файлов приложения](document-identity-layout-20261005/application-artifacts.json), [30 синтетических вариантов](document-identity-layout-20261005/case-inventory.json). QA-файлы и исполнимые сценарии — .runtime/document-audit-20261005. Код продукта, шаблоны, БД, ранее выданные документы и production не менялись. Исправления не применены; физическая печать и новая серверная конвертация остаются непроверенными. Полный test/build/CI не заявляется для этого аудита.


## 2026-10-05 — Neutral forms: DOC-01…DOC-10 local Word/PDF acceptance

- Implemented 16 new immutable template versions (11 individual + 5 group), policy `NEUTRAL_FORMS_V1`, renderer `demo-ooxml-12/libreoffice-26.2.6.3`. Old template files, legacy helpers and historical artifacts were retained.
- Removed source logos, stamps, signatures and foreign identity from the whole new OOXML package. Added editable neutral logo/stamp slots; current frozen issuer/recipient values remain data.
- Corrected ITR certificate, worker/PB/PTM/PS cards and PS witness geometry, bilingual fields, dates/numbers/photos; overflow is rejected before issuance. New namespace isolation makes photo output independent of prior jobs.
- Five group forms retain every member/result and repeat only genuine headers. Rows cannot split; commission remains whole with participants. PB250 in Word uses a final spanned commission row; its 14th page has members 248–250 and the whole commission (application PDF 13 pages).
- Fresh principal set:30 DOCX,30 application PDF,30 Word PDF; all 48 + 48 pages visually reviewed. Scale matrix 1/2/25/100/250/400:30 cases, 3890 members per engine; all 285 application + 286 Word pages programmatically checked,53 pages per engine visually reviewed.
- Checks: `pnpm test:render` 125 PASS; final targeted form/field/card/namespace/upgrade checks 14 PASS plus finalPB protocol checks 7 PASS. Unit 189 + 211 = 400 PASS; focused integration 12 PASS; lint/typecheck/build PASS. Physical printing and full integration/E2E were not performed.
- Disposable local PostgreSQL `demo_test_neutral_forms_20261005` on 127.0.0.1:5544 verified additive 16 old + 16 new registrations, unapproved-new-version gating, immutable snapshot/artifact and authenticated readback; production was not changed.
- Evidence: [acceptance matrix](neutral-forms-20261005/acceptance-matrix.json), [Russian report and artifact links](neutral-forms-20261005/REPORT_RU.md), [preservation](neutral-forms-20261005/preservation-after.json), [registration/history](neutral-forms-20261005/registration-history-upgrade.json). Control archives include DOCX, actual application PDF, Word comparison, snapshots and SHA256; print at 100%.
- Minor PTM observations: complete long words may wrap without a hyphen; Word omits the left stroke of the neutral logo outline while the application PDF shows the complete outline. No data loss or field intersection was found.
- Final batch follow-up: unique bookmark IDs/names and recipient-local anchors; two batch regressions PASS. The same two-recipient PB DOCX passed actual Word and application conversion (two pages, complete commissions, ordered recipients, no clipping). Final current-code reproduction of all 30 principal DOCX remained byte-identical.

## 05.10.2026 — автозаполнение, обычный ИТР и готовая редакция директора

В текущей `codex/operator-flow-refinement-20261003` реализовано узкое продолжение от `6ffa7fe`: ordinary ИТР получает `ITR_STANDARD` и не требует отрасль, БИН/адрес работодателя, knowledge/proctoring для нейтральных форм, которые их не печатают. Явный SPECIAL использует три отдельные регистрации существующих специальных бланков и полноценную серверную проверку. Общие данные разрешаются один раз по источникам; `MANUAL`, `IMPORTED`, `CLEARED` и исторические `UNKNOWN/FAILED/ABSENT` сохраняются. Новые обычные назначения получают положительный исход/формулировки RU/KZ. По отдельному прямому требованию пользователя английские поля, импорт и приложение исключены из нового цикла; исторические payload и выданные bytes сохранены.

Autosave сохраняет рабочую заявку. Явная передача выполняет подготовку и проверку выбранного состава, после чего фиксирует эффективные значения и provenance в защищённом `resolvedSnapshot`; директор и выпуск используют эту же редакцию. Старые scoped/unscoped PENDING отличимы от готовых и могут быть подготовлены к повторной передаче без изменения исторического payload. Исходный пример с 21 замечанием (1 ФИО, 7 полей БиОТ, 1 БИН, 3 профессии ПС, 9 неизвестных исходов) разобран по источникам: это не 21 независимый ввод и не основание автоматически объявить старых людей сдавшими.

Статус этой записи — `IMPLEMENTED_LOCAL_ACCEPTANCE_PASS_DEPLOYMENT_PENDING`. Свежие lint, `pnpm -r typecheck` без повторного Prisma generate и полный build + финальный web build выполнены; web BUILD_ID `gVC7Zgp2WckAGi0Tyx9zV`. Domain full: 204/206 PASS, затем исправлены два устаревших ожидания EN и соответствующий suite 8/8 PASS. Web full: 217/218 PASS, затем исправлено одно устаревшее ожидание EN и suite 4/4 PASS. Это покрытие 424 разных unit-кейсов через full + targeted reruns, **не один непрерывный зелёный `pnpm test`**. Затем добавлен один helper regression для общих knowledge/proctoring и персональных MANUAL/CLEARED: соответствующий suite 3/3 PASS, всего 425 разных покрытых кейсов; повторный full run 425/425 не заявляется. Эта последняя правка только в тесте, без изменения application/UI source. Новые approval/freeze/readiness проверки 9/9 PASS; issuance-batches после исправления точного состава 6/6 PASS; director-approval 7/7 выполнен раньше последующих правил EN/freeze. Registration/upgrade 10/10, импорт RU/KZ 14/14. Полный повтор всех integration/renderer/E2E этой записью не заявляется.

Свежий Excel400 уже прошёл настоящий UI-импорт одной заявкой, общие курсы, передачу и одно решение директора: 1 загрузка XLSX, 1 подтверждение состава, 3 выбора курса, 1 неизвестное название компании, 2 общие длительности, 0 диалогов каждого человека/ручных разбиений/повторных общих вводов. Это проверка состава и решения, не выпуск 400 файлов. Независимый настоящий CUA-цикл новой организации и одного человека с ИТР+ПС прошёл autosave/reload → передачу → сводку директора без замечаний → одно согласование → явный выпуск: 5 документов, 10 фактических DOCX/PDF, 22/22 jobs SUCCEEDED (10 preview + 12 final). Для ordinary ИТР не понадобились БИН/адрес/отрасль/knowledge/proctoring; введены только необходимые по выбранному графику 8 часов ПС. Хеши всех 10 скачанных файлов повторно сверены; текст ФИО/номеров, профессия ПС и отсутствие EN/неподставленных placeholders проверены. Фактические 2 страницы ПС-карточки и 1 страница ИТР-сертификата открыты и просмотрены. [Санитизированный CUA readback и скриншоты](autofill-cycle-20261005/cua-workflow-readback.json).

Свежий ручной цикл 20 человек завершён на той же заявке: 105 документов, 212/212 original jobs SUCCEEDED (105 DOCX + 105 PDF + XLSX + ZIP), скачаны 22 образца всех 11 видов в двух форматах, проверены live API SHA и фактический текст/состав. Исходный запуск трёх E2E сохранил 2 PASS и 1 ORIGINAL_RENDER_TIMEOUT: UI20 уже выпустил документы, но очередь не уложилась в ожидание. После увеличения локальных worker с 1 до 4 выполнен отдельный read-only resume той же заявки, PASS за 35,5 с; новых людей/выдачи не создавалось. Отдельный UI исключений PASS: UNKNOWN/FAILED/ABSENT, ручной срок, CLEARED-часы, повторный курс и reload сохраняются. Не утверждается, что исходный тройной run был непрерывно зелёным. [Компактный browser readback](autofill-cycle-20261005/browser-workflow-readback.json), [текст 22 фактических файлов](autofill-cycle-20261005/manual20-artifact-text-readback.json).

Настоящий CUA-путь старой синтетической PENDING также завершён: подготовка → явная повторная передача → новая PENDING revision13, 9 назначений/4 курса, 0 замечаний. Старый payload SHA и 9 UNKNOWN неизменны, прежняя редакция SUPERSEDED. [Read-only подтверждение](autofill-cycle-20261005/legacy-ui-readback.json) и два скриншота сохранены. Сопоставление вводов: раньше 27 полей, теперь 26; три лишних SPECIAL-поля ordinary ИТР устранены, а свежий сценарий дополнительно вводит KZ-должность и нового работодателя. Это разные наборы исходных данных, поэтому общий процент ускорения не заявляется.

Проверены фактические DOCX/PDF 16 ordinary-форм (20 страниц) и 3 SPECIAL-форм (3 страницы), текст и все PNG просмотрены; в этих синтетических вариантах нет найденной обрезки/пересечений или потери KZ-глифов. Исходные шаблоны не изменены. Синтетическая registry-проверка подтверждает append-only регистрации, неизменность исторического snapshot/artifact/HTTP SHA и побайтное воспроизведение прежнего renderer. Два исходных foreign dirty web-конфига после последней сборки восстановлены по точным blob-хешам baseline; чужая старая acceptance-матрица не редактировалась.

Публикация пока не выполнена в рамках этой записи. Резервные архивы уже проверены по SHA и содержимому 58 файлов; заголовок и TOC дампа проверены, полного восстановления БД не было. Результаты production migration/deploy/smoke добавляются только по факту. Новая [матрица приёмки и действий](autofill-cycle-20261005/acceptance-matrix.json), [матрица источников и печатных полей](autofill-cycle-20261005/field-matrix.md), [визуальная проверка](autofill-cycle-20261005/visual-review.json), [сохранение истории](autofill-cycle-20261005/registration-history-upgrade.json). Microsoft Word, физическая печать, юридическое утверждение и действительная НУЦ-подпись в эту узкую проверку не входят.
