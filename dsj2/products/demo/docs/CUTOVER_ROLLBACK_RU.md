# Переключение и безопасный откат

Статус: подготовлено для ответственного оператора. Внешний ingress, DNS, production migrations и рабочие процессы не изменялись. Выполнение в конкретном рабочем окружении требует отдельного поручения владельца на это окружение.

## Перед переключением

1. Заполнить инвентаризацию адресов: старый public web, прямой API origin, служебные ingress, public invite/signing callback addresses, object-storage public links и все старые worker/scheduler deployments. В исходной рабочей папке эти внешние адреса/имена deployments не подтверждены; нельзя угадать их по README.
2. Собрать DEMO только с context `products/demo`; сохранить digest image и backup исходного DSJ отдельно. Не применять DEMO migrations к DSJ.
3. Поднять изолированную DEMO БД и private volume; выполнить migrations, setup, утверждение профиля/форм. Выполнить dry-run legacy migration, изучить conflicts/counts/checksums; только затем применить согласованную карту источников. Номера не менять ради успешного импорта.
4. Проверить реальный браузер, две tenant-сессии, downloads, очередь, PDF и резервное восстановление. Выполнить `pnpm verify` с реальными внешними зависимостями. Юридическое утверждение форм выполняет центр отдельно.

## Окно переключения

1. Убрать старый DSJ web/API из публичного ingress и закрыть их прямые origins сетевыми правилами; для неизвестных страниц/API/public links отвечать 404. Если старый gateway временно остаётся, развернуть текущую fail-closed policy v1; это не разрешение оставить старый unpatched deployment.
2. Остановить ВСЕ прежние DSJ web/API, notification/compliance/signing/LMS consumers, cron/schedulers и NCALayer bridge. Сохранить volumes/БД/очереди; не очищать Redis и не удалять migrations. Существующие serverless/cron экземпляры тоже входят в инвентарь.
3. Проверить, что новые задания в старых очередях больше не обрабатываются. Зафиксировать время остановки, список процессов и remaining queued counts.
4. Сделать финальный read-only экспорт источника и reconciliation. Не открывать оба контура для параллельного выпуска по одному namespace.
5. Настроить HTTPS origin на loopback8080 нового `deployment/compose.yaml`. Открыть только DEMO ingress. API/PostgreSQL/worker не имеют публичных портов. Старые DNS-имена с frozen surfaces должны оставаться 404/закрытыми, включая direct origin.
6. Проверить anonymous, все старые роли и SUPER_ADMIN: `/journal`, `/permits`, `/protocols`, `/training`, `/invite/...`, `/api/signing/...`, public callback и downloads — 404. Проверить Next-Action replay и POST `/login`, `/requests`, encoded slash/traversal; проверить direct backend. Старый JWT/`dsj_session` не даёт DEMO session.
7. Оформить контрольный синтетический выпуск, дождаться файлов, сравнить download hashes, проверить audit и backup. Зафиксировать evidence: адрес, image digest, policy hash, время и результаты.

## Откат без потери новых выпусков

Нельзя направлять трафик обратно на full DSJ: это откроет frozen-функции. Откат допускает предыдущий совместимый DEMO image или статический maintenance/404 origin.

1. Закрыть изменяющие запросы, остановить web/API и дождаться остановки worker. Сделать резервную копию ТЕКУЩЕЙ DEMO БД и файлов: в ней уже могут быть новые выпуски и занятые номера.
2. Если предыдущий DEMO image совместим с текущей схемой, включить его с ТЕМИ ЖЕ текущими БД/volumes. Не восстанавливать старую pre-cutover копию поверх этих данных, не откатывать sequence и не освобождать номера.
3. Если схема несовместима, оставить maintenance/404, восстановить текущую копию в отдельную БД и подготовить forward-compatible исправление. Выпуски после cutover обязаны сохраниться; автоматический downgrade/down-migration не предусмотрен.
4. Проверить counts/hash/idempotency/jobs и доступ к последнему новому выпуску до повторного открытия трафика. Повторить проверку frozen origins. Зафиксировать причину и точный image/schema state.

Инвентарь окружения и результаты реального переключения заполняются оператором после получения доступа; данный документ не является свидетельством, что старый deployed DSJ уже выключен.
