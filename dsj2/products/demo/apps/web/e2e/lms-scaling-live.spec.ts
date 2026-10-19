import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { measureLmsActions } from "./lms-action-measurement";

const product = path.resolve(__dirname, "../../..");
const output = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : path.join(product, "docs/evidence/lms-tz-scaling-20261015");
const fixturePath =
  process.env.DEMO_LMS_SCALING_FIXTURE ||
  path.join(product, ".runtime/lms-scaling/browser-fixture.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const records: unknown[] = [];
function measure(page: Page, name: string, start: string, role = "DIRECTOR") {
  const current = measureLmsActions(page, name, role, start, [
    fixture.preparedCosts,
    "Only synthetic data in a task-owned disposable demo_test_lms database. First creation of people/order/course/legal profile and prior rendering are prerequisites, not measured first-entry actions.",
  ]);
  return {
    action: current.action,
    finish(result: unknown) {
      const value = current.finish(result);
      records.push(value);
      return value;
    },
  };
}
async function login(page: Page, email: string, password: string) {
  const entry = measure(
    page,
    "existing synthetic account login",
    "Signed out; login page not open",
    "EXISTING_ACCOUNT",
  );
  await entry.action("navigate", "Open login", () => page.goto("/login"));
  await entry.action("field", "Enter existing synthetic email", () =>
    page.getByLabel("Электронная почта", { exact: true }).fill(email),
  );
  await entry.action("field", "Enter existing synthetic password", () =>
    page.getByLabel("Пароль", { exact: true }).fill(password),
  );
  await entry.action("click", "Sign in", () =>
    page.getByRole("button", { name: "Войти", exact: true }).click(),
  );
  await expect(page).not.toHaveURL(/\/login/);
  entry.finish({ signedIn: true, separateFromRoutineScenario: true });
}
test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
});
test.beforeEach(() => {
  records.length = 0;
});
test.afterEach(async ({ page }, info) => {
  void page;
  if (info.title.startsWith("V4 visual")) {
    await writeFile(
      path.join(output, "UX_VISUAL_FOLLOWUP.json"),
      JSON.stringify(
        { name: info.title, status: info.status, records },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const phase = info.title.startsWith("V4 order")
    ? "order"
    : info.title.startsWith("V4 draft")
      ? "draft"
      : info.title.startsWith("V4 ordinary")
        ? "print"
        : "access";
  await writeFile(
    path.join(output, `UX_BROWSER_${phase}.json`),
    JSON.stringify(
      { name: info.title, status: info.status, records },
      null,
      2,
    ) + "\n",
  );
  const phases = await Promise.all(
    ["order", "draft", "access", "print"].map(async (name) => {
      const raw = await readFile(
        path.join(output, `UX_BROWSER_${name}.json`),
        "utf8",
      ).catch(() => "null");
      return JSON.parse(raw);
    }),
  );
  await writeFile(
    path.join(output, "UX_ACTIONS.json"),
    JSON.stringify(
      {
        fixtureVersion: fixture.fixtureVersion,
        softwareFramework:
          "Existing @demo/web Playwright runner; fresh isolated browser context",
        cuaLimitation:
          "CUA could not load request-header policy (Cloudflare403) before opening a tab; no user browser was controlled",
        phases: phases.filter(Boolean),
      },
      null,
      2,
    ) + "\n",
  );
});

test("V4 order, partial assignment, durable group, Kazakh row/document errors and ready bundle", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page, fixture.director.email, fixture.director.password);
  const replayState = await (
    await page.request.get(`/api/lms/courses/${fixture.courseId}`)
  ).json();
  if (replayState.course.assignmentPaused) {
    const session = await (await page.request.get("/api/auth/session")).json();
    const reset = await page.request.post(
      `/api/lms/courses/${fixture.courseId}/pause`,
      {
        headers: {
          origin: process.env.DEMO_ORIGIN!,
          "x-csrf-token": session.csrfToken,
        },
        data: {
          paused: false,
          reason: "Synthetic fixture replay after separate pause acceptance",
        },
      },
    );
    expect(reset.ok()).toBe(true);
    records.push({
      scenario: "Synthetic fixture replay setup",
      setupOnly: true,
      action:
        "Resume only the synthetic course previously paused by the independent acceptance phase",
      boundary:
        "Explicit test prerequisite; no operator action or first-entry saving is claimed",
    });
  }
  const context = measure(
    page,
    "known order to prepared training assignment",
    "Existing order known; order workspace not open",
  );
  await context.action(
    "navigate",
    "Open known order in current workbench",
    () => page.goto(`/workbench?orderId=${fixture.orderId}`),
  );
  const training = page
    .locator("summary")
    .filter({ hasText: "Обучение и документы" });
  await expect(training).toBeVisible();
  await context.action("click", "Expand training for known order", () =>
    training.click(),
  );
  await context.action(
    "click",
    "Open assignment for known request and people",
    () =>
      page
        .getByRole("link", { name: /Назначить обучение участникам заявки/ })
        .click(),
  );
  const program = page.getByRole("combobox", {
    name: "Программа",
    exact: true,
  });
  await expect(
    program.locator(`option[value="${fixture.courseVersionId}"]`),
  ).toBeAttached();
  const programAutomaticallySelected =
    (await program.inputValue()) === fixture.courseVersionId;
  if (!programAutomaticallySelected) {
    await context.action(
      "select",
      "Select the intended prepared course among available programs",
      () => program.selectOption(fixture.courseVersionId),
      { decision: true },
    );
  }
  await expect(program).toHaveValue(fixture.courseVersionId);
  await expect(
    page.getByRole("button", { name: "Назначить обучение · 3", exact: true }),
  ).toBeEnabled();
  context.finish({
    knownPeopleAutomaticallySelected: 3,
    programAutomaticallySelected,
    repeatedFields: 0,
  });
  const replaySource = await readFile(
    path.join(path.dirname(fixturePath), "browser-operation-replay.json"),
    "utf8",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (replaySource) {
    const replay = JSON.parse(replaySource);
    expect(replay.input.sourceOrderId).toBe(fixture.orderId);
    expect(replay.input.sourceRequestId).toBe(fixture.requestId);
    expect([...replay.input.recipientIds].sort()).toEqual(
      fixture.people
        .map((person: { recipientId: string }) => person.recipientId)
        .sort(),
    );
    const fingerprint = JSON.stringify([
      await page
        .getByRole("combobox", { name: "Программа", exact: true })
        .inputValue(),
      [...replay.input.recipientIds].sort(),
      replay.input.customerId,
      {
        sourceRequestId: replay.input.sourceRequestId,
        sourceOrderId: replay.input.sourceOrderId,
      },
    ]);
    await page.evaluate(
      ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
      {
        key: `demo:lms:assignment:${fixture.tenantId}:${fixture.director.userId}`,
        value: { operationId: replay.id, fingerprint },
      },
    );
    records.push({
      scenario: "Interrupted software acceptance operation recovery",
      setupOnly: true,
      operationId: replay.id,
      groupId: replay.groupId,
      boundary:
        "Restore only the actual previously persisted test operation into this fresh test browser. The following application click replays the same immutable input and cannot create a second group or enrollment.",
    });
  }
  const routine = measure(
    page,
    "prepared assignment with one employment exception and preserved historical origin",
    "Known order/request/people/program already open and selected",
  );
  await routine.action("click", "Switch task language to Kazakh", () =>
    page.getByRole("button", { name: "KZ", exact: true }).click(),
  );
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lms/enrollments") &&
      r.request().method() === "POST",
  );
  await routine.action(
    "click",
    "Assign all known selected people once",
    () =>
      page
        .getByRole("button", { name: "Оқуды тағайындау · 3", exact: true })
        .click(),
    { decision: true },
  );
  const report = await (await response).json();
  expect(report.created + report.duplicates).toBeGreaterThanOrEqual(1);
  expect(
    report.errors.some(
      (row: { code: string }) => row.code === "EMPLOYMENT_REQUIRED",
    ),
  ).toBe(true);
  await expect(
    page.getByRole("alert").filter({
      hasText: "Қызметкердің таңдалған ұйыммен байланысын тексеріңіз.",
    }),
  ).toBeVisible();
  expect(await page.locator(".lms-table tbody input:checked").count()).toBe(
    report.failedRecipientIds.length,
  );
  const group = page.getByRole("link", { name: "Топты ашу", exact: true });
  const groupHref = await group.getAttribute("href");
  expect(groupHref).toMatch(/^\/lms\/groups\//);
  routine.finish({
    created: report.created,
    conflicts: report.conflicts,
    errors: report.errors.map((row: { code: string }) => row.code),
    successfulRowsRetained: true,
    failedOnlySelected: report.failedRecipientIds.length,
    languagePreferenceCostIncluded: true,
  });
  await page.screenshot({
    path: path.join(output, "01-kz-partial-assignment.png"),
    fullPage: true,
  });
  const groupFlow = measure(
    page,
    "persistent group and its scoped results",
    "Completed partial operation has a group link",
  );
  await groupFlow.action("click", "Open saved group", () => group.click());
  await expect(
    page.getByRole("link", { name: /Нәтижелер мен дайын құжаттар/ }),
  ).toBeVisible();
  const members = await page.locator(".lms-table tbody tr").count();
  await groupFlow.action("refresh", "Reload the persisted group", () =>
    page.reload(),
  );
  await expect(page.locator(".lms-table tbody tr")).toHaveCount(members);
  await groupFlow.action("click", "Open scoped results from group", () =>
    page.getByRole("link", { name: /Нәтижелер мен дайын құжаттар/ }).click(),
  );
  await expect(
    page.getByRole("button", { name: "Топтың дайын құжаттары", exact: true }),
  ).toBeEnabled();
  const documentError = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lms/documents/bundle") &&
      r.request().method() === "POST",
  );
  await groupFlow.action(
    "click",
    "Request documents before the new group has a verified result",
    () =>
      page
        .getByRole("button", { name: "Топтың дайын құжаттары", exact: true })
        .click(),
  );
  expect((await documentError).status()).toBe(409);
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Файлдар мен міндетті қолтаңбалардың дайын болуын күтіңіз. Таңдалған құрам сақталды.",
    }),
  ).toBeVisible();
  groupFlow.finish({
    groupHref,
    persistedMembers: members,
    scopedDocumentError: "DOCUMENT_NOT_READY",
    chosenCompositionPreserved: true,
  });
  await page.screenshot({
    path: path.join(output, "02-kz-group-document-error.png"),
    fullPage: true,
  });
  const findReady = measure(
    page,
    "find existing ready result after scoped group work",
    "Group results and a real document-readiness exception are open",
  );
  await findReady.action("navigate", "Open all results", () =>
    page.goto("/lms/results"),
  );
  await findReady.action("click", "Return to Russian for result lookup", () =>
    page.getByRole("button", { name: "RU", exact: true }).click(),
  );
  const filters = page.getByText("Фильтры и отчёт", { exact: true });
  await findReady.action("click", "Open remembered result filters", () =>
    filters.click(),
  );
  await findReady.action(
    "click",
    "Clear previous group scope for all permitted results",
    () =>
      page
        .getByRole("button", { name: "Сбросить фильтры", exact: true })
        .click(),
  );
  await findReady.action("field", "Find the existing synthetic learner", () =>
    page.getByLabel("Найти слушателя", { exact: true }).fill("Синтетический"),
  );
  await findReady.action(
    "select",
    "Restrict ready results to the intended course version",
    () =>
      page
        .getByRole("combobox", { name: "Курс и версия", exact: true })
        .selectOption(fixture.courseVersionId),
    { decision: true },
  );
  await expect(
    page.locator('.lms-table tbody input[type="checkbox"]'),
  ).toHaveCount(1);
  await findReady.action(
    "click",
    "Select the found permitted ready result",
    () =>
      page
        .getByRole("row")
        .filter({
          has: page.locator(`a[href="/requests/${fixture.documentRequestId}"]`),
        })
        .getByRole("checkbox", {
          name: "Синтетический слушатель Первый",
          exact: true,
        })
        .check(),
    { decision: true },
  );
  const readyButton = page.getByRole("button", {
    name: /^(Получить готовый комплект|Подготовить документы) · 1$/,
  });
  await expect(readyButton).toBeEnabled();
  findReady.finish({
    permittedReadyResultSelected: true,
    allContextAndFilterCostsIncluded: true,
  });
  const bundleFlow = measure(
    page,
    "ready permitted documents from existing result",
    "Known eligible result found; applicable document types and rendered files already exist",
  );
  await bundleFlow.action(
    "click",
    "Reuse the selected existing document set",
    () => readyButton.click(),
  );
  const part = page.getByRole("link", {
    name: "Скачать часть 1 / 1",
    exact: true,
  });
  await expect(part).toBeVisible({ timeout: 45_000 });
  const event = page.waitForEvent("download");
  await bundleFlow.action("click", "Download the ready permitted part", () =>
    part.click(),
  );
  const downloaded = await event;
  const file = path.join(output, "ready-documents.zip");
  await downloaded.saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  bundleFlow.finish({
    permittedZipBytes: bytes.length,
    parts: 1,
    manualPeopleSplits: 0,
    readySelectionAutomaticallyPreparesBundle: true,
  });
  await page.screenshot({
    path: path.join(output, "03-ready-bundle.png"),
    fullPage: true,
  });
});

test("V4 draft correction, shared question selection, reload and pause preserve published history", async ({
  page,
}) => {
  await login(page, fixture.director.email, fixture.director.password);
  await page.goto(fixture.links.course);
  const editor = measure(
    page,
    "responsible role corrects draft and chooses a saved question",
    "Existing course with one prepared unpublished draft; editor open",
  );
  await expect(page.getByLabel("Модуль RU", { exact: true })).toBeEnabled();
  const before = await (
    await page.request.get(`/api/lms/courses/${fixture.courseId}`)
  ).json();
  await editor.action("field", "Correct the draft module name", () =>
    page
      .getByLabel("Модуль RU", { exact: true })
      .fill("Модуль — синтетическая правка V4"),
  );
  await expect(page.locator(".lms-save-state").first()).toHaveText("Сохранено");
  await editor.action("click", "Open tenant question bank", () =>
    page.getByText("Выбрать из банка вопросов", { exact: true }).click(),
  );
  await editor.action(
    "click",
    "Explicitly choose the saved question revision",
    () =>
      page
        .getByRole("button", { name: "Использовать", exact: true })
        .first()
        .click(),
    { decision: true },
  );
  await expect(page.locator(".lms-save-state").first()).toHaveText("Сохранено");
  await editor.action("refresh", "Reload and restore saved draft", () =>
    page.reload(),
  );
  await expect(page.getByLabel("Модуль RU", { exact: true })).toHaveValue(
    "Модуль — синтетическая правка V4",
  );
  const after = await (
    await page.request.get(`/api/lms/courses/${fixture.courseId}`)
  ).json();
  const oldPublished = before.versions.find(
    (version: { id: string }) => version.id === fixture.courseVersionId,
  );
  const newPublished = after.versions.find(
    (version: { id: string }) => version.id === fixture.courseVersionId,
  );
  expect(newPublished).toEqual(oldPublished);
  editor.finish({
    draftAutosavedAndRestored: true,
    savedQuestionChosenExplicitly: true,
    publishedVersionUnchanged: true,
  });
  const pause = measure(
    page,
    "pause new assignments without modifying current learning",
    "Responsible role has the existing course editor open",
  );
  await pause.action(
    "click",
    "Open current review and assignment availability",
    () =>
      page
        .getByText("Актуальность и новые назначения", { exact: true })
        .click(),
  );
  await pause.action("field", "Explain this synthetic pause", () =>
    page
      .getByLabel("Причина паузы новых назначений", { exact: true })
      .fill("Синтетическая локальная проверка V4"),
  );
  await pause.action(
    "click",
    "Pause only new assignments",
    () =>
      page
        .getByRole("button", {
          name: "Приостановить новые назначения",
          exact: true,
        })
        .click(),
    { decision: true },
  );
  await expect(
    page.getByRole("button", {
      name: "Возобновить новые назначения",
      exact: true,
    }),
  ).toBeVisible();
  const paused = await (
    await page.request.get(`/api/lms/courses/${fixture.courseId}`)
  ).json();
  expect(paused.course.assignmentPaused).toBe(true);
  pause.finish({
    assignmentPaused: true,
    existingResultId: fixture.resultId,
    firstReasonEntryIncluded: true,
  });
  await page.screenshot({
    path: path.join(output, "04-draft-and-pause.png"),
    fullPage: false,
  });
});

test("V4 actual expired access speaks Kazakh without creating an attempt", async ({
  page,
}) => {
  await login(page, fixture.expired.email, fixture.expired.password);
  await page.goto(fixture.links.expired);
  const expired = measure(
    page,
    "Kazakh expired access after a real server refusal",
    "An existing expired synthetic enrollment is open",
    "LEARNER",
  );
  const beforeAccess = await (
    await page.request.get(
      `/api/learn/enrollments/${fixture.expired.enrollmentId}`,
    )
  ).json();
  const refusal = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(
          `/api/learn/enrollments/${fixture.expired.enrollmentId}/attempts`,
        ) && response.request().method() === "POST",
  );
  await expired.action(
    "click",
    "Attempt the exam on the expired enrollment",
    () =>
      page.getByRole("button", { name: "Начать экзамен", exact: true }).click(),
  );
  const refused = await refusal;
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("ACCESS_EXPIRED");
  await expect(
    page.getByRole("alert").filter({
      hasText: "Срок обучения завершён. Обратитесь в учебный центр.",
    }),
  ).toBeVisible();
  await expired.action(
    "click",
    "Translate the existing refusal to Kazakh",
    () => page.getByRole("button", { name: "KZ", exact: true }).click(),
  );
  await expect(
    page.getByRole("alert").filter({
      hasText: "Оқу мерзімі аяқталды. Оқу орталығына хабарласыңыз.",
    }),
  ).toBeVisible();
  const afterAccess = await (
    await page.request.get(
      `/api/learn/enrollments/${fixture.expired.enrollmentId}`,
    )
  ).json();
  expect(afterAccess.attempts.length).toBe(beforeAccess.attempts.length);
  expired.finish({
    realCode: "ACCESS_EXPIRED",
    existingErrorTranslatedWithoutRetry: true,
    attemptsCreated: afterAccess.attempts.length - beforeAccess.attempts.length,
    recovery: "Clear contact-center instruction and enrollment retained",
  });
  await page.screenshot({
    path: path.join(output, "05-kz-expired-access.png"),
    fullPage: true,
  });
});

test("V4 ordinary prepared printing still opens in a fresh browser context", async ({
  page: staff,
}) => {
  test.setTimeout(90_000);
  await login(staff, fixture.director.email, fixture.director.password);
  const ordinary = measure(
    staff,
    "existing ordinary prepared printing entry",
    "Existing synthetic ordinary DEMO request known; no learner result conversion",
  );
  await ordinary.action(
    "navigate",
    "Open the existing prepared printing request",
    () => staff.goto(fixture.links.ordinaryPrint),
  );
  await expect(staff.locator(".editor-heading h1")).toBeVisible();
  await expect(
    staff.getByText("Загружаем заявку…", { exact: true }),
  ).toBeHidden();
  const visibleArtifacts = fixture.ordinaryPrint.artifacts.filter(
    (artifact: { format: string }) => artifact.format !== "ZIP",
  );
  await expect
    .poll(() => staff.locator(".artifact-list > article").count())
    .toBeGreaterThanOrEqual(visibleArtifacts.length);
  for (const artifact of visibleArtifacts) {
    await expect(
      staff.locator(`.artifact-list a[href="/api/artifacts/${artifact.id}"]`),
    ).toBeVisible();
  }
  for (const artifact of fixture.ordinaryPrint.artifacts.filter(
    (item: { format: string }) => item.format === "ZIP",
  )) {
    await expect(
      staff.locator(`.artifact-list a[href="/api/artifacts/${artifact.id}"]`),
    ).toHaveCount(0);
  }
  for (const artifact of visibleArtifacts.filter(
    (item: { format: string }) => item.format === "XLSX",
  )) {
    await expect(
      staff.locator(`.artifact-list a[href="/api/artifacts/${artifact.id}"]`),
    ).toHaveAttribute("aria-disabled", "true");
  }
  await expect(staff.locator("body")).not.toContainText("Application error");
  const pdf = fixture.ordinaryPrint.artifacts.find(
    (artifact: { format: string }) => artifact.format === "PDF",
  );
  expect(pdf).toBeTruthy();
  const downloadEvent = staff.waitForEvent("download");
  await ordinary.action("click", "Download the existing issued PDF", () =>
    staff.locator(`.artifact-list a[href="/api/artifacts/${pdf.id}"]`).click(),
  );
  const download = await downloadEvent;
  const savedPdf = path.join(output, "ordinary-issued.pdf");
  await download.saveAs(savedPdf);
  const bytes = await readFile(savedPdf);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBe(pdf.size);
  ordinary.finish({
    ordinaryRequestId: fixture.ordinaryRequestId,
    actualLoadedRequestHeading: await staff
      .locator(".editor-heading h1")
      .innerText(),
    readyArtifactIds: fixture.ordinaryPrint.artifacts.map(
      (artifact: { id: string }) => artifact.id,
    ),
    actualVisibleArtifactCount: await staff
      .locator(".artifact-list > article")
      .count(),
    downloadedIssuedPdfBytes: bytes.length,
    downloadedIssuedPdfSignature: "%PDF-",
    officialZipAndRegistryAwaitSignatures: true,
    scope:
      "Actual loaded issued-request files and authorized PDF download; physical print and Word/PDF layout remain outside this unchanged path check",
  });
  await staff.screenshot({
    path: path.join(output, "06-ordinary-print-entry.png"),
    fullPage: true,
  });
});

test("V4 visual followup keeps ready download primary and dates on one line", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page, fixture.director.email, fixture.director.password);
  await page.goto("/lms/results");
  await page
    .getByLabel("Найти слушателя", { exact: true })
    .fill("Синтетический");
  await page.getByText("Фильтры и отчёт", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Курс и версия", exact: true })
    .selectOption(fixture.courseVersionId);
  await expect(
    page.locator('.lms-table tbody input[type="checkbox"]'),
  ).toHaveCount(1);
  await page
    .getByRole("row")
    .filter({
      has: page.locator(`a[href="/requests/${fixture.documentRequestId}"]`),
    })
    .getByRole("checkbox", {
      name: "Синтетический слушатель Первый",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", {
      name: /^(Получить готовый комплект|Подготовить документы) · 1$/,
    })
    .click();
  const part = page.getByRole("link", {
    name: "Скачать часть 1 / 1",
    exact: true,
  });
  await expect(part).toBeVisible({ timeout: 45_000 });
  await expect(part).toHaveClass(/\bprimary\b/);
  await expect(
    page.getByRole("button", { name: "Подождите…", exact: true }),
  ).toBeHidden();
  const source = page.locator("details").filter({
    has: page
      .locator("summary")
      .filter({ hasText: "Формат и исходные документы" }),
  });
  await expect(source).toBeVisible();
  await expect(source).not.toHaveAttribute("open", "");
  await expect(
    source.getByRole("button", { name: "Получить комплект", exact: true }),
  ).toBeHidden();
  const dates = await page
    .locator(".lms-table tbody tr td:nth-child(3) .lms-list-meta")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          text: node.textContent?.trim(),
          whiteSpace: getComputedStyle(node).whiteSpace,
          textRects: range.getClientRects().length,
        };
      }),
    );
  expect(dates.length).toBeGreaterThan(0);
  for (const date of dates) {
    expect(date.text).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(date.whiteSpace).toBe("nowrap");
    expect(date.textRects).toBe(1);
  }
  records.push({
    scenario: "Narrow final Results visual followup",
    sourceDetailsClosed: true,
    readyDownloadPrimary: true,
    dates,
    boundary:
      "Only final markup verification. Four accepted business phases and UX_ACTIONS.json remain unchanged; no additional ZIP download or domain scenario was repeated.",
  });
  await page.screenshot({
    path: path.join(output, "03-ready-bundle.png"),
    fullPage: true,
  });
});
