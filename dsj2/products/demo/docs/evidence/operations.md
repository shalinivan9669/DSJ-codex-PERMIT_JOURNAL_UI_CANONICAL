# Operations evidence — DEMO 2.0

Дата: 22.09.2026. Исходный commit `161c5ed022c9e2c643e80802d3f9dc2cd496a041`; ветка `codex/demo-print-2-0`. Все нижеописанные данные синтетические. Источник production DSJ не подключался.

## Миграции и перенос

- PostgreSQL **17.11**, portable test cluster, loopback `127.0.0.1:55432`, локальная тестовая роль `demo_local`.
- Empty DB `demo_test_backup_v4`: `pnpm db:deploy` применил **5** миграций 001–005 без `db push`/seed.
- Upgrade DB `demo_test_upgrade_ops`: применён baseline 001, добавлена синтетическая запись Tenant, baseline отмечен `prisma migrate resolve --applied`, затем `pnpm db:deploy` применил 002–005. Запись `upgrade-retained` сохранена, новый `demoOnly=false`. Applied DSJ migrations не изменялись.
- На `demo_test_operations` выполнены `tests/migration.test.ts` и `tests/integration/legacy-migration.test.ts`: **4 passed / 0 failed / 0 skipped**. Dry-run не пишет; 2 заявки/2 получателя с одинаковым RU ФИО остаются отдельными; KZ самостоятельны; номера ИСТ-101/ИСТ-102 сохранены, floor=102; повтор не дублирует; changed source/tenant/occupied number отвергаются; Artifact/GenerationJob для отсутствующих originals не создаются.
- Повторно выполнен export с read-only ролью `demo_export_readonly` из `demo_legacy_source_fixture`: **1 request, 1 item, 1 audit**, checksum `aaceb8b6e229ab075eb9ab7c9bf005e59594b32a6110bf1314c7677248c8ab3f`. Другая компания и signing audit исключены. Попытка CREATE TABLE получила `cannot execute CREATE TABLE in a read-only transaction`.
- CLI importer резервирует новый report до apply. Отчёт включает source count/checksum и учёт каждой заявки/числа строк с APPLIED/UNCHANGED/CONFLICT/PROPOSED. Duplicate request/item/audit IDs и checksum/count mismatch отвергаются. Никакие ФИО не используются для неявного merge, исторические номера не перенумеровываются.

## Реальная резервная копия и восстановление

`scripts/verification/backup-fixture.ts` создаёт отдельный синтетический центр, PNG480×640, утверждённые тестовые templates/profile, PB issuance и запускает настоящие DOCX/PDF/XLSX/ZIP задания. Повторное чтение каждого artifact сравнивается побайтно. Python 3.12.14 использован из bundled runtime; LibreOffice **26.2.6**, Windows `soffice.com`.

Из `demo_test_backup_v4` и `.runtime/backup-v4-files` создана `.runtime/operations-backup-v4`. В новую пустую `demo_test_restore_v4` и `.runtime/restored-operations-v4` выполнен restore. Независимая повторная verify также прошла.

| Сверяемая часть                          | Фактический результат                                  |
| ---------------------------------------- | ------------------------------------------------------ |
| public tables                            | 25: counts и SHA256 отсортированных JSON-строк совпали |
| Issuance / IssuedDocument / PrintRequest | 1 / 1 / 1                                              |
| Artifact / GenerationJob                 | 4 / 4; настоящие DOCX/PDF/XLSX/ZIP                     |
| PhotoAsset                               | 1, плюс исходные/нормализованные PNG в private store   |
| TemplateVersion / IssuerProfileVersion   | 10 / 1                                                 |
| Private storage                          | 16 файлов; каждый SHA256 совпал                        |
| Поставочные templates/fonts/assets       | 30 файлов; каждый SHA256 совпал                        |
| Миграции                                 | 5 записей истории восстановлены                        |
| Время backup                             | 9.107 секунды                                         |
| Время restore + reconciliation           | 5.294 секунды                                          |

Manifest со всеми counts/hashes: [backup-restore-manifest.json](backup-restore-manifest.json). Он не содержит исходных персональных полей/секретов. Резервная копия БД/файлов остаётся в игнорируемом `.runtime`, не включена в source/image. Применён offline backup: на выделенном источнике нет web/API/worker; RPO этой quiesced копии — 0 изменений после фиксации. Измеренный restore не включает provisioning нового host, доставку зашифрованной копии и переключение трафика; production RTO/RPO этим тестом не установлены.

Негативные проверки: restore в непустую БД отвергнут; изменение двух Tenant rows при прежнем count выявлено по row hash, после возврата точного исходного значения verify проходит; занятый shared storage maintenance lock запрещает backup/restore/verify. Lock общий с GC и не снимается автоматически. Секреты резервируются отдельно в secret manager. Manifest v1 допускает совместимость, но не заявляет row-content verification; новые backups создаются v2.

## Поставка и ограничения

- `node scripts/verification/autonomy.mjs`: 8 самостоятельных manifests, отсутствие @dsj dependencies, внешних относительных imports и DSJ runtime paths.
- Compose config с синтетическими переменными прошёл. Runtime definitions закрепляют Node24.16.0/Python3.12.14/PostgreSQL18.3/nginx1.28.2 digests, LO26.2.6 SHA256, non-root/private volumes/limits/health.
- Приватный Docker volume монтируется в /data целиком, включая /data/artifacts и sibling maintenance lock; общий lock остаётся доступен всем maintenance containers при read-only root filesystem. Эта конфигурация проверена через Compose config; фактический container lock пока относится к указанному ниже Linux gate.
- Corepack cache с закреплённым pnpm находится в /opt/corepack, доступен UID1000 и не скачивается заново при runtime-запуске. CI проверяет pnpm в обоих образах с read-only filesystem и отключённой сетью; локально этот container gate не выполнен.
- **UNVERIFIED Linux image:** `docker version` не подключается к `dockerDesktopLinuxEngine` (pipe отсутствует). Локальный контейнер не собран/запущен; PostgreSQL18.3 отдельно проверит добавленный GitHub Actions Linux workflow. Нельзя считать этот будущий CI запуск уже прошедшим.
- `.github/workflows/demo-release.yml` устанавливает автономную копию с frozen lockfile, применяет migrations, выполняет lint/format/typecheck/unit/DB integration/обязательный real render/e2e/audit/build и сборку shipping images. Отсутствие Python/LibreOffice/браузера вызывает FAIL, required render tests не skipped. E2E имеет собственную пустую БД, чтобы backlog интеграционных tests не попадал в рабочую очередь браузера.
- Production cutover и юридическое утверждение форм не выполнялись. Инструкции: `OPERATIONS_RU.md`, `OPERATOR_RU.md`, `MIGRATION_RU.md`, `CUTOVER_ROLLBACK_RU.md`.

Автономная установка и сборка выполнены во внешней копии; подробности и точное ограничение запуска приведены в standalone.md.

Финальный restore выполнен с migration005 и manifest-selected v4 templates. В отдельном предыдущем контрольном restore (demo_test_restore_final) пустая targetDB специально имела timezone Asia/Almaty; restore восстановил UTC из manifest. Новая копия v4 также проверяет UTC. Негативные проверки выполнялись на demo_test_restore_ops; финальная целостная копия — demo_test_restore_v4.

Python advisory audit: pip-audit 2.10.1 в отдельном venv, все 5 runtime dependencies с транзитивными зависимостями закреплены: Pillow12.3.0, lxml6.1.1, openpyxl3.1.5, defusedxml0.7.1, et_xmlfile2.0.0. Результат: 0 известных уязвимостей; полный JSON — python-audit.json. Проверка advisory-базы не является доказательством отсутствия неизвестных уязвимостей. Python3.12.14 Docker index digest проверен read-only командой docker buildx imagetools inspect. Контейнерные OS CVE локально UNVERIFIED; CI содержит обязательный Trivy0.74.0 API/web scan с отказом на HIGH/CRITICAL, закреплённый проверенным registry digest.

