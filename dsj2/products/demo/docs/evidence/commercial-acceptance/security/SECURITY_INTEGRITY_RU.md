# API, безопасность и целостность выпуска — новая приёмка

Дата: 22 сентября 2026 года. Область этого отчёта — автономный DEMO, синтетические данные и Windows loopback. Исходники пользователя сохранены. После пользовательского commit `3ad8e6bb5aba016df01da8f387c1bbe19a93011f` оставшиеся изменения учитываются общим хешированным манифестом; commit не выдаётся за ревизию более новых файлов.

## Проверенная среда

Node 24.16.0, pnpm 9.15.9, Python 3.12.14, PostgreSQL 17.11 x86_64 Windows, LibreOffice 26.2.6.3. Созданы отдельные базы `demo_test_security_20260922` и `demo_test_worker_process_20260922{,b,c}` на `127.0.0.1:55432`. Применены пять существующих миграций. Общий PostgreSQL не останавливался; пользовательские данные и применённые миграции не менялись.

Private artifact roots расположены только в `.runtime/security-acceptance-artifacts` и `.runtime/security-process-artifacts*`. Потеря и порча файлов воспроизводились на вновь созданных синтетических fixtures через проверенный путь `ArtifactStore`.

Результат полного интеграционного прогона и время находятся в [integration-final.log](integration-final.log). Дополнительные контракты: [contracts-final.log](contracts-final.log). API/worker typecheck, scoped ESLint и Prettier выполнены без ошибок. Печатная матрица, browser, Linux, backup/restore и общий release gate ведутся основным проверяющим отдельно.

## Проверки с реальными сессиями

В двух созданных организациях заведены ADMIN, OPERATOR и VIEWER. Все шесть пользователей вошли через обычный `/auth/login`; роли не подставлялись в невалидные токены. Выполнены 114 целевых cross-tenant HTTP probes: заявки, validate, preview, finalize, correction, cancellation, XLSX/ZIP export, фото, originals, восстановление, jobs, заказчики, получатели, импорт, шаблоны и пользователи. Чужой объект возвращает 404 для роли, которой разрешена соответствующая операция; VIEWER получает 403 на запрещённую запись.

Проверены свои downloads и SHA-256, отсутствие чужих записей в jobs/search/customers, tenant scope справочников, ограничения users/audit. Отдельно выполнены 144 запроса к закрытым маршрутам с шестью настоящими сессиями и дополнительные anonymous/old-JWT/Next-Action probes. Это доказательство локального нового API; внешние старые DSJ origins этим прогоном не проверены.

Реально проверены logout, истечение сессии, отключение пользователя, смена роли, admin reset и смена собственного пароля: старые tokens получают 401. Проверены Origin/CSRF, cookie HttpOnly/SameSite=Strict и Secure в production header, а также login rate limit с 429 и correlation ID. TLS transport и распределённый limiter не заявляются проверенными по этому локальному тесту.

В multipart HTTP проверены повреждённые изображения, SVG, HTML под именем PNG, лимит 5 МиБ, неподдерживаемый XLSM, макросы, внешние XLSX links и ZIP с 31 МиБ распакованного содержимого. Формула XLSX не вычисляется; строка с единственной формулой остаётся видимой со своим sourceRow и ошибкой. Это набор конкретных опасных fixtures, а не исчерпывающий fuzzing всех форматов.

## Исправленные дефекты и повторная проверка

| Дефект | Исправление | Доказательство |
|---|---|---|
| VIEWER не мог менять собственный пароль из-за общего write guard | Для этой команды требуется действующая сессия, Origin/CSRF и прежний пароль; право записи печатных заявок не требуется | Реальный HTTP 403 → 201 в контролируемом before/after; обе старые сессии отзываются |
| Утрата bytes могла дать архив с именем `complete` без согласия на partial | Полнота определяется проверенным manifest. До согласия — 409, после — `DEMO-PARTIAL.zip`; failed jobs имеют ID/format/reason | Настоящие DOCX/PDF/XLSX и сверка каждой ZIP entry с оригиналом; missing/corrupt/failed fixtures |
| Ошибка макета обнаруживалась после регистрации номера | Реальный renderer preflight выполняется до transaction; внутри transaction повторно сверяется fingerprint под блокировками нумерации и заказчика | Непомещающаяся строка даёт 422 с rowId; нет issuance/новых reservations, тот же черновик можно исправить и выпустить |
| Не передавались reason/education, номер протокола мог подменять номер удостоверения PS | Необязательные поля включены в contract и immutable snapshot. PS получает отдельные credentialNumber/linkedCredentialDocumentId либо пустое значение без карточки | Lifecycle assertions на четыре разных назначения и отдельный PS protocol без карточки |
| `history=true` игнорировался, All statuses и XLSX включали черновики | Строгий query boolean и тот же history filter в export | После 55 новых черновиков: history total=1 против 57 общего списка; 2 строки history XLSX против 102 полного экспорта |
| Строка с единственной формулой исчезала из учёта импорта, canApply оставался true | Renderer сохраняет sourceRow с FORMULA_NOT_ALLOWED; API учитывает ошибки preview | Реальный multipart XLSX: строка 2 видима, canApply=false |
| TypeScript маркировал новые artifacts как renderer v2 при Python v3 | Версии выровнены на `demo-ooxml-3/libreoffice-26.2.6.3`; worker проверяет совпадение при startup | Финальный process drill после обновления; прежние записи не переписываются |
| Некоторые integration tests проверяли только наличие DATABASE_URL | Все проверяют настоящее имя базы `demo_test*` до первой записи | Общий helper `test-database.ts`; рабочая база не используется |

[known-defects-before-after.json](known-defects-before-after.json) и соответствующий log содержат контролируемую реконструкцию прежних guard/naming решений в отдельном тестовом процессе. Это не повторный запуск старого commit. Продуктовые файлы на диске не подменялись. Получены реальные HTTP 403 → 201 и пример `3 DB artifacts / 3 expected`, где прежнее имя было complete при `manifest.complete=false`; исправленный API возвращает 409 или PARTIAL.

Preflight ограничен четырьмя активными проверками и 32 ожидающими, кэш — 2048 записями. Перегрузка даёт 429 до выделения номеров. Для номера проверяется максимальная 12-значная ширина padding. Черновик сохраняет до 500 символов в текстовом поле; непрерывные значения длиннее 80 символов дают русское сообщение с точным полем. Эти ограничения не разрешают сокращать ФИО или выдумывать перевод.

## Целостность и реальные отказы

Lifecycle проверяет 20 конкурентных разных заявок, 20 повторов одного ключа, 20 разных ключей для одной revision, payload mismatch, запрет изменения оформленного документа, отдельную PS registration, историю более 1000 выпусков и сохранение номеров после смены профиля. Preview и retry не расходуют номера. DB immutable triggers защищают snapshots и аудит; correction/cancel сохраняют связи и старые документы.

[process-drill.json](process-drill.json) и [process-drill.log](process-drill.log) фиксируют реальные процессы:

1. Worker принудительно остановлен после наблюдаемого RUNNING и до публикации: artifactCount=0.
2. После естественного истечения lease запущены два worker. Один и тот же snapshot завершился с attempts=2/fencingToken=2 и ровно одним canonical artifact.
3. Найден принадлежащий этим worker процесс `soffice.bin` именно с `--convert-to` и принудительно завершён. Зафиксированы PDF_CONVERSION_FAILED, RETRY и последующий SUCCEEDED. DOCX hash не изменился; канонический PDF один.

Первоначальный отдельный kill на стадии проверки версии конвертера сохранён в `process-drill-converter-version.*`; он не подменяет проверку прерывания преобразования. Предыдущий прогон до выравнивания version label сохранён в `process-drill-before-version-check.*`.

Worker integration также проверяет 20 atomic claims, heartbeat, stale fencing, ограниченные retries, завершение child по timeout/abort, честную реконструкцию, а также GC с active leases и backup-pinned bytes. Отдельный original, удалённый в синтетическом store, отдаёт 503/MISSING; восстановление создаёт новый artifact с RECONSTRUCTED и ссылкой на original SHA, не объявляя утраченными байтами вновь созданный файл.

Сохранены [входной snapshot](process-drill-input.json), [DOCX на 100 синтетических получателей](recovered-100.docx) и [PDF](recovered-100.pdf). Это проверка recovery, декодируемости и hashes, а не ручной просмотр ста страниц. Результаты визуальной приёмки находятся в отчёте печатного агента.

## Воспроизведение

Из корня `products/demo`, с отдельной мигрированной базой:

```powershell
$env:DATABASE_URL='postgresql://demo_local@127.0.0.1:55432/demo_test_security_20260922'
$env:DEMO_ARTIFACT_ROOT=Join-Path (Get-Location) '.runtime/security-acceptance-artifacts'
$env:DEMO_PYTHON='C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:DEMO_SOFFICE=Join-Path (Get-Location) '.runtime/libreoffice/program/soffice.com'
pnpm test:integration
pnpm exec tsx --tsconfig tsconfig.base.json --test tests/contracts.test.ts
pnpm exec tsx --tsconfig tsconfig.base.json tests/integration/known-defects-mutants.ts
```

Для `tests/integration/process-drill.ts` обязательны новая пустая мигрированная база `demo_test_worker_process_*` и отдельный artifact root. Сценарий откажется при наличии старых jobs; его нельзя направлять на общую рабочую очередь.

Сохранены неудачные промежуточные логи: `integration-v4-fixture-failure.log` (устаревший путь тестового шаблона) и `integration-zip-test-lease-failure.log` (новый harness вызывал executeJob без heartbeat). Последний исправлен использованием настоящего heartbeat, как в main worker; lease/fencing ради PASS не ослаблены.

## Граница заключения

Реальные DB/API restart, disk-full и недоступный volume относятся к отдельному operations report; общий PostgreSQL этой задачей не останавливался. Browser XSS, TLS, внешние public origins, полный Linux runtime и backup/restore не получают PASS из локального HTTP результата. Юридическое утверждение форм и физическая печать требуют отдельной фактической приёмки.
