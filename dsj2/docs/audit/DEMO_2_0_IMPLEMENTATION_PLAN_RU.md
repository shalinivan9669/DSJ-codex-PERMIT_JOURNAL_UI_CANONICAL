# DEMO 2.0 — единый план реализации печатного продукта

Основание: аудит от 22.09.2026, исходный commit `161c5ed022c9e2c643e80802d3f9dc2cd496a041`, актуальные уточнения пользователя. Название приложения: **DEMO**.

**Это один законченный реализационный запуск и один набор приёмки.** Пункты ниже задают зависимости работ, а не отдельные релизы, очереди приоритетов или поручения пользователю запускать Codex много раз. Исполнитель проходит весь план, исправляет обнаруженные регрессии и сдаёт собранный результат с доказательствами.

## 1. Какой результат требуется

Оператор учебного центра входит в DEMO, создаёт заявку на человека или организацию, вносит/импортирует получателей, выбирает документы, проверяет данные и макет, оформляет комплект и скачивает файлы. Работа сохраняется при перезагрузке. Номера назначает сервер. Повтор команды или сбой генерации не создаёт повторную выдачу. История содержит точную зарегистрированную редакцию и сохранённые файлы.

В продукт входят:

- корочки, удостоверения, сертификаты и свидетельства BIOT / PTM / PB / PS, их существующие варианты;
- связанные печатные протоколы, реестр и комплект файлов;
- заявки, заказчики, получатели, фото, русские и казахские поля;
- черновики, проверка, регистрация, генерация, история и контролируемые исправления;
- настройки выдающей организации, комиссии, шаблонов и нумерации;
- необходимые доступ, аудит, эксплуатация и резервное восстановление.

**Всё остальное DSJ сохранить в исходниках, заморозить и сделать недоступным всем пользователям DEMO.** Ни администратор, ни `SUPER_ADMIN`, ни старый публичный invite, ни прямой URL/API не должны открыть непечатные функции. Не удалять эти модули и не ремонтировать их бизнес-логику в этом запуске.

Название DEMO — бренд приложения. Оно не подменяет юридическое название выдающей организации. Отдельный режим тестовых данных помечает документы «ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ»; эта отметка не добавляется к рабочим документам только потому, что продукт называется DEMO.

## 2. Окончательное архитектурное решение

### 2.1. Автономный продукт и сохранённый исходник

Создать **`dsj2/products/demo/`** — собственный pnpm workspace, который можно скопировать в пустой каталог, установить, собрать и запустить без DSJ. Не создавать второй полный клон DSJ. Переносить только необходимый печатный код с адаптацией.

```text
products/demo/
  AGENTS.md
  README.md
  package.json / pnpm-lock.yaml / pnpm-workspace.yaml
  apps/
    web/                 # Next.js: только интерфейс DEMO
    api/                 # NestJS: только API DEMO
    render-worker/       # bounded Python/LibreOffice execution
  packages/
    contracts/           # Zod schemas, DTO, product route policy
    database/            # Prisma schema + собственные migrations
    printing/            # mapping, template contracts, numbering policies
    ui/                  # нужные primitives, не оболочка DSJ
  scripts/
    render/              # перенесённые Python helpers
    migration/           # экспорт/импорт legacy, dry-run/reconciliation
    verification/        # fixtures, render QA, release evidence
  assets/
    templates/           # версии + manifest + контрольные примеры
    fonts/               # разрешённые к распространению шрифты
  deployment/            # runtime, compose, health, backup/restore
  docs/                  # оператор, администратор, перенос, ограничения
```

Решения:

- Сохранить Next/React + Nest + Prisma/PostgreSQL + Python. Переход на Nuxt, другой backend или универсальную платформу шаблонов не нужен.
- Собственная БД DEMO. Не читать рабочие таблицы DSJ в обычном runtime. Связь с исходником — только отдельный управляемый импорт.
- Очередь генерации в PostgreSQL через `GenerationJob`: транзакционное создание задания, lease, fencing token, retries. Для этого масштаба не добавлять Redis/BullMQ и отдельный outbox как второй механизм доставки. Не переносить DSJ worker.
- Приватный durable filesystem volume за интерфейсом `ArtifactStore` — базовая поставка для одного узла API/worker. Это не `tmp` и не эфемерный диск контейнера. При разных хостах API/worker обязателен общий объектный store; не делать вид, что локальный volume автоматически общий.
- DOCX — редактируемый оригинал; PDF — производный файл из той же версии DOCX и закреплённого runtime; XLSX — реестр; ZIP — комплект с manifest. PDF/ZIP здесь новая реализация, а не включение готового DSJ модуля.
- Build graph нового продукта не содержит `@dsj/*`, относительных импортов за его границу или runtime путей в `dsj2/docs/experimental`.

### 2.2. Почему не только скрыть меню

Старые web/API/worker могут продолжить работать независимо от нового каталога. Поэтому в этом же плане обязательно реализовать **границу доступности и безопасное переключение deployment**:

1. У существующих web/API центральный режим печатной поставки закрывает всё вне точного allowlist; frozen business modules не редактируются.
2. Окончательная поставка DEMO содержит только новый печатный workspace; старые controllers/actions/worker entrypoints физически отсутствуют в её образах.
3. Во время переключения закрывается или выключается прежний публичный web/API origin DSJ и его непечатные workers/schedulers. Старые данные, очереди и исходники не удаляются.
4. Если доступ к действующему deployment не предоставлен, сдать готовые проверенные manifests и перечень адресов/процессов для переключения, но честно отметить, что действующий внешний DSJ ещё не доказанно закрыт. Не заявлять runtime-недоступность по одному git diff.

Безопасное поведение действует по умолчанию: отсутствие или неверный manifest не включает полную DSJ. Старые API/web entrypoints запускают только закрытую печатную поверхность либо завершаются с понятной ошибкой. Старый worker должен отказать **до** top-level создания Prisma/Queue/consumers; для этого разрешена минимальная правка bootstrap, без изменения тел frozen jobs. Корневой `dev` и прямой запуск прежнего worker не должны незаметно активировать full DSJ. Возвращение полной платформы требует отдельного поручения, а не случайного значения env.

Это не два самостоятельных релиза: временная защита текущих входов и окончательная минимальная поставка входят в один проход.

## 3. Граница доступа, которая действует для всех ролей

### 3.1. Общий механизм

Определить versioned JSON product manifest и exact **method + path** allowlist с двумя явно отдельными наборами: `legacy-printing-gateway` и `demo-product`. Для старых web/API локальный policy artifact генерируется из этого источника и проверяется schema/checksum test; старый workspace не обязан разрешать `@demo/contracts` из вложенного независимого workspace. Автономная DEMO содержит собственный полный policy artifact в `@demo/contracts`, без runtime imports за границу каталога. Политика исполняется до обычной авторизации и не зависит от роли. Незнакомый endpoint по умолчанию закрыт. `@Public` отменяет только требование сессии для конкретно разрешённого маршрута, но не границу продукта.

- Непечатная page/API/download/public surface возвращает 404.
- Разрешённый печатный маршрут отдельно проверяет сессию, capability, tenant и принадлежность объекта.
- Нет UI-переключателя «полный DSJ», query flag, cookie, localStorage или `SUPER_ADMIN` bypass, открывающих frozen-модули.
- Не использовать обобщённые исключения `/api/*`, `/auth/*`, `/certificates*` или proxy на любой DSJ URL.
- Продуктовый manifest встроен в сборку. Неверный productId/config вызывает остановку до подключения БД/worker.
- Старые JWT DSJ не принимаются DEMO: отдельные issuer/audience/ключи и cookie `demo_session`.

### 3.2. Временная защита существующих входов

Для старого интерфейса разрешить только GET/HEAD `/`, `/login`, `/access-denied`, `/certificates`, `/certificates/biot-experimental`, `/certificates/requests/:id/edit`, необходимые проверенные Next assets и точные печатные proxy routes.

Точный временный HTTP allowlist (каждый перечисленный метод — отдельная запись policy; `:id` — один валидированный сегмент):

| Поверхность | Метод | Путь |
|---|---|---|
| Web auth, новые handlers | POST | `/api/auth/login`, `/api/auth/logout` |
| Web печать | GET | `/api/biot-cards/defaults`, `/api/biot-cards/requests` |
| Web заявка | GET, PUT, DELETE | `/api/biot-cards/requests/:id` |
| Web создание | POST | `/api/biot-cards/generate` |
| Web файлы | GET | `/api/biot-cards/requests/:id/cards`, `/protocol`, `/witness`, `/registry` — каждый суффикс относительно того же request path |
| Web помощник | POST | `/api/translations/job-title` только при включённом проверенном adapter |
| Nest auth | POST / GET соответственно | `/v1/auth/login`, `/v1/auth/me` |
| Nest context, новый узкий endpoint | GET | `/v1/printing/context` |
| Nest печать | GET | `/v1/biot-cards/defaults`, `/v1/biot-cards/requests` |
| Nest заявка | GET, DELETE | `/v1/biot-cards/requests/:id` |
| Nest update | POST | `/v1/biot-cards/requests/:id/update` |
| Nest создание | POST | `/v1/biot-cards/generate-batch` |
| Nest файлы | GET | `/v1/biot-cards/requests/:id/export-cards`, `/export-protocol`, `/export-witness`, `/export-registry` — каждый суффикс относительно того же request path |
| Nest помощник | POST | `/v1/translations/job-title` только для изолированного разрешённого adapter |

Неиспользуемый нынешним UI `POST /v1/biot-cards/generate` остаётся закрытым; открывать его можно только при выявленном необходимом клиенте и отдельном тесте. Служебные OPTIONS/HEAD разрешать только для уже разрешённого точного route и CORS policy, а не как общий обход. URL нормализуется единообразно; encoded slash/path traversal и неоднозначные пути не обходят policy.

Login/logout перевести на обычные защищённые same-origin JSON/form endpoints. **Все старые Server Actions и POST к page URLs закрыть**, включая запросы с `Next-Action`: печатный редактор ими не пользуется, кроме заменяемого auth transport. Это исключает replay action замороженного модуля через разрешённую страницу.

Для старого Nest разрешить точные login/me и используемые `biot-cards` методы, включая `generate-batch`, request update и четыре экспорта. Не открывать целиком CompaniesModule: сделать узкий `printing/context` для текущего авторизованного scope. Убрать из печатных страниц неиспользуемые employees/trainingAssignments GET. Optional translation не должен открывать correspondence/AI модуль целиком.

Центральные точки изменения: middleware web, routing/default login destination, печатная оболочка, auth transport, HTTP boundary middleware Nest, состав модулей/entrypoint, product deployment и startup policy. Это разрешённые адаптеры границы; тела frozen business modules не меняются.

### 3.3. Финальная поверхность DEMO

Навигация: **Заявки · Заказчики · История · Настройки**. «История» — сохранённый фильтр общего реестра, а не независимая копия данных. Настройки доступны по роли; содержат реквизиты центра, пользователей, формы и нумерацию.

Основные страницы: `/requests`, `/requests/new`, `/requests/:id`, `/requests/:id/edit`, `/customers`, `/settings`. Legacy печатные URL могут иметь точные redirects на эквиваленты. Непечатные legacy URL не перенаправляются в старый DSJ.

Окончательный API:

| Операция | Контракт |
|---|---|
| Вход / выход / сессия | Exact auth endpoints, защищённый cookie transport, revocation/sessionVersion |
| Контекст | Tenant текущей сессии, capabilities, активные шаблоны/настройки; без доступа к DSJ |
| Заказчики/получатели | Tenant-scoped CRUD справочников; архивирование без изменения выпусков |
| Черновик | `POST /print-requests`, `GET /print-requests/:id`, `PATCH /print-requests/:id` с expectedRevision |
| Реестр | `GET /print-requests` с cursor/page, total, search и фильтрами |
| Фото | Отдельный bounded upload → opaque assetId; private read с проверкой прав |
| Импорт | Upload/parse preview → validate → apply to draft, без регистрации номеров |
| Проверка | `POST /print-requests/:id/validate` → список ошибок/предупреждений и plan документов |
| Preview | Задание чернового preview, привязанное к revision; номер не выделяется |
| Оформление | `POST /print-requests/:id/finalize`, expectedRevision + Idempotency-Key |
| Задания | Только просмотр доступных jobs и безопасный retry той же зафиксированной версии |
| Файлы | Download конкретного artifactId; streaming bytes, проверенный MIME/disposition |
| Исправление / отмена | Явные команды с причиной и revision/document links; не обычный update |
| Экспорт | Полный XLSX/ZIP по зафиксированному набору документов; job для больших выгрузок |
| Диагностика | Liveness без приватных данных; защищённая/internal readiness с БД/worker/assets |

Фактические маршруты зарегистрировать в manifest и проверять тестом соответствия registered routes ↔ allowlist. Auth transport защищает mutating same-origin requests проверкой Origin/CSRF. Наличие cookie само по себе не считается CSRF-защитой.

## 4. Минимальная модель данных

Названия ниже — целевой контракт. Не создавать параллельные сущности с тем же смыслом под другими именами.

| Сущность | Назначение и обязательные свойства |
|---|---|
| `Tenant` | Учебный центр как владелец данных; timezone и активность |
| `User` | Пользователь центра; password hash, role/capabilities, active, sessionVersion; DSJ EMPLOYEE_SIGNER не переносить |
| `IssuerProfileVersion` | Версия реквизитов центра, комиссии, разрешённых assets и политик; используется snapshot при выпуске |
| `CustomerOrganization` | Заказчик внутри tenant; RU/KZ наименования, необязательные подтверждённые реквизиты |
| `Recipient` | Необязательный повторно используемый справочник людей; ФИО не является уникальным идентификатором |
| `PrintRequest` | `tenantId`, type PERSON/COMPANY, customerId, DRAFT/FINALIZED/CANCELLED, revision, автор/время, source mapping при импорте |
| `RequestItem` | Стабильный row ID, самостоятельные RU/KZ поля, photoAssetId, выбранные документы, основания, даты и результаты по назначению |
| `TemplateVersion` | Family/variant/kind, version, checksum, runtime contract, formats, geometry, fonts, photo requirements, статус demo/active/retired |
| `Issuance` | Неизменяемая зарегистрированная редакция заявки: input/issuer snapshots, hash, template versions, актор, document plan |
| `RenderInputSnapshot` | Неизменяемый вход рендера: union `draft-preview` или `issued-document`; для preview requestId/revision/template/profile versions, без регистрации и номеров |
| `IssuedDocument` | Документ конкретного получателя/протокола: namespace, номер, даты, kind, links, отмена/замена с причиной; generation state отдельно |
| `NumberSequence` + `NumberReservation` | Атомарное выделение и уникальность, связь с IssuedDocument, контроль legacy conflicts |
| `GenerationJob` | document/version/artifact kind, status, attempts, runAfter, leaseUntil, lease token, bounded error, progress, unique logical key |
| `Artifact` | Tenant, issuance/document, format, storageKey, sha256, size, template/input/renderer versions, createdAt, provenance |
| `PhotoAsset` | Private original + normalized image/thumbnail, type/size/dimensions/hash, tenant/owner |
| `IdempotencyOperation` | Tenant + command + key, canonical payload hash, stable result IDs |
| `AuditEvent` | Append-only событие: кто, что, entity ID, безопасные metadata; без base64, паролей и полных персональных payload |

Протокол моделируется как документ с участниками и связями с удостоверениями. Template contract фиксирует фактическую семантику `INDIVIDUAL` или `EXTERNAL_REFERENCE`; `GROUP` реализовать только если конкретная используемая форма действительно предусматривает группу. Не добавлять новый групповой renderer ради абстрактного примера. При отсутствии поддерживаемого GROUP-template сервер явно отклоняет такой выбор до финализации. Для старых индивидуальных форм сохранить прежнюю семантику. Если форма групповая, создаётся один номер и список участников, без размножения на каждого человека. Не превращать внешнее основание в новый внутренний номер.

Все mutable ссылки внутри tenant проверить и в API, и, где возможно, составными foreign key/unique constraints в PostgreSQL. `customerId` не является `tenantId`. Роли нового продукта: **администратор центра, оператор, просмотр**; не добавлять кабинеты работников или слушателей. Администратор управляет настройками/пользователями, оператор оформляет, просмотр скачивает разрешённое без изменений. Во всех ролях продуктовая граница одинакова.

## 5. Инварианты, которые реализация не может нарушать

### Черновик и финализация

1. Черновик можно сохранить неполным. Он не получает финальных номеров и не создаёт зарегистрированные документы.
2. PATCH требует expectedRevision; конфликт возвращает 409 и актуальную revision без молчаливой потери правок.
3. Финализация проверяет права, tenant, revision, весь выбранный набор, состояние шаблонов, фото и оснований.
4. Одна транзакция фиксирует snapshot и `IdempotencyOperation`, создаёт issuance/documents, резервирует номера, записывает audit и durable generation jobs. Большие файлы внутри транзакции не рендерить.
5. Один ключ + тот же canonical request возвращает прежние IDs. Один ключ + иной request → 409. Повтор с другим ключом для уже финализированной revision не создаёт второй выпуск. Это закрепить DB constraints `UNIQUE(tenantId, command, key)` и `UNIQUE(requestId, sourceRevision)` для Issuance. Canonical hash включает requestId из route, sourceRevision и тело команды; результат повторов формируется из сохранённых ID, а не заново.
6. Потеря HTTP-ответа после commit не создаёт дубль при retry. Клиент не меняет ключ, пока не установил судьбу исходной команды.
7. Если хотя бы обязательная строка не проходит проверку, регистрация нового комплекта атомарно отклоняется. Техническая генерация после регистрации может завершиться частично — это видно отдельно.

### Номера и даты

- Runtime-нумерация не использует `max+1`, audit log, клиентский счётчик или current row count.
- Namespace содержит tenant/эмитент, направление и kind. Series/year/branch включаются только согласно явной версии policy; автоматический ежегодный сброс не вводить.
- Уникальные индексы отдельно защищают namespace + sequence и namespace + нормализованный formatted number; протокол и удостоверение не делят счётчик случайно. PS witness certificate и registration number имеют собственные политики. Namespace опирается на стабильный issuer/namespace ID, **не** на IssuerProfileVersion или policyVersion. Обновление реквизитов/формата не сбрасывает счётчик и не освобождает прежде занятые номера; изменение самой области требует явной миграции с conflict check.
- Блокировка/атомарный update счётчика и уникальная reservation выполняются в той же транзакции, что issuance. Порядок блокировки нескольких namespaces фиксированный, deadlock retries ограниченные.
- Preview, сохранение, скачивание, PDF conversion и worker retry не выделяют номера. Аннулированные номера не возвращаются в пул.
- Начальные значения конфигурируются до первого выпуска или устанавливаются из проверенного legacy import. Историческое «12000» не применять ко всем центрам.
- Оператор не меняет системный номер свободным полем. Внешние номера оснований сохраняются отдельно. Привилегированный импорт исторических номеров оставляет provenance и отчет конфликтов.
- Дата документа, обучения, проверки/протокола и техническое время записи — разные поля. Календарные даты хранить как date-only, timestamps — UTC. «Сегодня» вычислять по timezone центра.
- Не заменять невалидную дату текущей. Не вычислять нормативный срок по createdAt. Пресеты действуют только по версии policy выбранной формы.

### Файлы, версии и исправления

- Завершённый artifact — реально сохранённые bytes с sha256 и размером. Ошибка/отсутствие storage не маскируется READY.
- Повторное скачивание возвращает те же bytes; изменения справочников/шаблонов не меняют прошлый файл.
- «Восстановить утраченный файл» — отдельная аудируемая операция по snapshot + template version; если bytes отличаются, записать новый artifact/provenance, не утверждать идентичность.
- После регистрации обычный PATCH бизнес-данных запрещён. «Исправить» создаёт связанный черновик/новый выпуск с причиной. Базовая политика нового документа — новый номер, связь `replacesDocumentId`; техническая повторная генерация неизменённых данных сохраняет номер. Не применять эту новую политику задним числом к legacy без migration mapping.
- Старый документ аннулируется/заменяется отдельным событием, его версия и файл остаются. Удалять можно только незарегистрированный черновик по правилам retention.
- Статусы подготовки, генерации и внешней выдачи не смешиваются. GENERATED/READY не означает SIGNED/DELIVERED. ЭЦП, фактическую выдачу и результаты экзамена не создавать автоматически.

## 6. Единый порядок реализации

### 1. Зафиксировать источник, заморозку и границу продукта

Прочитать audit, действующие AGENTS и `DEMO_FROZEN_SCOPE.md`; проверить HEAD/status и не затронуть пользовательские изменения. Создать branch `codex/demo-print-2-0` при начале реальной работы. Зафиксировать source manifest: используемые шаблоны/скрипты, hashes, активные варианты, форматы, сценарии и старые пути.

Реализовать центральный deny-by-default для текущих входов, печатную навигацию и запрет старых actions по разделу 3. Удалить только ненужные data fetches из разрешённых печатных страниц. Создать инструкции и import-boundary test нового workspace. Непечатный код сохраняется, не проходит попутный «рефакторинг».

**Результат:** режим DEMO не предоставляет доступ к frozen-функциям; исходники сохранены; точная карта переноса и блокируемых поверхностей проверяется автоматически.

### 2. Собрать автономный каркас и воспроизводимую среду

Создать дерево из раздела 2, собственные manifests/lockfiles/env schema. Перенести только нужные UI primitives, schemas и helpers. Убрать мёртвые props employees/trainingAssignments. Собственные auth roles, cookie/issuer/audience, seed только синтетических данных; admin bootstrap требует явно заданного пароля и не сбрасывает существующую БД.

Node LTS и Python закрепить в toolchain/CI/Docker; выбрать исправленные совместимые версии зависимостей по актуальному audit. Исправить именно новое dependency tree, без ремонта всех frozen packages. Для Python закрепить `python-docx`, `openpyxl`, decoder/renderer и транзитивные зависимости воспроизводимым lock/constraints.

**Результат:** копия `products/demo/` вне DSJ устанавливается frozen install, собирается, запускает login/health и не требует внешних DSJ paths/env/assets.

### 3. Реализовать БД, доступ и безопасный перенос

Создать минимальную schema из раздела 4 и собственный baseline. Прогнать `migrate deploy` на пустой disposable PostgreSQL, затем обновление тестовой предыдущей версии. Не применять старые DSJ migrations и не изменять их.

Реализовать tenant scope в server services, compound constraints, capability matrix, session revocation, logout, безопасный административный сброс пароля, rate limits login/uploads/finalize. Не собирать ИИН по умолчанию, если форма не требует. Загружаемые фото и файлы остаются приватными.

Добавить legacy export/import по разделу 9 и synthetic seed без реальных подписей/клиентов. Изоляционные tests используют как минимум два центра, двух заказчиков одного центра и все роли.

**Результат:** изоляция не зависит от client companyId, миграции воспроизводимы, перенос можно оценить dry-run и проверить количественно.

### 4. Реализовать серверные заявки, проверку и нумерацию

Заменить старую цепочку `generate → save → log → render` командами draft/validate/preview/finalize. Сделать optimistic concurrency, atomic issuance и idempotency. Вынести numbering и document plan в чистые функции/сервисы. Убрать чтение audit как источника уникальности.

Сервер возвращает структурированные field/row errors с стабильным кодом, путём и row ID; одна проверка отдаёт все предметные ошибки. Обязательные поля определяет TemplateVersion. Результаты обучения/оценки/сроки/комиссия — явно введённые или выбранные подтверждённые данные, а не скрытые константы.

**Результат:** два оператора и повтор HTTP не создают дубликат, одна заявка объединяет разные документы получателей, количество выдаваемых документов известно до commit.

### 5. Реализовать надёжную генерацию и хранение

Перенести генераторы без потери геометрии/placeholder contracts, затем обернуть их единым executor. Worker получает immutable RenderInputSnapshot и закреплённые template/profile versions. Для `issued-document` snapshot связан с Issuance; для `draft-preview` он связан с requestId + revision, не создаёт Issuance/IssuedDocument/номер и имеет ограниченный retention. Worker не использует новые значения справочников и не получает номера. UI никогда не показывает preview другой revision как актуальный.

Очередь PostgreSQL:

- claim через транзакцию и `FOR UPDATE SKIP LOCKED`, lease и возрастающий fencing token;
- default concurrency 2 с конфигурационным верхним пределом; timeout/cancel убивает дочерние процессы, включая converter;
- ограниченные attempts с backoff для временных ошибок; data/template errors не повторяются бесконечно;
- heartbeat продлевает lease; после падения worker задача снова доступна; устаревший worker не может завершить задачу новым владельцем;
- запись во временный storage key, проверка размера/hash, публикация в **immutable no-overwrite key** по content hash или уникальной попытке; затем CAS выбора canonical Artifact pointer в БД по актуальному fencing token. Общий перезаписываемый final key запрещён: stale worker не должен менять bytes даже до отказа DB completion;
- crash между upload и DB commit допускает безопасное восстановление по unique logical key, orphan cleanup только после периода безопасности;
- audit success возникает после успешного завершения, stderr очищается, у пользователя error code + correlation ID;
- SIGTERM прекращает claim, завершает/отпускает работу в пределах grace period, не теряет registered jobs.

Preview и непривязанные photo uploads имеют документированный TTL. GC перед удалением повторно проверяет ссылки и активные leases; он не удаляет объект, связанный с Issuance, final Artifact или удерживаемой backup snapshot. Retired template/profile/assets сохраняются для исторического восстановления. Stale attempt остаётся orphan до безопасной очистки. Отдельно проверить гонки GC с finalize/retry/backup; очистка не может разрушать сохранённый выпуск.

Изображения: отдельный upload PNG/JPEG, decode/reencode с pixel/byte limits; no remote URLs, path traversal или base64 в массовом JSON. Предлагаемые стартовые лимиты: 5 MiB/file, 20 MP/image, JSON 2 MiB, максимум 100 участников на заявку и 1000 планируемых документов. Все уровни transport/proxy/schema совпадают; превышение определяется до финализации и не обрезает строки молча. Лимиты документируются и измеряются на acceptance, а не объявляются производительностью из воздуха.

**Результат:** состояние переживает refresh/restart, retry не меняет номера, старые задания не перетирают новые версии; storage проверен на отказ/повреждение.

### 6. Привести формы, реквизиты и форматы к продуктовой поставке

Создать TemplateVersion manifest для 10 фактически используемых runtime DOCX templates; 11-й reference template не подключать автоматически. Каждую форму описать: family/variant/kind, язык, размеры/поля/ориентация, фото, обязательные поля, supported exports, individual/group protocol semantics, контролируемый образец.

Убрать реквизиты прежнего центра и комиссии из логики/шаблонов, включая headers/footers/shapes/растровые изображения, где они присутствуют. Название DEMO не ставить вместо имени эмитента. Шаблоны должны брать реквизиты из IssuerProfileVersion; реальные подписи/печати по умолчанию не поставляются. Демонстрационные образцы имеют явную маркировку.

Сохранить различия BIOT WORKER/ITR, PTM, PB, PS card/protocol/witness и действующую связность полей. Новые формы не объявлять нормативно утверждёнными автоматически. Программная проверка шаблона, его доступность в тестовом наборе и утверждение оператором центра — разные статусы.

Сделать DOCX→PDF через закреплённый headless converter с установленными лицензированными шрифтами; isolated profile для каждого процесса, без макросов, внешних ссылок и сети. Preview идёт тем же renderer по draft snapshot с водяным знаком и placeholder номера. Если конвертация не удалась, DOCX может быть готов, PDF получает FAILED; нет ложной кнопки «готов полный комплект».

ZIP строится из сохранённых artifacts; manifest содержит ожидаемые/готовые/ошибочные документы, их IDs, filenames, hashes. Неполный архив явно маркируется и скачивается отдельной осознанной командой. XLSX включает все номера, RU/KZ поля, тип/статус/дату/ревизию, записывает пользовательский текст безопасно.

**Результат:** по каждой активной форме есть реальные DOCX/PDF, все страницы визуально проверены, прежний выпуск не меняется при обновлении template/profile.

### 7. Сделать законченный интерфейс оператора

Разделить монолит генератора по обязанностям: request editor, recipient table, row details, photo crop, import preview, validation summary, preview, result/jobs, registry. Domain rules и schemas имеют один источник, интерфейс не вычисляет финальные номера.

Сценарий человека и организации использует одну модель заявки, но разный старт. Для человека не требовать компанию без необходимости формы. Для организации реквизиты вводятся один раз, у людей индивидуальные наборы документов/основания/результаты. Поиск в справочнике не объединяет людей только по ФИО.

Сохранение: debounce autosave + явная кнопка «Сохранить», states «Есть изменения / Сохраняется / Сохранено / Нет связи / Конфликт». В одном редакторе не более одного PATCH в полёте; новые правки объединяются в следующий pending save, старый ответ не заменяет более новый local state. Перед validate/preview/finalize выполняется flush с ожиданием подтверждённой revision. Проверка/preview связаны с revision и после новой правки отмечаются устаревшими. При сетевой ошибке ввод остаётся и уход предупреждает. Не хранить персональные данные и фото в обычный localStorage.

RU/KZ ФИО, должность и организация независимы. Пустое необязательное значение допускается по форме. Копирование/перевод — явная команда, не скрытая перезапись; поздний ответ не заменяет ручные правки. Автоматический перевод должности — необязательный adapter, приложение работает без внешнего сервиса и не отправляет ему ФИО/фото.

Таблица: закреплённые ФИО/заголовок, keyboard Tab/Enter/Shift+Enter, выбор строк, явное массовое применение только выделенным строкам, отмена массовой правки до сохранения. Defaults не перезаписывают индивидуальные значения автоматически. На узком экране row details; горизонтальная прокрутка внутри таблицы.

«Проверить» показывает количество людей, документов и протоколов, ошибки со ссылкой на строку/поле, предупреждения, фактические даты и preview. «Оформить документы» — одна команда, disabled/pending относится ко всей операции. Результат показывает X из Y файлов, сбои и retry; закрытие вкладки не отменяет обработку.

Реестр: поиск по ФИО/номеру/заказчику, filters, pagination/total, отдельные даты документа/создания, загрузка detail по открытию; фото и все строки не передаются в list response. Не ограничивать экспорт текущей страницей. Пользователь видит download original, correction и cancel как разные действия.

Доступность: label/id, aria-describedby/errors, role alert, error summary/focus, dialogs с trap/Escape/return focus, видимый focus, достаточный контраст. Проверить 1366×768, 1920×1080 и узкий viewport; основной сценарий с клавиатуры.

**Результат:** оператор завершает путь без ручной правки JSON/БД и не теряет данные при предусмотренных сбоях.

### 8. Реализовать настоящий импорт и полную историю

Сохранить удобную tabular paste и добавить `.xlsx`/CSV import. Полный pipeline: загрузка → ограниченный parser → выбор листа/columns → preview → ошибки/дубликаты → осознанное применение в черновик. Не исполнять формулы, не обращаться по external links, не раскрывать макросы; `.xlsm`/неподдерживаемые форматы отклонять понятной ошибкой.

Preserve leading zeros, RU/KZ Unicode, row order и source row numbers. Не преобразовывать ФИО или customer name эвристикой. Дубликаты показывать кандидатами; повтор того же import operation не добавляет строки второй раз. Неполная строка не исчезает. Большой файл имеет явный лимит bytes/rows/decompressed size; 101 строка не превращается молча в 100.

Скачать шаблон импорта и error report. Правила mapping сохранять по tenant только после явного действия. Импорт не финализирует и не выделяет номера.

**Результат:** input rows = applied rows + explicitly rejected/excluded rows, итог виден пользователю, повтор безопасен.

### 9. Настроить эксплуатацию, проверку и поставку

Собственные multi-stage containers: frozen install, non-root user, только необходимые production deps/assets, pinned fonts/Python/converter. Read-only root где возможно, отдельные writable temp/private volumes, limits, cleanup. Не копировать секреты, source DSJ, `.agents`, caches и документы чужих модулей в image.

API/worker readiness проверяют требуемые компоненты: schema compatibility, DB, write/read/delete безопасного storage probe, наличие template/font/converter; worker heartbeat/queue age. Liveness не зависит от долгого render. Structured logs/correlation IDs без фото, паролей, полных payload и содержимого документов. Метрики: failed/retried jobs, queue age, render duration, storage errors, db errors.

Backup включает БД, artifacts, templates, issuer assets и нужные ключи отдельным защищённым способом. Реализовать и выполнить restore в пустое тестовое окружение, сверить counts/hashes. Предлагаемые стартовые эксплуатационные цели: RPO до 24 часов, RTO до 4 часов для небольшой установки; обозначить как целевые, зафиксировать реально измеренное время и процедуру.

CI нового продукта: lint + format check + typecheck + unit + integration на disposable PostgreSQL + migration test + generator/render QA + browser e2e + security/dependency scan + build. Нужные print tests не могут тихо skip при отсутствии Python/LibreOffice — CI должен подготовить runtime или явно упасть.

**Результат:** воспроизводимая сборка, проверенная установка, backup/restore, operator/admin docs, маршрут переключения старого DSJ и release evidence. Публикацию действующего production не выполнять без отдельного поручения на конкретное окружение; подготовка артефактов и локальная/staging приёмка входят в этот проход.

### 10. Пройти целиком приёмку и исправить результат

Запустить матрицу раздела 10, проверить все страницы файлов и интерфейс. Фиксировать failures, исправлять и повторять затронутые проверки; не продолжать бессмысленный полный retest после каждого текста. Финальный один полный release verify обязателен.

Сдать работающий код, доступный локальный preview, сборку/образ, актуальную документацию и проверяемые evidence. Если внешняя зависимость не предоставлена, закончить независимые работы, перечислить точную блокировку и не называть соответствующее свойство доказанным. Не выдавать один green build за производственную готовность.

## 7. Реестр переноса по исходным файлам

| Источник DSJ | Целевой смысл в DEMO |
|---|---|
| `apps/api/src/biot-cards/biot-cards.service.ts` | Чистые mapping/formatting functions и отдельные renderer adapters; lifecycle и numbering реализовать по новому контракту |
| `biot-cards.controller.ts`, `biot-cards.module.ts` | Только нужные HTTP operations, новый product boundary и typed responses |
| `packages/types/src/document.ts:267–419` | `packages/contracts/src/printing.ts`; не импортировать весь старый barrel |
| `apps/web/components/biot-card-generator.tsx` | Компоненты редактора и characterization fixtures; исключить duplicate defaults/network patterns |
| `photo-upload-input.tsx` | Upload/crop flow с валидным backend asset contract |
| `apps/web/app/api/biot-cards/**` | Унифицированный proxy/client; status/headers/body корректны; bounded streaming |
| `apps/web/lib/api.ts`, `lib/auth.ts` | Узкий исправленный transport/auth adapter; никакой универсальной прокси в DSJ |
| `packages/ui` | Необходимые безопасные primitives/tokens, accessibility fixes |
| `generate_biot_card.py` | DOCX engine и placeholder/image contracts |
| `generate_biot_mail_merge_bundle.py` | Объединённый DOCX из подготовленных полей, без ненужных external mailmerge references |
| `generate_ps_witness_certificate.py` | PS witness renderer |
| `export_card_request_registry.py` | Безопасный полный XLSX export |
| `docs/experimental/{biot,ptm,pb,ps}` | Versioned assets, не runtime-зависимость на docs |
| `CardGenerationRequest`, `Item`, generation AuditLog | Legacy adapter → PrintRequest/Issuance/IssuedDocument/provenance; без поддельного READY |

Каждая переносимая функция получает тест реального поведения/образца, если она влияет на данные или файлы. Не писать тест только ради совпадения строки реализации.

## 8. Что сознательно не входит в реализацию

Непечатные модули остаются замороженными, как потребовал пользователь. Не строить LMS, тестирование, прокторинг, кабинеты работников, юридическую ЭЦП/eGov, биллинг, CRM, переписку/рассылки, маркетплейс форм, произвольный WYSIWYG дизайнер, мобильное приложение или большой BI dashboard. Не использовать исходные signing/core модули как shortcut для истории печати.

Это ограничение не позволяет исключить обязательную функцию печатной формы: если ей требуется фото, второй язык или связанный протокол, они входят в приёмку этой формы.

## 9. Перенос существующих данных и переключение

1. Источник открывается отдельным read-only credential/экспортом. Не использовать `db push`, seed reset и прямые записи в DSJ.
2. Dry-run считает source requests/items/logs/photos, типы, диапазоны номеров, потенциальные дубли, пропуски, unmatched links, embedded issuer references.
3. Mapping DSJ owner company → Tenant задаётся явно; заказчик из requestCompany не становится tenant. Не угадывать новые центры по именам организаций.
4. Сохранять source repository/commit, source IDs и checksum исходных данных. Импорт повторяем по source identity; повтор не создаёт дополнительные requests/documents.
5. Не объединять людей по ФИО, не исправлять RU/KZ и не перенумеровывать исторические документы молча. Conflicts остаются в reconciliation report и требуют явного mapping до активации соответствующего namespace.
6. Если исходного файла нет, legacy запись не получает признак «оригинал сохранён». Можно сохранить данные и отдельно изготовить реконструкцию с временем/версией/provenance. Недостающие прошлые байты не восстанавливаются утверждением в metadata.
7. Из существующих данных выделить неизменяемые legacy snapshots. Не объявлять генерацию подписью/выдачей. Исторические даты не пересчитывать по новой policy.
8. После сверки номеров подготовить sequence state. Расчёт максимума допустим как одноразовая контролируемая миграция под блокировкой, не как runtime numbering.
9. Выполнить import rehearsal, reconciliation и restore на disposable окружении. Сверка: source count = imported + intentionally excluded + unresolved; у каждой невключённой записи причина.
10. Cutover runbook: backup → freeze записей старой печати → финальный export/delta → import/reconcile → переключение ingress на DEMO → остановка/закрытие старых API/web/workers → smoke всех allowed/forbidden URLs.
11. Rollback не теряет новые DEMO выпуски: сначала остановить новые mutations и сохранить delta/backup. Не переключать клиентов к устаревшей БД с конфликтующими счётчиками. Возврат трафика к full DSJ не является допустимым rollback, пока непечатные функции должны быть закрыты.

В текущем аудите source production data/deployment отсутствуют. Исполнитель может полностью сделать importer/runbook/tests, но не должен выдумывать количества переноса или объявлять cutover выполненным.

## 10. Единая приёмочная матрица

Каждый пункт получает PASS/FAIL/BLOCKED и путь к evidence. BLOCKED не равен PASS. Все проверки относятся к одному готовому релизу.

| ID | Проверка | Обязательный результат |
|---|---|---|
| A01 | Копия DEMO вне DSJ | Установка/миграция/сборка/запуск без DSJ files/env/БД |
| A02 | Frozen menu/routes | Только печатная навигация; все известные непечатные pages/API/downloads/public URLs закрыты anonymous и всеми ролями, включая SUPER_ADMIN |
| A03 | Обход frontend | Прямой Nest origin, alternate methods, старый JWT, replay Next-Action/page POST не открывают frozen-функции |
| A04 | Новый случайный controller | Без явного product allowlist закрыт, даже с Public; registered route manifest проверен |
| A05 | Jobs и package boundary | Нет DSJ imports/entrypoints/consumers/schedulers в DEMO; bare legacy start/корневой dev не включают full runtime; старые данные/очереди не удалены |
| A06 | Два tenant и два customer | Заказчики одного центра доступны по роли; чужие request/item/job/template/photo/artifact/search/export недоступны |
| A07 | Auth lifecycle | Login/logout/отключение/смена роли/сброс пароля работают, старые сессии отзываются, 5xx не изображает «неверный пароль» |
| A08 | Заявка человека | Создать без лишней организации, сохранить, оформить, получить DOCX/PDF и найти в истории |
| A09 | Заявка компании | 12 синтетических участников с индивидуальными наборами, 18 назначений из test fixture; ожидаемый состав каждого файла сверён |
| A10 | Серверный draft | После сохранения нет финальных номеров/Issuance; refresh восстанавливает поля/фото/состав |
| A11 | Конфликт редактирования | Два оператора: второй stale PATCH → 409, данные первого не затёрты |
| A12 | Несохранённая работа и связь | Offline/API failure сохраняет ввод; последние символы при мгновенном finalize попадают в snapshot; autosave flush и stale preview работают |
| A13 | Concurrent finalize | Не менее 20 конкурентных заявок: ни одного duplicate number в namespace, корректные links |
| A14 | Повтор одного finalize | 20 повторов одного ключа и потеря ответа после commit → один issuance и прежние номера |
| A15 | Key/payload mismatch | Тот же key с другим payload → 409; результат первого не изменён |
| A16 | Уже оформленная revision | Два concurrent finalize одной revision с разными keys дают один issuance; последующий новый key не создаёт повтор; PATCH зарегистрированного отклонён |
| A17 | История >1000 выпусков | Номера не зависят от окна audit, удаления draft, архивации или смены issuer/profile/policy version |
| A18 | Нет лишнего расхода номеров | Save/validate/preview/download/PDF/retry не увеличивают sequence |
| A19 | RU/KZ roundtrip | Отличающиеся ФИО/названия остаются самостоятельными после no-op edit, copy и import |
| A20 | Unicode/длинные поля | Ә Ғ Қ Ң Ө Ұ Ү Һ І и строчные, длинные ФИО/должность/организация не теряются; все страницы проверены |
| A21 | Календарные даты | UI/snapshot/DOCX/PDF совпадают при timezone boundary, следующем дне, високосной дате; нет silent today |
| A22 | Массовые defaults | Применяются только явно выбранным строкам; индивидуальные значения не перезаписаны скрыто |
| A23 | Translation race | Старый ответ не перезаписывает новый source или ручной KZ текст; offline перевод не блокирует печать |
| A24 | Import accounting | Все source rows объяснимо applied/rejected/excluded; leading zeros и порядок сохранены; частичные строки не исчезают |
| A25 | 100/101 строка | Лимит показан до финализации; нет частичной регистрации или silent truncation |
| A26 | Import повтор/formulas | Повтор не дублирует строки; формулы/macros/external links не исполняются; `=1+1` в XLSX export остаётся текстом |
| A27 | Фото | Настоящие PNG/JPEG, повреждённые bytes, oversized/decompression bomb, EXIF/crop/rotation; читаемая печать, стабильный asset scope |
| A28 | Нагрузка transport | Массовая заявка с фото references проходит согласованные лимиты; превышение → понятный 413/validation, без записей |
| A29 | Renderer crash/timeout | FAILED понятен, процесс ограничен/завершён, retry использует те же номера и snapshot |
| A30 | Worker crash/lease/GC race | Recovery после kill, stale completion/fencing, crash после upload/до DB; stale worker/GC не меняют hash опубликованного файла; один canonical artifact |
| A31 | Частичный комплект | X из Y; completed files сохранены; retry только failed; неполный ZIP не назван полным |
| A32 | Исходный файл | Download дважды → тот же sha256, размер/MIME/имя; числа requests/documents не изменились |
| A33 | Изменение master/template | Новые реквизиты/шаблон не меняют прошлые artifacts и snapshot |
| A34 | Потеря storage | READY не маскирует отсутствующий файл; восстановление отдельное, provenance честное |
| A35 | Исправление/отмена | Причина, автор, link и старые bytes сохранены; audit не удаляется; новая нумерация по policy |
| A36 | Все формы | BIOT worker/ITR, PTM, PB, PS card/protocol/witness: short/long/KZ/photo/blank optional/single/multi specimens |
| A37 | Семантика протокола | INDIVIDUAL/EXTERNAL сохранены; неподдерживаемый GROUP отклонён до финализации; если есть активная групповая форма — один номер/документ и верные участники/связи |
| A38 | Полный XLSX/ZIP | Все номера, включая PS witness/registration; export не зависит от pagination; manifest counts/hashes совпадают |
| A39 | История 55+ | Старейшая запись находится и скачивается; total верный; detail не загружает фото во все list rows |
| A40 | Производительность ввода | Defaults requests растут по unique configurations, не rows×types; измерен сценарий 100 строк и опубликованы условия/тайминги |
| A41 | Browser/keyboard | Полный сценарий keyboard, ошибки/диалоги/focus; 1366×768 и 1920×1080, узкий viewport без скрытых обязательных действий |
| A42 | Print pages | Все страницы DOCX/PDF через реальный renderer: размер/поля/таблицы/фото/переносы/глифы; нет старого центра/подписей/пустых лишних страниц |
| A43 | Scan документов | Нет unresolved merge fields, технических placeholders, внешних отношений, скрытого старого текста в XML/shapes/headers/изображениях |
| A44 | Миграции | Empty DB + upgrade rehearsal проходят; никакой `db push` вместо миграций и no destructive seed |
| A45 | Legacy import | Dry-run, повтор, duplicate conflicts, source counts reconciliation; отсутствующие originals не объявлены сохранёнными |
| A46 | Backup restore | В пустом окружении восстановлены records/templates/photos/artifacts, counts/hashes совпали; измерены RPO/RTO |
| A47 | Security/deps/runtime | Нет неразобранных applicable critical/high; версии зафиксированы; non-root/private storage/log redaction/request budgets |
| A48 | Production boundary | Старые публичные origins и workers закрыты/остановлены при cutover; без доступа к ним статус BLOCKED, не PASS |
| A49 | Branding и freeze | В интерфейсе/доках бренд DEMO; issuer отдельно; AGENTS и boundary tests запрещают случайное возвращение DSJ |
| A50 | Release gate | lint/typecheck/unit/integration/render/e2e/build зелёные; required print tests не skipped; отчёт содержит commit, команды, counts и evidence |

Для карточек со специальной раскладкой/физическим бланком требуется проверка печати 100% и, если применимо, лицевой/оборотной стороны. Наличие PDF renderer не доказывает поведение конкретного принтера; физическая проверка отмечается отдельно.

## 11. Что должен сдать Codex

1. Код автономной DEMO и централизованное закрытие старых непечатных входов, без изменения frozen business logic.
2. `AGENTS.md` нового продукта, product/freeze manifest, route/import boundary tests.
3. Собственную schema/migrations, безопасный bootstrap, synthetic fixture, importer с dry-run/reconciliation.
4. Воспроизводимые контейнеры/локальный запуск и доступный preview.
5. Все поддерживаемые шаблоны с version manifest, контрольные DOCX/PDF/XLSX/ZIP и страничные QA images.
6. Таблицу A01–A50 с результатами, команды/логи проверок, dependency report, build/image identification.
7. Короткую инструкцию оператора, настройку центра/шаблонов/номеров, backup/restore/cutover/rollback runbooks.
8. Финальный отчёт: что реализовано, какие исходные пути сохранены, что проверено фактически, что требует внешней проверки. Не заявлять completed на месте BLOCKED.

## 12. Условие завершения единого прохода

Считать реализацию завершённой, когда готов весь оговорённый печатный продукт и пройдены доступные обязательные проверки, а для внешних операций подготовлены конкретные исполнимые материалы. Считать **production rollout выполненным** только после фактического переключения согласованного окружения, закрытия старых доступов и проверки восстановления/рабочих форм. Это разные утверждения.

Не останавливать работу после нового меню, каркаса, одной формы, одного happy path или зелёного build. Не переносить оставшиеся обязательные пункты в неопределённый «следующий этап». При внешней блокировке закончить всю независимую работу и показать точный остаток без обещания, что он уже работает.
