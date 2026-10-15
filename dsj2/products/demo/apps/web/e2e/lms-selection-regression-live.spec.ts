import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { syntheticPdf } from "../../../tests/fixtures/pdf";
import { measureLmsActions } from "./lms-action-measurement";

test("operator choices survive real filtering and partial preparation; external exam dates remain separate and correctable without reentry", async ({
  page,
}, testInfo) => {
  test.setTimeout(240000);
  const root = path.resolve(__dirname, "../../..");
  const evidence = process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-selection-regression-live")
    : testInfo.outputDir;
  await fs.mkdir(evidence, { recursive: true });
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-selection-fixture.ts",
    ],
    { cwd: root, env: process.env, windowsHide: true, timeout: 60000 },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(root, ".runtime/lms-one-run/selection-fixture.json"),
      "utf8",
    ),
  );
  await fs.writeFile(
    path.join(evidence, "fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(fixture.director);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const measurements: unknown[] = [];
  const geometry: unknown[] = [];
  async function checkDateControls(screen: string) {
    for (const language of ["RU", "KZ"] as const) {
      await page.getByRole("button", { name: language, exact: true }).click();
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const dimensions = await page.evaluate(() => ({
          pageWidth: document.documentElement.scrollWidth,
          small: [
            ...document.querySelectorAll(
              ".lms-workspace button,.lms-workspace input[type=date],.lms-workspace textarea,.lms-workspace summary",
            ),
          ].flatMap((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width && rect.height && rect.height < 43.5
              ? [{ label: element.textContent, height: rect.height }]
              : [];
          }),
        }));
        expect(dimensions.pageWidth).toBeLessThanOrEqual(width + 1);
        expect(dimensions.small).toEqual([]);
        await page.getByRole("button", { name: language, exact: true }).focus();
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(
          () =>
            document.activeElement !== document.body &&
            getComputedStyle(document.activeElement!).outlineStyle !== "none",
        );
        expect(focused).toBe(true);
        geometry.push({
          screen,
          language,
          width,
          ...dimensions,
          keyboardFocusVisible: focused,
        });
        const summary =
          screen === "date-correction"
            ? language === "RU"
              ? "Уточнить дату экзамена"
              : "Емтихан күнін нақтылау"
            : language === "RU"
              ? "Добавить основание"
              : "Негіз қосу";
        await page
          .locator("summary")
          .filter({ hasText: summary })
          .locator("..")
          .screenshot({
            path: path.join(evidence, `${screen}-${language}-${width}.png`),
          });
      }
    }
    await page.getByRole("button", { name: "RU", exact: true }).click();
  }
  let clicks = 0,
    fields = 0,
    selections = 0;
  const started = performance.now();
  async function search(value: string) {
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/lms/assignment-context") &&
        (url.searchParams.get("search") || "") === value
      );
    });
    await page.getByLabel("Найти сотрудника", { exact: true }).fill(value);
    fields++;
    await loaded;
  }
  await page.goto(
    `/lms/assign?requestId=${fixture.requestId}&versionId=${fixture.courses[0].versionId}`,
  );
  const program = page.getByRole("combobox", {
    name: "Программа",
    exact: true,
  });
  await expect(program).toHaveValue(fixture.courses[0].versionId);
  await program.selectOption(fixture.courses[1].versionId);
  selections++;
  await page
    .getByRole("checkbox", { name: fixture.people[2].name, exact: true })
    .uncheck();
  clicks++;
  await search(fixture.people[0].name);
  await expect(program).toHaveValue(fixture.courses[1].versionId);
  await search("");
  await expect(program).toHaveValue(fixture.courses[1].versionId);
  await expect(
    page.getByRole("checkbox", { name: fixture.people[2].name, exact: true }),
  ).not.toBeChecked();
  const assignmentResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/lms/enrollments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Назначить обучение · 2", exact: true })
    .click();
  clicks++;
  const assignmentHttp = await assignmentResponse;
  const assignment = await assignmentHttp.json();
  expect(assignment.created).toBe(1);
  expect(assignment.errors).toEqual([
    {
      recipientId: fixture.people[1].id,
      code: "EMPLOYMENT_REQUIRED",
      message: "Проверьте связь сотрудника с организацией",
    },
  ]);
  expect(assignmentHttp.request().postDataJSON().courseVersionId).toBe(
    fixture.courses[1].versionId,
  );
  await search(fixture.people[0].name);
  await search("");
  await expect(
    page.getByRole("button", { name: "Назначить обучение · 1", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("checkbox", { name: fixture.people[1].name, exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: fixture.people[0].name, exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: fixture.people[2].name, exact: true }),
  ).not.toBeChecked();
  measurements.push({
    scenario:
      "selection and failed row retained across actual search responses",
    selectedProgram: fixture.courses[1].versionId,
    postedRecipients: assignmentHttp.request().postDataJSON().recipientIds,
    selectedAfterPartial: fixture.people[1].id,
    startBoundary:
      "Authenticated director opens a prepared assignment group; search and clear are intentional regression actions.",
    navigation: 1,
    clicks,
    fields,
    selections,
    repeatedFields: 0,
    dialogs: 0,
    keyboardActions: 0,
    manualRefresh: 0,
    elapsedMilliseconds: performance.now() - started,
  });
  await page.screenshot({
    path: path.join(evidence, "01-assignment-choice-retained.png"),
    fullPage: true,
  });

  await page.goto("/lms/results");
  await expect(
    page.getByRole("button", {
      name: "Подготовить документы · 3",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("checkbox", { name: fixture.results[2].name, exact: true })
    .uncheck();
  const preparedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/lms/results/documents") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Подготовить документы · 2", exact: true })
    .click();
  const prepared = await (await preparedResponse).json();
  expect(prepared.items).toHaveLength(1);
  expect(prepared.errors).toEqual([
    {
      resultId: fixture.results[1].resultId,
      message: "Для программы не заданы документы",
    },
  ]);
  const failedRow = page
    .getByRole("row")
    .filter({ hasText: fixture.results[1].name });
  await expect(failedRow.getByRole("alert")).toHaveText(
    "Для программы не заданы документы",
  );
  await expect(
    page.getByRole("button", {
      name: "Подготовить документы · 1",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("checkbox", { name: fixture.results[2].name, exact: true }),
  ).not.toBeChecked();
  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/lms/results/documents") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Подготовить документы · 1", exact: true })
    .click();
  const retry = await retryResponse;
  expect(retry.request().postDataJSON().resultIds).toEqual([
    fixture.results[1].resultId,
  ]);
  expect((await retry.json()).errors).toHaveLength(1);
  await expect(failedRow.getByRole("alert")).toHaveText(
    "Для программы не заданы документы",
  );
  await expect(
    page.getByRole("link", { name: "Посмотреть комплект", exact: true }),
  ).toHaveAttribute("href", `/requests/${prepared.items[0].requestId}`);
  const untouched = await (
    await page.request.get(
      `/api/lms/enrollments/${fixture.results[2].enrollmentId}`,
    )
  ).json();
  expect(untouched.documents).toEqual([]);
  measurements.push({
    scenario:
      "partial preparation preserves ready item, exact failed row and excluded result",
    initialSelection: fixture.results
      .slice(0, 2)
      .map((row: { resultId: string }) => row.resultId),
    readyDocuments: prepared.items.map((item: { id: string }) => item.id),
    retrySelection: retry.request().postDataJSON().resultIds,
    excludedDocuments: untouched.documents.length,
    navigation: 1,
    clicks: 3,
    fields: 0,
    repeatedFields: 0,
    dialogs: 0,
    keyboardActions: 0,
    manualRefresh: 0,
  });
  await page.screenshot({
    path: path.join(evidence, "02-partial-preparation-retained.png"),
    fullPage: true,
  });

  const pdf = path.join(evidence, "synthetic-external-source.pdf");
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-selection-fixture.ts",
      "--pagination",
    ],
    { cwd: root, env: process.env, windowsHide: true, timeout: 60000 },
  );
  const paginatedFixture = JSON.parse(
    await fs.readFile(
      path.join(root, ".runtime/lms-one-run/selection-fixture.json"),
      "utf8",
    ),
  );
  await fs.writeFile(
    path.join(evidence, "fixture.json"),
    JSON.stringify(paginatedFixture, null, 2),
  );
  await page.goto("/lms/results");
  await expect(
    page.getByRole("button", {
      name: "Подготовить документы · 1",
      exact: true,
    }),
  ).toBeEnabled();
  const firstPage = await (
    await page.request.get("/api/lms/enrollments?page=1&pageSize=250")
  ).json();
  expect(firstPage.total).toBe(259);
  await expect(
    page.getByRole("checkbox", {
      name: paginatedFixture.pagination.name,
      exact: true,
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  const secondPage = await (
    await page.request.get("/api/lms/enrollments?page=2&pageSize=250")
  ).json();
  const selectedOnSecond = secondPage.items.filter(
    (item: {
      result?: { eligible: boolean; documentEligible?: boolean };
      documents: unknown[];
    }) =>
      (item.result?.documentEligible ?? item.result?.eligible) &&
      !item.documents?.length,
  );
  expect(selectedOnSecond.length).toBeGreaterThan(1);
  await expect(
    page.getByRole("button", {
      name: `Подготовить документы · ${selectedOnSecond.length}`,
      exact: true,
    }),
  ).toBeEnabled();
  for (const item of selectedOnSecond.slice(1))
    await page
      .getByRole("checkbox", {
        name: item.recipient.data.fullNameRu,
        exact: true,
      })
      .uncheck();
  await expect(
    page.getByRole("button", {
      name: "Подготовить документы · 1",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: paginatedFixture.pagination.name,
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", {
      name: "Подготовить документы · 1",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: selectedOnSecond[0].recipient.data.fullNameRu,
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Подготовить документы · 1",
      exact: true,
    }),
  ).toBeEnabled();
  await page.screenshot({
    path: path.join(evidence, "05-page-specific-choice-retained.png"),
    fullPage: true,
  });
  measurements.push({
    scenario:
      "independent page subsets survive returning between real server pages",
    totalEnrollments: firstPage.total,
    pageSize: firstPage.pageSize,
    firstPageSelection: [paginatedFixture.pagination.resultId],
    secondPageInitialCount: selectedOnSecond.length,
    secondPageRestoredSelection: [selectedOnSecond[0].result.id],
    addedRealAttempts: 1,
    syntheticAdditionalEnrollments: 253,
    fields: 0,
    repeatedFields: 0,
    dialogs: 0,
    keyboardActions: 0,
    manualRefresh: 0,
  });
  await fs.writeFile(
    pdf,
    syntheticPdf(
      "Synthetic external evidence for local engineering acceptance only.",
    ),
  );
  async function addAndReview(
    p: Page,
    person: { name: string; enrollmentId: string },
    known: boolean,
  ) {
    const metric = measureLmsActions(
      p,
      known
        ? "Д: add and review an external source with known exam date"
        : "Д: add and review an external source with unknown exam date",
      "DIRECTOR",
      known
        ? "Results list is open with prior source details still open"
        : "Authenticated director has results list open",
      [
        "Existing learner, enrollment and course are selected from saved records; new external source metadata has not been entered before.",
        "Prepared fixture setup and selection/pagination regression are separate measurements.",
      ],
    );
    if (known)
      await metric.action("click", "Закрыть предыдущее основание", () =>
        p.getByRole("button", { name: "Закрыть", exact: true }).click(),
      );
    await metric.action("click", "Открыть слушателя", () =>
      p.getByRole("button", { name: person.name, exact: true }).click(),
    );
    await metric.action("click", "Добавить основание", () =>
      p.locator("summary").filter({ hasText: "Добавить основание" }).click(),
    );
    await metric.action("field", "Кем выдан", () =>
      p
        .getByLabel("Кем выдан", { exact: true })
        .fill("Synthetic training center"),
    );
    await metric.action("field", "Источник", () =>
      p.getByLabel("Источник", { exact: true }).fill("Synthetic local source"),
    );
    await metric.action("field", "Номер документа", () =>
      p
        .getByLabel("Номер документа", { exact: true })
        .fill(known ? "KNOWN-001" : "UNKNOWN-001"),
    );
    await metric.action("field", "Дата документа", () =>
      p.getByLabel("Дата документа", { exact: true }).fill("2026-01-14"),
    );
    if (known)
      await metric.action("field", "Дата экзамена", () =>
        p
          .getByLabel("Дата экзамена, если известна", { exact: true })
          .fill("2026-01-12"),
      );
    await metric.action(
      "file",
      "Файл основания",
      () => p.getByLabel("Файл основания", { exact: true }).setInputFiles(pdf),
      { decision: true },
    );
    const uploaded = p.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(
            `/lms/enrollments/${person.enrollmentId}/external-evidence`,
          ) && response.request().method() === "POST",
    );
    await metric.action("click", "Добавить на проверку", () =>
      p
        .getByRole("button", { name: "Добавить на проверку", exact: true })
        .click(),
    );
    const source = await (await uploaded).json();
    expect(source.examDate).toBe(known ? "2026-01-12" : null);
    await metric.action("field", "Как проверено основание", () =>
      p
        .getByLabel("Как проверено основание", { exact: true })
        .fill("Synthetic source read in local engineering acceptance"),
    );
    await metric.action(
      "select",
      "Результат во внешнем документе",
      () =>
        p
          .getByRole("combobox", {
            name: "Результат во внешнем документе",
            exact: true,
          })
          .selectOption("PASSED"),
      { decision: true },
    );
    const reviewed = p.waitForResponse(
      (response) =>
        response.url().endsWith(`/lms/external-evidence/${source.id}/review`) &&
        response.request().method() === "POST",
    );
    await metric.action(
      "click",
      "Подтвердить проверку",
      () =>
        p
          .getByRole("button", { name: "Подтвердить проверку", exact: true })
          .click(),
      { decision: true, confirmation: true },
    );
    expect((await reviewed).ok()).toBe(true);
    measurements.push(
      metric.finish({
        sourceId: source.id,
        examDate: source.examDate,
        documentDate: source.documentDate,
        reviewed: true,
      }),
    );
    return source;
  }
  const unknown = await addAndReview(page, fixture.external[0], false);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: fixture.external[0].name })
      .getByText("Уточните дату внешнего экзамена", { exact: true }),
  ).toBeVisible();
  const correctionMetric = measureLmsActions(
    page,
    "Д: clarify unknown exam date without repeated source fields",
    "DIRECTOR",
    "Reviewed source with unknown exam date is open",
    [
      "Source bytes, issuer, document number, document date, learner and enrollment are already saved.",
      "Only newly established exam date and justification are entered; existing evidence is immutable.",
    ],
  );
  await correctionMetric.action("click", "Уточнить дату экзамена", () =>
    page
      .locator("summary")
      .filter({ hasText: "Уточнить дату экзамена" })
      .click(),
  );
  await correctionMetric.action("field", "Дата экзамена", () =>
    page.getByLabel("Дата экзамена", { exact: true }).fill("2026-01-10"),
  );
  await correctionMetric.action("field", "Основание уточнения", () =>
    page
      .getByLabel("Основание уточнения", { exact: true })
      .fill("Synthetic source confirms exam date; original file retained"),
  );
  await correctionMetric.exclude(() => checkDateControls("date-correction"));
  const datedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/lms/external-evidence/${unknown.id}/date`) &&
      response.request().method() === "POST",
  );
  await correctionMetric.action(
    "click",
    "Сохранить уточнение",
    () =>
      page
        .getByRole("button", { name: "Сохранить уточнение", exact: true })
        .click(),
    { decision: true },
  );
  const datedHttp = await datedResponse;
  expect(datedHttp.ok()).toBe(true);
  const dated = await datedHttp.json();
  expect(dated.id).not.toBe(unknown.id);
  expect(dated.examDate).toBe("2026-01-10");
  expect(dated.documentDate).toBe("2026-01-14");
  expect(dated.sha256).toBe(unknown.sha256);
  const sources = await (
    await page.request.get(
      `/api/lms/enrollments/${fixture.external[0].enrollmentId}/external-evidence`,
    )
  ).json();
  expect(
    sources.items.find((item: { id: string }) => item.id === unknown.id).examAt,
  ).toBeNull();
  const revised = await (
    await page.request.get(
      `/api/lms/enrollments/${fixture.external[0].enrollmentId}`,
    )
  ).json();
  expect(revised.results).toHaveLength(2);
  expect(
    revised.results.filter(
      (item: { documentEligible: boolean }) => item.documentEligible,
    ),
  ).toHaveLength(1);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: fixture.external[0].name })
      .getByText("Уточните дату внешнего экзамена", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidence, "03-date-correction-with-history.png"),
    fullPage: true,
  });
  measurements.push(
    correctionMetric.finish({
      oldSourceId: unknown.id,
      newSourceId: dated.id,
      unchangedFile: dated.sha256 === unknown.sha256,
      examDate: dated.examDate,
      resultRevisions: revised.results.length,
    }),
  );
  const known = await addAndReview(page, fixture.external[1], true);
  const knownResult = await (
    await page.request.get(
      `/api/lms/enrollments/${fixture.external[1].enrollmentId}`,
    )
  ).json();
  expect(knownResult.results[0].documentEligible).toBe(true);
  expect(known.documentDate).toBe("2026-01-14");
  await expect(
    page.getByText("Дата экзамена: 2026-01-12", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "04-separate-known-exam-date.png"),
    fullPage: true,
  });
  await checkDateControls("date-upload");
  measurements.push({
    scenario: "separate known/unknown exam date and immutable correction",
    documentDate: known.documentDate,
    knownExamDate: known.examDate,
    unknownOriginalEvidenceId: unknown.id,
    datedEvidenceId: dated.id,
    unchangedPrivateFileSha256: dated.sha256,
    resultRevisions: revised.results.length,
    originalExamAt: null,
    correction: {
      startBoundary:
        "Unknown reviewed source is already open in the result details.",
      clicks: 2,
      fields: 2,
      repeatedFields: 0,
      selections: 0,
      dialogs: 0,
      fileSelections: 0,
      keyboardActions: 0,
      manualRefresh: 0,
      navigation: 0,
    },
    initialUploadFileSelections: 2,
    nativeFilePickerObserved: false,
  });
  await fs.writeFile(
    path.join(evidence, "acceptance.json"),
    JSON.stringify(
      {
        status: "PASS",
        checkedAt: new Date().toISOString(),
        fixtureVersion: fixture.fixtureVersion,
        setup: fixture.boundary,
        measurements,
        geometry,
        boundary:
          "Real local API and browser; synthetic data and input PDF only. Search/clear, retry and geometry actions intentionally exercise regressions and do not claim a prepared-flow action budget. No network provider, legal authority, issued external document or physical printing claimed.",
      },
      null,
      2,
    ),
  );
});
