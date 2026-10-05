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
  // The isolated single renderer measured about 27 minutes for 212 jobs.
  test.setTimeout(3600000);
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
    await waitOriginalJobs(page, resumedId, 2700000);
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
  await page.getByRole("radio", { name: /^Организация/ }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
  const id = /\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
  const companyName = `Синтетический работодатель ${suffix}`;
  await page.getByLabel("Название компании", { exact: true }).fill(companyName);
  steps.push(
    "Создать заявку организации: выбор типа и Далее; название компании введено один раз в общей карточке, без повторного работодателя у сотрудников",
  );
  const expectedPositions = Array.from({ length: 20 }, (_, index) => ({
    ru: index === 19 ? "Инженер" : "Слесарь",
    kz: index === 19 ? "Инженер" : "Жөндеуші",
  }));
  for (let index = 1; index <= 20; index++) {
    const input = page.getByLabel(`ФИО, строка ${index}`, { exact: true });
    await input.fill(
      `Синтетический ${suffix} Человек ${String(index).padStart(2, "0")}`,
    );
    await page
      .getByLabel(`Должность · RU, строка ${index}`, { exact: true })
      .fill(expectedPositions[index - 1].ru);
    await page
      .getByLabel(`Должность · KZ, строка ${index}`, { exact: true })
      .fill(expectedPositions[index - 1].kz);
    if (index < 20) await input.press("Enter");
  }
  steps.push(
    "20 уникальных ФИО введены в таблицу, 19 нажатий Enter создают следующие строки; 20 должностей RU и 20 отдельных KZ-вариантов введены по строкам, карточки людей не открывались",
  );
  await page
    .getByLabel("Категория сотрудника, строка 20", { exact: true })
    .selectOption("ITR");
  steps.push(
    "19 сотрудников оставлены рабочими, у двадцатого явно выбрана категория ИТР; его должность введена самостоятельно",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  steps.push(
    "Работодатель наследуется из компании заявки; неизвестные БИН и адрес не выдумываются и обычного ИТР не блокируют",
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
  // Row autosave retains the prepared company without creating a directory
  // entry. Explicit Save is the first business action that attaches it.
  expect((await readPrintDetail(page, id)).customerId).toBeNull();
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  const companyCreated = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/customers"),
  );
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  const companyResponse = await companyCreated;
  expect(companyResponse.ok(), await companyResponse.text()).toBe(true);
  const attachedCompany = await companyResponse.json();
  await expect
    .poll(async () => (await readPrintDetail(page, id)).customerId)
    .toBe(attachedCompany.id);
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  steps.push(
    "Явное Сохранить изменения создаёт и привязывает подготовленную компанию один раз; автосохранение строк до этого справочник не изменяло",
  );
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 20", { exact: true })).toHaveValue(
    `Синтетический ${suffix} Человек 20`,
  );
  const saved = await readPrintDetail(page, id);
  expect(saved.kind).toBe("COMPANY");
  expect(saved.customerId).toBeTruthy();
  await expect(page.locator("#request-customer")).toContainText(companyName);
  expect(
    saved.items.filter((item) => item.employeeCategory === "WORKER"),
  ).toHaveLength(19);
  expect(
    saved.items.filter((item) => item.employeeCategory === "ITR"),
  ).toHaveLength(1);
  expect(
    saved.items.map((item) => ({ ru: item.positionRu, kz: item.positionKz })),
  ).toEqual(expectedPositions);
  for (const item of saved.items) {
    expect(item.workplaceRu || "").toBe("");
    expect(item.workplaceKz || "").toBe("");
    expect(item.employerId || "").toBe("");
  }
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
    const viewer = directorPage.getByRole("region", {
      name: "Предпросмотр назначенных документов",
    });
    const reviewedPerson = submitted.items[19];
    const reviewedAssignment = reviewedPerson.assignments.find(
      (assignment) => assignment.templateId === "biot-itr-certificate",
    )!;
    const reviewedTarget = {
      kind: "ASSIGNMENT",
      rowId: reviewedPerson.id,
      assignmentId: reviewedAssignment.id,
    };
    const selector = viewer.getByRole("combobox", {
      name: "Человек и форма документа",
      exact: true,
    });
    await selector.selectOption(JSON.stringify(reviewedTarget));
    await expect(selector.locator("option:checked")).toContainText(
      reviewedPerson.fullNameRu,
    );
    await viewer
      .getByRole("button", { name: "Создать предпросмотр", exact: true })
      .click();
    await expect(
      viewer.getByRole("img", { name: /^Страница 1 из/ }),
    ).toBeVisible({ timeout: 180000 });
    await expect(
      viewer.getByRole("link", { name: "Открыть PDF", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.getByRole("link", { name: "Скачать DOCX", exact: true }),
    ).toBeVisible();
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
      "Директор: открыть редакцию и сводку, выбрать удостоверяемого ИТР в строке 20 и его сертификат в адресном предпросмотре, дождаться реального PDF, одно согласование всего состава",
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
    await waitOriginalJobs(page, id, 2700000);
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
  expect(issued.documents).toHaveLength(105);
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
  expect(
    snapshot.items.map((row) => ({ ru: row.positionRu, kz: row.positionKz })),
  ).toEqual(
    saved.items.map((row) => ({ ru: row.positionRu, kz: row.positionKz })),
  );
  if (saved.kind === "COMPANY") {
    expect(snapshot.kind).toBe("COMPANY");
    expect(snapshot.customerId).toBe(saved.customerId);
  }
  const artifacts = issued.artifacts.filter(
    (artifact) =>
      artifact.provenance === "ORIGINAL" &&
      ["PDF", "DOCX"].includes(artifact.format || ""),
  );
  expect(
    artifacts.filter((artifact) => artifact.format === "PDF"),
  ).toHaveLength(105);
  expect(
    artifacts.filter((artifact) => artifact.format === "DOCX"),
  ).toHaveLength(105);
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
        newScenarioInput: submitted
          ? {
              kind: "COMPANY",
              companyNameEntries: 1,
              fullNameEntries: 20,
              enterToAddRow: 19,
              individualPositionRuEntries: 20,
              individualPositionKzEntries: 20,
              sharedPositionApplicationActions: 0,
              repeatedEmployerEntries: 0,
              explicitItrCategoryChoices: 1,
              requestCourseChoices: 4,
              courseHoursEntries: 3,
              humanUsabilityMeasurement: false,
            }
          : undefined,
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
