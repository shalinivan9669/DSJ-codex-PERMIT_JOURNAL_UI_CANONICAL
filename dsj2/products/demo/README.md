# DEMO 2.0 — подготовка и печать документов

Самостоятельный продукт Next.js/React + NestJS + PostgreSQL/Prisma + Python. Рабочая папка — этот каталог `products/demo`. Для установки достаточно его копии; DSJ, Redis и старые JWT не используются.

Пользовательский путь: **Заявки → Человек / Организация → получатели и документы → сохранить → проверить / предпросмотр → оформить → файлы → история**. Доступны одиннадцать форм БиОТ/ПТМ/ПБ/ПС, включая отдельные протоколы БиОТ для рабочих и ИТР, DOCX, PDF, XLSX и ZIP. История, номера, исходные файлы и аудит сохраняются; исправление и восстановление имеют отдельное происхождение.

## Конфигурация установки

Поставка не содержит общих паролей или учётной записи по умолчанию. Администратор
создаётся командой `pnpm run setup` из явно переданных `DEMO_ADMIN_EMAIL`,
`DEMO_ADMIN_PASSWORD` (не менее 12 символов) и `DEMO_TENANT_NAME`.
Настройте отдельную PostgreSQL БД и приватный durable каталог файлов.

`.env.example` описывает переменные. CLI не загружает `.env` автоматически:
передайте окружение через supervisor/Compose или текущую shell-сессию.
`DEMO_PYTHON` и `DEMO_SOFFICE` задают абсолютные пути к установленным исполнителям;
они не должны ссылаться на личный каталог разработчика. Production использует
закреплённые runtime-компоненты из `deployment/Dockerfile`.

Для синтетической приёмки включают `DEMO_SAMPLE_DATA=1` только при создании
отдельного тестового центра. Его документы остаются маркированными.
Рабочая установка требует подтверждённых реквизитов, комиссий и форм; название
DEMO само по себе не добавляет водяной знак.

Перед `pnpm build` остановите web, использующий тот же `.next`. В Windows также
остановите API/worker перед `pnpm db:generate` (включён в build/typecheck): процесс
Prisma может удерживать DLL. Это не разрешение останавливать соседние установки.

## Чистая самостоятельная установка

Закреплённые компоненты: Node 24.16.0, pnpm 11.27.1, LibreOffice 26.2.6.3. Windows-проверки используют PostgreSQL 17.11; контейнерная поставка — PostgreSQL 18.6. Фактические результаты для каждой среды отмечены отдельно в отчёте. Python-пакеты и шрифты зафиксированы в `scripts/render/requirements.txt` и `assets/fonts/manifest.json`. Worker проверяет реальные версии/хеши и отказывается стартовать при расхождении.

1. Скопируйте весь этот каталог, исключив `node_modules`, `.runtime`, `data`, `.next`, `dist`, `.env` и другие локальные результаты. Установите закреплённые Node/pnpm, Python-пакеты, LibreOffice и шрифты согласно [эксплуатационной инструкции](docs/OPERATIONS_RU.md).
2. Создайте отдельные PostgreSQL role/database и закрытый каталог файлов. Задайте переменные из `.env.example` в окружении процесса. `.env.example` — справочник; автоматическая загрузка `.env` в локальные CLI не выполняется.
3. Выполните из корня продукта:

```text
corepack enable
corepack prepare pnpm@11.27.1 --activate
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm run setup
pnpm build
pnpm dev
```

До `pnpm run setup` обязательны `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_TENANT_NAME`. `DEMO_SAMPLE_DATA=1` явно включает только синтетический центр. Используйте именно `pnpm run setup`: `pnpm setup` — другая встроенная команда менеджера пакетов. Setup не сбрасывает пароли, номера или существующие документы и не выполняет destructive seed.

Для постоянного запуска используются команды `pnpm --filter @demo/api start`, `pnpm --filter @demo/render-worker start`, `pnpm --filter @demo/web start` под supervision/Compose. API по умолчанию слушает loopback; контейнерный `HOST=0.0.0.0` задан явно. Web связывается с API через `DEMO_API_ORIGIN`, доступ браузера защищён точным `DEMO_ORIGIN`.

## Проверки и материалы

Для DB-тестов обязательна отдельная мигрированная БД с именем `demo_test*`. Не направляйте интеграционные проверки на рабочую БД. Для e2e поднимите отдельные web/API/worker с синтетическим центром: оставшиеся в БД нагрузочных тестов тысячи заданий не должны попадать в очередь браузерного стенда.

```text
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:render
pnpm test:e2e
pnpm build
pnpm audit --prod --audit-level high
node scripts/verification/autonomy.mjs
```

Нужны реальные PostgreSQL, Python, LibreOffice, шрифты и Playwright Chromium; обязательные проверки при их отсутствии завершаются ошибкой, а не skip. `pnpm verify` объединяет основные проверки, но окружение БД и работающий e2e-стенд должны быть подготовлены отдельно, как в `.github/workflows/demo-release.yml` исходного репозитория.

- [Приёмка A01–A50 и точные границы готовности](docs/ACCEPTANCE_RU.md).
- [Новая независимая приёмка](docs/evidence/commercial-acceptance/matrix.json): прежние PASS не заменяют текущие проверки.
- [Инструкция оператора](docs/OPERATOR_RU.md).
- [Эксплуатация, настройка, backup/restore](docs/OPERATIONS_RU.md).
- [Read-only перенос старых печатных данных](docs/MIGRATION_RU.md).
- [Переключение и откат](docs/CUTOVER_ROLLBACK_RU.md).
- [Доказательства и логи](docs/evidence/progress.md), [текущая проверка 96 печатных случаев](docs/evidence/commercial-acceptance/printing/final-artifact-audit.json) и [повторная проверка текущих исходников форм](docs/evidence/commercial-acceptance/printing/final-source-docx-revalidation.json).
- [Контрольный комплект для печати](docs/evidence/commercial-acceptance/printing/control-print-set.zip): 20 DOCX, 20 PDF, реестр и контрольные суммы; [проверка состава и SHA ZIP](docs/evidence/commercial-acceptance/printing/control-print-set-verification.json). Бинарный комплект хранится среди локальных артефактов приёмки и не включается в исходный Git-репозиторий.
- [Совместимость текущих форм с Microsoft Word](docs/evidence/commercial-acceptance/word/WORD_COMPATIBILITY_RU.md), [точные версии и SHA 20 проверенных документов](docs/evidence/commercial-acceptance/word/final-active.json).

Другие функции DSJ остаются в исходниках и закрыты policy до авторизации. Рабочая DSJ БД, реальные подписи и очереди не изменялись. Локальная инженерная проверка, утверждение юридической пригодности форм, физическая печать и production cutover — отдельные результаты.
