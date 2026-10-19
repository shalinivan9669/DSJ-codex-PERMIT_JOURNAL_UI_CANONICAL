import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = process.cwd(), runtime = path.join(root, ".runtime/functional-completion-20261019/run-01"), evidence = path.join(root, "docs/evidence/functional-completion-20261019/run-01/learning");
const privateData = JSON.parse(await fs.readFile(path.join(runtime, "onboarding-result.private.json"), "utf8"));
const role = process.env.LEARNING_UI_ROLE || "methodist", base = "http://127.0.0.1:3350";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
let csrfToken = "";
page.on("request", request => { const token = request.headers()["x-csrf-token"]; if (token) csrfToken = token; });
page.setDefaultTimeout(15000);
const runStage = process.argv[2] || "inspect";
const supervised = runStage.startsWith("supervised-");
const stage = supervised ? runStage.slice(11) : runStage;
const variant = process.env.LEARNING_UI_VARIANT || "";
const filePrefix = variant || (supervised ? "supervised" : "learning");
const evidenceStage = variant ? `${variant}-${stage}` : runStage;
const courseFile = `${filePrefix}-course.private.json`;
const titleRu = variant === "prerequisite-a" ? "Шаг А: описание задачи перед передачей" : variant === "prerequisite-b" ? "Шаг Б: подтверждение приёма задачи" : supervised ? "Учебная симуляция: передача смены под наблюдением" : "Передача смены: задача, состояние и следующий шаг";
const titleKz = variant === "prerequisite-a" ? "А қадамы: тапсыру алдында тапсырманы сипаттау" : variant === "prerequisite-b" ? "Б қадамы: тапсырманы қабылдауды растау" : supervised ? "Оқу симуляциясы: бақылаумен ауысымды тапсыру" : "Ауысымды тапсыру: тапсырма, күй және келесі қадам";
const output = [];
try {
  await fs.mkdir(evidence, { recursive: true });
  await page.goto(base + "/login");
  await page.locator('input[type="email"]').fill(privateData.users[role].email);
  await page.locator('input[type="password"]').fill(privateData.users[role].password);
  await page.getByRole("button", { name: /^Войти$/ }).click();
  await page.waitForURL(url => !url.pathname.includes("login"));
  if (stage === "inspect") {
    await page.goto(base + "/lms/questions");
    await page.getByRole("button", { name: "Создать вопрос", exact: true }).click();
    output.push(await page.locator("main").innerText());
  }
  if (stage === "bank") {
    await page.goto(base + "/lms/questions");
    await page.getByRole("button", { name: "Создать вопрос", exact: true }).click();
    const editor = page.locator(".lms-question-author");
    await editor.getByLabel("Категория", { exact: true }).fill("Передача смены");
    await editor.getByLabel("Вопрос RU", { exact: true }).fill("Как передать незавершённую задачу следующей смене?");
    await editor.getByLabel("Вопрос KZ", { exact: true }).fill("Аяқталмаған тапсырманы келесі ауысымға қалай тапсыру керек?");
    const variants = editor.locator("fieldset").filter({ has: page.locator("legend", { hasText: /^Вариант/ }) });
    await variants.nth(0).getByLabel("RU", { exact: true }).fill("Указать состояние, ответственного и следующий шаг в журнале передачи");
    await variants.nth(0).getByLabel("KZ", { exact: true }).fill("Тапсыру журналында күйін, жауапты адамды және келесі қадамды көрсету");
    await variants.nth(1).getByLabel("RU", { exact: true }).fill("Оставить без записи: следующая смена сама разберётся");
    await variants.nth(1).getByLabel("KZ", { exact: true }).fill("Жазбасыз қалдыру: келесі ауысым өзі анықтайды");
    await variants.nth(0).getByLabel("Правильный ответ", { exact: true }).check();
    const saved = page.waitForResponse(response => response.url().endsWith("/api/lms/questions") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить редакцию", exact: true }).click();
    const response = await saved; if (!response.ok()) throw new Error(`QUESTION_SAVE_HTTP_${response.status()}: ${(await response.json()).message || ""}`);
    await page.getByText("Вопрос сохранён в банке", { exact: true }).waitFor();
    const bankQuestion = await response.json();
    await fs.writeFile(path.join(runtime, "learning-question.private.json"), JSON.stringify({ questionBankId: bankQuestion.question?.libraryQuestionId, revisionId: bankQuestion.id }));
    await page.reload();
    await page.getByText("Как передать незавершённую задачу следующей смене?", { exact: true }).waitFor();
    output.push({ standaloneQuestion: "created-and-reloaded", responseStatus: response.status() });
    await page.setViewportSize({ width: 390, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); if (overflow) throw new Error("QUESTION_BANK_MOBILE_OVERFLOW");
    await page.screenshot({ path: path.join(evidence, "ui-bank-mobile-ru.png"), fullPage: true });
    await page.getByRole("button", { name: "KZ", exact: true }).click();
    await page.getByText("Аяқталмаған тапсырманы келесі ауысымға қалай тапсыру керек?", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, "ui-bank-mobile-kz.png"), fullPage: true });
    output.push({ mobile: 390, languages: ["RU", "KZ"], overflow });
  }
  if (stage === "source") {
    await page.goto(base + "/lms/regulatory");
    await page.getByRole("button", { name: "Создать источник", exact: true }).click();
    const form = page.locator("form").first();
    await form.getByLabel("Название", { exact: true }).fill("Трудовой кодекс Республики Казахстан — карточка проверки");
    await form.getByLabel("Официальная HTTPS-ссылка", { exact: true }).fill("https://adilet.zan.kz/rus/docs/K1500000414");
    await form.getByLabel("Название редакции", { exact: true }).fill("Реквизиты на проверку 19.10.2026");
    await form.getByLabel("Номер НПА", { exact: true }).fill("414-V");
    await form.getByLabel("Дата НПА", { exact: true }).fill("2015-11-23");
    await form.getByLabel("Основание проверки / описание изменения", { exact: true }).fill("Карточка направлена эксперту. Актуальность текста и применимость к программе ещё не подтверждены.");
    const saved = page.waitForResponse(response => response.url().endsWith("/api/lms/regulatory-sources") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Сохранить редакцию", exact: true }).click();
    const response = await saved; if (!response.ok()) throw new Error(`SOURCE_SAVE_HTTP_${response.status()}`);
    const source = await response.json();
    await fs.writeFile(path.join(runtime, "learning-source.private.json"), JSON.stringify({ sourceId: source.sourceId, revisionId: source.id }));
    await page.reload();
    await page.getByText("Трудовой кодекс Республики Казахстан — карточка проверки", { exact: true }).waitFor();
    await page.getByText("История редакций (1)", { exact: true }).click();
    await page.getByText(/Не подтверждена/).waitFor();
    output.push({ source: "created-and-reloaded", verified: false, responseStatus: response.status() });
  }
  if (stage === "import") {
    await page.goto(base + "/lms/questions");
    await page.getByText("Импорт вопросов", { exact: true }).click();
    const header = "kind\tcategory\ttopic\tquestionRu\tquestionKz\toptionsRu\toptionsKz\tcorrect\trightRu\trightKz\tcriteriaRu\tcriteriaKz\texplanationRu\texplanationKz\tsource\tcontextRu\tcontextKz";
    const row = "SINGLE\tПередача смены\tУточнение условий\tЧто сделать, если следующий шаг передачи непонятен?\tТапсырудың келесі қадамы түсініксіз болса, не істеу керек?\tУточнить у ответственного до начала действия|Действовать по догадке\tӘрекетке дейін жауапты адамнан нақтылау|Болжаммен әрекет ету\t1\t\t\t\t\tУточнение снимает неоднозначность и предотвращает потерю задачи.\tНақтылау екіұштылықты жойып, тапсырманың жоғалуын болдырмайды.\tОригинальный методический пример DEMO\t\t";
    const upload = page.getByLabel("Таблица вопросов", { exact: true });
    const invalid = `${header}\n${row}\nSINGLE\tПередача смены\t\tНеполная строка\tТолық емес жол`;
    await upload.setInputFiles({ name: "questions-invalid.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from(invalid) });
    await page.getByRole("button", { name: "Проверить таблицу", exact: true }).click();
    await page.getByText(/Неполная строка.*проверьте переводы и правила оценки/).waitFor();
    if (await page.getByRole("button", { name: /^Сохранить вопросы/ }).isEnabled()) throw new Error("INVALID_IMPORT_CAN_SAVE");
    const valid = `${header}\n${row}\n${row}`;
    for (let index = 0; index < 2; index++) {
      await upload.setInputFiles({ name: "questions-valid.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from(valid) });
      await page.getByRole("button", { name: "Проверить таблицу", exact: true }).click();
      await page.getByText(/Повтор в файле/).waitFor();
      const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/lms/questions/import") && response.request().postDataJSON()?.commit === true);
      await page.getByRole("button", { name: /^Сохранить вопросы/ }).click();
      const response = await responsePromise; if (!response.ok()) throw new Error(`IMPORT_HTTP_${response.status()}`);
      await page.getByText(/Сохранено вопросов: 1/).waitFor();
    }
    await page.reload();
    await page.getByLabel("Поиск", { exact: true }).fill("следующий шаг передачи");
    const matches = page.getByText("Что сделать, если следующий шаг передачи непонятен?", { exact: true });
    await matches.waitFor(); if (await matches.count() !== 1) throw new Error("IMPORT_DUPLICATE");
    output.push({ invalidRowsBlocked: true, duplicateRowMerged: true, repeatedImportMerged: true, matchingQuestions: 1 });
  }
  if (stage === "source-review") {
    await page.goto(base + "/lms/regulatory");
    await page.getByRole("button", { name: "Проверить редакцию", exact: true }).click();
    await page.getByLabel("Основание проверки / описание изменения", { exact: true }).fill("Карточка и официальная ссылка проверены. Применимость к программе и актуальность содержания требуют юридической проверки; статус остаётся «Требует проверки».");
    const responsePromise = page.waitForResponse(response => response.url().includes("/api/lms/regulatory-sources/") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить редакцию", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`SOURCE_REVIEW_HTTP_${response.status()}`);
    const revision = await response.json();
    if (revision.version !== 2 || revision.definition.status !== "REVIEW_REQUIRED" || !revision.checkedAt) throw new Error("SOURCE_REVIEW_STATE");
    await page.reload();
    await page.getByText("История редакций (2)", { exact: true }).click();
    await page.getByText(/Применимость к программе и актуальность содержания требуют юридической проверки/).waitFor();
    output.push({ immutableNewRevision: 2, status: "REVIEW_REQUIRED", checkedAt: !!revision.checkedAt, legalCurrentNotAsserted: true });
  }
  if (stage === "course") {
    let savedCourse = await fs.readFile(path.join(runtime, courseFile), "utf8").then(JSON.parse).catch(() => null);
    if (!savedCourse) {
      await page.goto(base + "/lms");
      await page.getByRole("button", { name: "Создать программу", exact: true }).click();
      await page.waitForURL(/\/lms\/courses\//);
      savedCourse = { courseId: new URL(page.url()).pathname.split("/").at(-1) };
      await fs.writeFile(path.join(runtime, courseFile), JSON.stringify(savedCourse));
    } else await page.goto(base + `/lms/courses/${savedCourse.courseId}`);
    await page.getByLabel("Название RU", { exact: false }).fill(titleRu);
    await page.getByLabel("Название KZ", { exact: false }).fill(titleKz);
    await page.getByLabel("Описание RU", { exact: false }).fill("Короткая рабочая программа по передаче незавершённых задач без потери ответственности и контекста. Учебный результат; нормативная квалификация не присваивается.");
    await page.getByLabel("Описание KZ", { exact: false }).fill("Жауапкершілік пен мәнмәтінді жоғалтпай аяқталмаған тапсырмаларды тапсыру бойынша қысқа оқу бағдарламасы. Оқу нәтижесі; нормативтік біліктілік берілмейді.");
    if (supervised) {
      await page.getByText("Основание и оформление", { exact: true }).click();
      await page.getByLabel("Оценка", { exact: false }).selectOption("PRACTICE");
      await page.getByLabel("Требуется практика", { exact: true }).check();
      await page.getByLabel("Основание подтверждения практики", { exact: false }).selectOption("IN_PERSON");
      await page.getByLabel("Требуется прокторинг", { exact: true }).check();
      await page.getByLabel("Способ контроля экзамена", { exact: false }).selectOption("LOCAL_SUPERVISED");
      await page.getByLabel("Основание проверки", { exact: true }).fill("Учебная симуляция работы интерфейса; не реальная проверка личности или физического присутствия. Документ квалификации не выдаётся.");
    }
    await page.getByRole("button", { name: "Содержание", exact: true }).click();
    const modules = page.getByRole("group", { name: "Модули и уроки", exact: true });
    if (!await modules.getByLabel("Модуль RU", { exact: true }).count()) await modules.getByRole("button", { name: "Добавить модуль", exact: true }).click();
    await modules.getByLabel("Модуль RU", { exact: false }).fill("Надёжная передача рабочего контекста");
    await modules.getByLabel("Модуль KZ", { exact: false }).fill("Жұмыс мәнмәтінін сенімді тапсыру");
    if (!await modules.getByLabel("Урок RU", { exact: true }).count()) await modules.getByRole("button", { name: "Добавить урок", exact: true }).click();
    const lesson = modules.getByRole("group", { name: "Урок 1", exact: true });
    if (supervised) await lesson.getByLabel("Тип элемента", { exact: false }).selectOption("SESSION");
    await lesson.getByLabel("Урок RU", { exact: false }).fill("Три записи, которые нужны следующей смене");
    await lesson.getByLabel("Урок KZ", { exact: false }).fill("Келесі ауысымға қажет үш жазба");
    await lesson.getByLabel("Текст RU", { exact: false }).fill("При передаче незавершённой задачи зафиксируйте три вещи: что уже сделано, кто принимает ответственность и какое следующее действие согласовано. Начните с краткого проверяемого состояния: «Проверены две заявки из трёх; третья ждёт уточнения адреса». Назовите ответственного по роли или имени и срок следующего шага. Попросите принимающего повторить задачу своими словами. Если условия непонятны, уточните их до начала действия. Не подменяйте передачу формулировкой «там всё понятно»: она не сообщает ни состояния, ни ответственности. Практический пример: уходящая смена записывает номер заявки, причину ожидания и кому передан звонок клиенту. Принимающая смена подтверждает получение и начинает с указанного шага. Эта методическая карта описывает рабочую коммуникацию, а не нормативную инструкцию по безопасности.");
    await lesson.getByLabel("Текст KZ", { exact: false }).fill("Аяқталмаған тапсырманы тапсыру кезінде үш нәрсені тіркеңіз: не орындалды, жауапкершілікті кім қабылдайды және қандай келесі әрекет келісілді. Тексерілетін қысқа күйден бастаңыз: «Үш өтінімнің екеуі тексерілді; үшіншісі мекенжайды нақтылауды күтуде». Жауапты адамды рөлі немесе аты бойынша және келесі қадамның мерзімін көрсетіңіз. Қабылдаушыдан тапсырманы өз сөзімен қайталауын сұраңыз. Шарттар түсініксіз болса, әрекетке дейін нақтылаңыз. Тапсыруды «бәрі түсінікті» деген сөзбен алмастырмаңыз: ол күйді де, жауапкершілікті де көрсетпейді. Мысал: кетіп бара жатқан ауысым өтінім нөмірін, күту себебін және клиентке қоңырау шалуды кімге тапсырғанын жазады. Қабылдаушы ауысым алғанын растап, көрсетілген қадамнан бастайды. Бұл әдістемелік карта нормативтік қауіпсіздік нұсқаулығын емес, жұмыс байланысын сипаттайды.");
    await page.getByRole("button", { name: "Итоговая проверка", exact: true }).click();
    await page.getByText("Выбрать из банка вопросов", { exact: true }).click();
    const bankRow = page.locator("li").filter({ hasText: "Какие сведения передают следующей смене по незавершённой задаче?" });
    await bankRow.getByRole("button", { name: "Использовать", exact: true }).click();
    await page.getByRole("button", { name: "Условия", exact: true }).click();
    await page.getByText("Цели, аудитория и параметры программы", { exact: true }).click();
    await page.getByLabel(/Итог программы/).selectOption(supervised ? "REGULATED" : "LEARNING");
    if (variant === "prerequisite-b") {
      await page.getByLabel("Продолжительность программы, дней", { exact: true }).fill("2");
      const prerequisite = JSON.parse(await fs.readFile(path.join(runtime, "prerequisite-a-course.private.json"), "utf8"));
      await page.getByText("Предыдущие курсы", { exact: true }).click();
      await page.getByLabel("Добавить предварительный курс", { exact: false }).selectOption(prerequisite.courseId);
    }
    await page.getByRole("button", { name: "Публикация", exact: true }).click();
    const submitResponse = page.waitForResponse(response => response.url().endsWith("/review") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Отправить на проверку", exact: true }).click();
    const response = await submitResponse; if (!response.ok()) throw new Error(`COURSE_SUBMIT_HTTP_${response.status()}: ${(await response.json()).message}`);
    const version = await response.json(); savedCourse.versionId = version.id;
    await fs.writeFile(path.join(runtime, courseFile), JSON.stringify(savedCourse));
    await page.getByText("Согласование: На проверке", { exact: true }).waitFor();
    output.push({ courseId: savedCourse.courseId, versionId: version.id, submittedFromUi: true, reusedStandaloneBank: true });
  }
  if (stage === "publish") {
    const course = JSON.parse(await fs.readFile(path.join(runtime, courseFile), "utf8"));
    await page.goto(base + `/lms/courses/${course.courseId}?section=review`);
    await page.getByRole("button", { name: "Публикация", exact: true }).click();
    await page.getByLabel("Комментарий к решению", { exact: true }).fill("Проверены двуязычный материал и самостоятельный вопрос. Содержание соответствует учебной цели передачи смены; нормативный документ не выдаётся.");
    await page.getByRole("button", { name: "Одобрить редакцию", exact: true }).click();
    await page.getByText("Согласование: Одобрена текущая редакция", { exact: true }).waitFor();
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/publish") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`COURSE_PUBLISH_HTTP_${response.status()}`);
    await page.getByRole("button", { name: "Создать новую версию", exact: true }).waitFor();
    output.push({ courseId: course.courseId, publishedFromUi: true, responseStatus: response.status() });
  }
  if (stage === "configure-prerequisite") {
    const course = JSON.parse(await fs.readFile(path.join(runtime, courseFile), "utf8"));
    const prerequisite = JSON.parse(await fs.readFile(path.join(runtime, "prerequisite-a-course.private.json"), "utf8"));
    await page.goto(base + `/lms/courses/${course.courseId}`);
    await page.getByRole("button", { name: "Условия", exact: true }).click();
    await page.getByText("Предыдущие курсы", { exact: true }).click();
    await page.getByLabel("Добавить предварительный курс", { exact: false }).selectOption(prerequisite.courseId);
    await page.getByRole("button", { name: "Публикация", exact: true }).click();
    const saved = page.waitForResponse(response => response.url().endsWith("/review") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Отправить на проверку", exact: true }).click();
    const response = await saved; if (!response.ok()) throw new Error(`COURSE_REVIEW_${response.status()}`);
    const version = await response.json(); course.versionId = version.id;
    await fs.writeFile(path.join(runtime, courseFile), JSON.stringify(course));
    output.push({ courseId: course.courseId, versionId: version.id, prerequisiteCourseId: prerequisite.courseId, durationDays: version.content.metadata.durationDays, submittedFromUi: true });
  }
  if (stage === "assign") {
    const course = JSON.parse(await fs.readFile(path.join(runtime, courseFile), "utf8"));
    await page.goto(base + `/lms/assign?versionId=${course.versionId}`);
    await page.getByLabel("Найти сотрудника", { exact: true }).fill(privateData.users.learner.displayName);
    await page.getByRole("checkbox", { name: privateData.users.learner.displayName, exact: true }).check();
    await page.getByText("Группа и сроки · по правилам программы", { exact: true }).click();
    await page.getByLabel("Название группы · необязательно", { exact: true }).fill(variant ? `${titleRu} · учебный состав` : supervised ? "Учебная симуляция · наблюдаемый практикум" : "Передача смены · первый учебный состав");
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/lms/enrollments") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Назначить обучение · 1", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`ASSIGN_HTTP_${response.status()}`);
    const result = await response.json();
    await page.getByText(/Назначено: 1/).waitFor();
    await fs.writeFile(path.join(runtime, `${filePrefix}-assignment.private.json`), JSON.stringify(result));
    output.push({ created: result.created, state: result.state, assignedFromUi: true });
  }
  if (stage === "learner") {
    await page.goto(base + "/learn");
    const card = page.locator("li").filter({ hasText: titleRu });
    await card.getByRole("link", { name: /обучение/ }).click();
    await page.waitForURL(/\/learn\/[^/]+$/);
    const enrollmentId = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByRole("button", { name: "Изучено, дальше", exact: true }).click();
    await page.getByRole("button", { name: "Начать итоговый тест", exact: true }).click();
    await page.getByLabel("Указать состояние, ответственного и следующий шаг в журнале передачи", { exact: true }).check();
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/submit") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Завершить попытку", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`FINISH_HTTP_${response.status()}`);
    const attempt = await response.json();
    await page.getByText("Разбор ответов", { exact: true }).waitFor();
    output.push({ enrollmentId, state: attempt.state, verdict: attempt.verdict, completedFromUi: true });
  }
  if (stage === "learner-result") {
    await page.goto(base + "/learn");
    const card = page.locator("li").filter({ hasText: titleRu });
    await card.getByRole("link", { name: "Результат и документы", exact: true }).click();
    await page.waitForURL(/\/learn\/[^/]+$/);
    const enrollmentId = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByText("Учебная программа завершена", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Разобрать попытку 1", exact: true }).click();
    await page.getByText("Разбор ответов", { exact: true }).waitFor();
    await page.getByText("Ваш ответ:", { exact: true }).waitFor();
    await page.getByText("По правилам этой попытки правильные ответы и объяснения не раскрываются.", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); if (overflow) throw new Error("REVIEW_MOBILE_OVERFLOW");
    await page.screenshot({ path: path.join(evidence, "ui-review-mobile-ru.png"), fullPage: true });
    await page.getByRole("button", { name: "KZ", exact: true }).click();
    await page.getByText("Аяқталмаған тапсырманы келесі ауысымға қалай тапсыру керек?", { exact: false }).waitFor();
    await page.screenshot({ path: path.join(evidence, "ui-review-mobile-kz.png"), fullPage: true });
    output.push({ enrollmentId, completedReload: true, attemptReviewReload: true, answerKeysHiddenByPolicy: true, mobile: 390, overflow, languages: ["RU", "KZ"] });
  }
  if (stage === "bind") {
    const course = JSON.parse(await fs.readFile(path.join(runtime, courseFile), "utf8"));
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    await page.goto(base + `/lms/learning-roles?courseId=${course.courseId}&groupId=${assignment.groupId}`);
    await page.getByLabel("Пользователь", { exact: false }).selectOption(privateData.users.teacher.id);
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/lms/learning-bindings") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Назначить роль", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`BIND_HTTP_${response.status()}: ${(await response.json()).message}`);
    await page.getByText("Учебные полномочия назначены", { exact: true }).waitFor();
    output.push({ teacherBoundToGroup: true, groupId: assignment.groupId });
  }
  if (stage === "event") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    await page.goto(base + `/lms/groups/${assignment.groupId}`);
    await page.getByRole("button", { name: "Назначить занятие", exact: true }).click();
    await page.getByLabel("Требование программы", { exact: false }).selectOption({ label: "Три записи, которые нужны следующей смене" });
    await page.getByLabel("Название на русском", { exact: true }).fill("Симуляция передачи смены по двум критериям");
    await page.getByLabel("Название на казахском", { exact: true }).fill("Екі критерий бойынша ауысымды тапсыру симуляциясы");
    await page.getByLabel("Преподаватель", { exact: false }).selectOption(privateData.users.teacher.id);
    await page.getByLabel("Часовой пояс", { exact: true }).fill("UTC");
    await page.getByLabel("Начало занятия", { exact: true }).fill(new Date(Date.now() - 20 * 60000).toISOString().slice(0,16));
    await page.getByLabel("Окончание занятия", { exact: true }).fill(new Date(Date.now() - 5 * 60000).toISOString().slice(0,16));
    await page.getByLabel("Место проведения", { exact: true }).fill("Учебная симуляция интерфейса; физическое занятие не проводилось");
    await page.getByText("Критерии очной практики", { exact: true }).click();
    await page.getByRole("button", { name: "Добавить критерий", exact: true }).click();
    await page.getByLabel("Критерий RU 1", { exact: true }).fill("Названы состояние задачи и следующий согласованный шаг");
    await page.getByLabel("Критерий KZ 1", { exact: true }).fill("Тапсырма күйі және келісілген келесі қадам аталды");
    await page.getByRole("button", { name: "Добавить критерий", exact: true }).click();
    await page.getByLabel("Критерий RU 2", { exact: true }).fill("Назван ответственный и получено подтверждение понимания");
    await page.getByLabel("Критерий KZ 2", { exact: true }).fill("Жауапты адам аталып, түсіну расталды");
    let material = null;
    if (variant !== "attendance") {
    const uploadPromise = page.waitForResponse(response => response.url().endsWith("/recordings") && response.request().method() === "POST");
    await page.getByLabel("Загрузить запись занятия", { exact: true }).setInputFiles({ name: "simulation-training-material.mp4", mimeType: "video/mp4", buffer: await fs.readFile(path.join(runtime, "content/biot-observation.mp4")) });
    const upload = await uploadPromise; if (!upload.ok()) throw new Error(`RECORDING_UPLOAD_HTTP_${upload.status()}`);
    material = await upload.json();
    }
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/lms/teaching-events") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Назначить и уведомить", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`EVENT_HTTP_${response.status()}: ${(await response.json()).message}`);
    const event = await response.json();
    await fs.writeFile(path.join(runtime, `${filePrefix}-event.private.json`), JSON.stringify({ event, materialId: material?.id }));
    await page.reload();
    await page.getByRole("button", { name: "Открыть занятие и участие", exact: true }).click();
    if (material) await page.getByText("Посмотреть запись", { exact: true }).waitFor();
    output.push({ eventId: event.id, eventReload: true, privateRecordingMaterialId: material?.id, simulatedEvent: true, realPhysicalAttendanceNotClaimed: true });
  }
  if (stage === "attendance-only") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    await page.goto(base + `/lms/groups/${assignment.groupId}`);
    await page.getByRole("button", { name: "Открыть занятие и участие", exact: true }).click();
    await page.getByRole("checkbox", { name: privateData.users.learner.displayName, exact: true }).check();
    await page.getByLabel("Основание отметки или исправления", { exact: true }).fill("Учебная симуляция участия; присутствие не подтверждает практические навыки. Оценка практики ещё не выполнена.");
    const saved = page.waitForResponse(response => response.url().endsWith("/attendance") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Подтвердить участие выбранных · 1", exact: true }).click();
    const response = await saved; if (!response.ok()) throw new Error(`ATTENDANCE_${response.status()}`);
    await page.reload();
    await page.getByRole("button", { name: "Открыть занятие и участие", exact: true }).click();
    await page.getByText("Участвовал", { exact: true }).first().waitFor();
    output.push({ attendanceRecordedFromUi: true, practiceNotReviewed: true, simulatedOnly: true });
  }
  if (stage === "attendance-denied") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    const enrollmentId = assignment.items[0].id;
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/learn/enrollments/${enrollmentId}`));
    await page.goto(base + `/learn/${enrollmentId}`);
    const data = await (await saved).json();
    if (data.examReadiness.reasonCode !== "IN_PERSON_PRACTICE_REQUIRED") throw new Error(`WRONG_ADMISSION_REASON_${data.examReadiness.reasonCode}`);
    const start = page.getByRole("button", { name: "Начать учебный тест", exact: true });
    await start.waitFor(); if (await start.isEnabled()) throw new Error("ATTENDANCE_UNLOCKED_PRACTICE_EXAM");
    await page.getByText("Для допуска требуется подтверждение очной практики учебным центром.", { exact: false }).waitFor();
    const denied = await context.request.post(base + `/api/learn/enrollments/${enrollmentId}/attempts`, { headers: { "x-csrf-token": csrfToken, "content-type": "application/json", origin: base }, data: {} });
    const denial = await denied.json();
    if (denied.status() !== 409 || denial.params?.reason !== "IN_PERSON_PRACTICE_REQUIRED") throw new Error(`PRACTICE_DIRECT_NOT_DENIED_${denied.status()}_${JSON.stringify(denial)}`);
    output.push({ attendancePresent: true, supervisorAdmissionAlreadyRecorded: true, practiceAccepted: false, examButtonDisabled: true, reasonCode: data.examReadiness.reasonCode, directStartDenied: denied.status(), denialReason: denial.params.reason, existingAttempts: data.attempts.length });
  }
  if (stage === "attendance-readback") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    await page.goto(base + `/lms/groups/${assignment.groupId}`);
    const saved = page.waitForResponse(response => response.url().includes("/attendance?") && response.request().method() === "GET");
    await page.getByRole("button", { name: "Открыть занятие и участие", exact: true }).click();
    const data = await (await saved).json();
    const row = data.items.find(item => item.enrollmentId === assignment.items[0].id);
    if (row?.status !== "PRESENT") throw new Error("ATTENDANCE_NOT_PRESENT");
    await page.getByText("Участвовал", { exact: true }).first().waitFor();
    output.push({ attendancePresentAfterReload: true, practiceNotReviewed: true, simulatedOnly: true });
  }
  if (stage === "practice") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, "supervised-assignment.private.json"), "utf8"));
    await page.goto(base + `/lms/groups/${assignment.groupId}`);
    await page.getByRole("button", { name: "Открыть занятие и участие", exact: true }).click();
    await page.getByRole("checkbox", { name: privateData.users.learner.displayName, exact: true }).check();
    await page.getByLabel("Основание отметки или исправления", { exact: true }).fill("Учебная симуляция участия для проверки интерфейса; физическое присутствие не утверждается.");
    const attendancePromise = page.waitForResponse(response => response.url().endsWith("/attendance") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Подтвердить участие выбранных · 1", exact: true }).click();
    const attendance = await attendancePromise; if (!attendance.ok()) throw new Error(`ATTENDANCE_HTTP_${attendance.status()}`);
    await page.getByRole("button", { name: "Оценить", exact: true }).click();
    await page.getByLabel("Названы состояние задачи и следующий согласованный шаг", { exact: false }).selectOption("YES");
    await page.getByLabel("Назван ответственный и получено подтверждение понимания", { exact: false }).selectOption("YES");
    await page.getByLabel("Результат наблюдения и замечания", { exact: false }).fill("Учебная симуляция оценки: пример содержит состояние, ответственного, следующий шаг и подтверждение. Не является оценкой реального человека или физического занятия.");
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/practice") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Зачесть практику", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`PRACTICE_HTTP_${response.status()}: ${(await response.json()).message}`);
    await page.getByText("Зачтено", { exact: true }).waitFor();
    output.push({ attendanceRecorded: true, practiceAcceptedSeparately: true, simulatedEvent: true });
  }
  if (["before-admission", "recording"].includes(stage)) {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, "supervised-assignment.private.json"), "utf8"));
    await page.goto(base + `/learn/${assignment.items[0].id}`);
    if (stage === "before-admission") {
      const start = page.getByRole("button", { name: "Начать учебный тест", exact: true });
      await start.waitFor(); if (await start.isEnabled()) throw new Error("EXAM_OPEN_WITHOUT_ADMISSION");
      await page.getByText(/Откройте журнал контроля экзамена/).waitFor();
    }
    await page.getByRole("button", { name: "Материалы и задания", exact: true }).click();
    await page.getByText(/Практика зачтена/).waitFor();
    await page.getByText("Посмотреть запись", { exact: true }).click();
    const recording = page;
    await recording.locator("video").scrollIntoViewIfNeeded();
    await recording.waitForFunction(() => { const video=document.querySelector("video"); return video && Number.isFinite(video.duration) && video.duration > 0; });
    const duration = await recording.locator("video").evaluate(video => video.duration);
    if (!Number.isFinite(duration) || duration < 150) throw new Error("RECORDING_NOT_REAL_MEDIA");
    const bounds = await recording.locator("video").boundingBox();
    await recording.mouse.click(bounds.x + 24, bounds.y + bounds.height - 29);
    await recording.waitForFunction(() => { const video=document.querySelector("video"); return video && video.currentTime >= 2 && !video.paused; });
    const playedSeconds = await recording.locator("video").evaluate(video => video.currentTime);
    await recording.screenshot({ path: path.join(evidence, "ui-private-recording-playing.png") });
    output.push({ playedSeconds, missingProctorAdmissionBlocked: stage === "before-admission", acceptedPracticeVisible: true, privateRecordingOpened: true, recordingDurationSeconds: duration });
  }
  if (["proctor-assign", "proctor-admit", "proctor-approve"].includes(stage)) {
    await page.goto(base + "/lms/teaching");
    const queueResponse = page.waitForResponse(response => response.url().includes("/api/lms/proctoring?"));
    await page.getByRole("button", { name: "Контроль экзамена", exact: true }).click();
    const queue = await (await queueResponse).json();
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    const targetIndex = queue.items.findIndex(item => item.id === assignment.items[0].id);
    if (targetIndex < 0) throw new Error("PROCTOR_QUEUE_TARGET_MISSING");
    await page.getByRole("button", { name: "Открыть сессию", exact: true }).nth(targetIndex).click();
    const feedback = page.getByLabel("Основание / замечания / решение", { exact: false });
    if (stage === "proctor-assign") {
      await page.getByLabel("Наблюдатель", { exact: false }).selectOption(privateData.users.teacher.id);
      await feedback.fill("Учебная симуляция интерфейса. Назначен учебный аккаунт преподавателя; реальная проверка личности и физическое наблюдение не выполняются.");
    } else if (stage === "proctor-admit") {
      if (await page.getByRole("button", { name: "Подтвердить личность и допустить", exact: true }).isEnabled()) throw new Error("ADMIT_ENABLED_WITHOUT_ATTESTATIONS");
      await page.getByLabel("Личность слушателя проверена по документу лично", { exact: true }).check();
      await page.getByLabel("Подтверждаю присутствие и наблюдение; замечания проверены", { exact: true }).check();
      await feedback.fill("Учебная симуляция допуска тестового аккаунта. Поля подтверждения проверяются как функциональность, реальная идентификация человека не заявляется.");
    } else {
      await feedback.fill("Учебная симуляция: ответы отправлены, событие сеанса отмечено; фактическое наблюдение человека не утверждается.");
      const incident = page.waitForResponse(response => response.url().endsWith("/proctoring") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Записать событие / замечание", exact: true }).click();
      if (!(await incident).ok()) throw new Error("PROCTOR_INCIDENT_FAILED");
      await page.getByLabel("Подтверждаю присутствие и наблюдение; замечания проверены", { exact: true }).check();
      await feedback.fill("Учебная симуляция решения по конкретной отправленной попытке. Проверена работа UI журнала; личное наблюдение человека не заявляется.");
    }
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/proctoring") && response.request().method() === "POST");
    const action = stage === "proctor-assign" ? "Назначить наблюдателя и время" : stage === "proctor-admit" ? "Подтвердить личность и допустить" : "Подтвердить попытку для оценки";
    await page.getByRole("button", { name: action, exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`PROCTOR_HTTP_${response.status()}: ${(await response.json()).message}`);
    const session = await response.json();
    output.push({ decision: session.history[0].decision, simulationOnly: true, realIdentityVerificationNotClaimed: true });
  }
  if (stage === "exam") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, "supervised-assignment.private.json"), "utf8"));
    await page.goto(base + `/learn/${assignment.items[0].id}`);
    await page.getByRole("button", { name: "Начать учебный тест", exact: true }).click();
    await page.getByLabel("Указать состояние, ответственного и следующий шаг в журнале передачи", { exact: true }).check();
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/submit") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Завершить попытку", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`EXAM_HTTP_${response.status()}: ${(await response.json()).message}`);
    const attempt = await response.json();
    if (attempt.state !== "AWAITING_REVIEW") throw new Error(`EXAM_SKIPPED_PROCTOR_REVIEW_${attempt.state}`);
    await fs.writeFile(path.join(runtime, "supervised-attempt.private.json"), JSON.stringify({ id: attempt.id, enrollmentId: assignment.items[0].id }));
    output.push({ attemptId: attempt.id, state: attempt.state, finalResultDeferred: true });
  }
  if (["grade-blocked", "grade"].includes(stage)) {
    const attempt = JSON.parse(await fs.readFile(path.join(runtime, "supervised-attempt.private.json"), "utf8"));
    await page.goto(base + `/lms/teaching?type=ATTEMPT&reviewId=${attempt.id}`);
    const submit = page.getByRole("button", { name: "Передать оценку слушателю", exact: true });
    await submit.waitFor();
    if (stage === "grade-blocked") {
      if (await submit.isEnabled()) throw new Error("GRADE_ENABLED_WITHOUT_PROCTOR_APPROVAL");
      output.push({ gradeBlockedUntilProctorApproval: true });
    } else {
      await page.getByLabel("Обратная связь слушателю", { exact: false }).fill("Учебная симуляция: выбран полный способ передачи задачи; критерии практики и журнал попытки сохранены. Это учебный результат, не документ квалификации.");
      const responsePromise = page.waitForResponse(response => response.url().endsWith("/decision") && response.request().method() === "POST");
      await submit.click();
      const response = await responsePromise; if (!response.ok()) throw new Error(`GRADE_HTTP_${response.status()}: ${(await response.json()).message}`);
      output.push({ explicitGradeAfterProctor: true, attemptId: attempt.id });
    }
  }
  if (stage === "result") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, "supervised-assignment.private.json"), "utf8"));
    await page.goto(base + `/learn/${assignment.items[0].id}`);
    await page.getByRole("button", { name: "Разобрать попытку 1", exact: true }).click();
    await page.getByText("Разбор ответов", { exact: true }).waitFor();
    await page.getByText("Сдано", { exact: true }).waitFor();
    await page.getByText(/Учебная симуляция: выбран полный способ передачи задачи/).waitFor();
    output.push({ completedAttemptReload: true, passed: true, teacherFeedbackVisible: true, learnerEnrollmentId: assignment.items[0].id, simulationOnly: true });
  }
  if (stage === "source-links") {
    const course = JSON.parse(await fs.readFile(path.join(runtime, "supervised-course.private.json"), "utf8"));
    const linked = [];
    for (let index = 0; index < 2; index++) {
      if (!index) {
        await page.goto(base + `/lms/courses/${course.courseId}`);
        await page.getByRole("button", { name: "Публикация", exact: true }).click();
        await page.getByRole("button", { name: "Создать новую версию", exact: true }).click();
        await page.getByText("Черновик · Версия 2", { exact: false }).waitFor();
        await page.getByRole("button", { name: "Сведения", exact: true }).click();
      } else {
        await page.goto(base + "/lms");
        await page.getByRole("button", { name: "Создать программу", exact: true }).click();
        await page.waitForURL(/\/lms\/courses\//);
        await page.getByLabel("Название RU", { exact: false }).fill("Черновик проверки общего источника: адаптация нового сотрудника");
        await page.getByLabel("Название KZ", { exact: false }).fill("Ортақ дереккөзді тексеру жобасы: жаңа қызметкерді бейімдеу");
      }
      await page.getByText("Основание и оформление", { exact: true }).click();
      await page.getByText("Выбрать источник из библиотеки", { exact: true }).click();
      const picker = page.getByLabel("Редакция: Трудовой кодекс Республики Казахстан — карточка проверки", { exact: true });
      await picker.locator("option").filter({ hasText: /^2\./ }).waitFor({ state: "attached" });
      const revisionId = await picker.locator("option").filter({ hasText: /^2\./ }).getAttribute("value");
      const responsePromise = page.waitForResponse(response => response.url().includes("/api/lms/course-versions/") && response.request().method() === "PUT");
      await picker.selectOption(revisionId);
      await page.getByRole("button", { name: "Условия", exact: true }).click();
      const response = await responsePromise; if (!response.ok()) throw new Error(`SOURCE_LINK_HTTP_${response.status()}`);
      linked.push({ courseId: new URL(page.url()).pathname.split("/").at(-1), sourceRevisionId: revisionId });
    }
    await fs.writeFile(path.join(runtime, "learning-source-links.private.json"), JSON.stringify(linked));
    output.push({ twoProgramsLinked: linked, existingPublishedVersionPreserved: true });
  }
  if (stage === "source-tasks") {
    await page.goto(base + "/lms/regulatory");
    await page.getByRole("button", { name: "Новая редакция", exact: true }).click();
    await page.getByLabel("Название редакции", { exact: false }).fill("План применимости к двум программам · 19.10.2026");
    await page.getByLabel("Основание проверки / описание изменения", { exact: false }).fill("Создана задача для ответственных программ. Реквизиты карточки проверены ранее; актуальность норм и применимость по-прежнему требуют юридической проверки.");
    const responsePromise = page.waitForResponse(response => response.url().includes("/api/lms/regulatory-sources/") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить редакцию", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`SOURCE_REVISION_HTTP_${response.status()}`);
    await page.getByRole("button", { name: "Решение по задаче", exact: true }).nth(1).waitFor();
    if (await page.getByRole("button", { name: "Решение по задаче", exact: true }).count() !== 2) throw new Error("SOURCE_TASKS_NOT_TWO");
    await page.getByRole("button", { name: "Решение по задаче", exact: true }).first().click();
    await page.getByLabel("Ответственный за программу", { exact: false }).selectOption(privateData.users.methodist.id);
    await page.getByLabel("Решение", { exact: false }).selectOption("IN_REVIEW");
    await page.getByLabel("Срок проверки", { exact: true }).fill("2026-11-02");
    await page.getByLabel("Обоснование решения", { exact: false }).fill("Методист сверит применимость источника. До отдельного решения действующее содержание и юридическая актуальность не подтверждаются.");
    const decisionPromise = page.waitForResponse(response => response.url().includes("/api/lms/regulatory-tasks/") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить решение", exact: true }).click();
    const decision = await decisionPromise; if (!decision.ok()) throw new Error(`SOURCE_TASK_HTTP_${decision.status()}`);
    await page.reload();
    await page.getByText(/Методист сверит применимость источника/).waitFor();
    output.push({ immutableRevision: 3, affectedPrograms: 2, assigneeSelected: true, dueAt: "2026-11-02", decision: "IN_REVIEW", reloadConfirmed: true, legalCurrentNotAsserted: true });
  }
  if (stage === "question-revision") {
    await page.goto(base + "/lms/questions");
    const row = page.locator("li").filter({ hasText: "Как передать незавершённую задачу следующей смене?" });
    await row.getByRole("button", { name: "Новая редакция", exact: true }).click();
    const editor = page.locator(".lms-question-author");
    await editor.getByLabel("Вопрос RU", { exact: false }).fill("Какие сведения передают следующей смене по незавершённой задаче?");
    await editor.getByLabel("Вопрос KZ", { exact: false }).fill("Аяқталмаған тапсырма бойынша келесі ауысымға қандай мәліметтер беріледі?");
    await editor.getByText("Объяснение и источник", { exact: true }).click();
    await editor.getByLabel("Объяснение RU", { exact: false }).fill("Получатель должен знать текущее состояние, ответственного и следующий согласованный шаг. Версия уточняет формулировку без изменения правила оценки.");
    await editor.getByLabel("Объяснение KZ", { exact: false }).fill("Қабылдаушы ағымдағы күйді, жауапты адамды және келісілген келесі қадамды білуі керек. Нұсқа бағалау ережесін өзгертпей тұжырымды нақтылайды.");
    const responsePromise = page.waitForResponse(response => response.url().includes("/api/lms/questions/") && response.url().endsWith("/revisions") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сохранить редакцию", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`QUESTION_REVISION_HTTP_${response.status()}`);
    const revision = await response.json();
    output.push({ newQuestionRevision: revision.version, revisionId: revision.id, oldAttemptWillBeReadSeparately: true });
  }
  if (stage === "course-revise") {
    const course = JSON.parse(await fs.readFile(path.join(runtime, "supervised-course.private.json"), "utf8"));
    await page.goto(base + `/lms/courses/${course.courseId}`);
    await page.getByText("Основание и оформление", { exact: true }).click();
    await page.getByText("Выбрать источник из библиотеки", { exact: true }).click();
    const picker = page.getByLabel("Редакция: Трудовой кодекс Республики Казахстан — карточка проверки", { exact: true });
    await picker.locator("option").filter({ hasText: /^3\./ }).waitFor({ state: "attached" });
    await picker.selectOption(await picker.locator("option").filter({ hasText: /^3\./ }).getAttribute("value"));
    await page.getByRole("button", { name: "Итоговая проверка", exact: true }).click();
    await page.getByText("Выбрать из банка вопросов", { exact: true }).click();
    const bankRow = page.locator("li").filter({ hasText: "Какие сведения передают следующей смене по незавершённой задаче?" });
    await bankRow.getByRole("button", { name: "Использовать", exact: true }).click();
    await page.getByRole("button", { name: "Публикация", exact: true }).click();
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/review") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Отправить на проверку", exact: true }).click();
    const response = await responsePromise; if (!response.ok()) throw new Error(`REVISION_SUBMIT_HTTP_${response.status()}: ${(await response.json()).message}`);
    const version = await response.json();
    await fs.writeFile(path.join(runtime, "supervised-course.private.json"), JSON.stringify({ ...course, originalVersionId: course.versionId, versionId: version.id }));
    output.push({ version: version.version, sourceRevision: 3, questionRevision: 2, submittedFromUi: true });
  }
  if (["history-before", "history-after"].includes(stage)) {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, "supervised-assignment.private.json"), "utf8"));
    const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/learn/enrollments/${assignment.items[0].id}`));
    await page.goto(base + `/learn/${assignment.items[0].id}`);
    const response = await responsePromise; if (!response.ok()) throw new Error(`HISTORY_HTTP_${response.status()}`);
    const data = await response.json();
    const stable = { courseVersion: data.courseVersion, attempts: data.attempts.map(attempt => ({ id: attempt.id, state: attempt.state, score: attempt.score, maximum: attempt.maximum, verdict: attempt.verdict, questions: attempt.questions, answers: attempt.answers, review: attempt.review })), results: data.results.map(result => ({ id: result.id, state: result.state, verdict: result.verdict, score: result.score, maximum: result.maximum })), documents: data.documents.map(document => ({ id: document.id, status: document.status })) };
    const digest = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
    const baseline = path.join(runtime, "supervised-history.private.json");
    if (stage === "history-before") await fs.writeFile(baseline, JSON.stringify({ digest, stable }));
    else if (JSON.parse(await fs.readFile(baseline, "utf8")).digest !== digest) throw new Error("HISTORICAL_LEARNER_STATE_CHANGED");
    await page.getByRole("button", { name: "Разобрать попытку 1", exact: true }).click();
    await page.getByText("Как передать незавершённую задачу следующей смене?", { exact: false }).waitFor();
    if (await page.getByText("Какие сведения передают следующей смене по незавершённой задаче?", { exact: false }).count()) throw new Error("OLD_ATTEMPT_USES_NEW_QUESTION");
    output.push({ originalCourseVersion: data.courseVersion.version, attemptCount: stable.attempts.length, resultCount: stable.results.length, documentCount: stable.documents.length, oldQuestionWordingPreserved: true, digest, comparedToBaseline: stage === "history-after" });
  }
  if (stage === "published-choice") {
    const course = JSON.parse(await fs.readFile(path.join(runtime, "supervised-course.private.json"), "utf8"));
    await page.goto(base + "/lms/applications");
    await page.getByRole("button", { name: "Создать заявку", exact: true }).click();
    const option = page.locator(`option[value="${course.originalVersionId}"]`);
    await option.waitFor({ state: "attached" });
    output.push({ originalPublishedVersionAvailableWhileDraftExists: true, originalVersionId: course.originalVersionId, option: await option.innerText() });
  }
  if (["blocked", "unlocked", "expired", "extended"].includes(stage)) {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    const enrollmentId = assignment.items[0].id;
    const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/learn/enrollments/${enrollmentId}`));
    await page.goto(base + `/learn/${enrollmentId}`);
    const response = await responsePromise; if (!response.ok()) throw new Error(`LEARNING_HTTP_${response.status()}`);
    const data = await response.json();
    const lessons = data.content.modules.flatMap(module => module.lessons);
    if (data.content.metadata?.durationDays !== 2) throw new Error("DURATION_DAYS_NOT_PRESERVED");
    await page.getByText(/Продолжительность программы: 2 дней/).waitFor();
    if (stage === "blocked" || stage === "expired") {
      const expected = stage === "blocked" ? "COURSE_PREREQUISITE_REQUIRED" : "ACCESS_CLOSED";
      if (!lessons.every(lesson => lesson.locked && lesson.lockReason === expected && !lesson.textRu && !lesson.textKz)) throw new Error(`EXPECTED_LOCK_${expected}`);
      if (stage === "blocked") await page.getByRole("link", { name: "Открыть базовый курс", exact: true }).waitFor();
      else await page.getByText(/Учебный доступ сейчас закрыт/).first().waitFor();
      if (!csrfToken) throw new Error("CSRF_NOT_CAPTURED_FROM_UI");
      const denied = await context.request.post(base + `/api/learn/enrollments/${enrollmentId}/attempts`, { headers: { "x-csrf-token": csrfToken, "content-type": "application/json", origin: base }, data: {} });
      const denial = await denied.json();
      if (denied.ok() || ![403,409].includes(denied.status()) || /CSRF/.test(denial.code || "")) throw new Error(`DIRECT_START_NOT_DOMAIN_DENIED_${denied.status()}_${denial.code}`);
      output.push({ enrollmentId, lessonLock: expected, lockedContentRedacted: true, directStartDenied: denied.status(), denialCode: denial.code, durationDays: data.content.metadata.durationDays });
    } else {
      if (!lessons.every(lesson => !lesson.locked && lesson.textRu)) throw new Error("COURSE_NOT_UNLOCKED");
      await page.getByRole("button", { name: "Изучено, дальше", exact: true }).waitFor();
      output.push({ enrollmentId, prerequisiteSatisfied: data.prerequisites.every(item => item.satisfied), contentAvailable: true, durationDays: data.content.metadata.durationDays, accessEndsAt: data.dueAt });
    }
  }
  if (["expiry-window", "extend-window"].includes(stage)) {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, `${filePrefix}-assignment.private.json`), "utf8"));
    await page.goto(base + `/lms/groups/${assignment.groupId}`);
    await page.getByText("Название и общий срок", { exact: true }).click();
    await page.getByLabel("Изменить общий период доступа", { exact: true }).check();
    await page.getByLabel("Режим доступа", { exact: false }).selectOption("FIXED");
    await page.getByLabel("Часовой пояс", { exact: false }).selectOption("UTC");
    const start = new Date(Date.now() - 3600000).toISOString().slice(0,16);
    const end = new Date(Date.now() + (stage === "expiry-window" ? 95000 : 86400000)).toISOString().slice(0,16);
    await page.getByLabel("Начало доступа", { exact: true }).fill(start);
    await page.getByLabel("Окончание доступа", { exact: true }).fill(end);
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/lms/groups/${assignment.groupId}`) && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const response = await saved; if (!response.ok()) throw new Error(`ACCESS_SAVE_${response.status()}`);
    await page.reload();
    output.push({ groupId: assignment.groupId, accessMode: "FIXED", timezone: "UTC", startsAt: start + ":00Z", endsAt: end + ":00Z", changedFromUi: true });
  }
  if (stage === "duration-views") {
    await page.goto(base + (role === "learner" ? "/learn" : "/lms"));
    const card = page.locator("li").filter({ hasText: titleRu });
    await card.getByText("Продолжительность: 2 дней", { exact: true }).waitFor();
    await page.getByRole("button", { name: "KZ", exact: true }).click();
    const translated = page.locator("li").filter({ hasText: titleKz });
    await translated.getByText("Ұзақтығы: 2 күн", { exact: true }).waitFor();
    output.push({ surface: role === "learner" ? "learner-list" : "staff-catalogue", durationDays: 2, languages: ["RU", "KZ"], distinctFromHoursAndAccess: true });
  }
  if (stage === "calendar-create") {
    const assignment = JSON.parse(await fs.readFile(path.join(runtime, "attendance-assignment.private.json"), "utf8"));
    await page.goto(base + `/lms/groups/${assignment.groupId}`);
    await page.getByRole("button", { name: "Назначить занятие", exact: true }).click();
    await page.getByLabel("Название на русском", { exact: true }).fill("Учебная консультация: уточнение передачи задачи");
    await page.getByLabel("Название на казахском", { exact: true }).fill("Оқу кеңесі: тапсырманы тапсыруды нақтылау");
    await page.getByLabel("Преподаватель", { exact: false }).selectOption(privateData.users.teacher.id);
    await page.getByLabel("Часовой пояс", { exact: true }).fill("UTC");
    await page.getByLabel("Начало занятия", { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0,16));
    await page.getByLabel("Окончание занятия", { exact: true }).fill(new Date(Date.now() + 90000000).toISOString().slice(0,16));
    await page.getByLabel("Место проведения", { exact: true }).fill("Учебное событие для проверки календаря; реальная встреча не проводится");
    const saved = page.waitForResponse(response => response.url().endsWith("/api/lms/teaching-events") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Назначить и уведомить", exact: true }).click();
    const response = await saved; if (!response.ok()) throw new Error(`CALENDAR_CREATE_${response.status()}`);
    const event = await response.json();
    await fs.writeFile(path.join(runtime, "calendar-event.private.json"), JSON.stringify(event));
    output.push({ eventId: event.id, startsAt: event.startsAt, createdThroughUi: true });
  }
  if (["calendar-move", "calendar-cancel"].includes(stage)) {
    const event = JSON.parse(await fs.readFile(path.join(runtime, "calendar-event.private.json"), "utf8"));
    await page.goto(base + `/lms/groups/${event.groupId}`);
    const row = page.locator("article.lms-event-row").filter({ hasText: event.titleRu });
    await row.getByRole("button", { name: "Открыть занятие и участие", exact: true }).click();
    await row.getByText("Изменить или отменить", { exact: true }).click();
    const saved = page.waitForResponse(response => response.url().includes(`/api/lms/teaching-events/${event.id}`) && ["PUT", "POST"].includes(response.request().method()));
    if (stage === "calendar-move") {
      await row.getByRole("button", { name: "Изменить расписание и ссылки", exact: true }).click();
      await page.getByLabel("Начало занятия", { exact: true }).fill(new Date(Date.parse(event.startsAt) + 86400000).toISOString().slice(0,16));
      await page.getByLabel("Окончание занятия", { exact: true }).fill(new Date(Date.parse(event.endsAt) + 86400000).toISOString().slice(0,16));
      await page.getByLabel("Причина изменения", { exact: true }).fill("Учебный перенос консультации на следующий день; проверка уведомления слушателю.");
      await page.getByRole("button", { name: "Сохранить и уведомить", exact: true }).click();
    } else {
      await row.getByLabel("Причина отмены", { exact: true }).fill("Учебная консультация отменена после проверки переноса; реальная встреча не планировалась.");
      await row.getByRole("button", { name: "Отменить и уведомить", exact: true }).click();
    }
    const response = await saved; if (!response.ok()) throw new Error(`CALENDAR_CHANGE_${response.status()}: ${(await response.json()).message}`);
    const changed = await response.json();
    await fs.writeFile(path.join(runtime, "calendar-event.private.json"), JSON.stringify(changed));
    await page.reload();
    await page.locator("article.lms-event-row").filter({ hasText: changed.titleRu }).getByRole("button", { name: "Открыть занятие и участие", exact: true }).click();
    output.push({ eventId: changed.id, status: changed.status, revision: changed.revision, startsAt: changed.startsAt, changedThroughUi: true, reloadConfirmed: true });
  }
  if (["calendar-moved-notification", "calendar-cancelled-notification"].includes(stage)) {
    const event = JSON.parse(await fs.readFile(path.join(runtime, "calendar-event.private.json"), "utf8"));
    const saved = page.waitForResponse(response => response.url().includes("/api/lms/notifications?page="));
    await page.goto(base + "/learn/notifications");
    const inbox = await (await saved).json();
    const kind = stage === "calendar-moved-notification" ? "UPDATED" : "CANCELLED";
    const notification = inbox.items.find(item => item.eventId === event.id && item.kind === kind);
    if (!notification) throw new Error(`EVENT_NOTIFICATION_MISSING_${kind}`);
    const row = page.locator("li").filter({ hasText: event.titleRu }).filter({ hasText: kind === "UPDATED" ? "Занятие изменено" : "Занятие отменено" }).first();
    await row.getByRole("link", { name: "Открыть", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/learn/calendar" && url.searchParams.get("eventId") === event.id);
    await page.locator(".lms-event-detail").getByRole("heading", { name: event.titleRu, exact: true }).waitFor();
    if (kind === "CANCELLED") await page.locator(".lms-event-detail").getByText(/Отменено/).first().waitFor();
    output.push({ eventId: event.id, notificationKind: kind, internalDeliveryVisible: true, exactEventLinkOpened: true, displayedState: event.status });
  }
  await page.screenshot({ path: path.join(evidence, `ui-${evidenceStage}-${role}.png`), fullPage: true });
  console.log(JSON.stringify({ stage, role, url: new URL(page.url()).pathname, output }, null, 2));
  await fs.writeFile(path.join(evidence, `ui-${evidenceStage}-${role}.json`), JSON.stringify({ stage, role, route: new URL(page.url()).pathname, output, completedAt: new Date().toISOString() }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(evidence, `ui-${evidenceStage}-${role}-failure.png`), fullPage: true }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally { await browser.close(); }
