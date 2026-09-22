# Перенос печатных записей DSJ

Миграция выполняется отдельно от HTTP-приложения, по явной карте источника и назначения. Она не открывает frozen API и не использует DSJ runtime. Рабочую DSJ БД не изменяет.

## Экспорт

Подключение `LEGACY_DATABASE_URL` задаётся явно и должно принадлежать роли с SELECT только на `CardGenerationRequest`, `CardGenerationRequestItem`, `AuditLog`. Скрипт дополнительно включает `default_transaction_read_only=on`, открывает REPEATABLE READ READ ONLY и завершает ROLLBACK. SQL ограничен выбранным source company; в audit допускаются только события `biot_card.%`. Нет ограничения 50/1000 записей. Люди/кадровые таблицы/подписи не выгружаются.

```sh
export LEGACY_DATABASE_URL='postgresql://readonly:...@legacy-host/dsj'
node scripts/migration/export-legacy.mjs SOURCE_COMPANY_ID /private/export/printing.json
```

`DEMO_PSQL` позволяет указать абсолютный путь к PostgreSQL psql. Выход содержит текущие заявки/строки, сохранившийся печатный audit, counts и общий SHA256. Файл создаётся эксклюзивно и содержит ПДн; не кладите его в git, публичный каталог или обычный лог. Ранее удалённые DSJ данные этим экспортом не восстанавливаются. Исходный pipeline не сохранял оригинальные bytes документов, поэтому экспорт помечает их `NOT_EXPORTED_LEGACY_DID_NOT_PERSIST_ORIGINALS`.

## Карта переноса и dry-run

Подготовьте JSON с tenant и администратором DEMO, существующей profileVersionId и уникальной постоянной меткой экземпляра DSJ. Заказчик не является tenant. Тип каждой старой заявки задаётся явно: прежние EMPLOYEE/REQUEST не считаются достоверным эквивалентом PERSON/COMPANY. Старые номера никогда не получают новые значения.

```json
{
  "tenantId": "UUID-центра-DEMO",
  "actorId": "UUID-администратора-этого-центра",
  "profileVersionId": "UUID-существующего-профиля-центра",
  "sourceCompanyId": "SOURCE_COMPANY_ID",
  "sourceLabel": "dsj-production-instance-1",
  "requestKinds": { "legacy-request-id": "COMPANY" },
  "numbers": {
    "BIOT:CARD|ИСТ-101": 101,
    "BIOT:PROTOCOL|ПР-102": 102,
    "PS:WITNESS|СВ-103": 103,
    "PS:REGISTRATION|РЕГ-104": 104
  }
}
```

Ключ `namespace|number` содержит ТОЧНЫЙ исторический текст номера. Значение — явно согласованный целочисленный sequence этой записи. Скрипт не угадывает последовательность по префиксу/суффиксу и не ищет max+1 в AuditLog. После импорта sequence floor может только увеличиться. Пропуски, неоднозначные одинаковые номера и конфликты существующих резервов входят в отчёт и блокируют применение всего пакета.

```sh
export DATABASE_URL='postgresql://.../demo'
pnpm exec tsx scripts/migration/import-legacy.ts /private/export/printing.json /private/mapping.json /private/dry-run.json
pnpm exec tsx scripts/migration/import-legacy.ts /private/export/printing.json /private/mapping.json /private/applied.json --apply
```

Первый вызов только читает назначение. `--apply` выполняет атомарную SERIALIZABLE транзакцию; при conflicts изменений нет. Отчёт записывается в новый файл, содержит create/unchanged/applied, source counts/checksum, conflicts и число документов без оригинала. Повторная загрузка тех же source IDs/checksums не создаёт дублей. Изменившийся уже импортированный source ID — конфликт, а не overwrite. Одинаковые ФИО не объединяются; заказчики сохраняются по source request identity, без неявного объединения по названию.

`ORPHAN_GENERATION_AUDIT` означает, что сохранившийся факт генерации с занятым номером больше не имеет исходной заявки. Такой источник требует отдельного документированного reconciliation до apply. Нельзя удалить строку отчёта или присвоить другой номер для обхода конфликта. Неизвестные/пропавшие данные остаются неизвестными.

## Происхождение и оригиналы

Импорт создаёт защищённые исторические записи, сохранённые номера, immutable snapshot исходных полей и audit. `legacySourceId` и `LegacyMapping` связывают объекты с источником. RU/KZ и исходное embedded photo значение сохраняются в legacy snapshot без замены русскими значениями; это не утверждение о проверенном/обрезанном фото нового renderer.

Ни GenerationJob, ни Artifact для отсутствующего оригинала не создаются. Provenance — `LEGACY_RECORD_WITHOUT_ORIGINAL`; неизвестная старая версия шаблона — unapproved/missing. Ссылка на текущую profileVersionId — контейнер импорта, явно помеченный `IMPORT_CONTAINER_ONLY_NOT_PROOF_OF_LEGACY_ISSUER`, она не доказывает, каким эмитентом/шаблоном был создан исторический файл. Технический статус FINALIZED фиксирует историю и занятость номера; не является доказательством успешного старого рендера или юридической силы.

Реконструкция, если её отдельно поручили, должна быть новым файлом с отдельным происхождением и не заменять отсутствующий оригинал. Сам importer реконструкцию не выполняет.

## Выполненная проверка

На отдельной PostgreSQL17.11 БД `demo_migration_test` проверены dry-run без записи, 2 distinct получателя с одинаковым RU ФИО, самостоятельные KZ ФИО, 2 заказчика, точные исторические номера ИСТ-101/ИСТ-102, увеличение floors101/102, повтор без дублей, конфликт изменённого источника, отказ для чужого tenant и занятого номера, отсутствие выдуманных Artifact/GenerationJob.

Экспорт проверен на отдельной синтетической `demo_legacy_source_fixture`: 1 заявка +1 строка +1 печатный audit; запись другой компании и frozen signing audit исключены. Попытка записи read-only ролью завершилась `cannot execute CREATE TABLE in a read-only transaction`. Подключения к реальной DSJ БД не выполнялись.
