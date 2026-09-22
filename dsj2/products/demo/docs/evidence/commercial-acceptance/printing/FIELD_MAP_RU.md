# Карта структуры и данных печати

Это инженерная карта десяти подключённых исторических форм. Нормативная
пригодность отдельно рассматривается в `../../../FORM_LEGAL_REVIEW_RU.md`.
Все образцы синтетические и сохраняют водяной знак.

Машиночитаемая карта `template-structure-field-map.json` содержит каждую таблицу,
ширины сетки в twips, каждую строку и ячейку, gridSpan/vMerge, заголовки,
tblHeader/cantSplit, разделы и поля страницы. `fieldLocations` связывает каждый
placeholder с конкретным XPath абзаца/ячейки OOXML и его контекстом. Для каждого
базового PDF файл `*.field-coordinates.json` хранит фактические page + bounding
box соответствующих значений. Это координаты текста PDF, а не предположение по
положению XML; одного глобального поиска текста для нумерации не используется.

| Входное поле | Placeholder / блок |
| --- | --- |
| item.fullNameRu / fullNameKz | FULL_NAME_RU / FULL_NAME_KZ; FULL_NAME_BOTH объединяет обе самостоятельные строки через `/` |
| item.positionRu / positionKz | POSITION_RU / POSITION_KZ / POSITION_BOTH; в PS witness PROFESSION_RU / PROFESSION_KZ |
| item.workplaceRu / workplaceKz | WORKPLACE_RU / WORKPLACE_KZ / WORKPLACE_BOTH; полное название не сокращается |
| item.number | NUMBER, KB_NUMBER; отдельный серверный номер документа |
| item.credentialNumber | NUMBER только в PS-protocol: номер связанного удостоверения, пусто при его отсутствии |
| item.protocolNumber | PROTOCOL_NUMBER, PROTOCOL_NUMBER_DISPLAY; независим от порядкового номера человека |
| item.registrationNumber | REGISTRATION_NUMBER в PS witness |
| assignment.documentDate | DOCUMENT_* и ISSUE_* |
| assignment.protocolDate | PROTOCOL_*; также дата решения комиссии в обеих языковых частях PS witness |
| assignment.trainingStart / trainingEnd | TRAINING_START_* / TRAINING_END_* |
| assignment.validUntil | VALID_*; в PB-card день и месяц берутся из validUntil |
| assignment.trainingSubject | SUBJECT |
| assignment.result / reason / education / hours | RESULT / REASON / EDUCATION / HOURS |
| issuer.nameRu / nameKz | ISSUER_RU / ISSUER_KZ, EDU_ORG_RU / EDU_ORG_KZ |
| issuer.cityRu / cityKz, addressRu / addressKz | CITY_RU / CITY_KZ, ADDRESS_RU / ADDRESS_KZ |
| issuer.approvalBasis | APPROVAL_BASIS, один блок в каждом использующем его протоколе |
| issuer.commission[0..2] | CHAIR / MEMBER_1 / MEMBER_2: имя и должность; графические подписи не генерируются |
| item.photoAssetId + snapshot.photos | PTM/PB/PS-card: приватные PNG bytes, разные фотографии всех получателей |

Если шаблон имеет одну двуязычную ячейку с историческим RU-only placeholder и
не имеет отдельного KZ/BOTH placeholder соответствующего поля, renderer
выводит обе самостоятельные строки. Пустой KZ не заменяется русским переводом.
В шаблонах остаются пустые места ручной подписи и печати; чужие изображения
подписи/печати не вставляются. Реальные полномочия комиссии не имитируются.

| Форма | Основные таблицы и числовая семантика | Листы на получателя в коротком образце |
| --- | --- | ---: |
| BIOT worker card | Три одноколоночные таблицы-контейнера панелей; строк номеров колонок нет | 2 |
| BIOT ITR certificate | Позиционированные блоки без таблиц; номер сертификата | 1 |
| BIOT protocol | Таблица0: 6 колонок, header row0, номера row1=`1..6`, person row2=`1`; таблицы комиссии0/подписи имеют отдельные назначения | 1 |
| PTM card | Одноколоночный контейнер лицевой/оборотной панели, нет номеров колонок | 1 |
| PTM protocol | Таблица0: 7 колонок, row0 header, row1 человек=`1`, последняя ячейка ручной подписи пустая; таблица комиссии grid7 с объединёнными ячейками | 1 |
| PB card | Одноколоночные контейнеры текущей и повторных проверок, нет номеров колонок | 2 |
| PB protocol | Таблица0: 5 колонок, человек=`1`; таблица комиссии grid7 с объединениями | 1 |
| PS card | Контейнеры панелей; таблица дисциплин grid3, `1` — порядковый номер дисциплины, второй результат не дублируется | 2 |
| PS protocol | Таблица0: 7 колонок, человек=`1`; последняя ячейка содержит credentialNumber один раз; комиссия grid4 | 1 |
| PS witness | Две языковые панели и вложенные таблицы дат/курсов с grid15/16 и gridSpan; регистрационный номер отдельный; строки номеров колонок нет | 2 |

Координатные assertions BIOT читают геометрические линии таблицы в PDF, находят
нужную таблицу по заголовку «Примечание» и проверяют каждую из шести ячеек
конкретной строки на каждой физической странице. Отдельный инженерный fixture
искусственно удлиняет таблицу, сохраняя модель продукта индивидуальной. Он
доказывает повтор заголовка `1..6` на следующей физической странице. Управляемая
мутация второй копии на `7..12` обязана падать в DOCX и PDF. Историческое
самопроизвольное продолжение списков не объявляется воспроизведённым.
