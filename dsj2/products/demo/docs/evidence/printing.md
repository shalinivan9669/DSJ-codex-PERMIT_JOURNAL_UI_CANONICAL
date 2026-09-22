# DEMO: печать, очередь и сохранённые файлы

Дата проверки: 22 сентября 2026. Область: `products/demo`; legacy DSJ формы прочитаны как исходники, их файлы и данные не изменялись.

## Реализация

- В поставке ровно 10 подключённых шаблонов версии 4: BIOT worker, BIOT ITR, BIOT protocol, PTM card/protocol, PB card/protocol, PS card/protocol/witness. Неподключённый reference DOCX не переносился.
- В manifest записаны исходные и текущие SHA-256, поля, размеры каждого раздела, наличие фото и индивидуальная семантика протокола. Выпуск использует копию bytes шаблона из приватного хранилища по ключу и контрольной сумме snapshot.
- Из шаблонов удалены исходные изображения, подписи, печати, thumbnails, внешние relationships, mail merge/embedded объекты, значения прежней комиссии и эмитента, двоичные кэши `o:gfxdata` и остаток старого названия в декоративной полосе. Черновые версии 1–3 оставлены в игнорируемом локальном `.runtime/historical-template-generation`, вне поставки. Приватные исторические версии не переписываются.
- Renderer `demo-ooxml-2/libreoffice-26.2.6.3` сохраняет геометрию листа и рамок, переносит динамический текст внутри прежних блоков, резервирует место фото PB/PS/PTM. Неумещающийся текст возвращает `PRINT_LAYOUT_OVERFLOW`, без обрезания. Нижняя граница автоматического подбора карточек — 6,5 pt. В сертификате ITR подбирается только размер ФИО в свободной полосе над названиями курса; остальной текст и свидетельство сохраняют исходные размеры.
- Независимые RU/KZ ФИО, должность и организация сохраняются также в исторических одноклеточных формах: если в сохранённых bytes нет отдельного KZ/BOTH поля, RU поле получает оба введённых значения через « / ». Это исправляет три протокола с RU-only ФИО, PTM организацию, PS должность и ФИО сертификата ITR. Никакого автоматического перевода или копирования одного значения вместо другого нет.
- В пакетах каждый получатель получает собственные DrawingML/VML identifiers, bookmarks и numbering instances. Длинные серии пустых абзацев BIOT заменены настоящим переходом страницы. Это устраняет пропавшую KZ-половину второго свидетельства, продолжение нумерации колонок и перенос рамок за лист.
- PDF конвертируется из тех же DOCX bytes закреплённым LibreOffice 26.2.6.3. Установленные и исходные 12 шрифтов Liberation 2.1.5 сверяются по SHA-256. Worker проверяет product policy, Python dependencies, templates, fonts и converter до создания PrismaClient и первого heartbeat.
- Фото декодируется Pillow как PNG/JPEG; проверяются 5 MiB, 20 млн пикселей, EXIF, crop/rotation, минимальный размер и печатное разрешение. В снимке — opaque asset references; production object keys дополнительно позволяют проверить hash фото при печати.
- XLSX экспорт пишет пользовательские строки текстом, включает request/status/revision/date, самостоятельные RU/KZ-поля, направление, вид документа, номер документа, протокола и регистрации PS. Импорт возвращает оригинальные заголовки и rawRows, листы и выбранный лист, номера исходных строк, leading zeros, ошибки формул; macros/external links отклоняются.
- ZIP получает только текущие jobs каждого document/format; файлы FAILED и прежние восстановленные попытки не включаются. `manifest.json` содержит counts, hashes и missing reasons; `STATUS.txt` прямо называет неполный комплект, имя такого ZIP начинается `PARTIAL-`.

## Очередь и storage

PostgreSQL очередь использует `FOR UPDATE SKIP LOCKED`, lease 30 секунд, heartbeat каждые 5 секунд, fencing token и транзакционную публикацию pointer. Время SQL явно приведено к UTC, включая соединение PostgreSQL с `Asia/Almaty`. Истёкший worker может оставить только неподключённый объект, не изменить опубликованный файл. Хранилище создаёт случайный immutable key через `wx`, fsync bytes и, в Linux, родительского каталога. Download читает сохранённые bytes.

Восстановление использует новый snapshot с `provenance=RECONSTRUCTED`, `restoreOfArtifactId` и `originalSha256`; audit хранит ссылку на оригинал. Прежний artifact не изменяется, номера и Issuance не создаются повторно.

## GC

`pnpm exec tsx scripts/maintenance/gc.ts --dry-run` выводит кандидатов. Применение: `pnpm exec tsx scripts/maintenance/gc.ts --apply --backup ABSOLUTE_BACKUP_DIRECTORY`.

Удаляются только attempt-addressed `objects/<prefix>/<sha>-<uuid>.<extension>`, у которых и creation time, и mtime старше 7 суток, нет ссылок из любого Artifact, TemplateVersion, PhotoAsset или RenderInputSnapshot, и нет ключа в проверенной резервной копии. Проверяются hash database.dump и каждый файл manifest. Символические ссылки игнорируются. Перед удалением повторно сверяются size/mtime/hash. Рабочий каталог и путь каждого файла разрешены внутри ArtifactStore.

GC и backup/restore используют единый эксклюзивный sibling lock `<artifact-root>.maintenance.lock` с `wx`; stale lock автоматически не ломается. GC получает advisory transaction lock 1145392463, worker acquisition — shared lock с тем же ключом. Apply отказывает при любом неистёкшем RUNNING lease. Финальные artifacts и DB записи preview не удаляются. Эта консервативная поставка сознательно сохраняет preview records и всё, перечисленное в выбранном backup manifest; автоматического удаления зарегистрированной истории нет.

## Выполненные проверки

`tests/integration/worker.test.ts`: 9/9 PASS, 0 skipped. Отчёт `worker-tests.log`. Проверены 20 параллельных захватов, отказ stale heartbeat/publication, единственный canonical artifact, exhausted crash, deferred PDF без расходования retry, traversal/hash corruption, bounded child timeout/abort, честное восстановление, GC/lease/backup race и UTC при не-UTC соединении.

`tests/render/test_render.py`: окончательный полный прогон **14/14 PASS, 0 skipped, 218,594 секунды** на итоговом renderer — `print-render-final.log`. Обязательные проверки не используют skip: настоящий DOCX/PDF для 10 форм, batch/100/101, безопасный XLSX/import, повреждённое фото, crop/rotation/EXIF/limits, полный и частичный ZIP, размеры всех исходных секций, отсутствие demo mark на рабочем документе, raw headers/лист/leading zeros, immutable template bytes, календарные границы и независимые RU/KZ значения в одноклеточных формах. Неразрывное имя длиной 500 символов отклоняется до появления обрезанного файла. Линтер изменённых TypeScript областей и typecheck packages/printing и apps/render-worker прошли. Предыдущий полный прогон 12 тестов и отдельные regressions сохранены как история, но итоговый статус основан на завершающем прогоне всех 14.

Расширенная проверка: `scripts/verification/acceptance_render.py`; итоговые 40 пар DOCX/PDF, полный inventory, SHA-256, размеры и PNG каждой страницы — `docs/evidence/render/acceptance/`. Варианты каждой формы: short, long/RU-KZ, blank optional, batch two. Протоколы в пакете остаются двумя индивидуальными документами. Отдельные conversion markers связывают hash DOCX с hash PDF после реально выполненного конвертера; повторное использование допускается только при совпадении обеих сумм.

**Финальная визуальная приёмка v4: PASS для 40 комплектов и 70 страниц.** Проверены все 9 contact sheets; дополнительно в полном размере просмотрены длинный ITR сертификат, PTM, исправленные PS/PB с фото, PB без фото и обе страницы второго пакетного свидетельства RU/KZ. В PB и PS текст отделён от фото; пустое место фото PB также сохраняется. Имена второго получателя, его номер и собственное фото присутствуют; нумерация таблиц начинается заново. После исправления KZ fallback повторно конвертированы затронутые протоколы и ITR; обновлённые contact sheets 02/03/04/06/08 просмотрены повторно. В длинном PB протоколе два соседних пустых spacer-абзаца сведены к одному: пояснения подписи не остаются на пустой второй странице. Все PDF проверены на полные независимые RU/KZ ФИО и доступные в форме должность/организацию; `problems=[]`.

| Форма | Пар DOCX/PDF | Страниц |
|---|---:|---:|
| BIOT worker card | 4 | 10 |
| BIOT ITR certificate | 4 | 5 |
| BIOT protocol | 4 | 5 |
| PTM card | 4 | 5 |
| PTM protocol | 4 | 5 |
| PB card | 4 | 10 |
| PB protocol | 4 | 5 |
| PS card | 4 | 10 |
| PS protocol | 4 | 5 |
| PS witness | 4 | 10 |
| **Всего** | **40** | **70** |

Точные hashes каждого DOCX/PDF/PNG — `render/acceptance/inventory.json`; перечень просмотренных страниц и hash inventory — `printing-visual-review.json`. `printing-technical.json` подтверждает 10 шаблонов v4, отсутствие старых реквизитов, исходных media/embeddings, внешних relationships и скрытого gfxdata. Исторические 14 пробных файлов перенесены в `.runtime/qa-predecessors`, вне итогового evidence. Шаблоны и артефакты старых выпусков в приватном хранилище не менялись.

## Границы заключения

Это локальная инженерная проверка. Содержание нормативных ссылок и юридическую применимость форм должен утвердить эмитент; исторический шаблон не доказывает актуальность нормы. Тестовые specimens имеют явную отметку «ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ». Production ingress/DSJ workers здесь не переключались. Размер и сложность произвольного текста ограничены физической формой; превышение обрабатывается ошибкой, не молчаливым сокращением ФИО.
