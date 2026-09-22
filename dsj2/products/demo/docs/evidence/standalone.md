# Автономная копия вне DSJ — фактическая проверка

Проверено 22.09.2026. Копия: `C:/Users/Admin/Documents/DEMO-standalone-20260922`. В неё не переносились parent workspace, node_modules, .runtime, data/storage, build/cache directories и generated QA evidence. Зависимости установлены заново. Исторические промежуточные шаблоны исключены из поставочных assets; только 10 manifest-selected v4 форм.

Отдельные runtime dependencies находятся в `C:/Users/Admin/AppData/Local/DEMO-Verification-Runtime`: LibreOffice26.2.6.3, PostgreSQL17.11, новый cluster `pgdata-standalone`, private store `standalone-files`. Python3.12.14 — системный bundled runtime вне DSJ, шрифты — установленные пользовательские Liberation fonts с проверяемыми SHA256. Новый PostgreSQL слушает только 127.0.0.1:55435, test role `demo_standalone`, БД `demo_test_standalone`. Это отдельный cluster и БД, не подключение к DSJ либо ранее запущенной DEMO БД. Trust-auth применяется только к локальному синтетическому тесту и не входит в production Compose.

| Проверка внутри внешней копии | Результат |
| --- | --- |
| `corepack pnpm --version` | 9.15.9 |
| `corepack pnpm install --frozen-lockfile` | PASS: 8 workspaces, 273 packages, 34.4 секунды; повтор 2.3 секунды, lockfile не менялся |
| `node scripts/verification/autonomy.mjs` | PASS: 8 manifests, 61 source files, 0 external DSJ dependencies |
| `corepack pnpm db:deploy` | PASS: 5 migrations в новую пустую БД |
| `corepack pnpm run setup` | PASS: синтетический demoOnly центр создан при первоначальной установке, без default admin password/destructive seed; после финального обновления v4 assets повторный setup не запускался |
| `corepack pnpm lint` | PASS |
| `corepack pnpm format:check` | PASS на финальной копии |
| `corepack pnpm test` | PASS: 9 contract/migration + 7 web unit = 16; 0 failed, 0 skipped |
| `corepack pnpm build` | PASS: Prisma generate + все packages/API/worker и production Next15.5.25 |
| HTTP API/web/worker этой копии | BLOCKED_BY_APPROVAL_REVIEW; процессы не запущены |

Финальная сверка source/config/runtime assets: **108 файлов**, 0 отличий. Объединённый SHA256 `c88c4042db90e6ff983f294e13567fe1040eeacd2c989989605435b84402f64f`. Полные hashes и перечень исключений: [standalone-source-hashes.json](standalone-source-hashes.json). Markdown, docs, tests, verification scripts, node_modules и generated/runtime directories не входят в runtime digest. Lockfile SHA256: `5a6af8b21d2dfdded1e6b7ac9c00c6e4991b2b2ce6b987988b71e58f385e5cd0`.

Автоматическая проверка разрешений отклонила команды запуска API (`corepack pnpm --filter @demo/api start`), Next (`corepack pnpm --filter @demo/web exec next start -p 3111 --hostname 127.0.0.1`) и worker (`corepack pnpm --filter @demo/render-worker start`) с единственной указанной причиной `blocked by policy`. Запуск через другой launcher либо HTTP bootstrap не предпринимался. Это ограничение конкретной проверки запуска, а не успешный runtime smoke и не доказательство ошибки продукта. A01 нельзя отметить полностью PASS: независимая установка, миграции и сборка доказаны, login/health/ready на внешней копии не проверены.

Браузерные проверки основного локального экземпляра отражены отдельно в browser evidence; они не подменяют проверку самостоятельного запуска этой копии. Production и старые внешние DSJ origins не затрагивались.

После проверок отдельный тестовый PostgreSQL55435 остановлен штатно через pg_ctl; данные сохранены. Основной локальный DEMO PostgreSQL55432 и его preview не затронуты. В Next build traces внешней копии найдено 0 ссылок на путь исходного DSJ.

