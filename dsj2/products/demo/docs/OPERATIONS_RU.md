# Эксплуатация DEMO 2.0

Все команды выполняются из автономного каталога `products/demo`. В образах нет родительского DSJ. Реальное рабочее окружение в рамках реализации не переключалось.

## Сборка и первое включение

Требуются Linux Docker Engine/Compose, x86_64, HTTPS reverse proxy, доступ к registry и Document Foundation на этапе сборки. Образы Node 24.16.0, Python 3.12.14, PostgreSQL 18.3 и nginx 1.28.2 закреплены digest; LibreOffice 26.2.6 — SHA256 архива. Python packages и Liberation fonts закреплены в печатном runtime. Рабочие API/worker запускаются как UID1000, nginx как UID101, PostgreSQL как postgres. БД/API/web не публикуют host ports; снаружи доступен только loopback8080 ingress, перед которым нужен HTTPS termination.

Задайте секреты через защищённый env/secret manager, не сохраняйте их в git:

- `DEMO_DB_PASSWORD`: случайный URL-safe пароль БД, например 32 случайных байта в hex;
- `DEMO_ORIGIN`: ровно HTTPS origin без завершающего `/`;
- только для первоначальной команды setup: `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` (12+ символов), `DEMO_TENANT_NAME`.

```sh
docker compose -f deployment/compose.yaml config --quiet
docker compose -f deployment/compose.yaml build --pull
docker compose -f deployment/compose.yaml up -d db
docker compose -f deployment/compose.yaml run --rm migrate
docker compose -f deployment/compose.yaml run --rm setup
docker compose -f deployment/compose.yaml up -d api worker web ingress
```

`setup` в package manager запускается как `pnpm run setup`: `pnpm setup` является встроенной командой pnpm. Настройте реквизиты, комиссию и подтвердите подходящие формы в интерфейсе. Без этого нельзя оформлять действующие документы. `DEMO_SAMPLE_DATA=1` относится только к явно синтетической локальной среде, в production его не задают.

`GET /api/health` сообщает liveness, `GET /api/ready` проверяется авторизованным администратором; readiness включает БД, актуальный worker heartbeat и доступность файлов. Отсутствие worker не является готовностью только потому, что HTTP отвечает.

На хосте приложения не следует запускать корневой DSJ `dev`, прежние API migrations/seed или старые workers. Старые данные и очереди сохраняются. Новый стек не имеет подключения к DSJ database/Redis.

## Резервное копирование и восстановление

Согласованная копия включает PostgreSQL custom dump, весь приватный `DEMO_ARTIFACT_ROOT` (документы, фото, версии шаблонов), поставочные шаблоны и шрифты, counts и SHA256 содержимого всех public tables, SHA256 каждого файла. Manifest v2 сверяет содержимое БД до/после копии и после restore, поэтому изменение строки с прежним count тоже обнаруживается. Пароли и служебные секреты не выводятся в argv/log и не включаются в manifest; их резервируют отдельно в шифрованном secret manager. Каталог backup содержит персональные данные и должен быть закрыт ACL/правами и зашифрован на носителе.

Перед копированием остановите web/API и дождитесь остановки worker. Это небольшое плановое окно без записи. Установите `DEMO_MAINTENANCE=1` только после остановки: переменная подтверждает организационное действие, сама сервисы не останавливает.

```sh
docker compose -f deployment/compose.yaml stop ingress web api worker
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

Скрипт откажется от restore в непустую БД/хранилище, проверит dump hash до записи и сравнит counts и SHA256 содержимого всех таблиц и hashes файлов/шрифтов/шаблонов после восстановления. Две независимые среды не должны одновременно выполнять worker над одной БД. Перед открытием восстановленной среды отзовите старые сессии и установите новые секреты по административной процедуре.

Проверенный локальный restore и пригодность выбранного рабочего backup storage — разные результаты. Повторяйте restore drill после изменения schema/renderer и регулярно сохраняйте отчёт, а не только успешный код pg_dump.

## Известные границы проверки поставки

Compose config проверен. На машине реализации Docker Linux Engine недоступен (`dockerDesktopLinuxEngine` pipe отсутствует), поэтому сборка/запуск Linux image и nginx syntax inside image ещё требуют отдельного Linux runner. Portable PostgreSQL17.11 использован для настоящих локальных DB/migration/restore испытаний. PostgreSQL18.3 в Compose закреплён отдельно; до включения рабочей среды нужно прогнать тот же acceptance suite на этом образе. Это не утверждение о выполненной production-выкатке.

Collector и backup/restore используют общий эксклюзивный lock рядом с хранилищем: DEMO_ARTIFACT_ROOT.maintenance.lock. В Compose volume монтируется целиком в /data, а документы находятся в /data/artifacts: sibling lock /data/artifacts.maintenance.lock тоже обязан быть доступен всем maintenance containers. При собственном bind mount монтируйте родительский каталог, а не только подкаталог artifacts. При занятом lock операция отказывает. Зависший lock не удаляется автоматически: сначала убедитесь, что владелец остановлен. Lock не заменяет остановку API/worker перед offline backup.

Manifest также сохраняет effective timezone БД. Restore задаёт это свойство новой БД явно: обычный pg_dump без --create не переносит ALTER DATABASE settings. Это необходимо для корректных UTC-сроков очереди после восстановления.

Для отдельного Windows запуска установите именно поставленные assets/fonts/\*.ttf в пользовательские шрифты Windows (команда «Установить»). Worker проверяет SHA256 каждого шрифта в LOCALAPPDATA/Microsoft/Windows/Fonts; простого наличия файлов в workspace недостаточно. На Linux image шрифты устанавливает Dockerfile в /usr/local/share/fonts/demo. Задайте DEMO_PYTHON как абсолютный путь к проверенному Python, DEMO_SOFFICE — к soffice.com для Windows либо pinned soffice на Linux. Health/readiness проверяет версии конвертера, Python packages и шрифтов и отказывает при их несовпадении.

У каждого изолированного стенда должна быть собственная пара DATABASE_URL и DEMO_ARTIFACT_ROOT. Не используйте одно файловое хранилище для разных БД: collector сверяет ссылки только с БД своего экземпляра. Backup/restore и GC запускаются для той же пары, что и API/worker.
