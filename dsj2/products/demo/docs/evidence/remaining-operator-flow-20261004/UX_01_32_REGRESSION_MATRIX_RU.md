# Регрессионная матрица UX-01…32 и R1–R4

Состояние полного регрессионного подтверждения: **NOT_RUN_AFTER_USER_REDUCED_CHECKS**. Дата подготовки: 2026-10-04. Пользователь последним уточнением сократил проверки и потребовал завершить работу: FULL166 и свежая проверка 437 требований не запускались. Все 32 исходных UX-ID и четыре риска сохранены; исторические PASS не перенесены в текущий статус. Статус строки относится к полному подтверждению прежнего UX-контракта, а не отменяет перечисленные ниже выполненные проверки.

Рабочая база — указанная пользователем ветка `codex/operator-flow-refinement-20261003` в актуальном worktree, исходная реализация UX `9e78416`, исходный HEAD задачи `648a6bd`. Текущее выполнение REM-01…08 должно сохранить контракт каждой строки ниже. Приложение и E2E этим документом не изменяются.

Исторические определения: [матрица UX-01…32/R1–R4](../operator-flow-full-fix-20261003/UX_01_32_CLOSURE_MATRIX_RU.md), [исходная машинная карта 36 критериев / 38 обязательных сценариев / 437 требований](../operator-flow-full-fix-20261003/domain/final-mandatory-proof-map-v31.json), [актуальное задание REM](../../handoffs/2026-10-04-remaining-operator-flow/PROMPT_RU.md). Исходная карта SHA-256: `9d8e8d4b0fd65b9070c208dc2ef3742c64e458d9c6f676a92ba401f207b03fb3`.

Исторический FULL31 выполнил 155 тестов с **154 PASS / 1 FAIL**, 0 skipped и 0 flaky; company37 получил `RENDER_FILE_LIMIT`. Это сохранённое исходное свидетельство, а не зелёная приёмка нынешнего продукта. Свежая привязка прежних 36 критериев и 437 требований к полному запуску была подготовлена, но после уточнения пользователя не выполнялась.

Список подготовленного полного набора: [full-list-preview/results.json](full-list-preview/results.json), **166 сценариев**. Присутствие всех 38 обязательных точных file/project/title из исходной карты сверено по этому списку; перечисление не является прохождением тестов. Проект обязательных 38 случаев — `remaining`. Числа тестовых fixtures не вводят ограничений людей, составов или числа этапов; существующая граница 250 сохранена.

Выполнены текущие [unit: 341/341 PASS, 162 core + 179 web](checks/unit-final-v8.log), [integration: 203/203 PASS](checks/integration-final-v4.log), [renderer: 101/101 PASS](checks/render-v4.log) и [выделенный UI-набор: 16/16 PASS](browser-input-signing-final-v2/results.json). Эти результаты подтверждают свой фактический объём; они не объявляются 38 пройденными обязательными браузерными случаями или свежим аудитом всех 437 требований. Короткая реальная проверка [actual2 v5: 2/2 PASS, 71.9s](final-actual-v5-c3061a20-bae3-452b-b8f1-fb58a88e3227/results.json) выполнена на `.next-remaining-operator-v5`, BUILD_ID `IaZWxKNS7yKZA9n-T7KQc`, и фиксирует фактическое сохранение ввода и последовательные выпуски. Request выпуска: `e7e4b0de-564e-458a-a307-e4cfa3755a7d`.

## Привязка к финальному выполнению

| Параметр | Текущее значение |
| --- | --- |
| Точный каталог нового FULL / runId | Не создавался: NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| BUILD_ID / source SHA перед FULL | Полный запуск не привязывался. Последний actual2: `.next-remaining-operator-v5`, BUILD_ID `IaZWxKNS7yKZA9n-T7KQc` |
| Команда и exit полного запуска | Не запускалась; exit отсутствует |
| Все 166 случаев | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| 36 строк / 38 обязательных случаев / 437 требований | NOT_RUN_AFTER_USER_REDUCED_CHECKS; свежий audit не выполнялся |
| Сохранённые файлы и фактический визуальный просмотр | Выполненные отдельные проверки описаны в общем отчёте; полный свежий FULL-dossier отсутствует |
| Выполненные unit / integration / renderer / выделенный UI / actual live | 341/341 PASS / 203/203 PASS / 101/101 PASS / 16/16 PASS / 2/2 PASS с отдельными результатами выше |

Свежий полный PASS строки требовал бы её положительного теста и фактических новых артефактов в том же run, при успешном общем FULL и проверке всех 437 требований. После сокращения пользователем объёма проверки такой вывод не делается. Во всех строках сохранён явный NOT_RUN_AFTER_USER_REDUCED_CHECKS; выполненные отдельные тесты перечислены со своим объёмом.

## Все сохранённые UX-контракты

В столбце свидетельств приведены предусмотренные пути внутри незапущенного FULL и точное число требований строки из исходной карты. Это карта покрытия, а не список полученных новых файлов. 437 — число требований по строкам, а не обещание 437 разных файлов; общие JSON/PNG могут проверяться несколькими критериями. Полные predicates и принадлежность сценариям остаются в исходной машинной карте.

| ID | Сохранённый контракт и проверяемая регрессия | Текущие исходники | Обязательные случаи | Предусмотренные свидетельства | Выполненная текущая проверка и её граница | Статус полного подтверждения |
| --- | --- | --- | --- | --- | --- | --- |
| UX-01 | **Снятие обучения с фактами без защиты и восстановления**. Серверный журнал сохраняет точный состав снятия, IDs, факты, происхождение и порядок форм/событий. Восстановление после reload сохраняет несвязанные новые правки; изменённый затронутый контекст получает явный атомарный отказ. | [training-removals.ts](../../../apps/api/src/training-removals.ts)<br>[controller.ts](../../../apps/api/src/controller.ts)<br>[product-policy.json](../../../packages/contracts/src/product-policy.json) | [C05](#c05), [C06](#c06), [C07](#c07) | 4 требований; `domain-acceptance/ux01-full-scope.json`<br>`domain-browser/scoped-restoration.json` | [integration203](checks/integration-final-v4.log): scoped remove/reload/unrelated edits, restore exact IDs/server confirmation, atomic context conflict. Полный hidden multi-person UI-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-02 | **Чип выбранного обучения не имеет обратного действия**. В выбранной области доступны явные добавление остальным и снятие с количеством; пустое назначение допускает короткую отмену, сохранённые факты защищены журналом. | [request-training-choices.tsx](../../../apps/web/components/request-training-choices.tsx)<br>[request-bundles.ts](../../../apps/web/lib/request-bundles.ts) | [C08](#c08) | 14 требований; `ui/empty-before-training.json`<br>`ui/assigned-training-chooser.json` | [UI16](browser-input-signing-final-v2/results.json): actual NONE/PARTIAL/ALL и добавление отсутствующих форм; [unit341](checks/unit-final-v8.log): inline assignments/idempotency. Полный журнал hidden scope/restore — только API-часть. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-03 | **Строка исчезает под фильтром при первой букве**. Активная строка удерживается во всех фильтрах до явного ухода; клавиатура и вставка продолжают ввод, явный повторный фильтр снимает удержание. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[recipient-grid.tsx](../../../apps/web/components/recipient-grid.tsx) | [C09](#c09) | 10 требований; `ui/menu-keyboard-outside-nested-short.json`<br>`ui/hints-geometry-filter.json` | Точный browser-кейс удержания строки всеми фильтрами не повторён. Исходники сохранены; полный статус не заявляется. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-04 | **Серверное замечание подсвечивает другого человека**. Замечание адресовано recipientId/assignmentId/eventId/полю; временная проверка группы возвращает исходный индекс. Удаление, перестановка и фильтр не переводят ошибку четвёртого человека на первого. | [index.ts](../../../packages/contracts/src/index.ts)<br>[requests.ts](../../../apps/api/src/requests.ts)<br>[resolution.ts](../../../packages/contracts/src/resolution.ts) | [C10](#c10) | 2 требований; `domain-acceptance/ux04-structural-field-focus.json` | [integration203](checks/integration-final-v4.log): group subset reports fourth person; [UI16](browser-input-signing-final-v2/results.json): stable issue ID после перестановки адресует реальное поле. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-05 | **Неясна область «всем» и наследование следующей строки**. Общий default хранится явно и учитывает категорию; отмеченные и скрытые люди указаны числами, выбранное назначение не становится default. | [request-bundles.ts](../../../apps/web/lib/request-bundles.ts)<br>[index.ts](../../../packages/contracts/src/index.ts)<br>[editor.tsx](../../../apps/web/components/editor.tsx) | [C08](#c08), [C05](#c05) | 15 требований; `ui/empty-before-training.json`<br>`ui/assigned-training-chooser.json` | [unit341](checks/unit-final-v8.log): explicit common policy, next recipient inheritance, selected-only не становится default; [UI16](browser-input-signing-final-v2/results.json): три состояния действительного комплекта. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-06 | **Поля и действия двигаются из-за сообщений**. Основные контролы закреплены на одной линии, сообщения и реквизиты ИТР расположены ниже. Погрешность проверяется по offset каждого контрола. | [operator-form.css](../../../apps/web/components/operator-form.css)<br>[recipient-grid.css](../../../apps/web/components/recipient-grid.css)<br>[recipient-grid-row.tsx](../../../apps/web/components/recipient-grid-row.tsx) | [C09](#c09), [C11](#c11), [C12](#c12) | 41 требований; `ui/menu-keyboard-outside-nested-short.json`<br>`ui/hints-geometry-filter.json` | [UI16](browser-input-signing-final-v2/results.json): 1440/1280/768/390 без внешнего overflow и широкие блоки дат. Полная геометрия всех контролов и native200% не повторены. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-07 | **Полезный смысл предупреждения обрезан**. Полные предупреждения об исходном тексте переносятся без ellipsis; mixed alphabet не блокирует сохранение и не заменяет текст. | [recipient-grid.css](../../../apps/web/components/recipient-grid.css)<br>[operator-form.css](../../../apps/web/components/operator-form.css) | [C13](#c13), [C11](#c11) | 45 требований; `ui/two-source-warnings-with-length-error-390.json`<br>`ui/length-error-retained.json` | [unit341](checks/unit-final-v8.log): text quality identifies mixed-script tokens/hidden marks без переписывания текста. Полный browser-кейс переносов предупреждений не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-08 | **Готовность заставляет искать обязательное поле**. Следующий шаг и замечания адресуют recipient/event/assignment/поле; переход раскрывает слой и фокусирует реальную причину. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[index.ts](../../../packages/contracts/src/index.ts)<br>[recipient-details.tsx](../../../apps/web/components/recipient-details.tsx)<br>[index.tsx](../../../packages/ui/src/index.tsx) | [C09](#c09), [C10](#c10), [C14](#c14), [C15](#c15), [C16](#c16) | 19 требований; `ui/menu-keyboard-outside-nested-short.json`<br>`ui/hints-geometry-filter.json` | [unit341](checks/unit-final-v8.log): exact cause paths/readiness и невозможность local full readiness; [UI16](browser-input-signing-final-v2/results.json): точный issue-link и открытие требуемой даты. Четыре полных свежих PERSON/COMPANY/WORKER/ITR UI-контекста не повторены. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-09 | **Общая дата скрывает ошибку и происхождение исключений**. Общая дата показывает локальную причину и aria-состояние. Событийные и личные MANUAL/IMPORTED/CLEARED исключения сохраняются; возврат наследования даёт актуальную общую дату после reload. | [event-context.tsx](../../../apps/web/components/event-context.tsx)<br>[training-date-settings.tsx](../../../apps/web/components/training-date-settings.tsx)<br>[editor.tsx](../../../apps/web/components/editor.tsx)<br>[requests.ts](../../../apps/api/src/requests.ts) | [C17](#c17), [C18](#c18) | 3 требований; `date-causes/date-causes-readback.json` | [unit341](checks/unit-final-v8.log): manual/imported/cleared dates survive serialized reload/reset; [UI16](browser-input-signing-final-v2/results.json): независимые даты двух курсов/save/reload. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-10 | **Создание компании имеет неясное отдельное применение**. Создание новой компании явно отличается от выбора карточки; Cancel отменяет только временный ввод, navigation/reload/logout защищены, поздний ответ не выбирает отменённую карточку. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[request-organization-fields.tsx](../../../apps/web/components/request-organization-fields.tsx)<br>[api.ts](../../../apps/web/lib/api.ts)<br>[workspace.tsx](../../../apps/web/components/workspace.tsx) | [C19](#c19), [C20](#c20) | 4 требований; `ui/company-compact-cancel.json`<br>`ui/company-replacement-directory-failure.json` | [integration203](checks/integration-final-v4.log): company continuation concurrent replay creates one card; [UI16](browser-input-signing-final-v2/results.json) и [actual2 v5](final-actual-v5-c3061a20-bae3-452b-b8f1-fb58a88e3227/results.json): staged reload без карточки, natural apply один раз. Старый late-cancel browser-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-11 | **Ширины и сокращения мешают читать строку**. Важные поля имеют рабочие минимальные ширины, скролл остаётся внутри таблицы, детали открывают полный источник и возвращают место ввода. | [operator-form.css](../../../apps/web/components/operator-form.css)<br>[recipient-grid.css](../../../apps/web/components/recipient-grid.css)<br>[recipient-grid.tsx](../../../apps/web/components/recipient-grid.tsx)<br>[recipient-details.tsx](../../../apps/web/components/recipient-details.tsx)<br>[editor.tsx](../../../apps/web/components/editor.tsx)<br>[index.tsx](../../../packages/ui/src/index.tsx) | [C11](#c11), [C12](#c12) | 31 требований; `ui/viewport-1440-photo-off.json`<br>`ui/viewport-1440-photo-on.json` | [UI16](browser-input-signing-final-v2/results.json): локальная таблица и основные действия на четырёх ширинах, осмотр PNG. Native200%/полный длинный scroll-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-12 | **Счётчики и словарь используют разные единицы**. Счётчики различают людей/результаты; все четыре направления используют единый русский словарь в выборе, снятии и readiness. Точные старые стандартные названия отображаются понятно при сохранённых raw/custom titles, IDs, preparation и snapshots. | [draft-readiness.ts](../../../apps/web/lib/draft-readiness.ts)<br>[editor.tsx](../../../apps/web/components/editor.tsx)<br>[training-bundle-dialog.tsx](../../../apps/web/components/training-bundle-dialog.tsx)<br>[training-display.ts](../../../apps/web/lib/training-display.ts)<br>[training-removal.ts](../../../apps/web/lib/training-removal.ts)<br>[training-overview.tsx](../../../apps/web/components/training-overview.tsx)<br>[event-context.tsx](../../../apps/web/components/event-context.tsx)<br>[training-date-settings.tsx](../../../apps/web/components/training-date-settings.tsx)<br>[order-evidence.tsx](../../../apps/web/components/order-evidence.tsx) | [C08](#c08), [C11](#c11) | 41 требований; `ui/empty-before-training.json`<br>`ui/assigned-training-chooser.json` | [unit341](checks/unit-final-v8.log): unknown trainings/people считаются без двойного учёта парных форм; [UI16](browser-input-signing-final-v2/results.json): текущие course counts. Полный словарь старого UI-кейса не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-13 | **Редактируемый срок обещает ручную дату, которую расчёт отменяет**. Расчётный LIVE_V1 срок доступен только для чтения и объяснён фактическим правилом. Дата выдачи сохраняет своё происхождение; срок получает AUTO. ПС показывает бессрочность без обещания ручного исключения. | [validity-display.ts](../../../apps/web/lib/validity-display.ts)<br>[recipient-details.tsx](../../../apps/web/components/recipient-details.tsx)<br>[event-context.tsx](../../../apps/web/components/event-context.tsx)<br>[date-calculation-status.tsx](../../../apps/web/components/date-calculation-status.tsx) | [C04](#c04) | 6 требований; `preparation-browser-readback.json` | [unit341](checks/unit-final-v8.log): R4 all categories/primary/companion/group actual LIVE expiry/AUTO и явное inspector/council discrepancy. Полные 30 новых browser-наблюдений не повторены. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-14 | **Исправление категории плодит группы и протоколы**. Коррекция Рабочий↔ИТР использует связь исходного и производного события. Совместимый возврат сохраняет исходную идентичность и факты; независимые одноимённые события и изменённый контекст не объединяются. | [business-rules.ts](../../../packages/contracts/src/business-rules.ts)<br>[index.ts](../../../packages/contracts/src/index.ts) | [C21](#c21), [C22](#c22) | 5 требований; `domain-acceptance/ux14-return-refused.json`<br>`domain-acceptance/ux14-compatible-facts.json` | [unit341](checks/unit-final-v8.log): three WORKER→ITR→WORKER cycles, original identity и refusal изменённого контекста; [integration203](checks/integration-final-v4.log): смешанные worker/ITR bundles. Полный старый browser-cycle не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-15 | **Возврат общего значения не работает одинаково в связанных формах**. Сброс каждого предлагаемого поля работает одинаково из основной и связанной формы. Общая программа/часы/даты и их origins восстанавливаются согласованно; независимый документ и уже подтверждённые факты сохраняются. | [training-assignment-edit.ts](../../../apps/web/lib/training-assignment-edit.ts)<br>[recipient-details.tsx](../../../apps/web/components/recipient-details.tsx) | [C23](#c23), [C24](#c24) | 3 требований; `domain-acceptance/ux15-all-form-reset.json`<br>`domain-browser/linked-form-reset.json` | [unit341](checks/unit-final-v8.log): every form restores linked program/hours/dates without changing another result; [UI16](browser-input-signing-final-v2/results.json): PS linked RU/KZ exceptions/reload/reset. Полный reset-all-fields UI-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-16 | **Кнопка обучения строки меняет назначение после первого выбора**. Одна и та же кнопка всегда открывает выбор/снятие обучения, включая уже назначенное; значения и факты остаются в деталях. | [recipient-grid-row.tsx](../../../apps/web/components/recipient-grid-row.tsx)<br>[editor.tsx](../../../apps/web/components/editor.tsx) | [C08](#c08) | 14 требований; `ui/empty-before-training.json`<br>`ui/assigned-training-chooser.json` | [UI16](browser-input-signing-final-v2/results.json): row course chooser показывает текущие галки и добавляет отсутствующее; [unit341](checks/unit-final-v8.log): сохранение прежних facts/idempotency. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-17 | **У одного поля разные ограничения в таблице и деталях**. Таблица и детали принимают общий предел500, ввод501 сохраняется локально с отказом400; исправление возобновляет autosave. | [recipient-grid-row.tsx](../../../apps/web/components/recipient-grid-row.tsx)<br>[recipient-details.tsx](../../../apps/web/components/recipient-details.tsx)<br>[index.ts](../../../packages/contracts/src/index.ts) | [C13](#c13) | 18 требований; `ui/two-source-warnings-with-length-error-390.json`<br>`ui/length-error-retained.json` | [unit341](checks/unit-final-v8.log): mapped preview rejects long identifiers; [integration203](checks/integration-final-v4.log): validation/schema paths. Полный retained501/error/correction в двух UI-видах не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-18 | **Открытие деталей превращает незаполненность в ошибку**. Незаполненный draft до проверки показывает спокойную подсказку; открытие деталей не становится проверкой; checked error имеет единое aria-состояние. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[recipient-details.tsx](../../../apps/web/components/recipient-details.tsx) | [C09](#c09), [C13](#c13) | 28 требований; `ui/menu-keyboard-outside-nested-short.json`<br>`ui/hints-geometry-filter.json` | [unit341](checks/unit-final-v8.log): current hints/readiness paths; [UI16](browser-input-signing-final-v2/results.json): конкретная ошибка открывает поле. Полный before-check/checked aria-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-19 | **В деталях не виден итог сохранения и неясно закрытие**. В sticky footer деталей виден итог autosave/error/conflict и один понятный возврат, input не теряется после ошибки. | [recipient-details.tsx](../../../apps/web/components/recipient-details.tsx)<br>[editor.tsx](../../../apps/web/components/editor.tsx) | [C13](#c13) | 18 требований; `ui/two-source-warnings-with-length-error-390.json`<br>`ui/length-error-retained.json` | [unit341](checks/unit-final-v8.log): serialized autosave/conflict retains local input; [UI16](browser-input-signing-final-v2/results.json): delayed PATCH после подписи сохраняется. Полный footer/error/escape-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-20 | **Меню «Ещё» остаётся над вводом**. Меню закрывается выбором, наружным действием и Escape с возвратом фокуса. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[recipient-grid.tsx](../../../apps/web/components/recipient-grid.tsx) | [C09](#c09) | 10 требований; `ui/menu-keyboard-outside-nested-short.json`<br>`ui/hints-geometry-filter.json` | Отдельный browser-кейс nested menu/outside/Escape не повторён. Исходники сохранены; source/build checks не выдаются за это наблюдение. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-21 | **Возврат из длинных деталей требует лишней прокрутки**. Длинные детали прокручивают внутреннее содержимое между sticky header/footer, активный контрол не покрывается overlay/footer. | [recipient-details.tsx](../../../apps/web/components/recipient-details.tsx)<br>[operator-form.css](../../../apps/web/components/operator-form.css)<br>[recipient-grid.css](../../../apps/web/components/recipient-grid.css)<br>[editor.tsx](../../../apps/web/components/editor.tsx)<br>[index.tsx](../../../packages/ui/src/index.tsx) | [C13](#c13), [C11](#c11), [C25](#c25), [C12](#c12) | 50 требований; `ui/two-source-warnings-with-length-error-390.json`<br>`ui/length-error-retained.json` | [UI16](browser-input-signing-final-v2/results.json): PS details и 390px main flow осмотрены. Полный long-details first/last-control, sticky overlay и native200% не повторены. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-22 | **После действия теряется место клавиатурного ввода**. Удаление/undo/назначение/закрытие возвращают существующий input с выделением и scroll; dirty последний символ сохраняется перед переходом. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[recipient-grid.tsx](../../../apps/web/components/recipient-grid.tsx) | [C26](#c26), [C27](#c27), [C28](#c28), [C29](#c29) | 7 требований; `ui/skip-link-dirty-hash-readback.json`<br>`ui/delete-restore-navigation.json` | [UI16](browser-input-signing-final-v2/results.json) и [actual2 v5](final-actual-v5-c3061a20-bae3-452b-b8f1-fb58a88e3227/results.json): paste/Undo, пустая/частичная строка, стабильные IDs/reload; delayed signing refresh сохраняет ввод. Старый keyboard-only navigation+selection/scroll-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-23 | **Выбранная компания вытесняет первый ввод людей**. Выбранная компания показывает компактное имя/действия; первая строка людей находится в рабочем desktop экране, новые названия доступны полностью. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[operator-form.css](../../../apps/web/components/operator-form.css)<br>[recipient-grid.css](../../../apps/web/components/recipient-grid.css) | [C19](#c19), [C20](#c20) | 4 требований; `ui/company-compact-cancel.json`<br>`ui/company-replacement-directory-failure.json` | [UI16](browser-input-signing-final-v2/results.json) и [actual2 v5](final-actual-v5-c3061a20-bae3-452b-b8f1-fb58a88e3227/results.json): компактная компания, staged reload и один natural apply; [integration203](checks/integration-final-v4.log): структура названия и прежние snapshots. Старый весь набор legal names/navigation/late-cancel UI-кейсов не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-24 | **Переключение направления стирает подготовку результата**. Неприменённая подготовка outcome/source/knowledge/proctoring хранится отдельно от фактов по tenant/user/request/event/kind. Переключение, reload и возврат её сохраняют; смена адресата отменяет review, применение требует явной команды. | [preparation-storage.ts](../../../apps/web/lib/preparation-storage.ts)<br>[use-durable-preparation.ts](../../../apps/web/lib/use-durable-preparation.ts)<br>[event-context.tsx](../../../apps/web/components/event-context.tsx)<br>[editor.tsx](../../../apps/web/components/editor.tsx) | [C30](#c30), [C31](#c31), [C32](#c32) | 5 требований; `preparation-browser-readback.json` | [unit341](checks/unit-final-v8.log): preparation identity tenant/user/request/event/kind, storage failure/retry и review invalidation; facts UNKNOWN не подменяются. Полный durable UI-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-25 | **Кандидат графика показывается у другого события**. Кандидаты графика изолированы по eventId, включая одинаковое исходное правило. Возврат восстанавливает кандидат; отмена убирает только подготовку, сохраняя применённый график и соседнее событие. | [calendar-preparation.ts](../../../apps/web/lib/calendar-preparation.ts)<br>[preparation-storage.ts](../../../apps/web/lib/preparation-storage.ts)<br>[use-durable-preparation.ts](../../../apps/web/lib/use-durable-preparation.ts)<br>[training-date-settings.tsx](../../../apps/web/components/training-date-settings.tsx)<br>[event-context.tsx](../../../apps/web/components/event-context.tsx) | [C33](#c33), [C32](#c32) | 3 требований; `preparation-browser-readback.json` | [unit341](checks/unit-final-v8.log): equal applied rules separate durable candidates; cancel сохраняет applied rule. Полный browser storage-error/switch-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-26 | **Ошибка расчёта часов фокусирует правильную дату**. Расчёт возвращает структурированную истинную причину: часы, productionHours, hoursPerDay, календарь, предел периода или дата. Переход раскрывает нужное обучение и фокусирует фактический контрол причины. | [date-calculation.ts](../../../packages/contracts/src/date-calculation.ts)<br>[resolution.ts](../../../packages/contracts/src/resolution.ts)<br>[editor.tsx](../../../apps/web/components/editor.tsx)<br>[event-context.tsx](../../../apps/web/components/event-context.tsx)<br>[training-date-settings.tsx](../../../apps/web/components/training-date-settings.tsx) | [C14](#c14), [C15](#c15), [C16](#c16) | 6 требований; `date-causes/date-causes-readback.json` | [unit341](checks/unit-final-v8.log): calculation causes hours/production/rule/calendar; [integration203](checks/integration-final-v4.log): impossible saved date exact field, no preview. Полный browser-focus набор причин не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-27 | **Частичный импорт блокирует неперенесённые строки**. Дозагрузка идемпотентна по заявке/importId/sourceRow. A→B/C→повтор всех не создаёт дублей; неясный сетевой исход, double submit и повтор сохраняют сильные IDs и исходные факты. | [imports.ts](../../../apps/web/lib/imports.ts)<br>[import-dialog.tsx](../../../apps/web/components/import-dialog.tsx)<br>[files.ts](../../../apps/api/src/files.ts) | [C34](#c34) | 2 требований; `test-results/**/partial-readback.json` | [integration203](checks/integration-final-v4.log): A→B/C→replay per-source-row idempotency, stale new row conflict, independent request; [unit341](checks/unit-final-v8.log): partial plan preserves source identities. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-28 | **Пауза конфликта не удерживается после закрытия диалога**. Реальный409 переводит autosave в устойчивую паузу. Закрытие окна и дальнейший локальный ввод не посылают PATCH. Явная загрузка возобновляет правильную базу; двойная команда копии создаёт одну новую заявку. | [requests.ts](../../../apps/api/src/requests.ts)<br>[autosave.ts](../../../apps/web/lib/autosave.ts)<br>[editor.tsx](../../../apps/web/components/editor.tsx) | [C35](#c35), [C36](#c36) | 4 требований; `domain-browser/conflict-copy.json`<br>`domain-browser/conflict-pause.json` | [unit341](checks/unit-final-v8.log): conflict pause preserves later input/no PATCH until new base; [integration203](checks/integration-final-v4.log): controlled real DB races/scoped conflict. Полный two-tab dismissal/double-copy browser-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-29 | **Пробельное пустое поле пропускается EMPTY-вставкой**. EMPTY использует единое определение пустоты для пробелов, NBSP и невидимых символов. Значимый текст сохраняется без нормализации; preview, отмена и применение отражают точный план диапазона. | [blank-text.ts](../../../packages/contracts/src/blank-text.ts)<br>[blank-text.ts](../../../apps/web/lib/blank-text.ts)<br>[grid-paste.ts](../../../apps/web/lib/grid-paste.ts)<br>[grid-paste-dialog.tsx](../../../apps/web/components/grid-paste-dialog.tsx) | [C03](#c03) | 3 требований; `test-results/**/blank-range-readback.json` | [unit341](checks/unit-final-v8.log): EMPTY whitespace/NBSP/invisible, clipboard250/251 no mutation; [UI16](browser-input-signing-final-v2/results.json) и [actual2 v5](final-actual-v5-c3061a20-bae3-452b-b8f1-fb58a88e3227/results.json): immediate empty paste/save/Undo. Содержательный preview/retry полного старого UI-кейса не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-30 | **Неверный график выключает применение без причины**. Неверный и промежуточный ввод графика сохраняется с конкретной причиной, диапазоном и aria-связями. Review/apply блокируются до исправления; дробный клавиатурный ввод и корректное применение проверяются readback. | [calendar-preparation.ts](../../../apps/web/lib/calendar-preparation.ts)<br>[training-date-settings.tsx](../../../apps/web/components/training-date-settings.tsx)<br>[use-durable-preparation.ts](../../../apps/web/lib/use-durable-preparation.ts) | [C33](#c33), [C16](#c16) | 4 требований; `preparation-browser-readback.json`<br>`date-causes/date-causes-readback.json` | [unit341](checks/unit-final-v8.log): empty/zero/25/text candidate cause, durable rule/cancel; [integration203](checks/integration-final-v4.log): invalid rule schema. Полный numeric keyboard/review/apply browser-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-31 | **Импортный preview обещает готовность неверного значения**. Preview проверяет конечный mapping категории, даты, длины и учебных полей до применения. Ошибочная ячейка исправляется или исключается явно; исходник/mapping сохраняются, изменение плана сбрасывает review. | [imports.ts](../../../apps/web/lib/imports.ts)<br>[import-dialog.tsx](../../../apps/web/components/import-dialog.tsx) | [C37](#c37) | 3 требований; `test-results/**/mapped-readback.json` | [unit341](checks/unit-final-v8.log): mapped category/date/length preview and corrected incomplete draft; [integration203](checks/integration-final-v4.log): invalid mapped dates/parser rejected before proposal. Полный browser provenance readback не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| UX-32 | **Поиск не учитывает действующую общую организацию**. Поиск использует действующего работодателя RU/KZ вместе с номерами и исходными полями. Общая компания, языковые и личные исключения разрешаются как в документах; поиск и его очистка не изменяют raw людей. | [editor.tsx](../../../apps/web/components/editor.tsx)<br>[recipient-grid.tsx](../../../apps/web/components/recipient-grid.tsx)<br>[recipient-employer.ts](../../../apps/web/lib/recipient-employer.ts) | [C38](#c38) | 2 требований; `test-results/**/effective-employer-search-readback.json` | [unit341](checks/unit-final-v8.log): effective employer/bulk language fallback без raw override; [integration203](checks/integration-final-v4.log): pinned company snapshots. Все 17 точных browser-поисков не повторены. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| R1 | Поиск людей и компаний не позволяет выбрать устаревшую карточку при debounce, медленном ответе, ошибке, повторе, A→B→A, очистке и переходе страницы. Enter выбирает действующую синтетическую запись; точный ID и карточка сохраняются. | [record-picker.tsx](../../../apps/web/components/record-picker.tsx)<br>[record-query.ts](../../../apps/web/lib/record-query.ts) | [C01](#c01) | 4 требований; `test-results/**/record-query-protocol.json` | [unit341](checks/unit-final-v8.log): response from different query/page/type/failed request never selectable. Полный controlled slow/error/Enter browser-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| R2 | Массовый preview показывает effective работодателя и языковой fallback. Только явно выбранное личное исключение попадает в raw; INHERITED не подменяет personal-значения, REPLACE требует подтверждения, Cancel сохраняет данные. | [bulk-dialog.tsx](../../../apps/web/components/bulk-dialog.tsx)<br>[bulk-edit.ts](../../../apps/web/lib/bulk-edit.ts)<br>[recipient-employer.ts](../../../apps/web/lib/recipient-employer.ts) | [C02](#c02) | 3 требований; `test-results/**/effective-company-bulk-readback.json` | [unit341](checks/unit-final-v8.log): bulk effective company vs raw fields, explicit exceptions and inherited mask; [integration203](checks/integration-final-v4.log): company snapshots. Полный browser preview/cancel/reload кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| R3 | Перед неоднозначным/содержательным применением диапазона перечислены все создаваемые строки, включая пустую середину/конец. KEEP/SKIP выбирается явно; Cancel ничего не сохраняет; 503 сохраняет точный план для атомарного повтора. 250/251 не усекались. | [grid-paste-dialog.tsx](../../../apps/web/components/grid-paste-dialog.tsx)<br>[grid-paste.ts](../../../apps/web/lib/grid-paste.ts)<br>[imports.ts](../../../apps/web/lib/imports.ts) | [C03](#c03) | 3 требований; `test-results/**/blank-range-readback.json` | [unit341](checks/unit-final-v8.log): blank source explicit creation/selected omission/250 no truncation; [UI16](browser-input-signing-final-v2/results.json) и [actual2 v5](final-actual-v5-c3061a20-bae3-452b-b8f1-fb58a88e3227/results.json): safe empty paste/Undo. Полный KEEP/SKIP+503 atomic retry UI-кейс не повторён. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |
| R4 | Каждый показанный LIVE_V1 срок совпадает с актуальным authoritative resolved после смены даты и reload; расчётный срок read-only, происхождение AUTO. WORKER/ИТР/инспектор/совет/ПС, личные и протокольные формы и расхождения preset/LIVE проверяются отдельно. Нормы, часы и условия ЕЦС не меняются. | [validity-display.ts](../../../apps/web/lib/validity-display.ts)<br>[recipient-details.tsx](../../../apps/web/components/recipient-details.tsx)<br>[event-context.tsx](../../../apps/web/components/event-context.tsx)<br>[date-calculation-status.tsx](../../../apps/web/components/date-calculation-status.tsx) | [C04](#c04) | 3 требований; `preparation-browser-readback.json` | [unit341](checks/unit-final-v8.log): all categories/forms actual LIVE expiry/AUTO и discrepancy без изменения norms/hours/ECS; [renderer101](checks/render-v4.log) проверяет свой render/security объём. Полные 30 браузерных expiry-наблюдений не повторены. | NOT_RUN_AFTER_USER_REDUCED_CHECKS |

## Точные обязательные регрессионные сценарии

Ниже сохранены все 38 уникальных обязательных случаев. Ссылки ведут в текущие E2E-исходники; точное название и проект сверены с новым --list. Для параметризованных случаев ссылка может вести в файл, поскольку буквальное название формируется из параметра.

<a id="c01"></a>

**C01 — R1**

[apps/web/e2e/operator-import-full-fix-live.spec.ts](../../../apps/web/e2e/operator-import-full-fix-live.spec.ts:499); project `remaining`.

`R1 controlled slow and failed record queries never expose stale selectable records across debounce, query and page`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c02"></a>

**C02 — R2**

[apps/web/e2e/operator-import-full-fix-live.spec.ts](../../../apps/web/e2e/operator-import-full-fix-live.spec.ts:379); project `remaining`.

`R2 real COMPANY bulk preview shows effective name, language fallback and only creates explicitly selected exception`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c03"></a>

**C03 — R3, UX-29**

[apps/web/e2e/operator-import-full-fix-live.spec.ts](../../../apps/web/e2e/operator-import-full-fix-live.spec.ts:291); project `remaining`.

`UX-29 and R3 keyboard range paste exposes blank creation and cancel, explicit keep, source rows and saved values`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c04"></a>

**C04 — R4, UX-13**

[apps/web/e2e/operator-preparation-full-fix.spec.ts](../../../apps/web/e2e/operator-preparation-full-fix.spec.ts:715); project `remaining`.

`UX13/R4 every supported category and personal form shows forced actual expiry, date change and reload`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c05"></a>

**C05 — UX-01, UX-05**

[apps/web/e2e/operator-domain-acceptance-live.spec.ts](../../../apps/web/e2e/operator-domain-acceptance-live.spec.ts:498); project `remaining`.

`UX01 exact hidden multi-person removal preserves MANUAL IMPORTED CLEARED facts, other direction and issued reference`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c06"></a>

**C06 — UX-01**

[apps/web/e2e/operator-domain-full-fix-live.spec.ts](../../../apps/web/e2e/operator-domain-full-fix-live.spec.ts:124); project `remaining`.

`UX-01/02 scoped UI remove/reload/restore preserves IDs, dates, confirmations and an unrelated saved edit`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c07"></a>

**C07 — UX-01**

[apps/web/e2e/operator-domain-full-fix-live.spec.ts](../../../apps/web/e2e/operator-domain-full-fix-live.spec.ts:288); project `remaining`.

`UX-01 persisted undo detects a changed training context and preserves both current data and removed facts`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c08"></a>

**C08 — UX-02, UX-05, UX-12, UX-16**

[apps/web/e2e/operator-ui-full-fix-live.spec.ts](../../../apps/web/e2e/operator-ui-full-fix-live.spec.ts:103); project `remaining`.

`UX02/05/12/16 explicit common training, hidden selections, next recipients and persistent row chooser`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c09"></a>

**C09 — UX-03, UX-06, UX-08, UX-18, UX-20**

[apps/web/e2e/operator-ui-full-fix-live.spec.ts](../../../apps/web/e2e/operator-ui-full-fix-live.spec.ts:1055); project `remaining`.

`UX03/06/08/18/20 primary geometry remains stable through hints and checked errors; scope keeps active input`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c10"></a>

**C10 — UX-04, UX-08**

[apps/web/e2e/operator-domain-acceptance-live.spec.ts](../../../apps/web/e2e/operator-domain-acceptance-live.spec.ts:588); project `remaining`.

`UX04 actual fourth-row group and individual issues focus exact assignment fields after deletion reorder and filtering; UX08 Next repairs true PERSON COMPANY WORKER ITR causes`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c11"></a>

**C11 — UX-06, UX-07, UX-11, UX-12, UX-21**

[apps/web/e2e/operator-ui-full-fix-live.spec.ts](../../../apps/web/e2e/operator-ui-full-fix-live.spec.ts:2045); project `remaining`.

`UX06/07/11/21 ten long bilingual rows, photo crop/error/retry and every required viewport keep active controls uncovered`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c12"></a>

**C12 — UX-06, UX-11, UX-21**

[apps/web/e2e/operator-native-zoom-live.spec.ts](../../../apps/web/e2e/operator-native-zoom-live.spec.ts:33); project `remaining`.

`UX06/11/21 genuine Chrome 200 percent zoom in a disposable native profile retains input, footer, and internal table scroll`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c13"></a>

**C13 — UX-07, UX-17, UX-18, UX-19, UX-21**

[apps/web/e2e/operator-ui-full-fix-live.spec.ts](../../../apps/web/e2e/operator-ui-full-fix-live.spec.ts:1386); project `remaining`.

`UX17/18/19/21 shared length policy retains 501 input and resumes saving after correction in both views`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c14"></a>

**C14 — UX-08, UX-26**

[apps/web/e2e/operator-date-causes-full-fix.spec.ts](../../../apps/web/e2e/operator-date-causes-full-fix.spec.ts:272); project `remaining`.

`UX26 source hours invalid unit, zero, empty, production and period limit focus the saved cause and preserve neighbor dates and UNKNOWN`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c15"></a>

**C15 — UX-08, UX-26**

[apps/web/e2e/operator-date-causes-full-fix.spec.ts](../../../apps/web/e2e/operator-date-causes-full-fix.spec.ts:332); project `remaining`.

`UX26 calendar outside verified years and nonworking anchor focus exact event control and are fixable without changing known facts`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c16"></a>

**C16 — UX-08, UX-26, UX-30**

[apps/web/e2e/operator-date-causes-full-fix.spec.ts](../../../apps/web/e2e/operator-date-causes-full-fix.spec.ts:381); project `remaining`.

`UX26/30 invalid daily parameter remains an accessible unapplied candidate, API rejects the invalid rule with a stable schema path, correction applies only on review`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c17"></a>

**C17 — UX-09**

[apps/web/e2e/operator-date-causes-full-fix.spec.ts](../../../apps/web/e2e/operator-date-causes-full-fix.spec.ts:480); project `remaining`.

`UX09 request/event/individual dates preserve inherited, manual, imported and cleared origins through reload and return to common`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c18"></a>

**C18 — UX-09**

[apps/web/e2e/operator-date-causes-full-fix.spec.ts](../../../apps/web/e2e/operator-date-causes-full-fix.spec.ts:584); project `remaining`.

`UX09 common empty date exposes its actual cause and malformed calendar drafts cannot pass validation or preview`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c19"></a>

**C19 — UX-10, UX-23**

[apps/web/e2e/operator-ui-full-fix-live.spec.ts](../../../apps/web/e2e/operator-ui-full-fix-live.spec.ts:1770); project `remaining`.

`UX10/23 selected company compact summary, cancel first entry and late creation response never selects cancelled input`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c20"></a>

**C20 — UX-10, UX-23**

[apps/web/e2e/operator-ui-full-fix-live.spec.ts](../../../apps/web/e2e/operator-ui-full-fix-live.spec.ts:2577); project `remaining`.

`UX10/23 company replacement, directory choice, pending input navigation, failure retry and all legal names preserve saved scope`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c21"></a>

**C21 — UX-14**

[apps/web/e2e/operator-domain-acceptance-live.spec.ts](../../../apps/web/e2e/operator-domain-acceptance-live.spec.ts:696); project `remaining`.

`UX14 independent facts remain separate and changed original context offers an explicit compatible return`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c22"></a>

**C22 — UX-14**

[apps/web/e2e/operator-domain-full-fix-live.spec.ts](../../../apps/web/e2e/operator-domain-full-fix-live.spec.ts:340); project `remaining`.

`UX-14 category correction cycles retain original event ID and confirmation without orphan groups`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c23"></a>

**C23 — UX-15**

[apps/web/e2e/operator-domain-acceptance-live.spec.ts](../../../apps/web/e2e/operator-domain-acceptance-live.spec.ts:789); project `remaining`.

`UX15 reset every offered training field from credential protocol and witness displays current common values after reload`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c24"></a>

**C24 — UX-15**

[apps/web/e2e/operator-domain-full-fix-live.spec.ts](../../../apps/web/e2e/operator-domain-full-fix-live.spec.ts:402); project `remaining`.

`UX-15 protocol reset updates both form origins and resolved program after reload`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c25"></a>

**C25 — UX-21**

[apps/web/e2e/operator-error-focus-live.spec.ts](../../../apps/web/e2e/operator-error-focus-live.spec.ts:23); project `remaining`.

`fresh 100-row draft shows validation heading at keyboard focus and opens exact inherited cause while preserving dates and UNKNOWN`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c26"></a>

**C26 — UX-22**

[apps/web/e2e/operator-ui-full-fix-live.spec.ts](../../../apps/web/e2e/operator-ui-full-fix-live.spec.ts:1836); project `remaining`.

`UX22 deletion and restoration focus an existing row; query and fragment navigation flushes last input`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c27"></a>

**C27 — UX-22**

[apps/web/e2e/operator-table-live.spec.ts](../../../apps/web/e2e/operator-table-live.spec.ts); project `remaining`.

`100 real recipients: keyboard editing, scoped selection, bilingual fields, autosave and reload`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c28"></a>

**C28 — UX-22**

[apps/web/e2e/operator-table-live.spec.ts](../../../apps/web/e2e/operator-table-live.spec.ts); project `remaining`.

`150 real recipients: keyboard editing, scoped selection, bilingual fields, autosave and reload`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c29"></a>

**C29 — UX-22**

[apps/web/e2e/operator-table-live.spec.ts](../../../apps/web/e2e/operator-table-live.spec.ts); project `remaining`.

`250 real recipients: keyboard editing, scoped selection, bilingual fields, autosave and reload`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c30"></a>

**C30 — UX-24**

[apps/web/e2e/operator-preparation-full-fix.spec.ts](../../../apps/web/e2e/operator-preparation-full-fix.spec.ts); project `remaining`.

`UX24 durable preparation keeps UNKNOWN separate until explicit selected apply`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c31"></a>

**C31 — UX-24**

[apps/web/e2e/operator-preparation-full-fix.spec.ts](../../../apps/web/e2e/operator-preparation-full-fix.spec.ts); project `remaining`.

`UX24 durable preparation keeps confirmed provenance separate until explicit selected apply`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c32"></a>

**C32 — UX-24, UX-25**

[apps/web/e2e/operator-preparation-full-fix.spec.ts](../../../apps/web/e2e/operator-preparation-full-fix.spec.ts:511); project `remaining`.

`preparation storage failure blocks switching/navigation then retries without losing input; removed target remains separate`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c33"></a>

**C33 — UX-25, UX-30**

[apps/web/e2e/operator-preparation-full-fix.spec.ts](../../../apps/web/e2e/operator-preparation-full-fix.spec.ts:348); project `remaining`.

`UX25/30 equal applied rules keep separate candidates, accessible cause, review, cancel and saved readback`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c34"></a>

**C34 — UX-27**

[apps/web/e2e/operator-import-full-fix-live.spec.ts](../../../apps/web/e2e/operator-import-full-fix-live.spec.ts:60); project `remaining`.

`UX-27 real partial import A then B/C, replay, unknown network outcome and independent request preserve source identities`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c35"></a>

**C35 — UX-28**

[apps/web/e2e/operator-domain-full-fix-live.spec.ts](../../../apps/web/e2e/operator-domain-full-fix-live.spec.ts:178); project `remaining`.

`UX-28 conflict copy double activation creates exactly one new request and resumes its save lane`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c36"></a>

**C36 — UX-28**

[apps/web/e2e/operator-domain-full-fix-live.spec.ts](../../../apps/web/e2e/operator-domain-full-fix-live.spec.ts:465); project `remaining`.

`UX-28 real two-tab conflict stays paused after dismissal and local edits until explicit reload`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c37"></a>

**C37 — UX-31**

[apps/web/e2e/operator-import-full-fix-live.spec.ts](../../../apps/web/e2e/operator-import-full-fix-live.spec.ts:167); project `remaining`.

`UX-31 mapped preview identifies exact category/date/length, preserves source during correction and stores explicit provenance`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

<a id="c38"></a>

**C38 — UX-32**

[apps/web/e2e/operator-import-full-fix-live.spec.ts](../../../apps/web/e2e/operator-import-full-fix-live.spec.ts:1262); project `remaining`.

`UX32 real COMPANY search uses effective RU/KZ employers, exceptions and changed company without mutating raw people`

Текущий результат: NOT_RUN_AFTER_USER_REDUCED_CHECKS.

## Дополнительные общие циклы и текущие выделенные доказательства

Подготовленный FULL дополнительно включает оператор→директор→исправление→новое согласование→renderer, свежих producer/consumer G1 и common, portal с изоляцией и 390px, историческое повторение и массовую правку документных полей. Эти полные браузерные циклы не запускались после сокращения проверок пользователем. Их отдельное покрытие в выполненных unit/integration и коротких UI/live-сценариях описано в итоговом отчёте; оно не заменяет все 38 обязательных случаев.

Canonical ZIP может состоять из нескольких ограниченных частей. Подготовленные company37/G1-сценарии сохраняют исходный смысл требований: company37 — 37 документов, 74 индивидуальных DOCX/PDF и 75 исходников; G1 — 101 DOCX + 101 PDF + 1 XLSX и 204 generation jobs. Добавлены проверки точного состава всех ZIP-частей, manifest union и хеша каждого вложения без фиксированного числа частей, увеличения лимитов или обхода публичного unsigned409. Эти тяжёлые новые браузерные сценарии не исполнены после сокращения проверок. Реальные ZIP/storage/unsigned export проверки присутствуют в выполненном integration203; их результат не выдаётся за fresh company37/G1 FULL. Общие названия G1 resume отражают «every original hash / every saved original» вместо прежнего предположения о ровно 204 итоговых файлах.

Актуальный выделенный управляемый UI-набор [browser-input-signing-final-v2/results.json](browser-input-signing-final-v2/results.json) прошёл 16/16 на `.next-remaining-operator-v4`, BUILD_ID `kGvvWs09mejsm-CLp_oXA`: actual course states, компактные независимые даты/reload, выбор стандартной и сохранённой программы по курсу, смешанные PS profession/qualification RU/KZ, защита уже выпущенного человека от удаления, safe paste/Undo, техническая пустота/защищённая частичная строка, inline translation error/retry/cancel/stale/apply, company continuation, stable issue ID и 1440/1280/768/390, выбор предыдущего выпуска и сохранность задержанного PATCH после подписания. Это дополнительное доказательство областей UX-02/04/05/09/10/11/15/16/22/23/29 и REM-05…08, а не закрытие всей старой матрицы.

Реальный input live 1/1 и customer-idempotency integration 1/1, чистые input/readiness unit 19/19, а также ограничения и осмотр PNG описаны в [operator-input-verification.md](operator-input-verification.md). Управляемые provider/translation ответы не доказывают настоящий NCA/eGov, качество внешнего перевода, физическую печать, юридическую приёмку или измеренное удобство человека. Итог последней сборки, обязательных code-checks и короткого реального UI/live-прогона фиксируется главным отчётом. FULL166 и свежий полный аудит 437 требований явно не выполнялись.

Исходные 32 UX-контракта и R1–R4, все 38 точных обязательных случаев и 437 связей сохранены для трассировки. Наличие этой карты не обозначает выполнение незапущенного полного набора. Исторические каталоги и прежние failed попытки сохранены и не используются как замена свежего результата. Общий статус — NOT_RUN_AFTER_USER_REDUCED_CHECKS, без заявления о новом полном 32/32 PASS.
