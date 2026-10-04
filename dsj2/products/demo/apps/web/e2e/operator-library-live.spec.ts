import { loginIsolated } from "./operator-full-fix-session";
import { loginRole } from "./operator-role-fixture";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/operator-value/library-browser",
);
test("live source document verification, person/program matrix and selected center dossier ZIP", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  await fs.mkdir(evidence, { recursive: true });
  const suffix = Date.now();
  const title = `Синтетический источник ${suffix}`;
  const customerName = `Заказчик матрицы ${suffix}`;
  const personName = `Получатель матрицы ${suffix}`;
  await loginIsolated(page);
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "demo_csrf",
  )!.value;
  const headers = { origin: process.env.DEMO_ORIGIN!, "x-csrf-token": csrf };
  const post = async (endpoint: string, data: unknown) => {
    const response = await page.request.post(`/api${endpoint}`, {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const customer = await post("/customers", {
    nameRu: customerName,
    nameKz: customerName,
  });
  const person = await post("/recipients", {
    id: crypto.randomUUID(),
    fullNameRu: personName,
    employerId: customer.id,
    assignments: [],
  });
  // The administrator prepares a rule; every workbench action below uses the operator.
  const administratorContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  let rule: { id: string; serviceKey: string };
  try {
    const administratorPage = await administratorContext.newPage();
    const administrator = await loginRole(administratorPage, "ADMIN");
    const ruleResponse = await administratorPage.request.post(
      "/api/service-rules",
      {
        headers: administrator.headers,
        data: {
          serviceKey: `matrix_${suffix}`,
          title,
          status: "APPROVED",
          source: "Синтетическое подтверждённое правило для UI",
          applicability: "Только тестовый набор",
          checkedOn: "2026-09-24",
          definition: {
            programVersion: "1",
            category: "",
            compatibleTemplateIds: ["pb-card", "pb-protocol"],
            requirements: [],
            limitation: "Не подтверждает допуск",
          },
        },
      },
    );
    expect(ruleResponse.ok(), await ruleResponse.text()).toBe(true);
    rule = await ruleResponse.json();
  } finally {
    await administratorContext.close();
  }
  await page.goto("/workbench");
  await page
    .getByRole("tab", { name: "Источники и правила", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить запись с источником", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выбрать заказчика", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(customerName);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: customerName })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выбрать человека", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(personName);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: personName })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  for (const [label, value] of [
    ["Направление / программа", rule.serviceKey],
    ["Источник документа / требования", "Получено от синтетического заказчика"],
    ["Фактический эмитент", "Другой синтетический учебный центр"],
    ["Номер внешнего документа", `EXT-000${suffix}`],
    ["Дата документа", "2026-09-20"],
    ["Срок действия (если подтверждён)", "2027-09-20"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", { name: "Сохранить запись", exact: true })
    .click();
  await expect(
    page.getByText("Запись сохранена.", { exact: true }),
  ).toBeVisible();
  const record = page.getByRole("row").filter({ hasText: `EXT-000${suffix}` });
  await expect(record).toContainText("Не проверен");
  await record
    .getByLabel("Основание проверки", { exact: true })
    .fill("Синтетический источник просмотрен уполномоченным оператором");
  await record
    .getByRole("button", { name: "Подтвердить проверку", exact: true })
    .click();
  await expect(record).toContainText("Проверен");
  await page
    .getByText("Матрица сведений: люди и программы", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выбрать заказчика для матрицы", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(customerName);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: customerName })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page.getByLabel(new RegExp(title)).check();
  await page
    .getByRole("button", { name: "Показать матрицу", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: personName, exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Внешний источник", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "evidence-matrix.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Досье центра", exact: true }).click();
  await page
    .getByRole("button", { name: "Добавить запись с источником", exact: true })
    .click();
  const dossierTitle = `Программа для пакета ${suffix}`;
  for (const [label, value] of [
    ["Название", dossierTitle],
    ["Источник документа / требования", "Синтетический внутренний акт"],
    ["Версия программы / документа", "1"],
    ["Применимость", "Тестовый заказчик"],
    ["Контрольный срок", "2026-09-24"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByLabel("Разрешить включение в комплект заказчика", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Сохранить запись", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: dossierTitle }),
  ).toBeVisible();
  const dossierRow = page.getByRole("row").filter({ hasText: dossierTitle });
  await dossierRow.getByText("Файлы источника (0)", { exact: true }).click();
  await dossierRow
    .getByLabel("Источник вложения", { exact: true })
    .fill("Синтетическая программа для пакета заказчика");
  const sourcePng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 100;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "white";
    drawing.fillRect(0, 0, 320, 100);
    drawing.fillStyle = "black";
    drawing.font = "18px sans-serif";
    drawing.fillText("SYNTHETIC SOURCE — UI TEST", 10, 50);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await dossierRow
    .getByLabel("PDF, PNG или JPEG до 1 МБ", { exact: true })
    .setInputFiles({
      name: "synthetic-program.png",
      mimeType: "image/png",
      buffer: Buffer.from(sourcePng, "base64"),
    });
  await dossierRow
    .getByLabel("Разрешить это вложение в выбранном пакете заказчика", {
      exact: true,
    })
    .check();
  await dossierRow
    .getByRole("button", { name: "Сохранить файл источника", exact: true })
    .click();
  await expect(
    dossierRow.getByText("Файлы источника (1)", { exact: true }),
  ).toBeVisible();
  await expect(
    dossierRow.getByRole("link", {
      name: "synthetic-program.png",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByText("Выбранное досье для заказчика и контроль сроков", {
      exact: true,
    })
    .click();
  await page.getByLabel(dossierTitle, { exact: true }).check();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать выбранное досье ZIP", exact: true })
    .click();
  const download = await downloadPromise;
  const file = path.join(evidence, "selected-dossier.zip");
  await download.saveAs(file);
  expect((await fs.readFile(file)).subarray(0, 2).toString()).toBe("PK");
  await page
    .getByLabel("Дата проверки сроков", { exact: true })
    .fill("2026-09-24");
  await page
    .getByRole("button", {
      name: "Показать сроки на ближайшие 30 дней",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Сроки записей проверены.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "selected-dossier.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "dossier-mobile.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "library-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        syntheticDataOnly: true,
        customerId: customer.id,
        recipientId: person.id,
        ruleId: rule.id,
        externalEvidenceInitiallyUnverified: true,
        explicitStaffVerification: true,
        scopedMatrixSource: "EXTERNAL",
        selectedDossierDownload: "selected-dossier.zip",
        baselineMs: null,
        limitation:
          "API fixtures create an isolated customer/person/approved rule; document entry, manual verification, matrix and selected export exercised through actual UI.",
      },
      null,
      2,
    ),
  );
});
