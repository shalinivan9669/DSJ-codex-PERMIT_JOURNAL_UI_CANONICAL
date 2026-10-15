import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { loginRole } from "./operator-role-fixture";

test("first UI-authored synthetic sanitary course links registration, group assignment, private PDF, exam, real documents, QR and automatic list", async ({
  page: initialPage,
  browser,
}, testInfo) => {
  test.setTimeout(600000);
  let page = initialPage;
  const product = path.resolve(__dirname, "../../..");
  const evidence = process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-first-flow-live")
    : testInfo.outputDir;
  await fs.mkdir(evidence, { recursive: true });
  const workerLifecycle: Record<string, unknown>[] = [];
  let worker: ChildProcess | undefined;
  let workerOrdinal = 0;
  async function startWorker() {
    const target = new URL(process.env.DATABASE_URL || "");
    expect(process.env.DEMO_LMS_TEST_RUNTIME).toBe("1");
    expect(["127.0.0.1", "localhost"]).toContain(target.hostname);
    expect(target.pathname).toMatch(/^\/demo_test/);
    workerOrdinal++;
    const stdout = createWriteStream(
      path.join(evidence, `worker-${workerOrdinal}-stdout.log`),
    );
    const stderr = createWriteStream(
      path.join(evidence, `worker-${workerOrdinal}-stderr.log`),
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(product, "apps/integration-worker/src/main.ts"),
      ],
      {
        cwd: product,
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: path.join(product, "tsconfig.base.json"),
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    worker = child;
    child.stdout!.pipe(stdout);
    child.stderr!.pipe(stderr);
    child.once("close", () => {
      stdout.end();
      stderr.end();
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    workerLifecycle.push({
      event: "STARTED",
      pid: child.pid,
      ordinal: workerOrdinal,
      at: new Date().toISOString(),
      executable: process.execPath,
      entrypoint: "apps/integration-worker/src/main.ts",
      shell: false,
    });
    expect(child.pid).toBeGreaterThan(0);
  }
  async function stopWorker(reason: string) {
    const child = worker;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `OWNED_WORKER_EXITED_BEFORE_STOP:${child.exitCode}:${child.signalCode}`,
      );
    const stopped = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("OWNED_WORKER_STOP_TIMEOUT")),
        30000,
      );
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        workerLifecycle.push({
          event: "STOPPED",
          pid: child.pid,
          ordinal: workerOrdinal,
          at: new Date().toISOString(),
          reason,
          code,
          signal,
        });
        resolve();
      });
    });
    child.kill("SIGTERM");
    await stopped;
    worker = undefined;
  }
  function readAutomaticState(resultId: string) {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(product, "scripts/verification/lms-first-flow-readback.ts"),
          resultId,
        ],
        {
          cwd: product,
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: path.join(product, "tsconfig.base.json"),
          },
          windowsHide: true,
          encoding: "utf8",
        },
      ),
    );
  }
  let applicationDialogs = 0;
  let nativeDialogs = 0;
  const observedPages = new Map<Page, number>();
  const observeDialogs = (observedPage: Page) => {
    if (observedPages.has(observedPage)) return;
    observedPages.set(observedPage, 0);
    observedPage.on("dialog", async (dialog) => {
      nativeDialogs++;
      await dialog.dismiss();
    });
  };
  observeDialogs(page);
  page.context().on("page", observeDialogs);
  const suffix = randomUUID().slice(0, 8),
    prefix = `Синтетический ${suffix}`;
  const pdf = path.join(evidence, "synthetic-lesson.pdf");
  execFileSync(
    process.env.DEMO_PYTHON!,
    [
      "-c",
      "import sys, fitz; d=fitz.open(); p=d.new_page(); p.insert_text((60,60),'Synthetic LMS lesson for local engineering acceptance.'); p.insert_text((60,85),'This file is not approved professional or legal content.'); d.save(sys.argv[1]); d.close()",
      pdf,
    ],
    { windowsHide: true },
  );
  const actions: {
    phase: string;
    role: string;
    kind: string;
    target: string;
    elapsedMilliseconds: number;
  }[] = [];
  let phase = "course and calendar first entry",
    role = "DIRECTOR";
  let started = 0;
  async function act(
    kind: string,
    target: string,
    run: () => Promise<unknown>,
  ) {
    await run();
    for (const [observedPage, previousVisible] of observedPages) {
      if (observedPage.isClosed()) continue;
      const visible = await observedPage
        .locator('[role="dialog"]:visible,dialog[open]')
        .count();
      applicationDialogs += Math.max(0, visible - previousVisible);
      observedPages.set(observedPage, visible);
    }
    actions.push({
      phase,
      role,
      kind,
      target,
      elapsedMilliseconds: performance.now() - started,
    });
  }
  const click = (locator: Locator, target: string) =>
    act("click", target, () => locator.click());
  const fill = (p: Page, name: string, value: string) =>
    act("field", name, () => p.getByLabel(name, { exact: true }).fill(value));
  const choose = (p: Page, name: string, value: string) =>
    act("selection", name, () =>
      p.getByRole("combobox", { name, exact: true }).selectOption(value),
    );
  const go = (p: Page, url: string) =>
    act("navigation", "Open task page", () => p.goto(url));
  const arrived = (target: string) =>
    actions.push({
      phase,
      role,
      kind: "navigation",
      target,
      elapsedMilliseconds: performance.now() - started,
    });
  await loginRole(page, "DIRECTOR");
  started = performance.now();
  phase = "one-time center template review";
  const centerSetupStarted = performance.now();
  const templateLabels = [
    ["lms-protocol", "Обучение — протокол результата"],
    ["lms-certificate", "Обучение — сертификат центра"],
    ["lms-credential", "Обучение — удостоверение центра"],
  ];
  const initialTemplates = await (
    await page.request.get("/api/settings/templates")
  ).json();
  await go(page, "/settings");
  await click(
    page.getByRole("button", { name: "Формы", exact: true }),
    "Open center document forms",
  );
  for (const [templateId, label] of templateLabels) {
    const article = page.locator(".template-list article").filter({
      has: page.getByRole("heading", { name: label, exact: true }),
    });
    await expect(article).toBeVisible();
    await click(
      article.locator("summary"),
      `Review center template contract: ${templateId}`,
    );
    await expect(article.locator("pre")).toBeVisible();
    const approve = article.getByRole("button", {
      name: "Подтвердить форму",
      exact: true,
    });
    if (await approve.isVisible())
      await click(approve, `Confirm center template: ${templateId}`);
    await expect(
      article.getByText("Подтверждена", { exact: true }),
    ).toBeVisible();
  }
  const setupActions = actions.filter((action) => action.phase === phase);
  const centerTemplateReview = {
    role: "DIRECTOR",
    phase,
    goal: "Review the three installed LMS forms once at center setup and explicitly confirm any not yet approved",
    startState:
      "Authenticated director; installed template versions are available in existing center settings",
    preconditions:
      "This isolated synthetic center was provisioned before LMS form approvals. No database approval bypass or automatic approval is performed. On subsequent runs already approved versions remain approved and no new approval is invented.",
    initialApprovalStates: templateLabels.map(([templateId]) => {
      const template = initialTemplates.items.find(
        (item: { templateId: string }) => item.templateId === templateId,
      );
      return {
        templateId,
        id: template?.id,
        approved: template?.approved,
        checksum: template?.checksum,
        version: template?.version,
      };
    }),
    actualSteps: setupActions,
    counts: {
      clicks: setupActions.filter((action) => action.kind === "click").length,
      keyboardActions: 0,
      filledFields: 0,
      repeatedFields: 0,
      decisions: setupActions.filter((action) => action.kind === "click")
        .length,
      navigation: setupActions.filter((action) => action.kind === "navigation")
        .length,
      dialogs: applicationDialogs + nativeDialogs,
      confirmations: setupActions.filter((action) =>
        action.target.startsWith("Confirm center template:"),
      ).length,
      manualRefresh: 0,
    },
    elapsedMilliseconds: performance.now() - centerSetupStarted,
    result:
      "All three exact visible center forms are confirmed through the existing UI",
  };
  await fs.writeFile(
    path.join(evidence, "center-template-review.json"),
    JSON.stringify(centerTemplateReview, null, 2),
  );
  phase = "course and calendar first entry";
  await go(page, "/lms/sanitary");
  for (const name of [
    "Параметры центра",
    "Производственный календарь",
    "Добавить версию календаря",
  ])
    await click(page.locator("summary").filter({ hasText: name }), name);
  await fill(page, "Название календаря", `Синтетический календарь ${suffix}`);
  await fill(page, "Начало периода", "2026-01-01");
  await fill(page, "Конец периода", "2027-12-31");
  await fill(
    page,
    "Источники календаря, по одному в строке",
    "Synthetic engineering calendar; no legal or production approval",
  );
  await click(
    page.getByLabel("Учебный календарь для проверки", { exact: true }),
    "Mark calendar synthetic",
  );
  const calendarResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/lms/sanitary/calendars") &&
      r.request().method() === "POST",
  );
  await click(
    page.getByRole("button", { name: "Сохранить версию", exact: true }),
    "Save one calendar version",
  );
  expect((await calendarResponse).status()).toBe(201);
  const calendar = await (await calendarResponse).json();
  await go(page, "/lms");
  await click(
    page.getByRole("button", { name: "Создать курс", exact: true }),
    "Create course",
  );
  await expect(page).toHaveURL(/\/lms\/courses\//);
  arrived("Created course editor opened");
  const courseId = page.url().split("/").at(-1)!;
  await fill(page, "Название RU", `${prefix} Гигиенический курс`);
  await fill(page, "Название KZ", `${prefix} Гигиеналық курс`);
  await fill(
    page,
    "Категория слушателей",
    "Только синтетические участники инженерной проверки",
  );
  await click(
    page.getByRole("button", { name: "Добавить модуль", exact: true }),
    "Add module",
  );
  await fill(page, "Модуль RU", "Синтетический модуль");
  await fill(page, "Модуль KZ", "Синтетикалық модуль");
  await click(
    page.getByRole("button", { name: "Добавить урок", exact: true }),
    "Add first required lesson",
  );
  await fill(page, "Урок RU", "Первый обязательный текст");
  await fill(page, "Урок KZ", "Бірінші міндетті мәтін");
  await fill(
    page,
    "Текст RU",
    "Синтетический материал. Выберите первый ответ в учебной проверке.",
  );
  await fill(
    page,
    "Текст KZ",
    "Синтетикалық материал. Тексеруде бірінші жауапты таңдаңыз.",
  );
  await click(
    page.getByRole("button", { name: "Добавить урок", exact: true }),
    "Add private PDF lesson",
  );
  const lesson = page
    .locator("fieldset")
    .filter({ has: page.locator("legend").filter({ hasText: /^Урок 2$/ }) })
    .last();
  for (const [name, value] of [
    ["Урок RU", "Второй обязательный PDF"],
    ["Урок KZ", "Екінші міндетті PDF"],
    [
      "Текст RU",
      "Откройте PDF. Подтверждение ознакомления не доказывает усвоение.",
    ],
    ["Текст KZ", "PDF ашыңыз. Танысу растауы білімді меңгеруді дәлелдемейді."],
  ])
    await act("field", name, () =>
      lesson.getByLabel(name, { exact: true }).fill(value),
    );
  await act("selection", "PDF material type", () =>
    lesson
      .getByRole("combobox", { name: "Материал", exact: true })
      .selectOption("PDF"),
  );
  const upload = page.waitForResponse(
    (r) => r.url().includes("/materials") && r.request().method() === "POST",
  );
  await act("file", "Upload authored synthetic lesson PDF", () =>
    lesson.getByLabel("Файл урока", { exact: true }).setInputFiles(pdf),
  );
  expect((await upload).status()).toBe(201);
  await click(
    lesson
      .locator("summary")
      .filter({ hasText: "Предыдущие обязательные уроки" }),
    "Set prerequisite",
  );
  await click(
    lesson.getByRole("checkbox", {
      name: "Первый обязательный текст",
      exact: true,
    }),
    "Require previous lesson",
  );
  await click(
    page.getByRole("button", { name: "Добавить вопрос", exact: true }),
    "Add question",
  );
  await click(
    page.locator("summary").filter({ hasText: "1. Новый вопрос" }),
    "Open question",
  );
  await fill(page, "Вопрос RU", "Какой ответ задан в синтетическом материале?");
  await fill(page, "Вопрос KZ", "Синтетикалық материалда қай жауап берілген?");
  for (let index = 0; index < 2; index++) {
    await act("field", `Answer ${index + 1} RU`, () =>
      page
        .getByLabel("RU", { exact: true })
        .nth(index)
        .fill(index ? "Второй" : "Первый"),
    );
    await act("field", `Answer ${index + 1} KZ`, () =>
      page
        .getByLabel("KZ", { exact: true })
        .nth(index)
        .fill(index ? "Екінші" : "Бірінші"),
    );
  }
  await click(
    page.locator("summary").filter({ hasText: "Параметры теста" }),
    "Open exam policy",
  );
  await choose(page, "Правило порога", "GT");
  await click(
    page.locator("summary").filter({ hasText: "Основание и оформление" }),
    "Open regulatory profile",
  );
  await fill(
    page,
    "Название основания",
    `Synthetic local test profile ${suffix}`,
  );
  await choose(page, "Проверка основания", "CONFIRMED");
  await choose(page, "Компетенции", "HYGIENE");
  await choose(page, "Оценка", "CENTER_EXAM");
  await fill(page, "Действует с", "2026-01-01");
  await fill(page, "Действует до", "2027-12-31");
  await fill(
    page,
    "Основание проверки",
    "Synthetic engineering fixture only; does not grant real exam authority",
  );
  await fill(page, "Уполномоченный экзаменатор", "Синтетический экзаменатор");
  await fill(page, "Эмитент документа", "Синтетический учебный центр");
  for (const label of [
    "Протокол",
    "Сертификат",
    "Удостоверение",
    "Синтетическая учебная программа",
    "Санитарное обучение",
  ])
    await click(
      page.getByRole("checkbox", { name: label, exact: true }),
      label,
    );
  await choose(page, "Производственный календарь", calendar.id);
  await click(
    page.getByRole("button", { name: "Добавить источник", exact: true }),
    "Add declared synthetic source",
  );
  await fill(
    page,
    "Название",
    "Synthetic normative fixture, no legal authority",
  );
  await fill(page, "Ссылка", "https://example.test/synthetic-lms-first-flow");
  await fill(page, "Редакция", "test-v1");
  const published = page.waitForResponse(
    (r) => r.url().endsWith("/publish") && r.request().method() === "POST",
  );
  await click(
    page.getByRole("button", { name: "Опубликовать", exact: true }),
    "Publish authored synthetic course",
  );
  expect((await published).status()).toBe(201);
  const course = await (
    await page.request.get(`/api/lms/courses/${courseId}`)
  ).json();
  const version = course.versions[0];
  expect(version.content.modules[0].lessons).toHaveLength(2);
  expect(version.profile.status).toBe("CONFIRMED");
  expect(version.profile.synthetic).toBe(true);
  const learners = [];
  const contexts = [];
  try {
    await startWorker();
    phase = "first learner registration";
    role = "NEW_LEARNER";
    for (const index of [1, 2]) {
      const context = await browser.newContext({
        baseURL: process.env.DEMO_ORIGIN,
      });
      contexts.push(context);
      context.on("page", observeDialogs);
      const learner = await context.newPage();
      await go(learner, "/learn/register");
      await fill(learner, "ФИО", `${prefix} Слушатель ${index}`);
      await fill(
        learner,
        "Электронная почта",
        `first-flow-${suffix}-${index}@example.test`,
      );
      await fill(learner, "Пароль", "Synthetic-LMS-only-20261015!");
      await click(
        learner.getByRole("checkbox"),
        "Consent to versioned learner data processing",
      );
      await click(
        learner.getByRole("button", { name: "Продолжить", exact: true }),
        "Register learner",
      );
      await expect(learner).toHaveURL(/\/learn$/);
      arrived("Registration opened My learning");
      learners.push(learner);
    }
    phase = "first group assignment";
    role = "DIRECTOR";
    await go(page, `/lms/assign?versionId=${version.id}`);
    await fill(page, "Найти сотрудника", prefix);
    await expect(
      page.getByRole("row").filter({ has: page.getByRole("checkbox") }),
    ).toHaveCount(2);
    await click(
      page.getByRole("checkbox", { name: "Выбрать весь список", exact: true }),
      "Select the two newly registered people",
    );
    const assigned = page.waitForResponse(
      (r) =>
        r.url().endsWith("/lms/enrollments") && r.request().method() === "POST",
    );
    await click(
      page.getByRole("button", { name: "Назначить обучение · 2", exact: true }),
      "Assign group once",
    );
    const assignments = await (await assigned).json();
    expect(assignments.created).toBe(2);
    expect(assignments.errors).toEqual([]);
    phase = "required learning and own exam";
    role = "LEARNER";
    const learner = learners[0];
    await go(learner, "/learn");
    await click(
      learner.getByRole("link", { name: "Продолжить", exact: true }),
      "Continue assigned course",
    );
    await expect(learner).toHaveURL(/\/learn\/[a-f0-9-]+$/);
    arrived("Continue opened assigned course");
    const enrollmentId = learner.url().split("/").at(-1)!;
    await expect(
      learner.getByRole("button", { name: /Второй обязательный PDF/ }),
    ).toBeDisabled();
    await expect(
      learner.getByRole("button", { name: "Начать экзамен", exact: true }),
    ).toBeDisabled();
    await click(
      learner.getByRole("button", { name: "Изучено, дальше", exact: true }),
      "Acknowledge first required lesson",
    );
    const pdfLink = learner.getByRole("link", {
      name: "Открыть материал PDF",
      exact: true,
    });
    await expect(pdfLink).toBeVisible();
    const materialResponse = await learner.request.get(
      (await pdfLink.getAttribute("href"))!,
    );
    expect(materialResponse.status()).toBe(200);
    expect((await materialResponse.body()).subarray(0, 5).toString()).toBe(
      "%PDF-",
    );
    const popup = learner.waitForEvent("popup");
    await click(pdfLink, "Open private PDF in browser");
    const pdfPage = await popup;
    arrived("Private PDF viewer opened");
    await act("navigation", "Close PDF viewer and return to lesson", () =>
      pdfPage.close(),
    );
    await click(
      learner.getByRole("button", { name: "Изучено, дальше", exact: true }),
      "Acknowledge PDF separately from download",
    );
    await click(
      learner.getByRole("button", { name: "Начать экзамен", exact: true }),
      "Start own eligible synthetic exam",
    );
    await click(
      learner.getByRole("radio", { name: "Первый", exact: true }),
      "Answer authored question",
    );
    const finished = learner.waitForResponse(
      (r) => r.url().endsWith("/submit") && r.request().method() === "POST",
    );
    await click(
      learner.getByRole("button", { name: "Завершить попытку", exact: true }),
      "Explicitly submit attempt",
    );
    expect((await finished).status()).toBe(201);
    const learning = await (
      await learner.request.get(`/api/learn/enrollments/${enrollmentId}`)
    ).json();
    expect(learning.progressPercent).toBe(100);
    expect(learning.results[0].verdict).toBe("PASSED");
    expect(learning.results[0].eligible).toBe(true);
    const resultId = learning.results[0].id;
    await learner.screenshot({
      path: path.join(evidence, "learner-passed.png"),
      fullPage: true,
    });
    phase = "automatic sanitary preparation after closed UI and worker restart";
    const beforeRestart = readAutomaticState(resultId);
    expect(beforeRestart.outbox).toHaveLength(1);
    for (const context of contexts) await context.close();
    contexts.length = 0;
    await page.context().close();
    const allUiClosedAt = new Date().toISOString();
    await stopWorker(
      "All learner and director UI contexts closed after confirmed result",
    );
    await startWorker();
    expect(
      workerLifecycle.filter((event) => event.event === "STARTED"),
    ).toHaveLength(2);
    expect(workerLifecycle[0].pid).not.toBe(workerLifecycle[2].pid);
    const newStaffContext = await browser.newContext({
      baseURL: process.env.DEMO_ORIGIN,
    });
    contexts.push(newStaffContext);
    newStaffContext.on("page", observeDialogs);
    page = await newStaffContext.newPage();
    role = "DIRECTOR";
    const reloginStarted = performance.now();
    await go(page, "/login");
    for (const [label, value] of [
      ["Электронная почта", process.env.DEMO_DIRECTOR_EMAIL!],
      ["Пароль", process.env.DEMO_DIRECTOR_PASSWORD!],
    ])
      await act("authentication-field", label, () =>
        page.getByLabel(label, { exact: true }).fill(value),
      );
    await click(
      page.getByRole("button", { name: "Войти", exact: true }),
      "Sign in again to inspect automatically prepared list",
    );
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    arrived("Fresh director login completed");
    const reloginElapsedMilliseconds = performance.now() - reloginStarted;
    let sanitaryBatchId = "";
    await expect
      .poll(
        async () => {
          const list = await (
            await page.request.get("/api/lms/sanitary?page=1&pageSize=100")
          ).json();
          const batch = list.items.find(
            (entry: { items: { resultId: string }[] }) =>
              entry.items.some((item) => item.resultId === resultId),
          );
          sanitaryBatchId = batch?.id || "";
          return (
            !!batch &&
            !!batch.dueAt &&
            batch.connectionState === "NOT_CONNECTED"
          );
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const afterRestart = readAutomaticState(resultId);
    expect(afterRestart.result).toEqual(beforeRestart.result);
    expect(afterRestart.outbox).toHaveLength(1);
    expect(afterRestart.outbox[0].status).toBe("DONE");
    expect(afterRestart.outbox[0].id).toBe(beforeRestart.outbox[0].id);
    expect(afterRestart.journal).toHaveLength(1);
    expect(afterRestart.items).toHaveLength(1);
    expect(afterRestart.items[0].batchId).toBe(sanitaryBatchId);
    expect(afterRestart.items[0].journalEntryId).toBe(
      afterRestart.journal[0].id,
    );
    expect(afterRestart.deliveries).toHaveLength(1);
    expect(afterRestart.deliveries[0].batchItemId).toBe(
      afterRestart.items[0].id,
    );
    for (const entry of beforeRestart.journal)
      expect(afterRestart.journal).toContainEqual(
        expect.objectContaining({
          id: entry.id,
          resultId: entry.resultId,
          snapshotHash: entry.snapshotHash,
        }),
      );
    for (const entry of beforeRestart.items)
      expect(afterRestart.items).toContainEqual(
        expect.objectContaining({
          id: entry.id,
          batchId: entry.batchId,
          resultId: entry.resultId,
          journalEntryId: entry.journalEntryId,
          snapshotHash: entry.snapshotHash,
        }),
      );
    for (const entry of beforeRestart.deliveries)
      expect(afterRestart.deliveries).toContainEqual(
        expect.objectContaining({
          id: entry.id,
          resultId: entry.resultId,
          batchItemId: entry.batchItemId,
          payloadHash: entry.payloadHash,
        }),
      );
    const inspectionStarted = performance.now();
    await go(page, "/lms/sanitary");
    await click(
      page
        .getByRole("row")
        .filter({ has: page.locator(`a[href*="${sanitaryBatchId}/export"]`) })
        .getByRole("button")
        .first(),
      "Inspect automatically prepared list",
    );
    await expect(
      page.getByText(`${prefix} Слушатель 1`, { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(evidence, "automatic-sanitary-list.png"),
      fullPage: true,
    });
    const inspectionElapsedMilliseconds = performance.now() - inspectionStarted;
    const automaticPreparation = {
      preparationMetrics: {
        scenario: "В: automatic internal sanitary preparation",
        role: "SYSTEM",
        phase: "automatic preparation",
        goal: "Prepare exactly one internal sanitary list item from the confirmed exam result without a triggering operator action",
        startState:
          "A real confirmed exam result and its transactional outbox record exist",
        preconditions:
          "The shipping integration worker is running against the isolated synthetic database. UI closure and worker restart are independently recorded below; no pending state is fabricated.",
        actualSteps: [],
        counts: {
          clicks: 0,
          keyboardActions: 0,
          filledFields: 0,
          repeatedFields: 0,
          decisions: 0,
          navigation: 0,
          dialogs: 0,
          confirmations: 0,
          manualRefresh: 0,
        },
        elapsedMilliseconds:
          new Date(afterRestart.outbox[0].processedAt).getTime() -
          new Date(afterRestart.outbox[0].createdAt).getTime(),
        timingBoundary:
          "Persisted server timestamps: outbox creation to actual processing completion. Authentication, UI inspection and restart instrumentation are separate recorded costs, not included in this automatic-processing duration.",
        result: {
          outboxId: afterRestart.outbox[0].id,
          status: afterRestart.outbox[0].status,
          journalCount: afterRestart.journal.length,
          itemCount: afterRestart.items.length,
          deliveryCount: afterRestart.deliveries.length,
        },
      },
      allUiClosedAt,
      workerLifecycle: structuredClone(workerLifecycle),
      beforeRestart,
      afterRestart,
      triggerOperatorActions: 0,
      login: {
        clicks: 1,
        filledFields: 2,
        repeatedFields: 2,
        authenticationRepeatedFields: 2,
        businessRepeatedFields: 0,
        navigation: 2,
        keyboardActions: 0,
        dialogs: 0,
        confirmations: 0,
        manualRefresh: 0,
        elapsedMilliseconds: reloginElapsedMilliseconds,
      },
      inspection: {
        clicks: 1,
        filledFields: 0,
        repeatedFields: 0,
        decisions: 1,
        navigation: 1,
        keyboardActions: 0,
        dialogs: 0,
        confirmations: 0,
        manualRefresh: 0,
        elapsedMilliseconds: inspectionElapsedMilliseconds,
      },
      interpretation:
        "All UI contexts closed; only the test-owned shipping worker PID was stopped and a different PID started. The same confirmed result and outbox persisted, and exactly one journal/item/delivery is present after restart. beforeRestart records whether processing had already completed; no pending state is fabricated. Authentication and inspection are separate from the zero-action automatic trigger.",
    };
    await fs.writeFile(
      path.join(evidence, "automatic-preparation-restart.json"),
      JSON.stringify(automaticPreparation, null, 2),
    );
    phase = "document preparation and separate director approval";
    role = "DIRECTOR";
    await go(page, "/lms/results");
    await expect(
      page.getByRole("checkbox", {
        name: `${prefix} Слушатель 1`,
        exact: true,
      }),
    ).toBeChecked();
    const selected = page.getByRole("checkbox", { checked: true });
    for (;;) {
      let changed = false;
      for (const checkbox of await selected.all()) {
        if (
          (await checkbox.getAttribute("aria-label")) !==
          `${prefix} Слушатель 1`
        ) {
          await click(
            checkbox,
            "Exclude unrelated eligible result from this first-entry scenario",
          );
          changed = true;
          break; // Checked-locator indices change after each actual deselection.
        }
      }
      if (!changed) break;
    }
    const preparation = page.waitForResponse(
      (r) =>
        r.url().endsWith("/lms/results/documents") &&
        r.request().method() === "POST",
    );
    await click(
      page.getByRole("button", {
        name: "Подготовить документы · 1",
        exact: true,
      }),
      "Prepare three requested document types",
    );
    const prepared = await (await preparation).json();
    expect(prepared.errors).toEqual([]);
    expect(prepared.items).toHaveLength(3);
    const requestId = prepared.items[0].requestId;
    const approvals = await (await page.request.get("/api/approvals")).json();
    const proposal = approvals.items.find(
      (item: { requestId: string }) => item.requestId === requestId,
    );
    expect(proposal).toBeTruthy();
    const approval = await page.context().newPage();
    await go(approval, `/approvals?proposal=${proposal.id}`);
    await click(
      approval.getByRole("button", {
        name: "Согласовать эту редакцию",
        exact: true,
      }),
      "Director explicitly approves frozen revision",
    );
    await act(
      "navigation",
      "Close approval page and return to prepared documents",
      () => approval.close(),
    );
    const download = page.getByRole("button", {
      name: "Скачать комплект",
      exact: true,
    });
    await expect(download).toBeEnabled({ timeout: 240000 });
    const downloadable = page.waitForEvent("download");
    await click(download, "Download three real application PDFs");
    await (
      await downloadable
    ).saveAs(path.join(evidence, "first-flow-documents.zip"));
    const issued = await (
      await page.request.get(`/api/print-requests/${requestId}`)
    ).json();
    expect(issued.documents).toHaveLength(3);
    phase = "registry and public QR";
    await go(page, `/requests/${requestId}`);
    await click(
      page
        .locator("summary")
        .filter({ hasText: "Ссылка и QR для проверки записи" }),
      "Open public verification controls",
    );
    await choose(page, "Выданный документ", issued.documents[0].id);
    await click(
      page.getByRole("checkbox", {
        name: "Разрешаю публичную проверку выбранной записи эмитента",
        exact: true,
      }),
      "Explicit publication permission",
    );
    await click(
      page.getByRole("button", { name: "Создать ссылку и QR", exact: true }),
      "Create verification link and QR",
    );
    await expect(
      page.getByRole("img", {
        name: "QR для проверки записи эмитента",
        exact: true,
      }),
    ).toBeVisible();
    const verification = page.waitForEvent("popup");
    await click(
      page.getByRole("link", {
        name: "Открыть публичную проверку",
        exact: true,
      }),
      "Inspect public minimal record",
    );
    const publicPage = await verification;
    arrived("Public verification opened");
    await expect(
      publicPage.getByText(issued.documents[0].number, { exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText(`${prefix} Слушатель 1`, { exact: true }),
    ).toHaveCount(0);
    await publicPage.screenshot({
      path: path.join(evidence, "minimal-public-record.png"),
      fullPage: true,
    });
    await act(
      "navigation",
      "Close public verification and return to registry",
      () => publicPage.close(),
    );
    expect(applicationDialogs + nativeDialogs).toBe(0);
    await fs.writeFile(
      path.join(evidence, "actions.json"),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          fixtureVersion: "lms-first-ui-flow-v2-owned-worker-restart",
          role: "DIRECTOR and LEARNER; explicit role transitions are recorded in the actions",
          phase: "complete first entry and linked execution",
          goal: "Create the first sanitary course, calendar and learner through the UI, assign and complete learning, prepare and approve real documents, and inspect the automatic list and minimal public record",
          startBoundary:
            "Director already authenticated; elapsed time and actions begin immediately after login. Learner first registration is included below.",
          prerequisites:
            "Existing synthetic demo center, accounts, installed DEMO/LMS templates and locally running API/render worker. One-time director review and any missing LMS template approvals are performed through actual settings UI and included in the counts, with initial approval states separately recorded. Test owns and restarts the real shipping integration-worker process with an explicit tsconfig. Course, profile, calendar, people, assignment and exam created only through actual UI in this scenario. Test PDF authored as input fixture, not substituted for application output.",
          centerTemplateReview,
          source: {
            courseId,
            courseVersionId: version.id,
            enrollmentId,
            resultId,
            requestId,
            sanitaryBatchId,
          },
          actions,
          counts: {
            clicks: actions.filter((x) => x.kind === "click").length,
            keyboardActions: 0,
            filledFields: actions.filter(
              (x) =>
                x.kind === "field" ||
                x.kind === "file" ||
                x.kind === "authentication-field",
            ).length,
            selections: actions.filter((x) => x.kind === "selection").length,
            fileSelections: actions.filter((x) => x.kind === "file").length,
            repeatedFields: 2,
            authenticationRepeatedFields: 2,
            businessRepeatedFields: 0,
            decisions: actions.filter(
              (x) => x.kind === "click" || x.kind === "selection",
            ).length,
            navigation: actions.filter((x) => x.kind === "navigation").length,
            dialogs: applicationDialogs + nativeDialogs,
            confirmations: actions.filter(
              (x) =>
                [
                  "Consent to versioned learner data processing",
                  "Director explicitly approves frozen revision",
                  "Explicit publication permission",
                ].includes(x.target) ||
                x.target.startsWith("Confirm center template:"),
            ).length,
            manualRefresh: 0,
          },
          applicationDialogs,
          nativeDialogs,
          fileInputMeasurement:
            "One synthetic PDF is selected through Playwright setInputFiles and counted as file selection/filled field. JavaScript and visible application dialogs are observed separately. The native OS file picker was not observed and its interactions are not claimed.",
          nativeFilePickerObserved: false,
          automaticSanitaryOperatorActions: 0,
          automaticPreparation,
          measurementConventions:
            "Navigation counts explicit routes, implicit page transitions and popup open/return. Decisions count each explicit activated control or selected option. fill is one semantic field entry, not a claim about physical keystrokes. Closing UI contexts, process restart, database/API readback, assertions and screenshots are verification instrumentation; their elapsed time remains included. Two re-entered authentication fields are explicit; repeated known business data remains zero. No operator action starts automatic sanitary preparation; fresh login and opening its existing list are separately recorded inspection costs.",
          elapsedMilliseconds: performance.now() - started,
          boundary:
            "Synthetic HYGIENE/CENTER_EXAM/INFORMATION_CARD engineering route only. No production legal authority, cryptographic signature, physical printing, provider acceptance or LMK mark claimed.",
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await stopWorker("Test cleanup stops only its current owned child PID");
    } finally {
      for (const context of contexts) await context.close();
      await fs.writeFile(
        path.join(evidence, "worker-lifecycle.json"),
        JSON.stringify(workerLifecycle, null, 2),
      );
    }
  }
});
