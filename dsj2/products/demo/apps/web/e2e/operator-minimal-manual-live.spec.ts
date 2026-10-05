import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import { templateIds } from "@demo/contracts";
import {
  loginRole,
  readPrintDetail,
  waitOriginalJobs,
} from "./operator-role-fixture";

test("manual 20 people use one group position employer and courses, director reviews effective values and files retain snapshot", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(900000);
  expect(new URL(process.env.DEMO_ORIGIN!).hostname).toBe("127.0.0.1");
  const operator = await loginRole(page, "OPERATOR");
  const resumedId = process.env.DEMO_E2E_MANUAL_REQUEST_ID;
  if (resumedId) {
    expect(resumedId).toMatch(/^[a-f0-9-]{36}$/);
    await page.goto(`/requests/${resumedId}/edit`);
    const existing = await readPrintDetail(page, resumedId);
    expect(existing.items).toHaveLength(20);
    expect(existing.issuances).toHaveLength(1);
    expect(existing.documents).toHaveLength(105);
    await waitOriginalJobs(page, resumedId, 600000);
    await verifyManualIssuance(
      page,
      resumedId,
      existing,
      [
        "Продолжение той же ручной заявки после ORIGINAL_RENDER_TIMEOUT: ввод/передача/согласование/выпуск уже выполнены предыдущим UI-прогоном; новая заявка и повторный выпуск не создаются",
      ],
      testInfo,
    );
    return;
  }
  const suffix = randomUUID().slice(0, 8);
  const steps: string[] = [];
  // Configure the synthetic centre once through its actual settings UI. This
  // is a fixture schedule, never a claimed real-world or universal programme.
  const setupContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  try {
    const setup = await setupContext.newPage();
    await loginRole(setup, "DIRECTOR");
    await setup.goto("/settings");
    const schedule = setup.getByRole("region", {
      name: "График обучения центра",
    });
    await schedule
      .getByText("Правило расчёта периода обучения", { exact: true })
      .click();
    const configuredSchedule =
      (await schedule
        .getByLabel("Часов в учебном дне", { exact: true })
        .inputValue()) === "8" &&
      (await schedule
        .getByLabel("Какие часы учитывать", { exact: true })
        .inputValue()) === "THEORY" &&
      (await schedule
        .getByLabel("Учебные дни", { exact: true })
        .inputValue()) === "KZ_FIVE_DAY" &&
      (await schedule
        .getByLabel("Связь с датой документа", { exact: true })
        .inputValue()) === "DOCUMENT_AFTER_TRAINING" &&
      (await schedule
        .getByLabel("Расчёт даты протокола", { exact: true })
        .inputValue()) === "DOCUMENT_DATE";
    if (!configuredSchedule) {
      await schedule
        .getByLabel("Часов в учебном дне", { exact: true })
        .fill("8");
      await schedule
        .getByLabel("Какие часы учитывать", { exact: true })
        .selectOption("THEORY");
      await schedule
        .getByLabel("Учебные дни", { exact: true })
        .selectOption("KZ_FIVE_DAY");
      await schedule
        .getByLabel("Связь с датой документа", { exact: true })
        .selectOption("DOCUMENT_AFTER_TRAINING");
      await schedule
        .getByLabel("Расчёт даты протокола", { exact: true })
        .selectOption("DOCUMENT_DATE");
      await schedule
        .getByLabel("Источник графика", { exact: true })
        .fill(`СИНТЕТИЧЕСКИЙ график локальной проверки ${suffix}`);
      await schedule
        .getByRole("button", {
          name: "Проверить применение графика",
          exact: true,
        })
        .click();
      await schedule
        .getByRole("button", { name: "Применить правило расчёта", exact: true })
        .click();
      const savedProfile = setup.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/settings/profile"),
      );
      await setup
        .getByRole("button", { name: "Сохранить новую версию", exact: true })
        .click();
      expect((await savedProfile).ok()).toBe(true);
    }
    steps.push(
      configuredSchedule
        ? "Через UI проверен ранее сохранённый график центра; повторное сохранение профиля не требуется"
        : "Синтетический график центра сохранён через настройки один раз до новых заявок, без ввода графиков людей",
    );
  } finally {
    await setupContext.close();
  }
  await page.goto("/requests/new");
  await page
    .getByRole("radio", { name: "Физическое лицо", exact: true })
    .check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
  const id = /\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
  steps.push("Создать физлицо: выбор типа и Далее");
  for (let index = 1; index <= 20; index++) {
    const input = page.getByLabel(`ФИО, строка ${index}`, { exact: true });
    await input.fill(
      `Синтетический ${suffix} Человек ${String(index).padStart(2, "0")}`,
    );
    if (index < 20) await input.press("Enter");
  }
  steps.push(
    "20 уникальных ФИО, Enter создаёт следующую строку; карточки людей не открывались",
  );
  await page
    .getByLabel("Категория сотрудника, строка 20", { exact: true })
    .selectOption("ITR");
  await page
    .getByLabel("Общая должность / профессия · RU", { exact: true })
    .fill("Слесарь");
  await page
    .getByLabel("Общая должность / профессия · KZ", { exact: true })
    .fill("Слесарь");
  await page
    .getByRole("button", {
      name: "Заполнить пустые должности (20)",
      exact: true,
    })
    .click();
  steps.push(
    "Одна общая должность RU/KZ, одно применение к 20 людям; одна категория ИТР как исключение",
  );
  await page
    .getByRole("button", { name: "Общий работодатель (20)", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Новая организация", exact: true })
    .click();
  const company = page.getByRole("dialog", {
    name: "Новая организация",
    exact: true,
  });
  await company
    .getByRole("combobox", { name: "Форма организации", exact: true })
    .selectOption("TOO");
  await company
    .getByRole("textbox", { name: /^Собственное наименование/ })
    .fill(`Синтетический работодатель ${suffix}`);
  await company.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Применить для 20", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  steps.push(
    "Новый работодатель введён один раз и применён ко всем; неизвестные БИН/адрес не выдумываются и ordinary ИТР не блокируют",
  );
  for (const course of ["БиОТ", "ПТМ", "ПБ", "ПС"])
    await page
      .getByRole("button", {
        name: `${course}: добавить всем в заявке (20)`,
        exact: true,
      })
      .click();
  for (const course of ["ПТМ", "ПБ", "ПС"])
    await page
      .getByLabel(`${course} · Часы программы`, { exact: true })
      .fill("16");
  steps.push(
    "Синтетическая длительность ПТМ/ПБ/ПС задана один раз на курс: по 16 часов; для БиОТ использованы defaults категории",
  );
  await expect(
    page.getByRole("textbox", { name: /^Отрасль · RU/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: /^Результат проверки знаний/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: /^Результат прокторинга/ }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("БИН предприятия, строка 20", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Адрес предприятия · RU, строка 20", { exact: true }),
  ).toHaveCount(0);
  steps.push(
    "Четыре выбора курса для всей группы; обычный ИТР получает ITR_STANDARD без специальных сведений и повторного подтверждения сдачи",
  );
  await expect
    .poll(async () => {
      const saved = await readPrintDetail(page, id);
      return (
        saved.items.length === 20 &&
        saved.events?.length === 5 &&
        saved.items[19].assignments
          .filter((assignment) => assignment.templateId.startsWith("biot-"))
          .every((assignment) => assignment.biotCategory === "ITR_STANDARD")
      );
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 20", { exact: true })).toHaveValue(
    `Синтетический ${suffix} Человек 20`,
  );
  const saved = await readPrintDetail(page, id);
  expect(saved.status).toBe("DRAFT");
  expect(saved.approval?.status).not.toBe("PENDING");
  expect(
    saved.items.every((person) =>
      person.assignments.every(
        (assignment) => assignment.outcome?.status === "PASSED",
      ),
    ),
  ).toBe(true);
  const ready = page.getByRole("region", {
    name: "Готовность и состав следующего выпуска",
  });
  const validationPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/print-requests/${id}/approval/submit`),
    { timeout: 210000 },
  );
  await ready
    .getByRole("button", { name: /Проверить и передать директору/ })
    .click();
  const validationResponse = await validationPromise;
  expect(validationResponse.ok(), await validationResponse.text()).toBe(true);
  const validation = await validationResponse.json();
  expect(validation.approval.status).toBe("PENDING");
  expect(validation.approval.assignments).toHaveLength(
    saved.items.reduce((total, row) => total + row.assignments.length, 0),
  );
  await expect
    .poll(async () => (await readPrintDetail(page, id)).approval?.status, {
      timeout: 210000,
    })
    .toBe("PENDING");
  steps.push(
    "Одна передача директору сохраняет и проверяет все 20 человек; отдельные Сохранить/Проверить/выбор всех не нужны",
  );
  const submitted = await readPrintDetail(page, id);
  const directorContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  try {
    const directorPage = await directorContext.newPage();
    const director = await loginRole(directorPage, "DIRECTOR");
    expect(director.session.tenant.id).toBe(operator.session.tenant.id);
    await directorPage.goto(
      `/approvals?proposal=${submitted.approval!.proposalId}`,
    );
    await expect(
      directorPage.getByRole("region", {
        name: "Подготовленные данные редакции",
      }),
    ).toContainText("20 человек");
    await directorPage
      .getByRole("button", {
        name: "Посмотреть образцы PDF и общие протоколы",
        exact: true,
      })
      .click();
    await expect(
      directorPage.getByRole("combobox", {
        name: "Документ для просмотра",
        exact: true,
      }),
    ).toBeVisible({ timeout: 180000 });
    await directorPage.screenshot({
      path: testInfo.outputPath("manual20-director-review.png"),
      fullPage: true,
    });
    await directorPage
      .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
      .click();
    await expect
      .poll(async () => (await readPrintDetail(page, id)).approval?.status)
      .toBe("APPROVED");
    steps.push(
      "Директор: открыть редакцию, просмотреть сводку и образец PDF, одно согласование всего состава",
    );
    // The operator receives the decision automatically, without reload.
    const finalize = page.getByRole("button", {
      name: "Сформировать документы",
      exact: true,
    });
    await expect(finalize).toBeEnabled({ timeout: 20000 });
    await finalize.click();
    await fs.writeFile(
      testInfo.outputPath("manual20-before-render-wait.json"),
      JSON.stringify({ requestId: id, steps, saved, submitted }, null, 2),
    );
    await waitOriginalJobs(page, id, 600000);
    await verifyManualIssuance(page, id, saved, steps, testInfo, submitted);
  } finally {
    await directorContext.close();
  }
});

async function verifyManualIssuance(
  page: Page,
  id: string,
  saved: Awaited<ReturnType<typeof readPrintDetail>>,
  steps: string[],
  testInfo: TestInfo,
  submitted?: Awaited<ReturnType<typeof readPrintDetail>>,
) {
  const issued = await readPrintDetail(page, id);
  expect(
    [...new Set(issued.documents.map((entry) => entry.templateId))].sort(),
  ).toEqual([...templateIds].sort());
  expect(issued.issuances).toHaveLength(1);
  const snapshot = issued.issuances[0].snapshot.draft;
  expect(snapshot.items).toHaveLength(20);
  expect(snapshot.englishAppendix).toBe(false);
  for (const row of snapshot.items) {
    expect(Object.keys(row).filter((key) => key.endsWith("En"))).toEqual([]);
    for (const assignment of row.assignments)
      expect(
        Object.keys(assignment).filter((key) => key.endsWith("En")),
      ).toEqual([]);
  }
  for (const assignment of snapshot.items[19].assignments.filter((entry) =>
    entry.templateId.startsWith("biot-"),
  )) {
    expect(assignment.biotCategory).toBe("ITR_STANDARD");
    expect(assignment.biotIndustryRu || "").toBe("");
    expect(assignment.biotKnowledgeResult || "").toBe("");
    expect(assignment.biotProctoringResult || "").toBe("");
  }
  for (const row of snapshot.items)
    for (const assignment of row.assignments) {
      expect(assignment.trainingStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(assignment.trainingEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(assignment.protocolDate).toBe(assignment.documentDate);
    }
  expect(snapshot.items.map((row) => row.fullNameRu)).toEqual(
    saved.items.map((row) => row.fullNameRu),
  );
  const artifacts = issued.artifacts.filter((artifact) =>
    ["PDF", "DOCX"].includes(artifact.format || ""),
  );
  expect(artifacts.some((artifact) => artifact.format === "PDF")).toBe(true);
  expect(artifacts.some((artifact) => artifact.format === "DOCX")).toBe(true);
  // Download each of the 11 template IDs in both formats. This flow uses
  // five group protocols; the separate render matrix also covers their
  // individual variants, for all 16 ordinary forms.
  const examples = new Map<string, (typeof artifacts)[number]>();
  for (const artifact of artifacts) {
    const document = issued.documents.find(
      (entry) => entry.id === artifact.documentId,
    );
    if (document && !examples.has(`${document.templateId}.${artifact.format}`))
      examples.set(`${document.templateId}.${artifact.format}`, artifact);
  }
  expect([...examples.keys()].sort()).toEqual(
    templateIds.flatMap((id) => [`${id}.DOCX`, `${id}.PDF`]).sort(),
  );
  const paths: Record<string, string> = {};
  for (const [key, artifact] of examples) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
    paths[key] = testInfo.outputPath(`example-${key.toLowerCase()}`);
    await fs.writeFile(paths[key], bytes);
  }
  await page.screenshot({
    path: testInfo.outputPath("manual20-files.png"),
    fullPage: true,
  });
  await fs.writeFile(
    testInfo.outputPath("manual20-readback.json"),
    JSON.stringify(
      {
        synthetic: true,
        noApiPrefill: true,
        resumedAfterRenderTimeout: !submitted,
        requestId: id,
        steps,
        saved,
        submitted,
        snapshot,
        documents: issued.documents,
        originalJobs: issued.jobs.filter((job) => job.issuanceId),
        examples: paths,
      },
      null,
      2,
    ),
  );
}
