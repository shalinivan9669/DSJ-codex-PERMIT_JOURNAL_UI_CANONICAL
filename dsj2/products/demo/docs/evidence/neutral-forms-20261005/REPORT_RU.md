# Новые печатные формы DEMO — локальная приёмка 05.10.2026

**Результат: PASS Word и PDF приложения.** Исправлены DOC-01…DOC-10; 16 новых версий, отдельная политика NEUTRAL_FORMS_V1. Физическая печать не выполнялась; production не менялся.

Worktree: `C:\Users\Admin\.codex\worktrees\ot-center-business-value\DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL\dsj2\products\demo`. Ветка `codex/operator-flow-refinement-20261003`, HEAD `a9c9ef2015d8e6c9f9c34f2fb897332f00329430`.

Основной комплект: 30 DOCX,30 PDF приложения и 30 экспортов Word; просмотрены все 48 + 48 страниц. Стресс-проверка: 5 групповых форм ×1,2,25,100,250,400 участников —3890 записей в каждом движке; 285 страниц приложения и 286 страниц Word. Все страницы прочитаны программно; визуально просмотрены малые случаи и окончания больших групп.

[Скачать полный контрольный комплект DOCX + PDF + Word + snapshots + SHA256](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/DEMO-neutral-control-kit-20261005.zip>)

[Скачать все 30 групповых случаев 1–400: DOCX + PDF приложения + Word](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/DEMO-neutral-group-scale-20261005.zip>)

## Матрица 16 форм

|Форма|Вид|Новая версия|Word / PDF, страниц основного комплекта|Результат|
|---|---|---|---|---|
|biot-worker-card|individual|21|4 / 4|PASS|
|biot-itr-certificate|individual|19|2 / 2|PASS|
|biot-protocol|individual|15|2 / 2|PASS|
|ptm-card|individual|18|3 / 3|PASS|
|ptm-protocol|individual|13|2 / 2|PASS|
|pb-card|individual|18|6 / 6|PASS|
|pb-protocol|individual|13|2 / 2|PASS|
|ps-card|individual|19|6 / 6|PASS|
|ps-protocol|individual|13|2 / 2|PASS|
|ps-witness|individual|15|4 / 4|PASS|
|biot-itr-protocol|individual|6|2 / 2|PASS|
|biot-protocol|group|15-group-1|3 / 3|PASS|
|ptm-protocol|group|13-group-1|3 / 3|PASS|
|pb-protocol|group|13-group-1|2 / 2|PASS|
|ps-protocol|group|13-group-1|2 / 2|PASS|
|biot-itr-protocol|group|6-group-1|3 / 3|PASS|

## DOC-01…DOC-10

|Дефект|Причина|Исправление|Новая проверка|
|---|---|---|---|
|DOC-01|Логотип был графикой в ZIP; замена строк его не удаляла.|Новые пакеты очищены от исходной графики; нейтральный редактируемый блок ЛОГОТИП.|Все 16 новых шаблонов +30 итоговых DOCX: XML/атрибуты/связи/media/известные SHA; Word и PDF.|
|DOC-02|Печати и подписи свидетельства были отдельными перекрывающими рисунками.|Рисунки удалены; отдельная нейтральная рамка МЕСТО ДЛЯ ПЕЧАТИ и строки подписи.|Обе страницы и языковые половины normal/long, длинная регистрация; Word и PDF.|
|DOC-03|Неиспользуемая картинка чужой организации оставалась в media.|Удалены все исходные media, свойства, миниатюры, вложения и лишние связи новых пакетов.|Поиск известных хешей во всех ZIPparts; отрицательный тест с внедрённой скрытой графикой.|
|DOC-04|Фиксированные узкие блоки ИТР и большой межбуквенный интервал обрезали строки.|Согласованы размеры/шрифты/интервалы заголовка, имени, курса, дат и издателя; контроль переполнения.|Обычные, длинные и стрессовые значения; полный текст и визуальный просмотр Word/PDF.|
|DOC-05|Плавающие поля ПБ пересекались с фото и соседними строками.|Потоковые таблицы, отдельная колонка фото, полные даты и переносы полей.|Normal/long/photo, обе страницы, отдельный пакет с разными фото двух получателей.|
|DOC-06|Повторная полоса ПС имела ширину за пределами листа.|Ширина полосы согласована с карточкой; сохранены RU/KZ издатель и работодатель.|Все 6 страниц normal/long/photo в обоих конвертерах; полный работодатель и дисциплины.|
|DOC-07|Две копии БиОТ использовали разную геометрию и плавающие блоки.|Одинаковые таблицы двух копий, согласованные ширины и переносы.|Сравнение структуры копий, normal/long, обе страницы Word/PDF, overflow preflight.|
|DOC-08|Неверные tblHeader, разрывы строк и автоматическая нумерация таблиц.|Только настоящие заголовки повторяются; cantSplit; явные 1..N; контроль высоты строки.|Все 5 форм ×1/2/25/100/250/400; каждый участник/результат/порядок, заголовки на всех страницах.|
|DOC-09|Плавающий/разрываемый блок комиссии отделялся от таблицы; Writer сливал соседние таблицы.|Комиссия в одном блоке со связью с последними участниками; у ПБ в замыкающей строке таблицы. Удалены только исходные дубли правовых форм.|Все 30 масштабных случаев в Word и PDF: целая комиссия и участники на последнем листе; пустых хвостов нет.|
|DOC-10|Разные движки по-разному обрабатывали исходные блоки, высоты и привязки.|Новая отдельная политика NEUTRAL_FORMS_V1 с нормализованной геометрией и проверкой переполнения.|Те же 30 DOCX отдельно Word16.0.17932 и renderer.convert_pdf/LibreOffice26.2.6.3; все страницы основного комплекта просмотрены.|

## Проверки

- `pnpm test: render`: 125 тестов PASS. После последних исправлений отдельно повторены 14 целевых проверок текущего кода и 7 проверок протоколов ПБ: реальные DOCX/PDF всех 11 форм, данные в ячейках, карточки/фото, независимость XML namespace, работодатели RU/KZ и запрет перезаписи существующих версий.
- `pnpm test`: 189 основных +211 web =400 PASS. `pnpm lint`, `pnpm typecheck`, `pnpm build`: PASS.
-12 целевых интеграционных тестов PASS: история артефактов, авторизованное скачивание, регистрация и добавление новых версий. Полный integration/E2E-прогон не заявляется.
-16 новых шаблонов и 30 итоговых DOCX: весь ZIP, XML/атрибуты, колонтитулы, связи, media, известные хеши старых изображений, свойства/миниатюры/вложения. Исходной символики нет.
-Все 30 финальных DOCX повторно сформированы текущим кодом: байты совпали. Ошибки переполнения дают `PRINT_LAYOUT_OVERFLOW` до выпуска.
-После объединения документов закладки получают уникальные ID и имена; ссылки сохраняются внутри своего получателя. Две пакетные регрессии PASS. Один и тот же объединённый DOCX ПБ на двух получателей проверен в Word и конвертере приложения: 2 страницы, каждый получатель один раз в правильном порядке, комиссия целиком. [Доказательства пакетной проверки](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/docs/evidence/neutral-forms-20261005/batch-bookmarks-verification.json>).

## История и регистрация

Сохранены все 87 прежних файлов каталога шаблонов и 319 файлов прежнего аудита/сохранённого комплекта. Вне manifest и renderer прежние проверяемые файлы не изменялись; прежний progress сохранён и дополнен.

В изолированной локальной БД 16 старых версий сохранены,16 новых добавлены как несогласованные. Исторический snapshot и артефакт неизменны; авторизованное HTTP-скачивание до/после имеет одинаковыйSHA256; повторный старый LEGACY_REFERENCE_90D5-рендер даёт прежние байты. Повторная регистрация не создаёт дубликаты. Согласование и подпись реального выпуска не имитировались.

[Контроль сохранности](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/docs/evidence/neutral-forms-20261005/preservation-after.json>) · [Проверка регистрации/истории](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/docs/evidence/neutral-forms-20261005/registration-history-upgrade.json>)

## До/после

**biot-itr-certificate-normal** — Те же данные.

![biot-itr-certificate-normal](C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/before-after/biot-itr-certificate-normal.png)

**biot-worker-card-long** — Те же длинные ФИО/должность/работодатель; после исправления дополнительно удлинены номера и RU/KZ курс.

![biot-worker-card-long](C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/before-after/biot-worker-card-long.png)

**pb-card-long** — Те же длинные ФИО/должность/работодатель; после исправления дополнительно удлинены номера и RU/KZ курс.

![pb-card-long](C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/before-after/pb-card-long.png)

**ps-card-normal** — Те же данные.

![ps-card-normal](C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/before-after/ps-card-normal.png)

**ps-witness-normal** — Те же данные.

![ps-witness-normal](C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/before-after/ps-witness-normal.png)

**biot-protocol-group25** — Те же данные.

![biot-protocol-group25](C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/before-after/biot-protocol-group25.png)

**pb-protocol-group25** — Те же данные.

![pb-protocol-group25](C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/before-after/pb-protocol-group25.png)

## Файлы основного комплекта

|Сценарий|DOCX|PDF приложения|PDF Word|
|---|---|---|---|
|biot-worker-card-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-worker-card-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-worker-card-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-worker-card-normal.word.pdf>)|
|biot-worker-card-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-worker-card-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-worker-card-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-worker-card-long.word.pdf>)|
|biot-itr-certificate-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-certificate-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-certificate-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-certificate-normal.word.pdf>)|
|biot-itr-certificate-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-certificate-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-certificate-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-certificate-long.word.pdf>)|
|biot-protocol-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-normal.word.pdf>)|
|biot-protocol-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-long.word.pdf>)|
|ptm-card-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-normal.word.pdf>)|
|ptm-card-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-long.word.pdf>)|
|ptm-card-photo|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-photo.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-photo.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-card-photo.word.pdf>)|
|ptm-protocol-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-normal.word.pdf>)|
|ptm-protocol-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-long.word.pdf>)|
|pb-card-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-normal.word.pdf>)|
|pb-card-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-long.word.pdf>)|
|pb-card-photo|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-photo.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-photo.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-card-photo.word.pdf>)|
|pb-protocol-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-normal.word.pdf>)|
|pb-protocol-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-long.word.pdf>)|
|ps-card-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-normal.word.pdf>)|
|ps-card-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-long.word.pdf>)|
|ps-card-photo|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-photo.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-photo.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-card-photo.word.pdf>)|
|ps-protocol-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-normal.word.pdf>)|
|ps-protocol-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-long.word.pdf>)|
|ps-witness-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-witness-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-witness-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-witness-normal.word.pdf>)|
|ps-witness-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-witness-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-witness-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-witness-long.word.pdf>)|
|biot-itr-protocol-normal|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-normal.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-normal.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-normal.word.pdf>)|
|biot-itr-protocol-long|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-long.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-long.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-long.word.pdf>)|
|biot-protocol-group25|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-group25.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-group25.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-protocol-group25.word.pdf>)|
|ptm-protocol-group25|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-group25.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-group25.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ptm-protocol-group25.word.pdf>)|
|pb-protocol-group25|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-group25.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-group25.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/pb-protocol-group25.word.pdf>)|
|ps-protocol-group25|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-group25.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-group25.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/ps-protocol-group25.word.pdf>)|
|biot-itr-protocol-group25|[DOCX](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-group25.docx>)|[PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-group25.pdf>)|[Word PDF](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/.runtime/neutral-forms-final-20261005/biot-itr-protocol-group25.word.pdf>)|

## Изменения реализации

Новые 16DOCX и manifest/реестрSHA; `renderer.py` dispatch; `neutral_forms.py`, `neutral_identity.py`, `neutral_cards.py`, `neutral_certificates.py`, `neutral_protocols.py`; additive upgrade и verification helpers; новые регрессии и три точечных адаптации прежних тестов. Старые legacy helpers и templates не переписаны. Полный список: [changed-files.json](<C:/Users/Admin/.codex/worktrees/ot-center-business-value/DSJ-codex-PERMIT_JOURNAL_UI_CANONICAL/dsj2/products/demo/docs/evidence/neutral-forms-20261005/changed-files.json>).

## Границы и контрольная печать

Синтетические документы. Печатать PDF из папки application-pdf, масштаб 100% / фактический размер, без подгонки.

Проверить на бумаге: физические рамки и размеры карточек; читаемость длинных ФИО/RU/KZ курса; края полос издателя; отдельную область фото; места подписи и печати; последовательность лиц/оборотов и сгибы; последнюю страницу группы с комиссией.

Для первого контроля печатать односторонне. Затем согласовать переворот по нужному краю для конкретного бланка и принтера. Физическая печать в этой проверке не выполнялась.

Две небольшие особенности ПТМ сохранены в матрице: перенос внутри длинного слова должности без дефиса и невидимая левая линия рамки ЛОГОТИП в Word. Данные полны, пересечений нет. Word может кодировать казахскую ә как визуально идентичную ə в извлечённом PDF-тексте; сравнение нормализует только эту пару.

Новые версии требуют обычного согласования шаблона в центре. Зарегистрированные immutable contract не обновляются при повторном setup. Production-миграции, публикация и отправка третьим лицам не выполнялись.
