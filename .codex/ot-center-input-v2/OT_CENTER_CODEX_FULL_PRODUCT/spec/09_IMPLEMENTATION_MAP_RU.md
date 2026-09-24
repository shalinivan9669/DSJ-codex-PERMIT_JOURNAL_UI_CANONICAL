# Карта реализации в существующем репозитории

Это ориентиры по прочитанным файлам и просмотренной структуре, не готовый patch и не приказ переписать все файлы. Перечень фактически прочитанного и диапазоны — audit/SOURCE_MAP.json. Вспомогательные имена компонентов/guard/entry ниже являются точками поиска, не утверждением о полном чтении каждого файла. После сверки актуального HEAD уточнить пути, символы и строки.

| Область | Существующий файл | Что расширить / сохранить |
|---|---|---|
| Контракт | packages/contracts/src/index.ts | draft/item/assignment schema, группа, ссылки личности, происхождение, типизированный результат, shared resolver; old-version adapter |
| БиОТ | packages/contracts/src/biot.ts | сохранить категории и ограничения; не менять без проверки применимости |
| Клиентские типы | apps/web/lib/types.ts | новые поля должны попадать в draftPayload; не потерять их в autosave |
| Пресеты | apps/web/lib/assignment-presets.ts | совместимые наборы, происхождение, сохранение manual/import overrides |
| Редактор | apps/web/components/editor.tsx | общий контекст, расширенный bulk, grid selection/diff/undo; существующий flush/revision/idempotency |
| Детали | apps/web/components/recipient-details.tsx | индивидуальные исключения вместо повторных общих полей; исходы/источник, доступность |
| Import UI | apps/web/components/import-dialog.tsx, apps/web/lib/imports.ts | несколько назначений/набор, stable identity, diff нового файла, отчёт |
| Клиенты | apps/web/components/customers.tsx | preferences, contacts, пагинированный поиск, customer/employer/payer различие |
| Выдача | apps/web/components/files-panel.tsx | отбор, профили имён/папок, реестр/опись, handover, неполный состав |
| Настройки | apps/web/components/settings.tsx | версии комиссий, паспорт услуги/форм, права, нужные справочники |
| Рабочий список | apps/web/components/request-list.tsx, workspace.tsx | следующий шаг/заказ/сроки; не плодить дубли таблиц |
| Autosave | apps/web/lib/autosave.ts | revision lane сохранить; тест расширенного payload, undo и конфликтов |
| API | apps/api/src/controller.ts | маршруты нового объёма; thin controllers, явные права и pagination |
| Регистрация | apps/api/src/requests.ts | единый document plan, group owner, resolver, snapshots и номерная атомарность |
| Файлы/импорт | apps/api/src/files.ts | revised apply, клиентский export, исправление ИТР resolver, handover-derived outputs |
| Профили | apps/api/src/settings.ts | версия профиля, комиссии и новые настройки, tenant scope |
| Auth | apps/api/src/auth.ts, core.ts | отдельная employer membership, invites/сессии/отзыв; не ослабить origin/CSRF |
| Политика | packages/contracts/src/product-policy.json, policy.ts + актуальные proxy/page guards | точное расширение allowlist для новых DEMO функций; старый DSJ закрыт |
| Proxy | apps/web/app/api/[...path]/route.ts | согласовать новые разрешённые маршруты и streaming/headers без Public wildcard |
| DB | packages/database/prisma/schema.prisma + новые migration dirs | аддитивные модели/constraints/индексы и old JSON compatibility; 001–005 не трогать |
| Printing | packages/printing/src/index.ts | typed group snapshot, безопасные derivative exports, filenames и selection |
| Python | scripts/render/renderer.py, ooxml.py, biot_2026.py, print_contracts.py | настоящая табличная групповая форма, preflight и экспорт; прочитать код перед изменением |
| Queue | apps/render-worker/src/queue.ts, main.ts | сохранить fencing/lease/dependencies; новые задания совместимы и bounded |
| Templates | assets/templates/manifest.json и версии файлов | новые версии/geometry/contract/checksum, неизменные старые файлы |
| Миграция старых данных | scripts/migration/export-legacy.mjs, import-legacy.ts | не подменять read-only provenance; расширение только на подтверждённые источники |
| Очистка/backup | scripts/maintenance/gc.ts, scripts/verification/backup-* и deployment | новые attachment references/backup pins; не удалять активные байты |

При необходимости разделить большой editor/requests на ограниченные модули по этой задаче. Не делать общую архитектурную революцию и не переносить домены в микросервисы. Новые UI/API пути нужны реальные и сквозные, не только интерфейс.

## Безопасный порядок зависимостей внутри одной поставки

Сначала зафиксировать baseline и модели/инварианты, затем реализовать общее разрешение полей/план документов и групповую семантику, после этого подключить массовый UX/импорт, результат для клиента, заказные/повторные процессы и портал, затем закончить проверки всего состава. Это внутренняя топология работ, **не разрешение выпускать неполный набор или переносить функции**. Тесты дописываются вместе с изменениями; полная приёмка выполняется на итоговом HEAD.

## Опасные короткие пути

Не добавлять новое поле только во frontend, забыв strict Zod/draftPayload/snapshot/renderer/export. Не сохранять поля управления доступом только в JSON UI. Не копировать совпавший templateId в неподходящее событие. Не подменять исходный внешний документ локальным Issuance. Не ослаблять regression tests ради новых групп: обновить контракт там, где новая авторизованная семантика действительно меняется, и сохранить отдельные тесты v1.

## Контроль границ документации

`docs/ACCEPTANCE_RU.md` содержит исторические PASS и прямо предупреждает о неполной текущей приёмке. Новые доказательства сохраняются отдельно в `docs/evidence/operator-value/`, с текущим SHA и командами. Ссылки на несуществующие локальные бинарные доказательства не превращать в PASS. В отчёте пометить внешние проверки и невыданные production-разрешения.

## Продуктовая проверка версии 2026-09-22.2

В дополнение к карте технических изменений прочитать спецификацию 00, связать BV01–BV08 → F01–F32 → AT001–AT184 и реализовать V01–V12. G1/G2 не являются единственным критерием. Изменения должны работать внутри существующих экранов/сервисов без новой обязательной отчётности и без ухудшения одиночного пути. Обновить Plan, Verification, BusinessValueEvidence и итоговый отчёт.
