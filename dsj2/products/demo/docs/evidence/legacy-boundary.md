# Legacy gateway / сохранение исходников

Дата: 22.09.2026. Исходный commit `161c5ed022c9e2c643e80802d3f9dc2cd496a041`, рабочая ветка `codex/demo-print-2-0`. Это проверка локальной реализации, не deployed DSJ.

Команды из `dsj2`:

```text
pnpm --filter @dsj/api exec tsx --test src/common/product-boundary.test.ts
node scripts/verify-demo-freeze.mjs
```

Фактически: **6 tests, 6 passed, 0 failed, 0 skipped**, 9.339 сек. Проверены checksum идентичной policy v1 в автономном contracts и legacy artifact; точные method/path; неизвестные/нормализуемые URL, альтернативные методы, Next-Action и POST к разрешённым страницам; отдельно поднятый Nest probe с Public controller; порядок product boundary перед auth; отсутствие непечатных модулей в AppModule; отсутствие employees/training dependencies в печатных страницах.

HTTP probe проверяет 18 запрещённых путей × 5 обозначений ролей (90 запросов), включая anonymous и SUPER_ADMIN, и возвращает 404 до авторизации. Значения Bearer в этом probe — синтетические метки ролей; это не вход в реальную legacy БД под пятью учётными записями. Product predicate не принимает role и не имеет ролевого обхода. Разрешённый auth probe возвращает 200; случайный Public controller закрыт.

Реальные direct entrypoints старых worker/NCALayer запускаются в тесте с невалидными DATABASE_URL/REDIS_URL. Оба завершаются кодом 1 с `frozen by DEMO product policy` до создания клиентов/очередей; ошибок Prisma/Redis подключения нет. Bare root dev также отказывает. Frozen job bodies не изменялись, очереди не очищались.

Автоматическая сверка baseline: **397 tracked legacy files; 381 без изменений; 16 изменённых разрешённых adapters; 0 изменений frozen business logic; 0 отсутствующих исходных файлов**. Проверяются прежние apps/packages/schema/migrations/templates. Подробный перечень adapters возвращает `verify-demo-freeze.mjs`. `.serena/`, audit-документы и история Git сохранены.

**UNVERIFIED:** реальный браузер старого Next gateway. Предыдущий запуск legacy preview был отклонён автоматической проверкой разрешений (`blocked by policy`); повтор через другой launcher не предпринимался. Unit/HTTP probe и source preservation не выдаются за полный legacy browser E2E.

**BLOCKED / внешнее условие A48:** реальные public origins, прямой backend, serverless/cron/worker deployments и storage URLs не предоставлены. Production ingress не переключался, старые внешние процессы не останавливались. Для конкретного окружения нужны исполнение `docs/CUTOVER_ROLLBACK_RU.md`, inventory и проверка запрещённых URL после переключения. Возврат full DSJ не является допустимым rollback.
