# Восстановление шаблонов ДСЖ в OT Center

Проверено 25 сентября 2026 года в ветке `codex/ot-center-dsj-forms-ux`. Для новых выпусков восстановлены формы ДСЖ по сохранённым оригиналам и их версионированным производным. Проверка текущих файлов: **14 пар DOCX/PDF, 44 страницы PDF, PASS**. Дополнительно просмотрена двухстраничная корочка с предельными серверными номерами. Все данные примеров синтетические; на каждой странице присутствует отметка «ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ».

## Источники и выбор версии

Оригиналы находятся в `dsj2/docs/experimental/biot/`. Сохранённые шаблоны и `manifest-before-biot-2026.json` находятся в каталоге:

`C:\Users\Admin\Documents\DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL\dsj2\products\demo\docs\evidence\commercial-acceptance\printing\historical-inputs`

Исторический manifest связывает каждую производную с SHA-256 оригинала. Эта связь и реальный рендер определили источник восстановления. Отдельного исторического оригинала протокола ИТР в этой цепочке нет: профиль ИТР использует ту же сохранённую двуязычную форму протокола, собственный идентификатор и версию. Поэтому его заголовок сохраняет общую формулировку проверки знаний по БиОТ работников; отдельных печатных граф специальных компетенций ИТР в выбранном оригинале нет. Сам профиль ИТР и его сертификат остаются отдельными сущностями приложения.

| Назначение                | Оригинал                             | Сохранённая производная ДСЖ     | До задачи        | Новая версия                                          |
| ------------------------- | ------------------------------------ | ------------------------------- | ---------------- | ----------------------------------------------------- |
| Рабочие, корочка          | `biot-card-template.docx`            | `biot-worker-card.v15.docx`     | v16              | `biot-worker-card.v17.docx`                           |
| ИТР, сертификат           | `biot-itr-certificate-template.docx` | `biot-itr-certificate.v13.docx` | v14              | `biot-itr-certificate.v15.docx`                       |
| Рабочие, протокол         | `biot-protocol-template.docx`        | `biot-protocol.v9.docx`         | v10              | `biot-protocol.v11.docx`                              |
| ИТР, протокол             | `biot-protocol-template.docx`        | `biot-protocol.v9.docx`         | v1               | `biot-itr-protocol.v2.docx`                           |
| Рабочие, протокол события | тот же оригинал протокола            | та же v9                        | прежняя group-v1 | `biot-protocol.group-v2.docx`, версия `11-group-1`    |
| ИТР, протокол события     | тот же оригинал протокола            | та же v9                        | прежняя group-v1 | `biot-itr-protocol.group-v2.docx`, версия `2-group-1` |

SHA-256 оригиналов:

- Корочка: `6dcadf33f59c8d50cac3c2c079c35482c3a83c3804c99a9e03912812f8ec8a41`.
- Сертификат: `d817d041ab6153508c851d1f6318561afd7988331619aac7f144f8c688c8d135`.
- Протокол: `31309ce6db0990d98c235fc80364ba21ccd0ae9c0fc262917be3601a0268047b`.

Полная цепочка контрольных сумм хранится в [журнале восстановления](../assets/templates/dsj-restoration-changes.json) и [активном manifest](../assets/templates/manifest.json). Повторная сверка после реализации подтвердила неизменность всех девяти файлов сравнения: трёх оригиналов, трёх исторических производных и трёх шаблонов, применявшихся до задачи.

## Что восстановлено и что исправлено

Корочка снова использует исторические панели, двуязычные поля и оборот с разделами повторной проверки. Сохранены исправления казахских надписей и внутренних отступов. Внутренний блок комиссии увеличен до 150 pt в существующей панели высотой 172,25 pt: полный серверный номер протокола помещается без уменьшения шрифта. Должности комиссии не повторяются в строках имён.

Сертификат ИТР сохраняет альбомный лист, синий геометрический орнамент, композицию и порядок двуязычных полей оригинала. Вместо чужого логотипа в прежнем месте выводится фактический эмитент. Примеры с коротким и длинным ФИО проверены отдельно.

Протокол сохраняет шесть исходных колонок. В строках участников отображаются собственные RU/KZ значения работодателя, должности и имени. Основание комиссии выводится один раз, вид проверки заполняется явно. Номер протокола находится в заголовке; номер удостоверения не подставляется в графу примечаний или подписи. В синтетических примерах примечания и линии подписи пусты.

Блок подписей переведён из плавающих элементов в таблицу с теми же тремя смысловыми колонками: подпись должности, имя, свободная линия подписи. Он следует за списком и переносится целиком. При трёх участниках пример занимает две страницы, при ста — **14 страниц**, причём последняя содержит комиссию и свободные линии подписи. Это фактическая пагинация восстановленной формы.

Фото не предусмотрено ни одной из выбранных исторических форм БиОТ: их исходный и новый manifest содержат `photo: false`. Поэтому фото не добавлено в корочку, сертификат или протокол. Другие направления сохраняют собственные правила фотографий.

## Фактические файлы и результаты

Пути в таблице относительны этому документу. Короткие и длинные значения проверялись в отдельных файлах; группа создаёт один общий протокол на событие.

| Сценарий                             | DOCX                                                                               | PDF                                                                              | Страниц PDF |
| ------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- |
| Рабочие, короткие поля               | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-worker-card-short-1.docx)     | [PDF](evidence/dsj-forms-ux/templates/restored/biot-worker-card-short-1.pdf)     | 2           |
| Рабочие, длинные поля                | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-worker-card-long-1.docx)      | [PDF](evidence/dsj-forms-ux/templates/restored/biot-worker-card-long-1.pdf)      | 2           |
| ИТР, короткие поля                   | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-itr-certificate-short-1.docx) | [PDF](evidence/dsj-forms-ux/templates/restored/biot-itr-certificate-short-1.pdf) | 1           |
| ИТР, длинные поля                    | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-itr-certificate-long-1.docx)  | [PDF](evidence/dsj-forms-ux/templates/restored/biot-itr-certificate-long-1.pdf)  | 1           |
| Рабочие, протокол с короткими полями | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-protocol-short-1.docx)        | [PDF](evidence/dsj-forms-ux/templates/restored/biot-protocol-short-1.pdf)        | 1           |
| Рабочие, протокол с длинными полями  | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-protocol-long-1.docx)         | [PDF](evidence/dsj-forms-ux/templates/restored/biot-protocol-long-1.pdf)         | 1           |
| ИТР, протокол с короткими полями     | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-short-1.docx)    | [PDF](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-short-1.pdf)    | 1           |
| ИТР, протокол с длинными полями      | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-long-1.docx)     | [PDF](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-long-1.pdf)     | 1           |
| Рабочие, группа 1                    | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-protocol-group-1.docx)        | [PDF](evidence/dsj-forms-ux/templates/restored/biot-protocol-group-1.pdf)        | 1           |
| Рабочие, группа 3                    | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-protocol-group-3.docx)        | [PDF](evidence/dsj-forms-ux/templates/restored/biot-protocol-group-3.pdf)        | 2           |
| Рабочие, группа 100                  | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-protocol-group-100.docx)      | [PDF](evidence/dsj-forms-ux/templates/restored/biot-protocol-group-100.pdf)      | 14          |
| ИТР, группа 1                        | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-group-1.docx)    | [PDF](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-group-1.pdf)    | 1           |
| ИТР, группа 3                        | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-group-3.docx)    | [PDF](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-group-3.pdf)    | 2           |
| ИТР, группа 100                      | [DOCX](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-group-100.docx)  | [PDF](evidence/dsj-forms-ux/templates/restored/biot-itr-protocol-group-100.pdf)  | 14          |

Дополнительный стресс-пример: [корочка с полными серверными номерами DOCX](evidence/dsj-forms-ux/templates/restored/biot-worker-server-number.docx) и [PDF](evidence/dsj-forms-ux/templates/restored/biot-worker-server-number.pdf), две страницы. Он не включён в счёт 14 сценариев и 44 страниц.

## Проверка и границы доказательств

`scripts/verification/compare-dsj-sources.py` сформировал реальные рендеры оригиналов, исторических производных и шаблонов до изменения. Каталог `comparison/` оставлен как исходное сравнение: слово `current` в его именах означает состояние до восстановления, то есть v16/v14/v10. Новые версии находятся в `restored/`.

`scripts/verification/verify-dsj-restored.py` сформировал 14 пар и проверил OOXML, отсутствие незаполненных плейсхолдеров и чужих реквизитов, границы PDF, RU/KZ имена, номера, число и порядок строк, повторные заголовки и цельность комиссии. Финальная повторная проверка выполнена по существующим файлам после последнего исправления корочки; их SHA-256 сверены с индивидуальными записями. Устаревшие контрольные суммы двух корочек в сводном JSON заменены подтверждёнными суммами этих финальных файлов.

Все 44 страницы проверены через 23 уникальных PNG; повторяющиеся изображения сопоставлены по SHA-256. Отдельно просмотрены обе страницы стресс-примера. Другой агент независимо просмотрел длинные поля корочки и сертификата, короткий протокол и последнюю страницу группы 100. Подтверждены читаемость казахских знаков, отсутствие перекрытий, целые рамки, свободные подписи и корректный порядок 1–100.

Машинные результаты: [verification.json](evidence/dsj-forms-ux/templates/restored/verification.json), [final-audit.json](evidence/dsj-forms-ux/templates/restored/final-audit.json), [sources.json](evidence/dsj-forms-ux/templates/comparison/sources.json). Используются страницы, перечисленные в JSON и реально содержащиеся в PDF; лишние PNG от промежуточных рендеров не являются страницами финальных документов.

Дополнительно проверены шапки четырёх страниц реально выпущенных локальных синтетических протоколов `BIOT-PROTOCOL-00003` и `BIOT-PROTOCOL-00004`: отметка ДЕМО, эмитент и адрес присутствуют на обеих страницах каждого PDF. Верхние 130 пикселей четырёх PNG побайтно одинаковы; в OOXML обоих DOCX одинаковы headers, settings и relationships. Результат и координаты текста сохранены в [header-audit.json](evidence/forms-ux/live/header-audit.json). Эти уже выпущенные файлы при проверке не менялись.

Полный `pnpm test:render` после финализации завершился с кодом 0: **37 тестов, 415,718 с, OK**. Проверены все активные формы, группы 1/2/25/100 для пяти направлений, 100 индивидуальных протоколов, защита закреплённых старых шаблонов, Excel/CSV, фото и XML. Лог: [render-final.log](evidence/forms-ux/render-final.log). Сверка с исходным коммитом `97ffd06c82b556324f342abd578f7343fed5f885` подтвердила неизменность 16 ранее существовавших DOCX, трёх исторических оригиналов и отсутствие tracked-изменений вне автономного продукта: [source-isolation-final.json](evidence/forms-ux/source-isolation-final.json).

Проверка выполнена локально рендерером продукта и LibreOffice в Windows. Открытие именно этих новых версий в Microsoft Word и физическая печать не выполнялись. Юридическое утверждение форм эмитентом не заявляется. Старые версии DOCX и их контрольные суммы не заменялись; новая версия выбирается для нового выпуска, а сохранённый снимок продолжает ссылаться на закреплённый шаблон и checksum. Общую сверку ранее выданных файлов и проверку браузерных сценариев содержит основной отчёт задачи.
