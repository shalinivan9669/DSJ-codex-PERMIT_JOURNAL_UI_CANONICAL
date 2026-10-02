# Проверка основного функционала DEMO — 30 сентября 2026

**Статус отчёта: локальные функциональные проверки завершены; работоспособность и сохранность данных после восстановления стенда подтверждены 30.09.2026 в 09:40 +05:00.** Основной проверенный путь работает: вход → заявка → RU/KZ данные → сохранение → проверка → предпросмотр → явное оформление → DOCX/PDF/XLSX/ZIP → история → отдельное исправление. В браузере также проверены импорт 250 получателей, сохранность последних введённых символов и восстановление сохранения после недоступности API. Найден небольшой дефект передачи заголовка SHA256 через web proxy; содержимое скачанных файлов корректно. Ниже результаты разделены по фактически выполненным проверкам и их границам.

**Исходники и окружение.**

| Параметр | Значение |
| --- | --- |
| Ветка | `codex/ot-center-dsj-forms-ux` |
| Проверенный HEAD | `0a44022e7962f32fef4b0d03edb18349ad2ef0b9` |
| Worktree | `C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL` |
| Продукт | `dsj2/products/demo` внутри указанного worktree |
| Node / pnpm | `v24.16.0` / `11.27.1` |
| Web текущей проверки | `http://localhost:3120`, свежая production-сборка Next.js |
| API текущей проверки | `http://127.0.0.1:4120`; web proxy — `http://localhost:3120/api` |
| Каталог сборки | `apps/web/.next-functional-audit-20260930` |
| BUILD_ID | `lxT_h3OCuGxT2JTVFRMMm` |
| Данные UI | Отдельная disposable PostgreSQL БД и синтетический центр; свой каталог файлов и worker |
| Данные интеграционных тестов | Другая disposable PostgreSQL БД, отдельно от UI-стенда |

В начале проверки прежний web на `localhost:3119` был недоступен, тогда как API на `4119` отвечал 200 на `/health`. Этот health-ответ сам по себе не подтверждал работоспособность пользовательского пути или renderer. Поэтому текущая функциональная проверка выполнена на отдельно подготовленном стенде `3120/4120` с новой сборкой. Выражение «production-сборка» здесь означает результат `next build` и его локальный запуск; полный бизнес-цикл внешней production-площадки не проверен, её обновление не выполнялось.

Во время аудита произошёл сброс инструментальной сессии с прекращением локальных runtime-процессов. Прерванный renderer завершён отдельным запуском оставшихся проверок. Синтетический стенд восстановлен и заново проверен реальными HTTP-запросами; наличие старого PID-файла не использовалось как свидетельство доступности.

Финальная проверка после восстановления процессов: **12/12 PASS**, зафиксировано `2026-09-30T04:40:21.067Z` / 09:40:21 +05:00. Web `3120`, API `/health` и аутентифицированный `/ready` отвечают 200; установлены 11 шаблонов, `storage: ok`, worker heartbeat `2026-09-30T04:40:14.717Z`. Все три синтетические заявки пережили перезапуск: оформленная — FINALIZED, revision 5, один документ и четыре прежних финальных файла с исходными SHA256; исправление — DRAFT, revision 2, сохранён полный текст проверки offline-сохранения с окончанием `456`; организация — DRAFT, revision 4, сохранён последний из 250 получателей. Вход и выход также прошли. Машинная сводка: [final-runtime.json](../.runtime/functional-audit-20260930/final-runtime.json).

Исходное tracked-дерево перед проверками было чистым. Код продукта не изменялся. Сборка автоматически изменила `apps/web/tsconfig.json` и `next-env.d.ts`; оба файла восстановлены побайтно из предварительно сохранённых копий, контрольные суммы совпали. Добавлены этот отчёт и [машинная сводка](evidence/functional-audit-20260930/summary.json), дополнены progress и acceptance matrix с сохранением прежних записей. Legacy DSJ, frozen-модули и рабочие данные не использовались для подготовки тестового центра.

**Опубликованный сайт: отдельная проверка чтением.**

На 30.09.2026 в 09:41 +05:00 выполнен ограниченный smoke [опубликованного DEMO](https://dsj-demo-operator-ux-20260929.vercel.app), адрес взят из существующих release evidence. `/login` и `/register` возвращают HTTP 200; отрисовка и работа этих форм через браузер на внешнем сайте не проверялись. Frontend `/api/health` и Railway backend `/health` возвращают 200, `status: ok`, `product: DEMO`. Anonymous `/api/context` и `/api/ready` ожидаемо возвращают 401.

Вход существующего синтетического acceptance аккаунта — 201; session/context — 200 с подтверждением нужного synthetic tenant; readiness — 200 / ready; logout — 201. Регистрация, бизнесданные, настройки, документы, очереди и deployments не менялись. Текущий активный Railway deployment `90932447-3d40-48c3-85d8-c5f84ce38e2e` имеет SUCCESS и SHA `0a44022e7962f32fef4b0d03edb18349ad2ef0b9`, совпадающий с проверенным локальным HEAD. Чтение Vercel deployment metadata вернуло HTTP 403: текущий SHA frontend и привязка alias к deployment этим запросом не подтверждены. Это ограничение доступа к метаданным, а не отказ публичного сайта. Доказательство: [production-readonly.json](../.runtime/functional-audit-20260930/production-readonly.json).

**Выполненные инженерные проверки.**

| Проверка | Результат | Доказательство |
| --- | --- | --- |
| `pnpm lint` | PASS, exit 0 | [lint.log](../.runtime/functional-audit-20260930/checks/lint.log) |
| `pnpm -r typecheck` | PASS во всех пакетах с typecheck; без `db:generate` | [typecheck.log](../.runtime/functional-audit-20260930/checks/typecheck.log) |
| `pnpm test` с закреплённым Python | 179/179 PASS: 103 основных и 76 web; 0 failures, 0 skipped | [unit-pinned-python.log](../.runtime/functional-audit-20260930/checks/unit-pinned-python.log) |
| `node scripts/verification/autonomy.mjs` | PASS: 8 manifests, 279 source files, 16 выбранных шаблонов, 0 внешних DSJ dependencies | [autonomy.log](../.runtime/functional-audit-20260930/checks/autonomy.log) |
| `pnpm --filter @demo/web build` | PASS, 116,82 с, отдельный dist-каталог | [build.log](../.runtime/functional-audit-20260930/checks/build.log) |
| Startup/supervisor tests | 4 PASS, 1 явный Windows skip | [deployment.log](../.runtime/functional-audit-20260930/checks/deployment.log) |
| `pnpm audit --prod --audit-level high` | PASS: известных уязвимостей не найдено при этом запросе | [dependency-audit.log](../.runtime/functional-audit-20260930/checks/dependency-audit.log) |
| HTTP smoke на proxy и direct API | 168/168 ожидаемых статусов PASS | [http-summary.json](../.runtime/functional-audit-20260930/http/http-summary.json) |
| Интеграционные тесты | 137 сценариев исходного набора подтверждены по совокупности запусков: 136 PASS сначала, затем 4 PASS в целевом повторе упавшего файла, включая вложенные проверки | [suite.log](../.runtime/functional-audit-20260930/integration/suite.log), [public-verification-recheck.log](../.runtime/functional-audit-20260930/integration/public-verification-recheck.log) |
| Renderer | Все 43 уникальных теста PASS по двум запускам: 25 до сброса и 18 после; повтор завершён без failures/errors/skips | [test-render.log](../.runtime/functional-audit-20260930/render/test-render.log), [resume-result.json](../.runtime/functional-audit-20260930/render/resume-result.json) |
| Финальная проверка после перезапуска стенда | 12/12 PASS: web/API/worker готовы; три заявки и четыре финальных файла сохранились | [final-runtime.json](../.runtime/functional-audit-20260930/final-runtime.json) |
| Дополнительный typecheck корневых scripts/tests | FAIL: 83 diagnostics; отдельно от успешного package typecheck | [root-typecheck-diagnostics.json](../.runtime/functional-audit-20260930/checks/root-typecheck-diagnostics.json) |
| `pnpm format:check` | FAIL: 105 исходно неотформатированных файлов | [format.log](../.runtime/functional-audit-20260930/checks/format.log) |

Сводка команд и окружения: [checks/summary.json](../.runtime/functional-audit-20260930/checks/summary.json). Полный `pnpm build`, включающий Prisma generation, не выполнялся: проведены package typecheck и реальная web-сборка без регенерации используемой API DLL.

Первый `pnpm test` был запущен без `DEMO_PYTHON`: системный `C:/Python314/python.exe` не содержал `pypdf`. Получено 81 PASS и 22 FAIL с `PDF_VALIDATOR_UNAVAILABLE`; web-часть тогда не запускалась из-за `&&`. После задания `.runtime/venv/Scripts/python.exe` с `pypdf 6.19.0` весь набор 179 тестов прошёл. Первичный [unit.log](../.runtime/functional-audit-20260930/checks/unit.log) сохранён как свидетельство ошибки конфигурации окружения. Это не представляется как дефект PDF-валидации при правильном runtime.

**Браузерный пользовательский путь.**

Выполнены 24 наблюдаемых сценария через управляемый настоящий браузер, работающий со свежей web-сборкой, реальными API/PostgreSQL/renderer и синтетическими данными. Перечень и границы зафиксированы в [browser/summary.json](../.runtime/functional-audit-20260930/browser/summary.json). Полный репозиторный Playwright e2e suite в этом аудите не запускался; приведённые ниже результаты относятся к выполненным браузерным действиям.

| Область | Проверенное поведение |
| --- | --- |
| Вход | Неверный пароль отклонён с понятной ошибкой и correlation ID; правильный синтетический логин открывает заявки. |
| Новая заявка человека | Поле имени получает фокус. Проверка пустого черновика показывает обязательные имя/документ и необходимость исправлений перед оформлением. Переход по замечанию переводит фокус в отсутствующее имя. |
| RU/KZ | Независимые русские и казахские значения сохраняются и восстанавливаются после reload. |
| Документ ПТМ | Выбор формы, программа и результат сохраняются; заполненная синтетическая заявка проходит серверную проверку. |
| Предпросмотр | Созданы реальные DOCX и PDF. PDF открыт в Chrome и визуально проверен. |
| Оформление | Явное подтверждение создало `PTM-CARD-00001`; исходная заявка стала оформленной и недоступной для обычного редактирования. |
| История | Поиск находит оформленную заявку и открывает оригинал. |
| Исправление | Создан отдельный черновик исправления; оригинал сохраняет статус FINALIZED. |
| Сохранение при навигации | Сразу после последних символов выполнен Back; переход дождался сохранения. Forward восстановил полный текст, включая окончание `987`. |
| Ошибка сети/API | После намеренной остановки только тестового API `4120` Save показал недоступность/несохранённое состояние, текст остался в редакторе. Back не увёл с текущего URL с несохранённым текстом. После восстановления API явный retry сохранил revision 2; reload восстановил полный текст. |
| Заявка организации | Превышение суммарной ёмкости 251 получателя показало объяснение и заблокировало применение. После удаления пустой стартовой строки импорт 250 строк применился. |
| Импорт 250 | После reload сохранены количество и последний получатель. Поиск находит `AUDIT-20260930-250`; казахское имя и табельный номер `00250` сохранены. |
| Мобильная ширина | При viewport 390 px измеренные document/body — 375 px; общего горизонтального переполнения страницы нет, широкая таблица прокручивается внутри своего контейнера. |
| Заказчики | Синтетическая организация создана из редактора; формы ТОО/ЖШС и RU/KZ значения совпадают со справочником. |
| Навигация | Открыты все три вкладки workbench и форма настроек. |

Идентификаторы синтетических заявок: оформленная — `c765f972-66ce-48b0-9693-373a37f9469a`; исправление — `f8f839a5-07e2-4607-a783-0d6ebb4b83fa`; организация с 250 получателями — `ec2117ba-8486-4137-950e-7d44f78834be`.

Снимки реального браузера: [финальный PDF в Chrome](../.runtime/functional-audit-20260930/browser/final-pdf-chrome.png), [ошибка сохранения при недоступном API](../.runtime/functional-audit-20260930/browser/save-failure.png), [сохранение после восстановления API](../.runtime/functional-audit-20260930/browser/save-recovered.png). На финальном PDF видны номер `PTM-CARD-00001` и маркировка синтетического документа.

Встроенный браузер Codex показывал пустую/чёрную область PDF, тогда как тот же файл отображался в Chrome. Это зафиксировано как ограничение встроенного просмотра; оно не приписывается повреждению PDF или отказу генерации. Дополнительный необязательный конфликт двух вкладок после сброса браузерной сессии не был выполнен и не считается дефектом сайта.

**HTTP, доступ и заголовки.**

HTTP smoke выполнен для синтетического ADMIN и anonymous на обоих origins. Проверялись статические GET-маршруты из product allowlist, кроме полного tenant export, несколько GET-маршрутов конкретной заявки, вход/выход и отрицательные запросы. Материалы: [компактная сводка](../.runtime/functional-audit-20260930/http/http-summary.json), [полные ответы статусов и выбранных заголовков](../.runtime/functional-audit-20260930/http/http-details.json).

- `/health` отвечает 200. Аутентифицированный `/ready` отвечает 200: `storage: ok`, 11 установленных индивидуальных шаблонов, свежий worker heartbeat, renderer `demo-ooxml-7/libreoffice-26.2.6.3`.
- `/context`, доступные ADMIN списки и чтение заявки отвечают ожидаемо. Employer-only portal для ADMIN возвращает ожидаемый 403.
- Anonymous на защищённых маршрутах получает 401. После logout прежняя сессия также получает 401.
- Неизвестный маршрут, `/training`, `/signing`, `/v1/printing/context`, `/journals` возвращают 404 и для anonymous, и для ADMIN. Запрос с `next-action` отклоняется 404.
- `/dossier/reminders` без обязательной даты `asOf` корректно возвращает 400 `VALIDATION`; с `asOf=2026-09-30&withinDays=30` — 200.
- Все 74 успешных HTTP-ответа имеют `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` и correlation ID. У успешных proxy-ответов также есть `X-Frame-Options: SAMEORIGIN` и `Referrer-Policy: same-origin`.
- Session cookie имеет `HttpOnly` и `SameSite=Strict`. Все созданные этим HTTP-прогоном сессии завершены logout.

Эта проверка подтверждает перечисленные маршруты и роли, но не является заявлением о проверке каждой комбинации ролей, всех замороженных URL, всех server actions или production-origin.

**Финальные документы и целостность скачивания.**

Для заявки `c765f972-66ce-48b0-9693-373a37f9469a` подтверждены статус FINALIZED, один issuance `a854e065-290d-429e-9134-6d5258ba6b57`, один документ и четыре финальных артефакта. Два прежних preview-артефакта отделены от финальных по `issuanceId`. Все шесть заданий preview/final завершились SUCCEEDED.

Каждый финальный файл скачан через web proxy и direct API: восемь реальных скачиваний. SHA256 вычислен по полученным байтам и сравнен с API-метаданными и записью БД; размеры сверены теми же способами. Все совпадения подтверждены. Anonymous-скачивание каждого файла отклонено 401.

| Формат | Размер | Скачивание proxy/direct | Проверка структуры |
| --- | ---: | --- | --- |
| DOCX | 24 950 байт | 200/200, SHA256 и размер совпадают | CRC архива исправен, 11 XML-частей разбираются, `word/document.xml` присутствует |
| PDF | 82 119 байт | 200/200, SHA256 и размер совпадают | 1 страница, без шифрования, текст извлекается; визуальный просмотр в Chrome выполнен отдельно |
| XLSX | 6 432 байта | 200/200, SHA256 и размер совпадают | CRC и XML исправны, 1 лист и 2 строки |
| ZIP | 97 185 байт | 200/200, SHA256 и размер совпадают | 5 вложений, безопасные пути, корректный CRC и manifest |

В ZIP находятся `STATUS.txt`, `manifest.json`, DOCX, PDF и XLSX. Manifest содержит `complete: true`, `readyCount: 3`, `expectedCount: 3`, `missing: []`. Хеши и размеры всех трёх документов внутри ZIP совпадают с manifest и отдельно скачанными финальными артефактами. PDF-артефакт: `ace5ccab-3c65-430e-8f45-d39e111cbc33`.

Доказательства: [artifact-summary.json — HTTP/БД/SHA256](../.runtime/functional-audit-20260930/http/artifact-summary.json), [artifact-structure.json — структура и manifest](../.runtime/functional-audit-20260930/http/artifact-structure.json). Общий `pass: false` в `artifact-summary.json` относится к отсутствующему ответному SHA-заголовку proxy, описанному ниже; сравнения самих байтов и размеров в этом же файле успешны.

**Обнаруженные проблемы и предупреждения.**

| Наблюдение | Влияние и точное основание |
| --- | --- |
| Minor: web proxy не передаёт `X-Content-SHA256` | Все четыре файла через proxy приходят без заголовка; direct API возвращает правильный SHA. Байты и размеры файлов на обоих путях совпадают с БД. В `apps/web/app/api/[...path]/route.ts:99` список передаваемых заголовков не содержит `x-content-sha256`; API выставляет его в `apps/api/src/controller.ts:457`. Дефект подтверждён текущими HTTP-запросами, не исправлялся в рамках проверки. |
| Пробел статической проверки корня | Package typecheck успешен, но `package.json:15` использует `pnpm -r typecheck`, не охватывающий корневые scripts/tests из `tsconfig.json:3`. Дополнительный `pnpm exec tsc --noEmit --incremental false` дал 83 diagnostics: 33 TS2339, 18 TS2694, 15 TS7006, 10 TS2307, 3 TS18047, 2 TS2783, по 1 TS2322 и TS7022. Часть ошибок связана с отдельным контекстом разрешения зависимостей и типов тестов. Это самостоятельный результат статического анализа, а не доказательство отказа runtime. |
| Форматирование | `pnpm format:check` обнаружил 105 файлов с исходными расхождениями стиля. Выполнялся только `--check`; массового форматирования и правок не было. |
| Предупреждения build | `apps/web/app/globals.css:1985`: `align-items: end` имеет неодинаковую поддержку браузерами; Next сообщает об отсутствии Next ESLint plugin. Build завершился успешно. |
| Windows-ограничение startup test | Linux process-group SIGTERM scenario явно пропущен по `process.platform === "win32"` в `tests/deployment/railway-start.test.mjs:108`. Остальные 4 startup/supervisor теста прошли. |
| Ошибка первоначальной shell-конфигурации | Системный Python без pypdf привёл к 22 падениям первого unit-прогона. Повторный прогон с закреплённым Python прошёл полностью; ошибка окружения сохранена отдельно. |

Примеры diagnostics дополнительного корневого typecheck: `scripts/verification/final-history-fixture.ts:101` — повторное поле `email`; `tests/integration/forms-ux-bundles.test.ts:105` — несовпадение типа результата с `events`; `tests/integration/security-acceptance.test.ts:557` — несовместимость Buffer/BlobPart. Полный набор без сокращений доступен в [root-typecheck.log](../.runtime/functional-audit-20260930/checks/root-typecheck.log).

**Интеграционные тесты: подтверждённый результат по нескольким запускам.**

Первоначальный `pnpm test:integration` зарегистрировал 137 сценариев: 136 PASS, 1 FAIL, 0 skipped. Упавший public-verification сценарий выполнялся в shell без обязательного `DEMO_ORIGIN`; первоначальный процесс завершился с exit 1. После явного задания `http://localhost:3120` файл `tests/integration/public-verification.test.ts` запущен повторно: 4/4 PASS, 0 failures/cancelled/skipped, exit 0. Четыре результата повторного запуска включают родительский сценарий и его вложенные проверки.

Таким образом, 137 сценариев исходного полного набора закрыты успешными выполнениями по совокупности запусков. Счётчики 136 и 4 сохранены раздельно, чтобы не смешивать исходный набор с вложенными тестами целевого повтора. Единый полный зелёный rerun интеграционного suite не заявляется.

Текущие доказательства: [execution.json](../.runtime/functional-audit-20260930/integration/execution.json), [suite.log](../.runtime/functional-audit-20260930/integration/suite.log), [public-verification-recheck.json](../.runtime/functional-audit-20260930/integration/public-verification-recheck.json), [public-verification-recheck.log](../.runtime/functional-audit-20260930/integration/public-verification-recheck.log), [scope.json](../.runtime/functional-audit-20260930/integration/scope.json). Отдельная business execution: [business-execution.json](../.runtime/functional-audit-20260930/integration/business-execution.json).

**Renderer: все 43 уникальных теста выполнены успешно по двум запускам.**

В первоначальном `test-render.log` есть явные успешные результаты 25 тестов. Процесс оборвался при инструментальном сбросе до итогового footer, поэтому успешный exit всего первоначального запуска не заявляется. Затем выполнены только 18 оставшихся тестов: `resumedTestsRun: 18`, `failures: 0`, `errors: 0`, `skipped: 0`, `success: true`. Полный список 43 тестов разделён на `completedInInitialLog` и `resumed` в [resume-result.json](../.runtime/functional-audit-20260930/render/resume-result.json); пересечения и повторный зачёт уже завершённых тестов не требуются.

Среди фактически выполненных сценариев — действующие формы DOCX/PDF, длинные RU/KZ значения, исходные байты шаблонов и геометрия, фото, безопасный XLSX/TSV, независимые даты, ограничения XML, QR, комплект файлов и групповые протоколы. Проверены реальные протоколы на 1/2/25/100/250 строк, PDF ПТМ на 250 участников с сохранением порядковых номеров и повторением заголовков, а также отказ при 251 участнике. Отдельный тест индивидуального DOCX сохраняет 250 получателей и отклоняет 251. Эти renderer-тесты не означают, что в браузере оформлены 250 отдельных индивидуальных документов.

Доказательства: [первоначальный лог](../.runtime/functional-audit-20260930/render/test-render.log), [лог 18 оставшихся тестов](../.runtime/functional-audit-20260930/render/resume.log), [результат возобновления](../.runtime/functional-audit-20260930/render/resume-result.json), [перечень возобновлённой области](../.runtime/functional-audit-20260930/render/resume-scope.json), [runtime-current.json](../.runtime/functional-audit-20260930/render/runtime-current.json), [runtime-health.json](../.runtime/functional-audit-20260930/render/runtime-health.json), [fonts-current.json](../.runtime/functional-audit-20260930/render/fonts-current.json), [visual-review.json](../.runtime/functional-audit-20260930/render/visual-review.json). Визуально проверенный браузерный ПТМ-документ остаётся дополнительным независимым свидетельством основного пользовательского пути.

**Что текущий аудит не подтверждает.**

- Оформление и генерация 250 отдельных индивидуальных документов через браузер не выполнялись. Подтверждены импорт, сохранение, повторное открытие, поиск и сохранность полей для 250 получателей, а также отдельный полный выпуск одного ПТМ-документа.
- Полный репозиторный Playwright suite не запускался. 24 сценария реального браузера и 168 HTTP-проверок не подменяют его перечень.
- Физическая печать, двустороннее совмещение на принтере, юридическая пригодность форм и исследование удобства с реальными операторами не проводились.
- Полный бизнес-цикл внешней production-площадки, production cutover и обработка рабочих очередей этим аудитом не подтверждены. Production cutover и обновление production не выполнялись; успешный отдельный read-only smoke опубликованного адреса не заменяет проверку полного бизнес-цикла.
- Успешный просмотр PDF в Chrome и проверка ZIP/XML не означают новую проверку редактирования в Microsoft Word/Excel или всех поддерживаемых браузеров.

Все ссылки на `.runtime/functional-audit-20260930` указывают на локальные доказательства текущего запуска. Эти runtime-артефакты не следует считать автоматически включёнными в Git или доступными в другом checkout. Пароли, session cookies, CSRF и строки подключения в отчёт не включены; private env-файлы не являются материалами для публикации.
