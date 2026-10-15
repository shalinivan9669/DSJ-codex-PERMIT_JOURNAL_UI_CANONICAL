# Агент A: домен LMS, закрытые материалы, новые формы и сохранность данных

Проверки выполнены локально на синтетических данных. Рабочие внешние системы, production, ЭЦП и физическая печать не использовались. Ветка общей команды: `codex/lms-one-run-20261015`. Основной продукт: `dsj2/products/demo`.

## Фактическая приёмка

| Проверка | Результат | Доказательство |
|---|---|---|
| Экзамены, 8 одновременных стартов/отправок, GT80, серверный дедлайн, повторы, внешний источник, VOIDED projection | PASS, 16 тестов вместе с родительскими группами | `domain-materials-gc.log`, `tests/integration/lms-exams.test.ts` |
| Закрытый MP4/PDF, multipart, роли/tenant/назначение/предшествующий урок, Range, seek/replay/подмена прогресса, истечение, повреждённые байты | PASS, 6 тестов вместе с родительской группой | `domain-materials-gc.log`, `tests/integration/lms-materials.test.ts` |
| GC сохраняет старый шаблон и новые LMS material/external/manual evidence; сирота определяется отдельно | PASS, 1 тест | `domain-materials-gc.log`, `tests/integration/lms-storage.test.ts` |
| Настоящее воспроизведение видео в Chrome: перемотка без завершения, play/pause, reload, продолжение с сохранённого места и естественное завершение | PASS, 1 browser test | `video-browser/PLAYBACK_ACCEPTANCE.json`, `01-paused.png`, `02-completed.png`, runner result |
| Web proxy: материал больше старого лимита 5 МБ, точный Range, private cache/CSP, лимиты Content-Length и chunked body | PASS | `PROXY_ACCEPTANCE.json` |
| Обновление baseline f8a9a66 и свежая установка с backup/restore/verify | PASS | `STORAGE_ACCEPTANCE.json` |
| Алгоритмы прогресса/оценки/Range и существующий строгий PDF validator | PASS, 25 тестов | `domain-unit-pdf.log` |
| Три новые LMS формы, DOCX/PDF/PNG, provenance, юридический вид, batch и preflight | PASS, 5 тестов плюс отдельный PASS локальной даты | `../lms-render/FILES.json`, `render-date.log`, `tests/render/test_lms_render.py` |
| Неизвестная дата внешнего экзамена, немедленный внутренний список, блок документов, отдельное новое основание с датой; закрытое ручное доказательство HTTP/hash/scope | PASS, 4 теста вместе с родительской группой | `external-exams-final.log`, `tests/integration/lms-source-review.test.ts` |
| Сохранённая выборка 5 из 9 вопросов RU/KZ с несколькими ответами и категориями при новой версии банка; submit/deadline race и replay в новом процессе; дробная граница и пустой ответ | PASS, 3 теста | `exam-boundaries.log`, `tests/integration/lms-exam-boundaries.test.ts` |
| Допуск к экзамену на границе локальной полуночи профиля | PASS, 1 целевая проверка | `exam-midnight.log` |
| Traversal, публичный путь к storage, действительный recovery token другого назначения и Range без назначения | PASS, 1 тест | `material-boundaries.log`, `tests/integration/lms-material-boundaries.test.ts` |
| Две разные ссылки восстановления одного пароля одновременно | FAIL воспроизведён до исправления; PASS после общего user lock | `recovery-race-before.log`, `recovery-race-after.log` |
| Настоящая обработка восстановленного pending outbox двумя работниками и повтор новым процессом | PASS: по одному result/batch item/journal/delivery, затем 0 обработанных повторно | `RESTORED_OUTBOX_ACCEPTANCE.json`, `restored-outbox.log` |
| Учёт подтверждённых/неизвестных субъектов и межtenant граница через HTTP; неизвестная роль через настоящий HTTP в отдельной БД | PASS, 3 теста с родительской группой | `accounting-boundaries.log`, `UNKNOWN_ROLE_ACCEPTANCE.json` |
| Явные требования практики/прокторинга, отсутствующая комиссия, закрытые проекции слушателя до/после завершения, позднее подтверждение и неизменяемый первоначальный календарный срок | PASS, 6 тестов с родительской группой | `route-calendar-boundaries.log`, `tests/integration/lms-route-calendar-boundaries.test.ts` |

Общий повтор доменных интеграционных проверок: **23/23 PASS**, без пропусков. Прямой API Range отдельно не доказывал работоспособность браузерной перемотки: реальный браузер обнаружил отсутствие Range headers в Next proxy. После исправления browser acceptance завершилась успешно. Время паузы `6.195398` секунды точно восстановилось после reload; сохранённый интервал дошёл до конца 12-секундного ролика.

В proxy LMS загрузки теперь идут ограниченным потоком в дисковый API upload handler: до 512 МБ для материала и до 20 МБ для внешнего основания плюс ограниченная multipart оболочка. Исторические маршруты сохранили прежние ограничения и буферную обработку. Проверена загрузка 7 276 053 байт, превышение заголовка размера и chunked 22 МБ с ответом 413. Ответы Range сохраняют private/no-store и CSP sandbox.

Дополнительные группы не подменяют весь набор критериев. Первый video PASS доказывает reload, а добавленный сценарий logout/login должен подтверждаться свежим full-suite журналом команды. Самостоятельные targeted server tests проверены без повторного запуска уже пройденных тяжёлых наборов. Общий актуальный результат всей LMS фиксирует координатор.

Учёт субъектов проверен через HTTP: в собственном tenant 2 подтверждённых связи, 5 записей получателей и 3 неизвестные; в другом — 1/8/7. Совпадающие имена не повышают неизвестную запись до подтверждённого человека. Подмена tenant в query не меняет область, learner/employer получают 403. Неизвестную роль сначала отверг штатный CHECK `user_role` с 23514. Для следующего слоя защиты создана отдельная новая `demo_test_lms_unknown_role_*` БД со всеми 25 миграциями: только в ней временно снят названный CHECK, проверены отказ входа 401 и 403 на восемь действующих GET-маршрутов плюс создание курса. В `finally` тестовые user/session удалены, исходное определение CHECK восстановлено и сверено. Общие БД, миграции и рабочая схема не изменялись.

Флаги `requiresPractice` и `requiresProctoring` отдельно проверены настоящим HTTP: старт получает 409, а проверенный внешний источник сохраняет факт PASSED с `eligible=false`, без outbox и документа. Пустая обязательная комиссия блокирует публикацию с 400; отдельная намеренно повреждённая импортная fixture доказала независимый запрет официального результата после завершения попытки. При `revealAnswers=false` все доступные слушателю catalog/enrollment/attempt/autosave/progress ответы не содержат ключей, в том числе после завершения и повтора submit; PDF и Range отдают только точные исходные байты. Это не отменяет разрешённую ТЗ явную политику раскрытия после завершения.

Поздно проверенный внешний экзамен от 2 октября сохранил deadline 5 октября 18:00 по времени профиля, был отмечен просроченным и не получил новый срок от даты проверки. Создание второй версии календаря с изменённым рабочим днём и повтор обработки outbox не изменили прежние dueAt/dueDate, calendarVersionId, snapshotHash и строки списка.

## Новые документы

Добавлены только новые assets `lms-protocol.v1.docx`, `lms-certificate.v1.docx`, `lms-credential.v1.docx` в `specialTemplates`. Исторические шаблоны не изменялись. Формы обозначают учебный центр и фактический legalForm; неподписанный файл не назван проверенным электронным оригиналом. Внешний источник сохраняет эмитента, номер и дату документа; отсутствующие score/attempt не придумываются. Снимок результата содержит result/profile IDs, источник и состояние подписи без ключей вопросов.

Визуально просмотрены все три созданных образца и все три PDF из настоящей очереди приложения в `../root-documents`. На каждом одна страница; RU/KZ, ФИО, результат, источник и служебные ID читаются, наложения и обрезка не обнаружены. Физическая печать и подпись человеком не проверялись. Найденное различие UTC-даты и даты профиля устранено явным frozen `examDate` в metadata; итоговую проверку новой даты фиксирует `test_06_exam_calendar_date_is_frozen_in_profile_timezone`.

## Обновление и резервная копия

`scripts/verification/lms-storage-acceptance.mjs` экспортирует точную baseline Prisma из Git f8a9a663a5fb26454917f84ed8bb8ca62d503e1b и создаёт собственные одноразовые БД. Имеющиеся БД не заменяются и не очищаются. Фактический финальный прогон: **23 → 25 миграций**; SHA-256 старых Tenant/User/Recipient совпали до/после, исторические MANUAL/PASSED/AUTO не создали ни одного VerifiedExamResult.

Штатный `deployment/backup.mjs` выполнил backup, restore в пустую новую БД и verify: 76 таблиц, 126 assets, один синтетический закрытый файл. Совпали канонические SHA всех строк, количество записей и SHA файла; pending outbox восстановлен. Клиент pg_dump/pg_restore 17 не подходит к локальному PG16 из-за `transaction_timeout`; приёмка использует точные локальные WSL PostgreSQL 16.14 через ограниченный acceptance wrapper, только loopback:55449 и имена demo_test_lms_. Секреты отсутствуют. Это проверка локального восстановления, не production backup.

Затем `scripts/verification/lms-restored-outbox.ts` создал через настоящий домен допустимый синтетический экзамен и pending event, сделал новую штатную резервную копию и восстановил её в `demo_test_lms_outbox_restore_mv8n6i78`. Перед продолжением выполнен штатный verify. Два работника подготовили ровно один внутренний список, журнал и delivery. Новый отдельный Node process повторил цикл: `processed=0`, все количества остались равны одному. Исходные result snapshotHash и контрольный SHA-256 канонического представления байтов закрытого файла сохранились; raw SHA-256 файлов дополнительно проверяет штатный backup verify. Старая отрицательная fixture с `eligible=false` была отменена, а не превращена в разрешённый результат.

## Исправление инфраструктуры PDF

Существующий `tests/fixtures/encrypted.pdf` был испорчен Windows autocrlf: 828 байт Git стали 887 байт с неверными xref offsets. Восстановлены точные bytes HEAD и добавлено правило `*.pdf binary` в локальный `.gitattributes`. Строгая проверка PDF не ослаблялась; 22/22 её тестов проходят, включая зашифрованный источник, активное содержимое, повреждённые потоки и лимиты ресурсов.

## Команды воспроизведения

```powershell
. ./scripts/verification/lms-test-env.ps1 integration
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json --test --test-concurrency=1 tests/integration/lms-exams.test.ts tests/integration/lms-materials.test.ts tests/integration/lms-storage.test.ts
$env:NODE_PATH = Join-Path (Get-Location) 'apps/api/node_modules'
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json --test tests/lms-domain.test.ts tests/pdf-attachment.test.ts
node scripts/verification/lms-storage-acceptance.mjs
pnpm test:render

. ./scripts/verification/lms-test-env.ps1 browser
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json scripts/verification/lms-video-browser-fixture.ts
$env:DEMO_E2E_TRACE='off'
pnpm --filter @demo/web exec playwright test e2e/lms-video-live.spec.ts
node scripts/verification/lms-proxy-acceptance.mjs
```

Для video browser сценария требуются уже запущенные локальные API 4159 и web 3159 из этой ветки и подготовленный синтетический director в отдельной browser БД. Fixtures явно отделены от измерения операторского первичного ввода; browser video тест не заявляет приёмку первичного заполнения курса.

Первый полный `pnpm test:render` завершился за 2465 секунд: 143 теста, 16 несовпадений исторических golden SHA и одна ошибка прежней проверки специальных форм. Исходный журнал `render-full.log` сохранён. Проверка SPECIAL ITR теперь выбирает именно три прежние записи `program=SPECIAL`; новые LMS формы проверяет отдельный набор. Повтор SPECIAL: **1/1 PASS**, `render-special-targeted.log`.

Для исторических файлов отдельно извлечены неизменяемые Git-архивы `8825dfa65f6c2a9b38bd39ee44463d3a0f6b102e` и `8c0833407675d8d31c786f37a55572357d7b9805`. Во всех 16 случаях совпали исходные шаблоны и целые DOCX обоих архивов и текущего кода в Windows. Установлены различия окружений: ZIP `create_system=0/3`; Pillow Windows использует BASIC, Linux — RAQM, что меняет созданные PNG в 11 формах при одинаковом XML. Старые golden SHA не воспроизвелись также в свежем Linux с закреплёнными зависимостями; исходный native runtime этих SHA в старом тесте не был записан. Причина не приписывается изменению XML или LMS.

Исходные исторические SHA оставлены без изменений. Добавлена отдельная Windows reference только из архивного `8c08334`, независимо подтверждённая архивом `8825dfa`: каждый source SHA и каждый целый output SHA сравнивается точно, состав Python/Pillow/FreeType/libxml/zlib/RAQM проверяется; неизвестный Windows runtime получает ошибку. Подробности и все 16 сравнений — `RENDER_BASELINE_DIAGNOSTIC.json`, воспроизводящий скрипт — `pinned-baseline-reproduce.py`, эталон — `tests/fixtures/render-pinned-windows-8c08334.json`. Повтор всего source-fidelity набора: **5/5 PASS**, `render-source-fidelity-targeted.log`.

Полный повтор команды после этих двух исправлений согласован с координатором после тихой проверки нагрузки. Отдельные пройденные целевые проверки не подменяют его окончательный статус.

Поздняя приёмка механического выпуска документов: **8/8 PASS**, без пропусков, фактический exit 0, `document-scheduling.log`. Новый тест создаёт 33 настоящих результата и заявки: 32 старые неподтверждённые заявки не задерживают позднее решение директора и остаются без номеров. Затем более 30 незавершённых реальных выпусков не задерживают поздний PDF, созданный штатной очередью. Отложен только `runAfter` прочих синтетических заданий; выдачи, готовые файлы и подписи не подделываются. Повторены прежние E08–E12: происхождение, корректировка, отзыв публичной записи и запрет чужого файла той же выдачи. Обход ограничен SQL LIMIT, отдельные курсоры requestId меняют лишь порядок работы и безопасно сбрасываются при restart.

Независимый security review актуализирован после проверки внешней даты (3 PASS в `../root-external-date-03.log`) и fairness (8 PASS). `SECURITY_REVIEW.json` содержит актуальные 20 SHA и пустой список открытых замечаний.

Повтор полного рендера `render-full-final.log` завершился фактическим exit 1: 144 теста, 6852,939 секунды, два исключения `subprocess.TimeoutExpired` в двух вариантах неизменённого neutral-batch теста. Остаток таймера стал отрицательным (−3411,735 и −292,282 секунды); Windows отдельно зафиксировал два периода сна/возобновления. Это корреляция с исключением таймера, не несовпадение данных. Тот же целевой тест прошёл обе формы без изменений за 48,150 секунды, actual exit 0 (`render-neutral-diagnostic.log`). Полная команда повторно запущена 2026-10-15T00:37:38.888Z под временной защитой от idle sleep, с отдельными `render-full-final-02.log` и `final-render-02/`; окончательный результат ещё ожидается. Подробности — `RENDER_SLEEP_TIMEOUT_DIAGNOSTIC.json`.

Снимок 163 прежних файлов проверен после повторной записи общего каталога: 100 совпадают по SHA, 63 изменились; все сохранённые копии исходного снимка целы. `RENDER_OUTPUT_REWRITE_COMPARISON.json` перечисляет каждый старый и новый SHA. Файлы не названы byte-identical там, где это не так.

Read-only обзор старых browser assertions и новых restart/date/reporter harness завершён без открытых замечаний: `TEST_ASSERTION_REVIEW.json` хранит исходные структурные сравнения, исправленные три пробела split-checkpoint и все SHA. Все 20 security-review исходников по-прежнему совпадают с записанными SHA. Это проверка исходников; фактический browser verdict остаётся за журналами запуска.

Поздняя сквозная проверка B2C выявила конфликт между пустым вторым написанием ФИО в неизменяемом результате и существующим RU/KZ автоподставлением DEMO. Координатор ввёл единое отображение `documentRecipient` из замороженных данных для bridge и строгой проверки: исходный результат не изменяется, текущий справочник не читается, произвольная подмена запрещена. Независимый source review закрыт; фактический общий повтор **11/11 PASS, 0 skipped, exit 0** подтверждён в `../root-document-projection-01.log` и command JSON. Это включает две одноязычные вариации × три формы, позднюю правку справочника, все шесть подмен полей, чужой employer ID и прежнюю проверку реальных файлов/исправлений/доступа/очереди. SHA metadata и bridge обновлены в `SECURITY_REVIEW.json`; остальные 18 исходников не изменились.

L06 повторный вход теперь фактически принят в browser run C: `../agent-c/critical-lms-20261015-01/lms-video-live/PLAYBACK_ACCEPTANCE.json`, enclosing video testcase `passed` в results.json. Позиция pause/reload/logout/login совпала: **6,015415 с**, после естественного воспроизведения сервер сохранил покрытие до 12 с и completion. `VIDEO_RELOGIN_CLOSURE.json` фиксирует SHA обоих отчётов. Общий critical14 имел 11 PASS и 3 FAIL, поэтому здесь подтверждается только video testcase. В этом запуске список наблюдённых Range-ответов пуст: приёмка Range остаётся отдельными HTTP/proxy доказательствами, не приписывается этому browser запуску.


Полный финальный `pnpm test:render` завершился фактическим кодом 0: 144 теста, 0 ошибок/падений/пропусков, 1884.922 секунды. Начало 2026-10-15T00:37:38.8878332Z, конец 2026-10-15T01:09:09.5225616Z. Лог `render-full-final-02.log`, SHA256 `3863633e7c627fcccc9daf352a7c136d349c5c53d43f03ffbe6ec6d98730d5df`; выходы сохранены отдельно в `final-render-02/`. Прежние неудачные целые прогоны не переименованы и сохранены; подробности фактических sleep/resume и неизменённых таймаутов находятся в `RENDER_SLEEP_TIMEOUT_DIAGNOSTIC.json`.
