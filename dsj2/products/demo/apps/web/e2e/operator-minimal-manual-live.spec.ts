import { test, expect } from "@playwright/test";
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
    await schedule.getByLabel("Часов в учебном дне", { exact: true }).fill("8");
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
    steps.push(
      "Синтетический график центра сохранён через настройки один раз до новых заявок, без ввода графиков людей",
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
  await company.locator(".customer-extra-fields > summary").click();
  await company.getByLabel("БИН", { exact: true }).fill("123456789012");
  await company
    .getByLabel("Адрес на русском", { exact: true })
    .fill("СИНТЕТИЧЕСКИЙ адрес, Алматы");
  await company
    .getByLabel("Адрес на казахском", { exact: true })
    .fill("СИНТЕТИЧЕСКИЙ адрес, Алматы");
  await company.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Применить для 20", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  steps.push(
    "Новый работодатель с БИН/адресом введён один раз и применён ко всем",
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
  await page
    .getByRole("textbox", { name: /^Отрасль · RU/ })
    .fill("СИНТЕТИЧЕСКАЯ отрасль проверки");
  await page
    .getByLabel("Отрасль · KZ", { exact: true })
    .fill("СИНТЕТИЧЕСКАЯ отрасль проверки");
  await page
    .getByRole("textbox", { name: /^Результат проверки знаний/ })
    .fill("СИНТЕТИЧЕСКАЯ проверка знаний: сдал");
  await page
    .getByRole("textbox", { name: /^Результат прокторинга/ })
    .fill("СИНТЕТИЧЕСКАЯ проверка прокторинга завершена");
  steps.push(
    "Четыре выбора курса для всей группы; фактические сведения ИТР введены один раз рядом с курсом",
  );
  await expect
    .poll(async () => {
      const saved = await readPrintDetail(page, id);
      return (
        saved.items.length === 20 &&
        saved.events?.length === 5 &&
        saved.events.some((event) =>
          event.commonFields.biotProctoringResult?.includes("СИНТЕТИЧЕСКАЯ"),
        )
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
      response.url().endsWith(`/print-requests/${id}/validate`),
    { timeout: 210000 },
  );
  await ready
    .getByRole("button", { name: /Проверить и передать директору/ })
    .click();
  const validationResponse = await validationPromise;
  const validation = await validationResponse.json();
  expect(validation.valid, JSON.stringify(validation)).toBe(true);
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
    await waitOriginalJobs(page, id, 600000);
    const issued = await readPrintDetail(page, id);
    expect(
      [...new Set(issued.documents.map((entry) => entry.templateId))].sort(),
    ).toEqual([...templateIds].sort());
    expect(issued.issuances).toHaveLength(1);
    const snapshot = issued.issuances[0].snapshot.draft;
    expect(snapshot.items).toHaveLength(20);
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
    // Download one example of every active form and format for independent text/visual review.
    const examples = new Map<string, (typeof artifacts)[number]>();
    for (const artifact of artifacts) {
      const document = issued.documents.find(
        (entry) => entry.id === artifact.documentId,
      );
      if (
        document &&
        !examples.has(`${document.templateId}.${artifact.format}`)
      )
        examples.set(`${document.templateId}.${artifact.format}`, artifact);
    }
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
          requestId: id,
          steps,
          saved,
          submitted,
          snapshot,
          documents: issued.documents,
          examples: paths,
        },
        null,
        2,
      ),
    );
  } finally {
    await directorContext.close();
  }
});
