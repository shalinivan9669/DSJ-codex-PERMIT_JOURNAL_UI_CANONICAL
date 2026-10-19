"""Assemble the measured functional handoff; does not mutate application data."""
import csv
import hashlib
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/evidence/functional-completion-20261019/run-01'
RUNTIME = ROOT / '.runtime/functional-completion-20261019/run-01'
HANDOFF = ROOT / 'docs/handoffs/2026-10-19-functional-completion'
NOW = datetime.now(timezone.utc).isoformat()

def read(name):
    return json.loads((OUT / name).read_text(encoding='utf-8-sig'))

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def text(name, value):
    (OUT / name).write_text(value.strip() + '\n', encoding='utf-8')

def tsv(name, fields, rows):
    with (OUT / name).open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fields, delimiter='\t')
        writer.writeheader()
        writer.writerows(rows)

def evidence(*names):
    for name in names:
        if not (OUT / name).is_file():
            raise FileNotFoundError(name)
    return ['docs/evidence/functional-completion-20261019/run-01/' + name for name in names]

def extra_outputs():
    gaps=[
      ('G01','У представителя без membership нет завершённого пути','Запрос доступа, очередь решения, права/срок/основание, восстановление без дубля','apps/api/src/employer-access.ts; apps/web/components/employer-access-request.tsx','onboarding/F03-access-request.json'),
      ('G02','Приглашение работодателя с ASSIGN_TRAINING отклонялось старым CHECK','Additive migration 007 и корректная проверка уполномоченного автора','apps/api/src/employer-invites.ts; packages/database/prisma/migrations','onboarding/F03-invitation.json'),
      ('G03','Принятый заказ работодателя возвращал403 из capability route','Разрешён точный маршрут /order с прежней active membership/READ/scope проверкой','packages/contracts/src/capabilities.ts','onboarding/b2b-group/order-scope-check.json'),
      ('G04','Новый черновик скрывал опубликованную версию при назначении','Назначение использует publishedVersion независимо от latestDraft','apps/web/components/lms/operator-application.tsx','learning/ui-published-choice-operator.json'),
      ('G05','Самостоятельный банк нельзя было законченно открыть/создать','Маршрут policy, авторинг, импорт, immutable revision; advisory execute исправлен','packages/contracts/src/product-policy.json; apps/api/src/lms/questions.ts','learning/ui-bank-methodist.json'),
      ('G06','Промежуток программы смешивался с часами и доступом','Отдельное необязательное metadata.durationDays в сохранённой версии и RU/KZ карточках','packages/contracts/src/lms/index.ts; apps/web/components/lms/course-learning-settings.tsx','learning/ui-prerequisite-b-duration-views-methodist.json'),
      ('G07','Учебный пример требовал скрытого программного основания','Явный переключатель synthetic только для demoOnly, обычный review/publish','apps/api/src/lms/courses.ts; apps/web/components/lms/course-editor.tsx','documents/credential/issued-result.json'),
      ('G08','Практика/наблюдение не давали цельного видимого допуска','Критерии практики, отдельное решение, наблюдатель и решение по точной попытке','apps/api/src/lms/practice.ts; apps/api/src/lms/proctoring.ts','learning/ui-attendance-attendance-denied-learner.json'),
      ('G09','Закрытая видеозапись не проигрывалась в нормальном кабинете','Встроенный player, корректная CSP и закрытие stream при abort/error','apps/web/components/lms/teaching-calendar.tsx; apps/api/src/lms/private-stream-response.ts','learning/ui-supervised-recording-learner.json'),
      ('G10','Календарное уведомление теряло событие и роль слушателя','Ссылка /learn/calendar?eventId= сохраняет конкретное событие','apps/web/components/lms/notifications.tsx','learning/ui-calendar-cancel-teacher.json'),
      ('G11','Новая редакция источника не имела полного рабочего handoff','Затронутые программы, ответственный, срок, состояние и требование новой ссылки','apps/api/src/lms/regulatory-sources.ts; apps/web/components/lms/source-library.tsx','learning/ui-source-tasks-methodist.json'),
      ('G12','Формы не давали полный управляемый цикл редакции','Загрузка/проверка/реальный preview/approve, прежняя утверждённая версия доступна','apps/api/src/template-management.ts; apps/web/components/template-manager.tsx','operations/browser/F15-forms-ui.json'),
      ('G13','Статус формирования ошибочно сообщал об ожидании подписей','RENDERING и AWAITING_SIGNATURE имеют отдельный понятный текст','apps/web/components/files-panel.tsx','documents/credential/issued-result.json'),
      ('G14','Массовый выбор сбрасывал прошлую страницу','Допустимые результаты добавляются к уже выбранным, счётчик общий','apps/web/components/lms/results.tsx','documents/bulk-full.json'),
      ('G15','Отрицательный возврат блокировался денежным UI парсером','Отрицательная сумма разрешена только событию платежа/возврата','apps/web/lib/money.ts; apps/web/components/order-finance.tsx','operations/payments-registry/F24-application-payment.json'),
      ('G16','Не было публичного поиска по номеру и корректного frozen срока','Точный номер+центр, privacy404, validUntil из immutable выпуска','apps/api/src/public-verification.ts; apps/api/src/document-validity.ts','operations/public-verification/F21-number-qr.json'),
      ('G17','Отчёт мог скрывать сущности без назначений/терять scope при скачивании','Полные directory rows и текущий scope артефакта на download','apps/api/src/lms/report-directory.ts; apps/api/src/lms/report-controller.ts','operations/payments-registry/F25-exports-scopes-F28-layouts.json'),
      ('G18','Ручная санитарная отметка могла выглядеть внешним успехом','Файл+SHA, immutable correction, честные NOT_CONNECTED/NOT_CONFIRMED','apps/api/src/regulatory-results/controller.ts; apps/web/components/lms/sanitary.tsx','operations/sanitary/F17-sanitary.json'),
    ]
    tsv('FUNCTIONAL_GAPS_BEFORE_AFTER.tsv',['ID','До','После','Код','Доказательство','Статус'],[dict(zip(['ID','До','После','Код','Доказательство','Статус'],[*row[:4],evidence(row[4])[0],'CLOSED_IN_VERIFIED_SCOPE'])) for row in gaps])
    journeys=[
      ('SUPER_ADMIN','Первый директор подтверждает пароль; создаёт роли и полномочия','Пользователи, организации, формы, доступ, журнал аудита','DIRECTOR / ADMIN / служебные роли','onboarding/F01.json','AUDIT_UI_RESULT.json'),
      ('ADMIN','Принимает заявку и управляет назначением','B2C/B2B заказ и группа; доступ представителю','OPERATOR / EMPLOYER / LEARNER','onboarding/b2b-group/journey.json','operations/payments-registry/F24-application-payment.json'),
      ('DIRECTOR','Проверяет программу и реальный предпросмотр документов','Публикация, approval, подтверждение комиссии, исправление/аннулирование','METHODIST / render-worker / LEARNER','documents/credential/commission-result.json','operations/result-lifecycle/F20-final.json'),
      ('OPERATOR','Открывает опубликованную версию, задаёт список и период','Назначения, группа, продление, результат/комплект','LEARNER / TEACHER / DIRECTOR','learning/ui-published-choice-operator.json','learning/ui-prerequisite-b-extended-learner.json'),
      ('METHODIST','Создаёт вопрос, импортирует, редактирует материалы/курс','Review, новая версия, источник и задачи актуализации','EXPERT / DIRECTOR','learning/ui-course-methodist.json','learning/ui-source-tasks-methodist.json'),
      ('EXPERT','Проверяет реквизиты источника и фиксирует редакцию','REVIEW_REQUIRED сохраняет границу юридической проверки','METHODIST / DIRECTOR','learning/ui-source-review-expert.json','learning/ui-source-links-methodist.json'),
      ('TEACHER','Получает группу, задание или попытку на проверку','Возврат/принятие, практика, наблюдение, ручная оценка, календарь','LEARNER / комиссия','onboarding/correction-retry/final-readback.json','learning/ui-supervised-result-learner.json'),
      ('VIEWER','Входит в разрешённый обзор','Таблицы/фильтры без кнопок экспорта; файл403','Чтение без передачи управляющих прав','onboarding/populated-learner/viewer-report.json','operations/payments-registry/F25-exports-scopes-F28-layouts.json'),
      ('EMPLOYER','Принимает приглашение или запрашивает доступ','Свой кабинет, групповая заявка, исправление списка, итог2/2','ADMIN / OPERATOR / свои сотрудники','onboarding/F03-access-request.json','onboarding/b2b-group/order-scope-check.json'),
      ('LEARNER','Регистрируется, выбирает/получает программу','Материалы, работа, пересдача, результат, документы, QR','TEACHER / DIRECTOR / личный кабинет','onboarding/exam-resilience/final-readback.json','documents/credential/learner-downloads.json'),
    ]
    tsv('ROLE_JOURNEYS.tsv',['Роль','Вход','Действие_и_результат','Передача','Доказательства','Граница'],[dict(zip(['Роль','Вход','Действие_и_результат','Передача','Доказательства','Граница'],[*r[:4],'; '.join(evidence(*r[4:])),'Локальные учебные аккаунты; внешняя доставка, юридические полномочия и ЭЦП не заявляются.'])) for r in journeys])
    copies=[
      ('Формирование файлов','Ожидаются электронные подписи при RENDERING','Файлы формируются; подписи упоминаются только при AWAITING_SIGNATURE','Сохранён запрет выдачи до выполнения действительного workflow','apps/web/components/files-panel.tsx'),
      ('Директор / approval','LMS:<UUID> в основном названии','Результат обучения','Точный source остаётся в данных и аудите','apps/web/components/approval-review.tsx'),
      ('Кабинет работодателя','Нет доступа без следующего действия','Запросить доступ; видно pending и решение с основанием','Сам запрос не выдаёт membership','apps/web/components/employer-access-request.tsx'),
      ('Допуск к экзамену','Общий отказ без маршрута продолжения','Причина и следующий шаг: уроки, практика, проверка, базовый курс, срок','Серверный guard не ослаблен','apps/web/components/lms/common.tsx'),
      ('Календарное уведомление','Открытие общего служебного календаря','Открытие точного события в кабинете своей роли','eventId сохранён, права проверяет API','apps/web/components/lms/notifications.tsx'),
      ('Массовый выбор','Выбрано на этой странице при нескольких страницах','Выбрано результатов','Выбор теперь действительно объединяет страницы','apps/web/components/lms/results.tsx'),
      ('Санитарная ветка','Неявное впечатление принятия внешней системой','Нет подключения; ручное доказательство отдельно; ЛМК не подтверждена','Статус внешнего провайдера не подделан','apps/web/components/lms/sanitary.tsx'),
      ('Учебная версия','Скрытое synthetic основание','Учебный пример — без юридической силы','Переключатель только в demoOnly, документы помечены','apps/web/components/lms/course-editor.tsx'),
      ('Возврат оплаты','Отрицательная сумма отклонена как цена','Сумма возврата принимается и входит в историю','Цена курса остаётся неотрицательной','apps/web/components/order-finance.tsx'),
      ('Пустые списки','Ошибка могла выглядеть отсутствием данных','Разделены загрузка, ошибка, пустой список и отсутствие совпадений','Предлагается повторить загрузку','apps/web/components/customers.tsx'),
    ]
    tsv('UI_COPY_REVIEW.tsv',['Экран','До','После','Сохранённый_смысл','Код'],[dict(zip(['Экран','До','После','Сохранённый_смысл','Код'],r)) for r in copies])
    forms=read('operations/forms/results.json')
    checks=[
      dict(command='pnpm -r build',status='PASS',exitCode=0,log='build-final.log',scope='Все8 workspace packages; итоговыйNext production build'),
      dict(command='pnpm lint',status='PASS',exitCode=0,log='lint-final.log',scope='Весь автономный products/demo'),
      dict(command='pnpm -r typecheck',status='PASS',exitCode=0,log='typecheck-final.log',scope='Все8 workspace packages'),
      dict(command='git diff --check -- .',status='PASS',exitCode=0,log='diff-check-final.log',scope='Текущий diff products/demo, включая сохранённый baseline'),
      dict(command='node scripts/verification/autonomy.mjs',status='PASS',exitCode=0,log='autonomy-final.log',scope='9manifest,21selectedtemplates,0externalDSJdependencies'),
      dict(command='Real browser journeys',status='PASS_IN_DOCUMENTED_SCOPE',scope='ACCEPTANCE_RESULTS.json; normal forms/API/files, no page.route success mocks'),
      dict(command='22 template renderer variants',status='PASS',passCount=sum(bool(r['ok']) for r in forms),total=len(forms),log='operations/forms/results.json'),
      dict(command='template upload boundary',status='PASS',passCount=4,log='operations/template-boundary.log'),
      dict(command='learning targeted invariants',status='PASS',log='learning/checks-result.json',scope='5readiness,3realOSfd,1isolatedintegration; no broad DB rerun'),
      dict(command='Final built runtime learner and session',status='PASS',log='FINAL_UI_RESULT.json'),
      dict(command='Notifications across full restart',status='PASS',log='NOTIFICATIONS_RESTART_RESULT.json'),
      dict(command='User data preservation after final restart',status='PASS',log='USER_INSTALLATION_RESULT.json'),
      dict(command='Isolated restore and historical file',status='PASS',log='BACKUP_RESTORE_RESULT.json'),
    ]
    for check in checks:
        if check.get('log'): evidence(check['log'])
    write('TEST_RESULTS.json',{'capturedAt':NOW,'checks':checks,'broadDatabaseSuiteRerun':False,'fullUnitAndIntegrationAndE2ePipeline':False,'reason':'Latest user instruction prioritizes working UI flows over repeated DB suites; targeted invariants and full build/lint/typecheck completed.','knownBuildWarnings':'Existing autoprefixer end alignment and optional Next eslint/TS plugin notices; build exits0.','resolvedFailures':['Initial lint unused json import removed; unused destructured helper fields removed; final whole-product lint passed.','Actual UI failures and fixes are listed in FUNCTIONAL_GAPS_BEFORE_AFTER.tsv.','Intermediate locator/readback errors remain in evidence; resumed business actions were not duplicated.'],'notExecuted':['Production deployment','Real provider delivery/signature/banking','Physical printing','Thousands-user load','Exhaustive role-by-resource revocation matrix','Full format rewrite of existing dirty workspace']})

CASES = [
 ('F01','Чистый центр и роли','PASS','DIRECTOR → первый SUPER_ADMIN → 7 служебных ролей → отдельные входы; OPERATOR users403.',['onboarding/F01.json'],'Учебная изолированная установка, не реальный вход владельца исторической БД.'),
 ('F02','Реквизиты, комиссия, формы и полномочия','PASS','Реквизиты и комиссия сохранены UI, обычные/LMS формы загружены, отрендерены, утверждены.',['onboarding/F02-F03-prerequisites.json','operations/browser/F15-forms-ui.json','documents/credential/commission-result.json'],'Локальное подтверждение комиссии не является ЭЦП.'),
 ('F03','Организация, представитель, список и scope','PASS_WITH_LIMITS','Приглашение → scoped кабинет; отзыв → запрос → решение → один активный доступ; ошибочный список исправлен.',['onboarding/F03-invitation.json','onboarding/F03-access-request.json','onboarding/b2b-group/order-scope-check.json'],'Все возможные форматы импорта и совпадения персональных данных не перебирались.'),
 ('F04','B2C заявка и обучение','PASS','Саморегистрация → каталог → заявка → решение → назначение/заказ → открытие курса; полный учебный путь отдельно доведён до файлов.',['operations/payments-registry/F24-application-payment.json','onboarding/populated-learner/final-readback.json','documents/learner-downloads.json'],'Коммерческий и полный содержательный учебный сценарии выполнялись разными учебными слушателями.'),
 ('F05','B2B групповая заявка','PASS','Заявка2 → принятие/заказ → ошибка email → исправление → 2 назначения/группа → работодатель видит2/2.',['onboarding/b2b-group/journey.json','onboarding/b2b-group/order-scope-check.json'],'Назначение не доказывает доставку приглашения двум сотрудникам внешней почтой.'),
 ('F06','Авторинг и публикация','PASS','Банк/импорт/источник → новый курс и материалы → review → публикация → назначение обычными ролями.',['learning/ui-bank-methodist.json','learning/ui-course-methodist.json','learning/ui-publish-director.json'],'Учебный контент; официальный учебный план требует утверждения владельца.'),
 ('F07','Редакции без переписывания истории','PASS_WITH_LIMITS','Новые вопросы/источник/курс, задачи ответственным; прежняя попытка и результат сохранили SHA.',['learning/ui-history-before-learner.json','learning/ui-history-after-learner.json','onboarding/correction-retry/v1-preserved-after-v2.json'],'Этот курс не имел выданного документа; неизменяемость выданных файлов отдельно подтверждена F20/F32.'),
 ('F08','Материалы и прогресс','PASS_WITH_LIMITS','4 текста,9-страничныйPDF,180сек видео с субтитрами/возобновлением, промежуточная проверка и работа.',['onboarding/populated-learner/journey.json','onboarding/populated-learner/final-readback.json','learning/ui-supervised-recording-learner.json'],'Все форматы и каждую комбинацию отзыва прав не перебирали.'),
 ('F09','Возврат задания и повторная сдача','PASS','Замечания → исправленный draft/reload → revision2 → отдельное принятие преподавателем.',['onboarding/correction-retry/journey.json'],'Неизменная повторная работа не принималась как новая редакция.'),
 ('F10','Практика и допуск','PASS','PRESENT и ADMITTED без принятой практики оставляют экзамен закрытым; отдельная полная цепь практики/наблюдения/оценки.',['learning/ui-attendance-attendance-denied-learner.json','learning/ui-supervised-result-learner.json'],'Личность и присутствие в этом локальном примере — явно учебная симуляция.'),
 ('F11','Предпосылка и окно доступа','PASS_WITH_LIMITS','А→Б blocked409 → А сдан → Б открыт; реальное истечение времени →409 → продление через UI.',['learning/ui-prerequisite-b-blocked-learner.json','learning/ui-prerequisite-b-expired-learner.json','learning/ui-prerequisite-b-extended-learner.json'],'Отдельный модуль→модуль отрицательный сценарий не повторялся.'),
 ('F12','Типы вопросов','PASS','SINGLE/MULTIPLE/MATCHING/ORDERING/CASE/TEXT exact+manual: автор → слушатель → автоматическая/ручная оценка.',['onboarding/correction-retry/final-readback.json','learning/ui-learner-result-learner.json'],'Раскрытие ключей зависит от политики законченной попытки.'),
 ('F13','Надёжность экзамена','PASS','Reload всех ответов, двойное завершение без дубля; реальный timeout; offline→online→autosave→reload→submit.',['onboarding/exam-resilience/timeout-readback.json','onboarding/exam-resilience/final-readback.json'],'Проверена краткая фактическая потеря сети, не длительное системное отключение сервера.'),
 ('F14','Неудача, ручная оценка и пересдача','PASS','FAILED0/7 → разбор → retry → PASSED7/7; две неизменяемые попытки, третья недоступна.',['onboarding/correction-retry/final-readback.json'],'Оценки вводились обычным преподавателем.'),
 ('F15','Календарь и запись','PASS','Создание → переносrevision2 → адресное уведомление → отменаrevision3 → адресное уведомление; приватныйMP4 играет.',['learning/ui-calendar-cancel-teacher.json','learning/ui-supervised-recording-learner.json'],'Zoom/Teams/Meet и фактическая внешняя конференция не подключались.'),
 ('F16','Результат до конечных документов','PASS','BIOT10/10 → approval → протокол/сертификат; отдельный1/1 →3вида PDF/DOCX; QR декодирован, комиссия и learner downloads сохраняются.',['documents/issued-result.json','documents/file-inspection.json','documents/credential/issued-result.json','documents/credential/file-inspection.json','documents/credential/learner-downloads.json','documents/credential/commission-result.json'],'Это явно синтетические документы центра без юридической силы; физический принтер не использовался.'),
 ('F17','Редакции шаблонов','PASS','UI загрузка → структурная валидация → реальныйDOCX/PDF → утверждение;22варианта отрендерены.',['operations/browser/F15-forms-ui.json','operations/forms/results.json'],'Свободный визуальный конструктор произвольного формата не заявлен; поддерживаются совместимые DOCX шаблоны.'),
 ('F18','Пакет выдачи','PASS_WITH_LIMITS','Сначала скачаны2готовыхPDF при ожидающем втором результате, затем4PDF однимZIP; reload и хеши реальных файлов.',['documents/bulk-partial.json','documents/bulk-full.json','documents/bundle-inspection.json'],'Проверены частичная готовность и повторная подготовка без дубля, не искусственный крах render-worker посередине большого пакета.'),
 ('F19','Общий реестр','PASS','Обычные PTM и LMS документы в едином реестре/экспортах, с источником, состоянием и областью доступа.',['operations/payments-registry/F19-common-registry.json','documents/issued-result.json'],'Обычный PASSED/AUTO не объявляется сдачей LMS экзамена.'),
 ('F20','Исправление и аннулирование','PASS_WITH_LIMITS','UI correction создаёт новый результат/выпуск/номера, старыйQR REPLACED; аннулирование нового выпуска отражено вQR/реестре, байты сохранены.',['operations/result-lifecycle/corrected-result.json','operations/result-lifecycle/F20-final.json'],'В этой цепочке не проходили отдельные дубликат/повторное обучение; фактическое истечение годового документа не симулировалось.'),
 ('F21','Публичная проверка','PASS_WITH_LIMITS','QR и точный номер+центр дают один результат; чужой/отсутствующий номер404; замена/аннулирование показывают реальные состояния.',['operations/public-verification/F21-number-qr.json','operations/result-lifecycle/F20-final.json'],'Граница срока документа проверена адресной чистой функцией; реальный документ имеет срок2027-10-19.'),
 ('F22','Бумажный и электронный маршруты','LOCAL_PASS_EXTERNAL_PENDING','Документы, согласование и локальное подтверждение комиссии доступны; криптографический подписанный оригинал не подменяется кнопкой.',['documents/commission-result.json','documents/credential/commission-result.json','operations/printing/F16-printing.json'],'Нужны фактическая подпись людей/печать либо разрешённый провайдер ЭЦП и сертификаты.'),
 ('F23','Санитарная ветка','LOCAL_PASS_EXTERNAL_PENDING','Результат → журнал/CSV/XLSX/PDF → файл ручного доказательства → неизменяемое исправление, SHA совпадает.',['operations/sanitary/F17-sanitary.json'],'NOT_CONNECTED / LMK NOT_CONFIRMED сохранены: внешняя МИС не подключена.'),
 ('F24','Заявка, расчёт, оплата и исполнение','PASS_WITH_LIMITS','Заявка → решение/назначение/заказ10000KZT → платёж10000/возврат2500/доплата2500 →PAID, повтор не создаёт4событие.',['operations/payments-registry/F24-application-payment.json'],'Ручной учёт; банковского платежа нет. Коммерческие КП/договор/счёт отдельно этой цепочкой не выпускались.'),
 ('F25','Отчёты и выгрузка','PASS','РеальныеCSV/XLSX/PDF, нулевые организации/сотрудники сохраняются; VIEWER безэкспорта, EMPLOYER scoped.',['operations/payments-registry/F25-employee-zero.json','operations/payments-registry/F25-exports-scopes-F28-layouts.json'],'Отдельное снятиеDOWNLOAD между постановкой конкретногоjob и скачиванием не повторялось.'),
 ('F26','Уведомления и перезапуск','PASS_WITH_LIMITS','Реальные assignment/result/document события, чтение/переход; после полного restart исходныеid/readAt сохранены без дубля тех же источников.',['NOTIFICATIONS_BEFORE.json','NOTIFICATIONS_RESTART_RESULT.json'],'Проверено на learner01 плюс календарные уведомления; не полный fault-injection каждого расписания.'),
 ('F27','Связный учебный набор','PASS','8служебных ролей+2работодателя+16слушателей,3 содержательные программы,2организации,32исходныхназначения; результаты появились прохождением.',['CONTENT_CATALOG.json','documents/learner-downloads.json'],'Учебный набор отделён от пользовательской базы; дополнительные UI сценарии находятся вclean3350.'),
 ('F28','RU/KZ, экран и клавиатура','PASS_WITH_LIMITS','360/390/768/1440 на формах/кабинетах/отчётах; RU/KZ learner/exam/QR; radioSpace и submitEnter в устойчивом экзамене.',['operations/payments-registry/F25-exports-scopes-F28-layouts.json','onboarding/exam-resilience/final-readback.json','onboarding/F02-F03-prerequisites.json'],'Не полный accessibility-аудит всех экранов и не профессиональная редактура казахского контента.'),
 ('F29','Актуальные права и старые ссылки','PASS_WITH_LIMITS','Отзыв membership закрывает кабинет, чужой заказ404/организация403; viewer export403; старая сессия послеlogout не скачивает прежнийPDF401.',['onboarding/F03-access-request.json','onboarding/b2b-group/order-scope-check.json','operations/payments-registry/F25-exports-scopes-F28-layouts.json','FINAL_UI_RESULT.json'],'Не исчерпывающая матрица каждой роли×каждого старогоURL.'),
 ('F30','Старт и повторный старт','PASS','ХолодныйPostgreSQL+4сервиса, повторныйstart сохраняетPID; финально запущен собранныйNextruntime.',['LOCAL_START_RESULT.json','FINAL_RUNTIME_RESULT.json'],'ЛокальнаяWindows поставка; deployment/внешнийхост не выполнялись.'),
 ('F31','Изолированное восстановление','PASS','Восстановлены dump+storage,38миграций,4users/152requests/17issuances/54docs/206files; историческийPDFHTTP200+SHA.',['BACKUP_RESTORE_RESULT.json'],'Временная сессия создана и удалена только вrestoreDB; реальный пароль пользователя не использовался.'),
 ('F32','Сохранность пользовательских данных','PASS','ОсновнаяБД сохранила counts, immutablehashes,206файлов90005263bytes; старые удаления/dirtystate не сброшены.',['USER_INSTALLATION_RESULT.json','BASELINE.json'],'Новыеfixtures/учебные результаты в основнойБД не создавались; физическаяпечать не заявлена.'),
]

def main():
    cases=[]
    for key,title,status,behavior,files,limits in CASES:
        available=all((OUT/name).exists() for name in files)
        cases.append(dict(id=key,title=title,executed=available,status=status if available else 'IN_PROGRESS',behavior=behavior,evidence=evidence(*files) if available else files,limits=limits))
    write('ACCEPTANCE_RESULTS.json',{'capturedAt':NOW,'scope':'Local autonomous DEMO functional completion; real UI and files','notAGlobalProductionCertification':True,'counts':dict(Counter(c['status'] for c in cases)),'criteria':cases})

    with (OUT/'MATRIX_DRAFT.tsv').open(encoding='utf-8-sig') as stream:
        reader=csv.DictReader(stream,delimiter='\t'); fields=reader.fieldnames; rows=list(reader)
    by_id={row['ID']:row for row in rows}
    def update(ids,behavior,files,limits='',status='IMPLEMENTED_UI_VERIFIED'):
        links='; '.join(evidence(*files))
        for key in ids.split():
            row=by_id[key]
            row['Текущий_статус']=status
            row['Реализованное_поведение']=behavior
            row['Доказательство']=links
            row['Граница_доказательства']=limits or 'Проверена описанная область; статус не означает production или внешнюю юридическую действительность.'
            row['Следующий_шаг']='Рабочий локальный путь доступен. Сохранять указанную границу доказательства.'
    update('TZ-01-01 TZ-69-01 TZ-70-01','B2C/B2B решение, назначение, содержательное обучение и выдача через обычные роли.',['onboarding/b2b-group/order-scope-check.json','onboarding/populated-learner/final-readback.json','documents/credential/learner-downloads.json'])
    update('TZ-03-01 TZ-03-02','Карточка/редактор/публикация; отдельное durationDays=2, часы и доступ независимы; существующие версии не дополнены выдуманным сроком.',['learning/ui-course-methodist.json','learning/ui-prerequisite-b-duration-views-methodist.json','learning/ui-prerequisite-b-duration-views-learner.json'])
    update('TZ-05-04 TZ-54-01','Новая версия, review/publish; старый опубликованный курс остаётся доступен оператору, прежние результаты неизменны.',['learning/ui-published-choice-operator.json','learning/ui-history-after-learner.json'],'Проверены draft/review/publish и история; suspend/archive отдельно не повторялись.','IMPLEMENTED_PARTIALLY_VERIFIED')
    update('TZ-07-01 TZ-42-01','Занятие/преподаватель/посещение/закрытая запись, перенос и отмена с адресными уведомлениями.',['learning/ui-calendar-cancel-teacher.json','learning/ui-supervised-recording-learner.json'])
    update('TZ-09-02 TZ-10-01 TZ-10-02','Промежуточный тест/задание/практика влияют на допуск; посещение без принятой практики оставляет409.',['onboarding/populated-learner/final-readback.json','learning/ui-attendance-attendance-denied-learner.json'])
    update('TZ-11-01 TZ-15-01','Реальные типы, ручная оценка, fail/retry, reload/double-submit, timeout и offline/reconnect.',['onboarding/correction-retry/final-readback.json','onboarding/exam-resilience/final-readback.json'])
    update('TZ-12-03','Основной банк30, итоговая попытка10вопросов; ответы сохранены и оценены.',['CONTENT_CATALOG.json','onboarding/populated-learner/final-readback.json'],'Это фактическая выборка из банка, не статистический тест случайности.')
    update('TZ-15-02','Рабочий местный наблюдаемый режим до отправки и по точной законченной попытке.',['learning/ui-supervised-proctor-approve-teacher.json','learning/ui-supervised-result-learner.json'],'Внешний видеопрокторинг/camera/microphone не подключены.')
    update('TZ-18-01 TZ-57-01 MVP-15','Три фактически выданных видаPDF/DOCX, номера, QR, сведения центра, learner download/reload.',['documents/credential/issued-result.json','documents/credential/file-inspection.json','documents/credential/learner-downloads.json'],'Электронный файл учебного центра не объявляется подписанным ЭЦП оригиналом.')
    if (OUT/'operations/result-lifecycle/F20-final.json').exists():
        update('TZ-24-01 TZ-25-01','Исправление новой редакцией/номером, затем аннулирование; публичный QR/реестр отражают состояние, все старые байты сохранены.',['operations/result-lifecycle/corrected-result.json','operations/result-lifecycle/F20-final.json'])
    update('TZ-28-01 TZ-59-01','Версии источника/вопроса/курса и старый результат неизменны; выданные документы используют frozen snapshot.',['learning/ui-history-after-learner.json','USER_INSTALLATION_RESULT.json'],'Старый выданный документ именно этого изменённого курса отсутствовал; две части подтверждены разными цепями.','IMPLEMENTED_PARTIALLY_VERIFIED')
    update('TZ-30-01 TZ-30-02 TZ-31-01 MVP-20','Работодатель имеет собственный кабинет, групповой заказ2/2, исправление списка и область доступа; чужойorder404.',['onboarding/b2b-group/order-scope-check.json','onboarding/b2b-group/journey.json','onboarding/F03-invitation.json'],'Excel и все виды импорта/массового скачивания именно работодателем не перебирались.')
    update('TZ-32-01','Группа связана с преподавателем, занятием, практикой и результатом; отдельная B2B группа2слушателей.',['learning/ui-supervised-result-learner.json','onboarding/b2b-group/journey.json'])
    update('TZ-33-01 TZ-33-02','Массовая подготовка/повтор, частичная готовность и полныйZIP с4PDF, уникальные номера и совпадающие хеши.',['documents/bulk-partial.json','documents/bulk-full.json','documents/bundle-inspection.json'],'Не нагрузочная проверка тысяч файлов; искусственный crash в середине большогоZIP не выполнялся.')
    update('TZ-36-01','Эксперт создаёт проверенную редакцию источника; комиссия подтверждает просмотренный реальный протокол.',['learning/ui-source-review-expert.json','documents/credential/commission-result.json'],'Локальное решение комиссии; криптографическая подпись требует внешнего провайдера.')
    update('TZ-37-01 TZ-38-01 MVP-21','Настройка пользователей/ролей/центра/организаций/учебных полномочий/программ/форм доступна обычномуSUPER_ADMIN и профильным ролям.',['onboarding/F01.json','onboarding/F02-F03-prerequisites.json','operations/browser/F15-forms-ui.json'])
    if (OUT/'AUDIT_UI_RESULT.json').exists():
        update('TZ-39-01 MVP-22','Журнал обычного администратора показывает фактические события, время, автора, объект, IP и раскрываемые изменения.',['AUDIT_UI_RESULT.json'],'Неподменяемость исторических business snapshots проверена отдельно; не формальная сертификация аудита.')
    if (OUT/'NOTIFICATIONS_RESTART_RESULT.json').exists():
        update('TZ-17-02 TZ-41-01 TZ-73-02','Внутренний inbox: реальные события, прочитано, переход к объекту; id/readAt сохранились после restart без дублей источника.',['NOTIFICATIONS_RESTART_RESULT.json','learning/ui-calendar-cancel-teacher.json'],'Внешняя почта/SMS/WhatsApp не подключены; каждый вид расписания отдельно не инъецировался.')
    update('TZ-43-01 TZ-45-01','Заявка, решение, заказ, назначения и ручная история платежей/возврата доступны; итогPAID не заменяет экзамен.',['operations/payments-registry/F24-application-payment.json'],'КП/договор/счёт отдельно в этой новой цепочке не выпускались.','IMPLEMENTED_PARTIALLY_VERIFIED')
    update('TZ-46-02','Оплата учитывается отдельно; право документа появляется только от подходящего учебного результата и approval.',['operations/payments-registry/F24-application-payment.json','documents/issued-result.json'])
    update('TZ-47-01 TZ-47-02','Отчёты/нулевые сущности/фильтры/экспорты на scoped данных.',['operations/payments-registry/F25-exports-scopes-F28-layouts.json'],'Все комбинации фильтров не перебирались.','IMPLEMENTED_PARTIALLY_VERIFIED')
    update('TZ-49-01 TZ-50-01 TZ-50-02 MVP-24 MVP-25','RU/KZ и 360/390/768/1440 на основных формах, кабинетах, отчётах; mobile learner/exam/QR; вводSpace/Enter.',['operations/payments-registry/F25-exports-scopes-F28-layouts.json','onboarding/exam-resilience/final-readback.json','onboarding/F02-F03-prerequisites.json'],'Проверены перечисленные маршруты; не полный accessibility-аудит каждого состояния или утверждение профессионального перевода.')
    update('TZ-55-01 TZ-56-01','А→Б prerequisite и настоящая граница срока; после продления черезUI доступ возвращается.',['learning/ui-prerequisite-b-blocked-learner.json','learning/ui-prerequisite-b-expired-learner.json','learning/ui-prerequisite-b-extended-learner.json'])
    update('TZ-56-02','Рабочие UNLIMITED и FIXEDпериоды, сохранение границ/продления.',['learning/ui-prerequisite-b-extended-learner.json'],'Отложенное начало отдельно не дожидались.','IMPLEMENTED_PARTIALLY_VERIFIED')
    update('SAN-02','Реальный render-worker создал конечные документы и санитарный batch из результатов; работающие сервисы перезапускаются.',['documents/issued-result.json','operations/sanitary/F17-sanitary.json'])
    update('REC-02','Продукт использует существующий реестр людей и printing engine; autonomy не нашёл внешнихDSJзависимостей.',['autonomy-final.log'],'Это ограничение архитектуры, а не требование внедрить второй движок/каталог/Kubernetes.','IMPLEMENTED_REVIEWED')
    # Section rows summarize their source children; a mixed section is never a blanket PASS.
    for row in rows:
        if row['Тип']!='SECTION': continue
        section=int(row['Раздел'])
        children=[r for r in rows if r['ID'].startswith(f'TZ-{section:02d}-')]
        if section==75: children=[r for r in rows if r['ID'].startswith('MVP-')]
        states={r['Текущий_статус'] for r in children}
        if states=={'IMPLEMENTED_UI_VERIFIED'}: row['Текущий_статус']='IMPLEMENTED_UI_VERIFIED'
        elif states=={'EXTERNAL_DEPENDENCY'}: row['Текущий_статус']='EXTERNAL_DEPENDENCY'
        else: row['Текущий_статус']='IMPLEMENTED_PARTIALLY_VERIFIED'
        row['Реализованное_поведение']='Сводка актуальных подпунктов: '+', '.join(r['ID'] for r in children)+'. Подробное поведение и границы указаны в строках подпунктов.'
        row['Доказательство']='; '.join(dict.fromkeys(p for r in children for p in r['Доказательство'].split('; ') if p))
        row['Граница_доказательства']='Сводный раздел не расширяет доказательства подпунктов. Внешние границы и неперебранные комбинации сохранены явно.'
        row['Следующий_шаг']='Использовать реализованные маршруты; для непроверенных комбинаций не приписывать полный PASS.'
    tsv('REQUIREMENTS_FULL.tsv',fields,rows)
    assert len(rows)==218 and len(by_id)==218
    assert sum(r['Тип']=='SECTION' for r in rows)==76
    assert sum(r['ID'].startswith('MVP-') for r in rows)==25
    missing=[]
    for row in rows:
        for value in row['Доказательство'].split('; '):
            if value and not (ROOT/value).exists(): missing.append((row['ID'],value))
    if missing: raise ValueError(missing)
    write('REQUIREMENTS_VALIDATION.json',{'rows':218,'sections':76,'historicalSubrequirements':117,'mvp':25,'counts':dict(Counter(r['Текущий_статус'] for r in rows)),'allEvidencePathsExist':True,'allMvpLocalUiVerified':all(r['Текущий_статус']=='IMPLEMENTED_UI_VERIFIED' for r in rows if r['ID'].startswith('MVP-')),'wholeSpecificationFullyTested':False})
    extra_outputs()
    provenance={'capturedAt':NOW,'root':str(ROOT),'branch':subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip(),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'baseline':read('BASELINE.json'),'sourceDocxSha256':hashlib.sha256((HANDOFF/'SOURCE_LMS_REQUIREMENTS.docx').read_bytes()).hexdigest(),'sourceParagraphs':1650,'fullSourceSections':76,'mvpItems':25,'workOnExistingDirtyCheckout':True,'pushOrDeployment':False,'providerMutations':False}
    current=subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True).splitlines()
    provenance['finalStatusRows']=len(current)
    provenance['finalDeletedRows']=sum(line[:2].strip()=='D' for line in current)
    prior=json.loads((RUNTIME/'source-before-manifest.json').read_text(encoding='utf-8-sig'))
    mono=ROOT.parents[1]
    changed=[]; missing_source=[]
    for entry in prior:
        file=mono/entry['path']
        if not file.exists(): missing_source.append(entry['path'])
        elif hashlib.sha256(file.read_bytes()).hexdigest()!=entry['sha256']: changed.append(entry['path'])
    provenance['baselineFilesMissingNow']=missing_source
    provenance['baselineFilesChangedNow']=changed
    provenance['baselineFilesOutsideProductChanged']=[p for p in changed if not p.startswith('products/demo/')]
    write('SOURCE_PROVENANCE.json',provenance)
    prior_by_path={r['path']:r for r in prior}
    tsv('SOURCE_CHANGES.tsv',['Путь','Исходный_SHA256','Итоговый_SHA256'],[{'Путь':p,'Исходный_SHA256':prior_by_path[p]['sha256'],'Итоговый_SHA256':hashlib.sha256((mono/p).read_bytes()).hexdigest()} for p in changed])
    print(json.dumps({'acceptance':dict(Counter(c['status'] for c in cases)),'matrix':dict(Counter(r['Текущий_статус'] for r in rows)),'baselineMissing':missing_source,'outsideProductChanges':provenance['baselineFilesOutsideProductChanged']},ensure_ascii=False))

if __name__=='__main__': main()
