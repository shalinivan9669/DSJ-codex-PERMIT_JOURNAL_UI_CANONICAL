# Эксплуатация DEMO 2.0

Все команды выполняются из автономного каталога `products/demo`. В образах нет родительского DSJ. Реальное рабочее окружение в рамках реализации не переключалось.

## Сборка и первое включение

Требуются Linux Docker Engine/Compose, x86_64, HTTPS reverse proxy, доступ к registry и Document Foundation на этапе сборки. Образы Node 24.16.0, Python 3.12.14 и nginx 1.30.5 закреплены digest; LibreOffice 26.2.6 — SHA256 архива. PostgreSQL 18.6 собирается из официального архива с проверкой SHA256 без неиспользуемой поддержки SQL/XML; описание и фактически выполненные проверки находятся в `docs/evidence/commercial-acceptance/POSTGRES_SECURITY_RU.md`. pnpm 11.27.1, Python packages и Liberation fonts закреплены в поставке. Рабочие API/worker запускаются как UID1000, nginx как UID101, PostgreSQL как UID70. БД/API/web не публикуют host ports; снаружи доступен только loopback8080 ingress, перед которым нужен HTTPS termination.

Для PostgreSQL требуется новый volume. Нельзя подключать старый volume от другого образа к новому UID70 или менять права существующей рабочей БД ради запуска. Перенос выполняется через проверенную резервную копию и восстановление в новую среду.

Задайте секреты через защищённый env/secret manager, не сохраняйте их в git:

- `DEMO_DB_PASSWORD`: случайный URL-safe пароль БД, например 32 случайных байта в hex;
- `DEMO_ORIGIN`: ровно HTTPS origin без завершающего `/`;
- `DEMO_PROXY_KEY`: общий случайный ключ ingress/Next/API из 32+ URL-safe символов (например 32 случайных байта в hex); хранить как секрет, не помещать в logs;
- только для первоначальной команды setup: `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` (12+ символов), `DEMO_TENANT_NAME`.

```sh
docker compose -f deployment/compose.yaml config --quiet
docker compose -f deployment/compose.yaml build --pull
docker compose -f deployment/compose.yaml up -d db
docker compose -f deployment/compose.yaml run --rm migrate
docker compose -f deployment/compose.yaml run --rm setup
docker compose -f deployment/compose.yaml up -d api worker integration web ingress
```

`setup` в package manager запускается как `pnpm run setup`: `pnpm setup` является встроенной командой pnpm. Настройте реквизиты, комиссию и подтвердите подходящие формы в интерфейсе. Без этого нельзя оформлять действующие документы. `DEMO_SAMPLE_DATA=1` относится только к явно синтетической локальной среде, в production его не задают.

`GET /api/health` сообщает liveness, `GET /api/ready` проверяется авторизованным администратором; readiness включает БД, отдельные heartbeat render-worker и integration-worker, установленные шаблоны и доступность файлов. Integration получает собственную версию heartbeat `integration-local-v1`, пишет sanitized lastError и stoppedAt при штатной остановке. Ответ/ошибка readiness включает время и возраст heartbeat, причину деградации, количество и возраст ожидающих санитарных outbox-заданий, число NEEDS_REVIEW. Отсутствующий/остановленный integration или heartbeat старше 30 секунд даёт 503 независимо от здоровья renderer. Оператору не требуется открывать эту эксплуатационную проверку. `NOT_CONNECTED` означает выключенного внешнего провайдера: локальная подготовка журнала, списка и документов продолжает работать.

В Compose и Railway запускаются три обязательных процесса: API, render-worker и integration-worker. Compose перезапускает каждый отдельный service; Railway supervisor завершает весь service при выходе любого обязательного child (включая code0), передаёт SIGTERM всем собственным process groups и ждёт до 45 секунд перед SIGKILL. Integration обрабатывает один tick одновременно, до 20 preparation jobs за tick (`DEMO_INTEGRATION_BATCH`, допустимо 1–100); renderer имеет concurrency2 (допустимо 1–4). Внешняя отправка при этом не включается.

Для выбранного Compose-профиля PostgreSQL max_connections=100. Prisma pool API ограничен 10, render4, integration2: всего 16 соединений приложения, один экземпляр каждого сервиса; оставшиеся 84 включают PostgreSQL reserved connections, административные/backup connections и запас. Next не имеет своего DB pool. Railway supervisor задаёт те же URL connection_limit=10/4/2 и pool_timeout=10; перед применением к выбранному managed PostgreSQL отдельно сверить его фактический лимит. Эти числа ограничивают ресурсы, но не доказывают production capacity. Не добавляйте replicas без пересчёта суммы.

Ingress допускает только существующую allowlist страниц, включая /lms, /lms/groups/:id, /learn, /lms/sanitary, и передаёт API автономному серверу с его точной product-policy. Только POST material upload получает body513MiB (файл512MiB плюс multipart), external-evidence21MiB (файл20MiB); остальные маршруты сохраняют12MiB. Для крупных routes request buffering выключен. API резервирует до двух concurrent uploads и суммарно1GiB temp budget до начала multipart parsing; оставляет минимум64MiB свободного места, учитывает оставшиеся временные файлы и очищает отказ/разрыв. `DEMO_UPLOAD_CONCURRENCY` допускает1–4, `DEMO_UPLOAD_TEMP_MIB`1–4096; суммарный бюджет должен вмещать максимум хотя бы одного нужного файла.

NGINX entrypoint подставляет только DEMO_PROXY_KEY во временную конфигурацию, оставляя исходник readonly; ingress/TLS заменяют client/proxy headers. API доверяет X-Demo-Client-IP только при совпадении секрета и точного IP доверенного proxy. Next также проверяет ключ и не переносит произвольный X-Forwarded-For. В шаблоне изолированная сеть172.30.15.0/24: API.3, Next.4, ingress.5, TLS.6; API доверяет только.4/.5/.6. Если сеть пересекается с сетью хоста, измените subnet, четыре адреса и DEMO_TRUSTED_PROXY_IPS согласованно до запуска. Локальный запуск без этих настроек не доверяет forwarded headers. TLS service обращается прямо к тем же api/web upstream, чтобы не терять client IP на втором proxy.

Private Range остаётся авторизованным. API кеширует только успешно проверенную identity объекта (realpath, device/inode, размер, nanosecond mtime/ctime/birthtime) вместе с ожидаемым SHA256, максимум256 записей на5минут. Изменение/замена/несовпадение ожидаемого hash или истечение доверия требует полной повторной проверки; несовпадение отказывает503. У функции openPrivateStream есть forceIntegrity для адресной полной проверки; штатные backup/verify также хешируют все private files. Хранилище должно оставаться приватным и immutable для приложения; кеш не предназначен для файловой системы, позволяющей внешнему писателю подделывать file identity.

## HTTPS с предоставленным сертификатом

Поставка включает дополнительный `deployment/compose.tls.yaml`. Задайте `DEMO_ORIGIN` как точный HTTPS origin, `DEMO_TLS_PORT` (по умолчанию 8443) и `DEMO_TLS_CERT_DIR` — абсолютный каталог вне исходников, содержащий `tls.crt` и `tls.key`. Ключ должен быть доступен на чтение UID/GID101, а каталог закрыт от записи сервисом. TLS завершается в отдельном nginx с TLS1.2/1.3, readonly filesystem и снятыми capabilities.

```sh
docker compose -f deployment/compose.yaml -f deployment/compose.tls.yaml config --quiet
docker compose -f deployment/compose.yaml -f deployment/compose.tls.yaml up -d api worker integration web ingress tls
```

Порт остаётся привязан к loopback. Публикация домена, внешний маршрут и сертификат рабочего центра требуют отдельной настройки целевого хоста. Однодневный локальный CA из изолированного acceptance-стенда предназначен только для испытания; он не установлен в системное хранилище доверия и не является производственным сертификатом.

На хосте приложения не следует запускать корневой DSJ `dev`, прежние API migrations/seed или старые workers. Старые данные и очереди сохраняются. Новый стек не имеет подключения к DSJ database/Redis.

## Резервное копирование и восстановление

Согласованная копия включает PostgreSQL custom dump, весь приватный `DEMO_ARTIFACT_ROOT` (документы, фото, версии шаблонов), поставочные шаблоны и шрифты, counts и SHA256 содержимого всех public tables, SHA256 каждого файла. Manifest v2 сверяет содержимое БД до/после копии и после restore, поэтому изменение строки с прежним count тоже обнаруживается. Пароли и служебные секреты не выводятся в argv/log и не включаются в manifest; их резервируют отдельно в шифрованном secret manager. Каталог backup содержит персональные данные и должен быть закрыт ACL/правами и зашифрован на носителе.

Перед копированием остановите ingress/web/API, render-worker и integration-worker и дождитесь фактического завершения всех writers, включая отдельные локальные или supervised экземпляры. Проверьте `docker compose ... ps --status running` (этих services быть не должно), а в PostgreSQL pg_stat_activity — отсутствие соединений application_name demo-api/demo-render/demo-integration и иных writers выбранной БД. Для локального профиля сверяйте сохранённые owner/PID, не останавливайте соседние процессы. Это небольшое плановое окно без записи. Установите `DEMO_MAINTENANCE=1` только после проверки: переменная подтверждает организационное действие, сама сервисы не останавливает. Остановленный heartbeat — диагностический признак, не доказательство отсутствия всех writers.

```sh
docker compose -f deployment/compose.yaml stop ingress web api worker integration
# Пример запуска на хосте с PostgreSQL client той же/новее major-версии:
export DATABASE_URL='postgresql://.../demo'
export DEMO_ARTIFACT_ROOT='/private/demo/artifacts'
export DEMO_MAINTENANCE=1
node deployment/backup.mjs backup /encrypted-backups/demo-20260922
```

Для Docker volumes выполните эту же команду через `docker compose run --rm --no-deps -e DEMO_MAINTENANCE=1 -v /encrypted-backups:/backups api node deployment/backup.mjs backup /backups/demo-20260922`. В runtime закреплены PostgreSQL18 client tools. Backup directory должен ещё не существовать; скрипт ничего не перезаписывает. После проверки копии включите тот же стек.

Восстановление выполняется только в НОВУЮ пустую БД и пустой каталог файлов на изолированном стенде. Исходная БД не изменяется. Сначала возьмите тот же release image, чтобы SHA256 поставочных шаблонов/шрифтов совпали. Не запускайте migrations/setup до restore — dump содержит схему, историю миграций и данные.

```sh
export DATABASE_URL='postgresql://.../demo_restore_empty'
export DEMO_ARTIFACT_ROOT='/private/demo/restore-empty'
node deployment/backup.mjs restore /encrypted-backups/demo-20260922
node deployment/backup.mjs verify /encrypted-backups/demo-20260922
```

Скрипт откажется от restore в непустую БД/хранилище, проверит dump hash до записи и сравнит counts и SHA256 содержимого всех таблиц и hashes файлов/шрифтов/шаблонов после восстановления. Оба workers остаются остановленными до успешного verify. Новые LMS/group/batch/heartbeat данные включаются общим inventory public tables; материалы, evidence и bundle parts — общим inventory всего DEMO_ARTIFACT_ROOT. Две независимые среды не должны одновременно выполнять workers над одной БД. Перед открытием восстановленной среды отзовите старые сессии и установите новые секреты по административной процедуре.

Проверенный локальный restore и пригодность выбранного рабочего backup storage — разные результаты. Повторяйте restore drill после изменения schema/renderer и регулярно сохраняйте отчёт, а не только успешный код pg_dump.

## Известные границы проверки поставки

Linux-стенд фактически запущен в изолированном Docker29.5.3 внутри WSL Ubuntu24.04: PostgreSQL18.6, API, worker, web и ingress имеют отдельные volumes и private network. Образы собраны из автономной копии продукта вне родительского DSJ. Промежуточные и итоговые сборки различаются хешами; точные версии и SHA находятся в `docs/evidence/commercial-acceptance/`. Первоначальный сбой Docker Desktop не означает отсутствие выполненной Linux-проверки: испытания использовали отдельный engine и не переустанавливали пользовательский Docker Desktop.

Выполнено настоящее восстановление в новую БД и новые volumes: совпали counts и хеши содержимого 25 таблиц, 16 приватных файлов и 38 поставочных ресурсов; сохранены фото и 10 версий шаблонов. После restore выполнен вход по HTTP и повторное скачивание четырёх исходных файлов с проверкой SHA256. Для этой небольшой синтетической копии backup занял 4980мс, restore со сверкой — 3489мс; эти измерения не являются RTO для другой базы. Доказательства: `backup-restore/timing.json`, `backup-restore/http-readback.json` и `backup-restore/backup-manifest.json` в каталоге приёмки.

На отдельном ограниченном tmpfs реально воспроизведены ENOSPC и EACCES под UID1000. Readiness отказала, незавершённые артефакты не выдавались; после восстановления хранилища очередь завершилась автоматически, номера сохранились, повторные скачивания совпали. При остановке БД и последующем перезапуске всех сервисов проверено восстановление очереди и сохранность файлов. Доказательства: `storage-faults/result.json` и `resilience/result.json`. Эти результаты относятся к записанным в них образам и синтетическим данным. Публичная production-выкатка, hosted CI и физическая печать на бумаге не подтверждены локальным стендом.

Collector и backup/restore используют общий эксклюзивный lock рядом с хранилищем: DEMO_ARTIFACT_ROOT.maintenance.lock. В Compose volume монтируется целиком в /data, а документы находятся в /data/artifacts: sibling lock /data/artifacts.maintenance.lock тоже обязан быть доступен всем maintenance containers. При собственном bind mount монтируйте родительский каталог, а не только подкаталог artifacts. При занятом lock операция отказывает. Зависший lock не удаляется автоматически: сначала убедитесь, что владелец остановлен. Lock не заменяет остановку API/worker перед offline backup.

Manifest также сохраняет effective timezone БД. Restore задаёт это свойство новой БД явно: обычный pg_dump без --create не переносит ALTER DATABASE settings. Это необходимо для корректных UTC-сроков очереди после восстановления.

Для отдельного Windows запуска установите именно поставленные assets/fonts/\*.ttf в пользовательские шрифты Windows (команда «Установить»). Worker проверяет SHA256 каждого шрифта в LOCALAPPDATA/Microsoft/Windows/Fonts; простого наличия файлов в workspace недостаточно. На Linux image шрифты устанавливает Dockerfile в /usr/local/share/fonts/demo. Задайте DEMO_PYTHON как абсолютный путь к проверенному Python, DEMO_SOFFICE — к soffice.com для Windows либо pinned soffice на Linux. Health/readiness проверяет версии конвертера, Python packages и шрифтов и отказывает при их несовпадении.

У каждого изолированного стенда должна быть собственная пара DATABASE_URL и DEMO_ARTIFACT_ROOT. Не используйте одно файловое хранилище для разных БД: collector сверяет ссылки только с БД своего экземпляра. Backup/restore и GC запускаются для той же пары, что и API/worker.
