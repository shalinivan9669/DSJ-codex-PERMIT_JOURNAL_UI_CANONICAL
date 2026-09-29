import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { newRecipient, type Draft } from "../lib/types";

const evidence = process.env.DEMO_E2E_EVIDENCE!;
async function login(page: Page) {
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  await fs.mkdir(evidence, { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  const session = await page.request.get("/api/auth/session");
  return {
    origin: new URL(page.url()).origin,
    "x-csrf-token": (await session.json()).csrfToken,
  };
}
async function create(page: Page, company = false) {
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page
    .getByText("Другие направления и отдельные формы: ПБ, ПТМ, ПС", {
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: company ? /Организация Заказчик/ : /Человек Документы/,
    })
    .click();
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toBeVisible();
  return /requests\/([^/]+)/.exec(page.url())![1];
}
async function read(page: Page, id: string): Promise<Draft> {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
}

test("real UI creates one, then keyboard enters ten without opening cards and persists every field", async ({
  page,
}) => {
  await login(page);
  const start = performance.now();
  const id = await create(page);
  const first = page.getByLabel("ФИО RU, строка 1", { exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.insertText("Синтетический Андрей Александрович");
  await save(page);
  expect((await read(page, id)).items[0].fullNameRu).toBe(
    "Синтетический Андрей Александрович",
  );
  const firstSavedMs = performance.now() - start;
  for (let i = 1; i < 10; i++)
    await page.getByRole("button", { name: "Получатель", exact: true }).click();
  await first.fill("");
  const entryStart = performance.now();
  const expected = [];
  for (let i = 1; i <= 10; i++) {
    await expect(
      page.getByLabel(`ФИО RU, строка ${i}`, { exact: true }),
    ).toBeFocused();
    const values = [
      `${i % 2 ? "Иванов" : "Иванова"} ${i} Синтетический`,
      i % 2 ? "Электромонтёр" : "Мастер участка",
      i === 7
        ? "Индивидуальная организация"
        : "Синтетическая организация Альфа",
    ];
    await page.keyboard.insertText(values[0]);
    await page.keyboard.press("Tab");
    await page.keyboard.insertText(values[1]);
    await page.keyboard.press("Tab");
    await page.keyboard.insertText(values[2]);
    expected.push(values);
    if (i < 10)
      for (let tab = 0; tab < 4; tab++) await page.keyboard.press("Tab");
  }
  await save(page);
  const keyboardSavedMs = performance.now() - entryStart;
  const persisted = await read(page, id);
  expect(
    persisted.items.map((i) => [i.fullNameRu, i.positionRu, i.workplaceRu]),
  ).toEqual(expected);
  await page.reload();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(10);
  expect((await read(page, id)).items).toEqual(persisted.items);
  await page.screenshot({
    path: path.join(evidence, "ten-keyboard-saved.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "one-ten-result.json"),
    JSON.stringify(
      {
        id,
        firstSavedMs,
        keyboardSavedMs,
        entryMouseClicks: 0,
        cardOpenings: 0,
        focusLosses: 0,
        fieldsVerified: 30,
        readback: true,
        humanTiming: false,
      },
      null,
      2,
    ),
  );
});

test("real existing organization and recipient reuse keeps personal data and resets previous document results", async ({
  page,
}) => {
  const headers = await login(page);
  const suffix = Date.now();
  const customer = await page.request.post("/api/customers", {
    headers,
    data: {
      nameRu: `Синтетический заказчик ${suffix}`,
      nameKz: `Синтетикалық тапсырыс беруші ${suffix}`,
    },
  });
  expect(customer.ok(), await customer.text()).toBe(true);
  const company = await customer.json();
  const person = {
    ...newRecipient(),
    fullNameRu: `Повторный Получатель ${suffix}`,
    fullNameKz: "Әбдірахманов Нұрсұлтан",
    positionRu: "Мастер",
    workplaceRu: company.nameRu,
    employerId: company.id,
    personnelNumber: "000125",
  };
  person.assignments[0].result = "Результат прошлого события";
  person.assignments[0].documentDate = "2025-01-10";
  const stored = await page.request.post("/api/recipients", {
    headers,
    data: person,
  });
  expect(stored.ok(), await stored.text()).toBe(true);
  const record = await stored.json();
  const id = await create(page, true);
  await page
    .getByRole("button", { name: "Найти в справочнике", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(company.nameRu);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: company.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Поиск по справочнику")
    .fill(person.fullNameRu);
  await page
    .getByRole("dialog")
    .getByRole("row")
    .filter({ hasText: person.fullNameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await save(page);
  const result = await read(page, id);
  expect(result.customerId).toBe(company.id);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].recipientId).toBe(record.id);
  expect(result.items[0].personnelNumber).toBe("000125");
  expect(result.items[0].fullNameKz).toBe(person.fullNameKz);
  expect(result.items[0].assignments[0].result).toBe("");
  expect(result.items[0].assignments[0].documentDate).not.toBe("2025-01-10");
  await page.reload();
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toHaveValue(person.fullNameRu);
  await fs.writeFile(
    path.join(evidence, "reuse-result.json"),
    JSON.stringify(
      {
        id,
        organizationReused: true,
        recipientReused: true,
        previousResultsNotCopied: true,
        readback: true,
      },
      null,
      2,
    ),
  );
});

test("real CSV import explains duplicates and missing names, explicit exclusions persist through reload", async ({
  page,
}) => {
  await login(page);
  const id = await create(page);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Убрать из заявки", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Табличный файл")
    .setInputFiles(
      path.resolve(
        __dirname,
        "../../../tests/fixtures/operator-complete/people-errors.csv",
      ),
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByText("Возможный дубль", { exact: true }),
  ).toBeVisible();
  await modal
    .getByLabel("Импортировать исходную строку 4", { exact: true })
    .uncheck();
  await modal
    .getByLabel("Импортировать исходную строку 7", { exact: true })
    .uncheck();
  await expect(
    modal.getByRole("button", {
      name: "Добавить 8 строк в черновик",
      exact: true,
    }),
  ).toBeEnabled();
  await page.screenshot({
    path: path.join(evidence, "import-errors-review.png"),
  });
  const download = page.waitForEvent("download");
  await modal
    .getByRole("button", { name: "Скачать отчёт по строкам", exact: true })
    .click();
  await (
    await download
  ).saveAs(path.join(evidence, "import-errors-report.csv"));
  await modal
    .getByRole("button", { name: "Добавить 8 строк в черновик", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(8);
  const result = await read(page, id);
  expect(result.items).toHaveLength(8);
  expect(
    result.items.filter((i) => i.fullNameRu.startsWith("Иванов Иван")),
  ).toHaveLength(1);
  expect(
    result.items.some((i) => i.personnelNumber === "00005" && !i.positionRu),
  ).toBe(true);
  await page.reload();
  expect((await read(page, id)).items).toEqual(result.items);
  await fs.writeFile(
    path.join(evidence, "import-errors-result.json"),
    JSON.stringify(
      {
        id,
        sourceRows: 10,
        explicitlyExcluded: [4, 7],
        savedRows: 8,
        partialRowRetained: true,
        readback: true,
      },
      null,
      2,
    ),
  );
});
