import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : path.resolve(__dirname, "../../../docs/evidence/browser");
test.beforeAll(async ({ browser }) => {
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "environment.json"),
    JSON.stringify(
      {
        browser: browser.browserType().name(),
        browserVersion: browser.version(),
        channel: process.env.DEMO_E2E_CHANNEL || "playwright-pinned",
        node: process.version,
        platform: process.platform,
        origin: process.env.DEMO_ORIGIN || "http://localhost:3100",
        syntheticDataOnly: true,
      },
      null,
      2,
    ),
  );
});
function zipText(bytes: Buffer, wanted: string) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP directory missing");
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    if (name === wanted) {
      const local = bytes.readUInt32LE(cursor + 42);
      const start =
        local +
        30 +
        bytes.readUInt16LE(local + 26) +
        bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(
        start,
        start + bytes.readUInt32LE(cursor + 20),
      );
      return (
        bytes.readUInt16LE(cursor + 10) === 8
          ? inflateRawSync(compressed)
          : compressed
      ).toString("utf8");
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry missing: ${wanted}`);
}
async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL || "admin@demo.local");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD || "Local-Demo-2026-Print!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
}
async function newPerson(page: Page) {
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await expect(page.getByLabel("ФИО RU, строка 1")).toBeVisible();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}
test("person: bilingual refresh, final characters, PDF/DOCX originals, immutable history and correction", async ({
  page,
}) => {
  await fs.mkdir(evidence, { recursive: true });
  await login(page);
  await newPerson(page);
  const title = `Браузер · человек ${Date.now()}`;
  await page.getByLabel("Название заявки", { exact: true }).fill(title);
  await page.getByLabel("ФИО RU, строка 1").fill("Проверочный Иван Васильевич");
  await page.getByLabel("ФИО KZ, строка 1").fill("Тексеру Әли Қасымұлы");
  const demoMode = page.getByLabel("Тестовый комплект", { exact: true });
  if (await demoMode.isEnabled()) await demoMode.check();
  else await expect(demoMode).toBeChecked();
  await page.getByLabel("Дата документа", { exact: true }).fill("2026-09-22");
  await page
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill("Контрольный курс: безопасность работ");
  await page
    .getByLabel("Подтверждённый результат / оценка")
    .fill("Результат контрольного образца");
  await page.getByRole("button", { name: "Фото", exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#d8e9ef";
    ctx.fillRect(0, 0, 800, 1000);
    ctx.fillStyle = "#235575";
    ctx.fillRect(220, 140, 360, 560);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Выбрать фотографию").setInputFiles({
    name: "synthetic-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page.getByLabel("Поворот", { exact: true }).selectOption("90");
  await expect(
    page.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: path.join(evidence, "photo-crop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Сохранить фото", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await save(page);
  await page.reload();
  await expect(page.getByLabel("ФИО KZ, строка 1")).toHaveValue(
    "Тексеру Әли Қасымұлы",
  );
  await expect(page.getByLabel("Дата документа", { exact: true })).toHaveValue(
    "2026-09-22",
  );
  await expect(
    page.getByRole("img", { name: "Фото получателя" }),
  ).toBeVisible();
  const savedDraft = await (
    await page.request.get(
      `/api/print-requests/${/requests\/([^/]+)/.exec(page.url())![1]}`,
    )
  ).json();
  expect(savedDraft.status).toBe("DRAFT");
  expect(savedDraft.documents).toHaveLength(0);
  expect(savedDraft.issuances).toHaveLength(0);
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Посмотреть", exact: true }).first(),
  ).toBeVisible({ timeout: 150000 });
  await page
    .getByRole("button", { name: "Посмотреть", exact: true })
    .first()
    .click();
  const pdf = await page.request.get(
    (await page.locator("iframe").getAttribute("src"))!,
  );
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect(pdf.headers()["content-disposition"]).toContain("inline");
  // Chrome's native PDF viewer paints after the response/iframe load; allow its first page to settle for visual QA.
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: path.join(evidence, "pdf-preview.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.screenshot({
    path: path.join(evidence, "editor-1366.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({
    path: path.join(evidence, "editor-1920.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Оформить комплект", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "editor-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page
    .getByLabel("ФИО KZ, строка 1")
    .fill("Тексеру Әли Қасымұлы — соңғы әріп");
  await expect(
    page.getByText(
      "Данные изменились после создания предпросмотра. Сформируйте новый макет перед оформлением.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
  await expect(page.getByLabel("ФИО KZ, строка 1")).toHaveValue(
    "Тексеру Әли Қасымұлы — соңғы әріп",
  );
  await expect(page.locator(".files-panel")).toContainText("Готово 6 из 6", {
    timeout: 150000,
  });
  const original = page.locator(".artifact-list a[download]").last();
  const href = await original.getAttribute("href");
  expect(href).toBeTruthy();
  const first = await page.request.get(href!);
  const second = await page.request.get(href!);
  expect(first.ok()).toBeTruthy();
  expect(await first.body()).toEqual(await second.body());
  await page.screenshot({
    path: path.join(evidence, "files-history.png"),
    fullPage: true,
  });
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const snapshot = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(snapshot.issuances).toHaveLength(1);
  expect(snapshot.documents).toHaveLength(1);
  expect(snapshot.issuances[0].snapshot.draft.items[0].fullNameKz).toBe(
    "Тексеру Әли Қасымұлы — соңғы әріп",
  );
  const personArtifacts = [];
  const personFolder = `person-${requestId}`;
  await fs.mkdir(path.join(evidence, personFolder), { recursive: true });
  for (const artifact of snapshot.artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
    const file = path.join(personFolder, `${artifact.id}-${artifact.fileName}`);
    await fs.writeFile(path.join(evidence, file), bytes);
    personArtifacts.push({
      file,
      format: artifact.format,
      provenance: artifact.provenance,
      sha256: artifact.sha256,
      size: bytes.length,
    });
  }
  await fs.writeFile(
    path.join(evidence, "person-result.json"),
    JSON.stringify(
      {
        requestId,
        documentCount: snapshot.documents.length,
        issuanceCount: snapshot.issuances.length,
        artifactCount: snapshot.artifacts.length,
        originalSha256: createHash("sha256")
          .update(await first.body())
          .digest("hex"),
        templates: snapshot.issuances[0].snapshot.templates.map(
          (template: {
            version: string;
            checksum: string;
            contract: { id: string };
          }) => ({
            id: template.contract.id,
            version: template.version,
            sha256: template.checksum,
          }),
        ),
        artifacts: personArtifacts,
      },
      null,
      2,
    ),
  );
  await page
    .getByRole("button", { name: "Создать исправление", exact: true })
    .click();
  await page
    .getByLabel("Причина", { exact: true })
    .fill("Контрольный сценарий исправления опечатки");
  await page
    .getByRole("button", { name: "Создать исправление", exact: true })
    .last()
    .click();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Черновик",
  );
  await expect(page.getByLabel("Название заявки")).toHaveValue(
    `Исправление: ${title}`,
  );
});
test("network failure retains data, retry saves; concurrent editor conflict has a focus-managed choice", async ({
  page,
  context,
}) => {
  await login(page);
  await newPerson(page);
  await save(page);
  const url = page.url();
  await page.route("**/api/print-requests/*", (route) =>
    route.request().method() === "PATCH"
      ? route.abort("failed")
      : route.continue(),
  );
  await page.getByLabel("ФИО RU, строка 1").fill("Не потерять при обрыве");
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Не потерять при обрыве",
  );
  await page.unroute("**/api/print-requests/*");
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Не потерять при обрыве",
  );
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Сохранённая версия первого окна");
  await save(page);
  await other
    .getByLabel("ФИО RU, строка 1")
    .fill("Локальная версия второго окна");
  await expect(
    other.getByRole("dialog", { name: "Заявка изменена в другом окне" }),
  ).toBeVisible();
  await expect(other.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Локальная версия второго окна",
  );
  await other.keyboard.press("Escape");
  await expect(other.getByRole("dialog")).toHaveCount(0);
  await other.close();
});
test("company: 12 independent bilingual recipients, 18 assignments, complete generated files", async ({
  page,
}) => {
  test.setTimeout(720000);
  await login(page);
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Организация Заказчик/ }).click();
  await page
    .getByRole("button", { name: "Добавить заказчика", exact: true })
    .click();
  await page
    .getByLabel("Название на русском", { exact: true })
    .fill(`Тестовый заказчик ${Date.now()}`);
  await page
    .getByLabel("Название на казахском", { exact: true })
    .fill("Тәуелсіз атауы бар тапсырыс беруші");
  await page.getByLabel("БИН", { exact: true }).fill("001234567890");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  const text =
    "ФИО RU\tФИО KZ\tДолжность RU\tДолжность KZ\n" +
    Array.from(
      { length: 12 },
      (_, i) =>
        `Получатель ${String(i + 1).padStart(3, "0")}\tҚабылдаушы ${i + 1}\tДолжность ${i + 1}\tЛауазым ${i + 1}`,
    ).join("\n");
  await page.getByLabel("Или вставьте таблицу с заголовками").fill(text);
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await expect(page.getByText("Прочитано: 12")).toBeVisible();
  await page
    .getByRole("button", { name: "Добавить 12 строк в черновик", exact: true })
    .click();
  await expect(page.getByLabel("ФИО KZ, строка 12")).toHaveValue(
    "Қабылдаушы 12",
  );
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await page
    .getByRole("button", { name: "Применить к выбранным (1)", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: "Дата документа", exact: true })
    .check();
  await page.getByRole("dialog").locator("input[type=date]").fill("2026-10-01");
  await page
    .getByRole("button", { name: "Применить к выбранным", exact: true })
    .click();
  await expect(page.getByLabel("Дата документа", { exact: true })).toHaveValue(
    "2026-10-01",
  );
  await page
    .getByRole("button", { name: "Документы и даты получателя 2", exact: true })
    .click();
  await expect(page.getByLabel("Дата документа", { exact: true })).toHaveValue(
    "",
  );
  await save(page);
  await page.reload();
  await expect(page.getByLabel("ФИО RU, строка 12")).toHaveValue(
    "Получатель 012",
  );
  for (let i = 1; i <= 6; i++) {
    await page
      .getByRole("button", {
        name: `Документы и даты получателя ${i}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Добавить документ", exact: true })
      .click();
    const second = page.locator(".assignment-list details").nth(1);
    await second.locator("summary").click();
    await second
      .getByLabel("Форма документа", { exact: true })
      .selectOption(i === 1 ? "ps-witness" : "biot-protocol");
  }
  await page.getByLabel("Выбрать всех получателей", { exact: true }).check();
  await page
    .getByRole("button", { name: "Применить к выбранным (12)", exact: true })
    .click();
  for (const name of [
    "Дата документа",
    "Программа / тема",
    "Подтверждённый результат",
  ])
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name, exact: true })
      .check();
  await page.getByRole("dialog").locator("input[type=date]").fill("2026-10-01");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Программа / тема", exact: true })
    .fill("Контрольная программа организации");
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Подтверждённый результат", exact: true })
    .fill("Контрольный результат");
  await page
    .getByRole("button", { name: "Применить к выбранным", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Документы и даты получателя 12",
      exact: true,
    })
    .click();
  await page.getByLabel("Дата документа", { exact: true }).fill("2026-10-02");
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "company-12.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
  await expect(page.locator(".files-panel")).toContainText("Готово 38 из 38", {
    timeout: 600000,
  });
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const result = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(result.items).toHaveLength(12);
  expect(result.documents).toHaveLength(18);
  expect(result.issuances).toHaveLength(1);
  expect(
    result.documents.filter(
      (item: { templateId: string }) => item.templateId === "ps-witness",
    ),
  ).toHaveLength(1);
  expect(
    result.issuances[0].snapshot.draft.items[11].assignments[0].documentDate,
  ).toBe("2026-10-02");
  const manifests = [];
  const artifactFolder = `company-${requestId}`;
  await fs.mkdir(path.join(evidence, artifactFolder), { recursive: true });
  for (const artifact of result.artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBeTruthy();
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
    if (artifact.format === "DOCX") {
      const document = result.documents.find(
        (item: { id: string }) => item.id === artifact.documentId,
      );
      const person = result.items.find(
        (item: { id: string }) => item.id === document.rowId,
      );
      const text = [
        ...zipText(bytes, "word/document.xml").matchAll(
          /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g,
        ),
      ]
        .map((match) => match[1])
        .join(" ");
      expect(text).toContain(person.fullNameRu);
      expect(text).toContain(person.fullNameKz);
      for (const other of result.items.filter(
        (item: { id: string }) => item.id !== person.id,
      ))
        expect(text).not.toContain(other.fullNameRu);
    }
    const file = path.join(artifactFolder, artifact.fileName);
    await fs.writeFile(path.join(evidence, file), bytes);
    manifests.push({
      file,
      id: artifact.id,
      format: artifact.format,
      size: bytes.length,
      sha256: artifact.sha256,
    });
  }
  await fs.writeFile(
    path.join(evidence, "company-12-18-result.json"),
    JSON.stringify(
      {
        requestId,
        recipientCount: result.items.length,
        documentCount: result.documents.length,
        documents: result.documents.map(
          (document: {
            templateId: string;
            number: string;
            registrationNumber?: string;
          }) => ({
            templateId: document.templateId,
            number: document.number,
            registrationNumber: document.registrationNumber,
          }),
        ),
        artifacts: manifests,
      },
      null,
      2,
    ),
  );
});
test("101 imported rows are explained before apply; all pages remain accessible by keyboard", async ({
  page,
}) => {
  const started = Date.now();
  let defaultsRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("defaults")) defaultsRequests++;
  });
  await login(page);
  await newPerson(page);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      "ФИО RU\n" +
        Array.from({ length: 101 }, (_, i) => `Строка ${i + 1}`).join("\n"),
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await expect(
    page.getByText(/После импорта получится 101 получателей/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Добавить 101 строк в черновик" }),
  ).toBeDisabled();
  await page
    .getByLabel("Импортировать исходную строку 102", { exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Добавить 100 строк в черновик", exact: true })
    .click();
  await expect(page.getByLabel("ФИО RU, строка 100")).toHaveValue("Строка 100");
  await save(page);
  await page.reload();
  await expect(page.getByLabel("ФИО RU, строка 100")).toHaveValue("Строка 100");
  await fs.writeFile(
    path.join(evidence, "import-100-timing.json"),
    JSON.stringify(
      {
        rows: 100,
        sourceRows: 101,
        excluded: 1,
        durationMs: Date.now() - started,
        defaultsRequests,
        browser: "Chromium",
        viewport: "1366x768",
      },
      null,
      2,
    ),
  );
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      "ФИО RU\n" +
        Array.from({ length: 101 }, (_, i) => `Строка ${i + 1}`).join("\n"),
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await expect(
    page.getByText(
      "Этот файл уже добавлен в заявку. Повторные строки не будут созданы.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть повторный импорт", exact: true })
    .click();
  await expect(page.locator(".recipient-table tbody tr")).toHaveCount(100);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const name of ["Заказчики", "История", "Настройки", "Заявки"]) {
    await page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name, exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toBeVisible();
  }
  expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
});

test("keyboard creates, validates and finalizes a person with focus visible in dialogs", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Новая заявка", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Человек Документы/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("ФИО RU, строка 1")).toBeVisible();
  for (const [label, value] of [
    ["ФИО RU, строка 1", "Клавиатурный Сценарий"],
    ["ФИО KZ, строка 1", "Пернетақта Ә Ғ Қ Ң Ө Ұ Ү Һ І"],
    ["Программа / тема обучения", "Контрольная программа"],
    ["Подтверждённый результат / оценка", "Контрольный результат"],
  ]) {
    await page.getByLabel(label, { exact: true }).focus();
    await page.keyboard.insertText(value);
  }
  await page.getByLabel("Дата документа", { exact: true }).fill("2026-09-22");
  await page.getByRole("button", { name: "Проверить", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".validation-result")).toBeFocused();
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Оформить", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
});

test("XLSX sheet selection, saved mapping, leading zeros, partial rows and row report", async ({
  page,
}) => {
  const mappingName = `Контроль Excel ${Date.now()}`;
  await login(page);
  await newPerson(page);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Табличный файл")
    .setInputFiles(path.join(__dirname, "fixtures/import-multiple.xlsx"));
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await page.getByLabel("Лист таблицы").selectOption("Получатели");
  await expect(
    page.getByLabel("Поле для колонки Сотрудник", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Поле для колонки Сотрудник", { exact: true })
    .selectOption("fullNameRu");
  await page
    .getByLabel("Поле для колонки Аты", { exact: true })
    .selectOption("fullNameKz");
  await page
    .getByLabel("Поле для колонки Табельный код", { exact: true })
    .selectOption("externalBasisNumber");
  await page
    .getByLabel("Название правила сопоставления", { exact: true })
    .fill(mappingName);
  await page
    .getByRole("button", { name: "Сохранить сопоставление", exact: true })
    .click();
  await expect(
    page.getByText("Сопоставление сохранено для вашего центра."),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать отчёт по строкам", exact: true })
    .click();
  await (await download).saveAs(path.join(evidence, "import-report.csv"));
  await page
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await expect(page.getByLabel("ФИО KZ, строка 1")).toHaveValue(
    "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
  );
  await expect(
    page.getByLabel("Внешний номер основания", { exact: true }),
  ).toHaveValue("00123");
  await expect(page.getByLabel("ФИО KZ, строка 2")).toHaveValue("");
  await save(page);
  await page.reload();
  await expect(
    page.getByLabel("Внешний номер основания", { exact: true }),
  ).toHaveValue("00123");
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Табличный файл")
    .setInputFiles(path.join(__dirname, "fixtures/import-multiple.xlsx"));
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await page.getByLabel("Лист таблицы").selectOption("Получатели");
  await page
    .getByRole("combobox", { name: "Сохранённое сопоставление", exact: true })
    .selectOption({ label: mappingName });
  await expect(
    page.getByLabel("Поле для колонки Сотрудник", { exact: true }),
  ).toHaveValue("fullNameRu");
  await expect(
    page.getByLabel("Поле для колонки Аты", { exact: true }),
  ).toHaveValue("fullNameKz");
  await expect(
    page.getByLabel("Поле для колонки Табельный код", { exact: true }),
  ).toHaveValue("externalBasisNumber");
  await page
    .getByRole("button", { name: "Закрыть повторный импорт", exact: true })
    .click();
});

test("failed-download UI supports reasoned reconstruction without renumbering or replacing originals", async ({
  page,
}) => {
  await login(page);
  await newPerson(page);
  await page.getByLabel("ФИО RU, строка 1").fill("Контроль восстановления");
  await page.getByLabel("Дата документа", { exact: true }).fill("2026-09-22");
  await page
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill("Контрольная программа");
  await page
    .getByLabel("Подтверждённый результат / оценка")
    .fill("Контрольный результат");
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  await expect(page.locator(".files-panel")).toContainText("Готово 4 из 4", {
    timeout: 150000,
  });
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const before = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  const original = before.artifacts.find(
    (artifact: { format: string }) => artifact.format === "DOCX",
  );
  // Simulates a failed GET in the browser only. Physical storage-loss checks are covered by API/operations tests.
  await page.route(`**/api/artifacts/${original.id}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Контрольный отказ чтения сохранённого файла",
      }),
    }),
  );
  await page.locator(`a[href="/api/artifacts/${original.id}"]`).click();
  await expect(
    page.getByText("Контрольный отказ чтения сохранённого файла"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Восстановить файл", exact: true })
    .click();
  await page
    .getByLabel("Причина восстановления", { exact: true })
    .fill("Контроль восстановления через интерфейс");
  await page.unroute(`**/api/artifacts/${original.id}`);
  await page
    .getByRole("button", { name: "Создать восстановленную копию", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".artifact-list")).toContainText(
    "Восстановленная копия",
    { timeout: 150000 },
  );
  const after = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(
    after.documents.map((document: { number: string }) => document.number),
  ).toEqual(
    before.documents.map((document: { number: string }) => document.number),
  );
  expect(
    after.artifacts.find(
      (artifact: { id: string }) => artifact.id === original.id,
    ).sha256,
  ).toBe(original.sha256);
  expect(
    after.artifacts.some(
      (artifact: { provenance: string }) =>
        artifact.provenance === "RECONSTRUCTED",
    ),
  ).toBe(true);
  await fs.writeFile(
    path.join(evidence, "reconstruction-ui.json"),
    JSON.stringify(
      {
        requestId,
        browserReadFailure: "simulated HTTP503",
        originalArtifactId: original.id,
        originalSha256: original.sha256,
        numberingPreserved: true,
        reconstructedArtifacts: after.artifacts.filter(
          (artifact: { provenance: string }) =>
            artifact.provenance === "RECONSTRUCTED",
        ).length,
      },
      null,
      2,
    ),
  );
});
