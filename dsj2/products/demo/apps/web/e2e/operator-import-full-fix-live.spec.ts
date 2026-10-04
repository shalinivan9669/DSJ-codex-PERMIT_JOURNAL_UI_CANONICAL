import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  newAssignment,
  newRecipient,
  type Draft,
  type Recipient,
} from "../lib/types";
import { openRecipientExtraTools } from "./operator-keyboard-helpers";
import { loginIsolated } from "./operator-full-fix-session";
import { fullSuitePageApiCooldown } from "./operator-full-suite";
test.use({ trace: "off" });
async function login(page: Page) {
  return loginIsolated(page);
}
async function create(
  page: Page,
  headers: Record<string, string>,
  items: Recipient[] = [{ ...newRecipient(), assignments: [] }],
  extra: Record<string, unknown> = {},
) {
  const response = await page.request.post("/api/print-requests", {
    headers,
    data: {
      kind: "PERSON",
      title: `Синтетический импорт full fix ${Date.now()}`,
      customerId: null,
      demoMode: true,
      schemaVersion: 2,
      commonFields: {},
      items,
      ...extra,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Draft;
}
async function read(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as Draft;
}
async function pasteImport(page: Page, text: string) {
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Или вставьте таблицу с заголовками", { exact: true })
    .fill(text);
  await modal
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await expect(modal.locator(".import-preview tbody tr")).not.toHaveCount(0);
  return modal;
}

test("UX-27 real partial import A then B/C, replay, unknown network outcome and independent request preserve source identities", async ({
  page,
}, testInfo) => {
  await fullSuitePageApiCooldown(
    page,
    testInfo.outputDir,
    "imports-partial-before-login",
  );
  const headers = await login(page);
  const created = await create(page, headers);
  const text =
    "ФИО RU\tКатегория сотрудника\tТабельный номер\nСинтетический Альфа\tРабочий\t00001\nСинтетический Бета\tITR\t00002\nСинтетический Гамма\tРабочий\t00003";
  await page.goto(`/requests/${created.id}/edit`);
  let modal = await pasteImport(page, text);
  await modal
    .getByLabel("Импортировать исходную строку 3", { exact: true })
    .uncheck();
  await modal
    .getByLabel("Импортировать исходную строку 4", { exact: true })
    .uncheck();
  await modal
    .getByRole("button", { name: "Добавить 1 строк в черновик", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const first = await read(page, created.id);
  expect(first.items).toHaveLength(1);
  expect(first.items[0].sourceRow).toBe(2);
  await page.reload();
  modal = await pasteImport(page, text);
  await expect(
    modal.getByLabel("Импортировать исходную строку 2", { exact: true }),
  ).toBeDisabled();
  await expect(modal).toContainText("Уже добавлена · без изменений");
  await page.screenshot({ path: testInfo.outputPath("partial-load-b-c.png") });
  // Controlled response loss after a real local API commit, not a fabricated import result.
  let dropped = false;
  await page.route(
    `**/api/print-requests/${created.id}/import`,
    async (route) => {
      const response = await route.fetch();
      if (!dropped) {
        dropped = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    },
  );
  await modal
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await expect(modal).toContainText("Нет связи с сервером");
  const committed = await read(page, created.id);
  expect(committed.items).toHaveLength(3);
  await modal
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const second = await read(page, created.id);
  expect(second.items).toEqual(committed.items);
  expect(second.items[0]).toEqual(first.items[0]);
  expect(new Set(second.items.map((item) => item.id)).size).toBe(3);
  expect(second.items.map((item) => item.personnelNumber)).toEqual([
    "00001",
    "00002",
    "00003",
  ]);
  modal = await pasteImport(page, text);
  await expect(
    modal.getByRole("button", {
      name: "Добавить 0 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    await modal
      .getByRole("checkbox", { name: /Импортировать исходную строку/ })
      .count(),
  ).toBe(3);
  await modal.getByRole("button", { name: /^Закрыть(?: диалог)?$/ }).click();
  await fullSuitePageApiCooldown(
    page,
    testInfo.outputDir,
    "imports-partial-before-independent-request",
  );
  const other = await create(page, headers);
  await page.goto(`/requests/${other.id}/edit`);
  modal = await pasteImport(page, text);
  await modal
    .getByRole("button", { name: "Добавить 3 строк в черновик", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  expect((await read(page, other.id)).items).toHaveLength(3);
  await fs.writeFile(
    testInfo.outputPath("partial-readback.json"),
    JSON.stringify(
      {
        first,
        committed,
        second,
        other: await read(page, other.id),
        controlledResponseLoss: true,
      },
      null,
      2,
    ),
  );
});

test("UX-31 mapped preview identifies exact category/date/length, preserves source during correction and stores explicit provenance", async ({
  page,
}, testInfo) => {
  await fullSuitePageApiCooldown(
    page,
    testInfo.outputDir,
    "imports-mapped-before-login",
  );
  const headers = await login(page);
  const created = await create(page, headers);
  await page.goto(`/requests/${created.id}/edit`);
  const text =
    "ФИО RU\tКатегория сотрудника\tДата документа\tТабельный номер\nСинтетический Исправляемый\tИнженер\t2026-02-30\t00009\n\tWORKER\t\t" +
    "0".repeat(101);
  const modal = await pasteImport(page, text);
  await modal
    .getByRole("combobox", {
      name: "Документ для импортируемых строк",
      exact: true,
    })
    .selectOption("ptm-card");
  const apply = modal.getByRole("button", {
    name: "Добавить 2 строк в черновик",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  const category = modal.getByLabel(
    "Исправленное значение, исходная строка 2, Категория сотрудника",
    { exact: true },
  );
  await expect(category).toHaveAttribute("aria-invalid", "true");
  await expect(modal).toContainText(
    "Должность не определяет категорию автоматически",
  );
  await page.screenshot({ path: testInfo.outputPath("mapped-invalid.png") });
  await category.fill("ITR");
  await modal
    .getByLabel("Исправленное значение, исходная строка 2, Дата документа", {
      exact: true,
    })
    .fill("2026-02-28");
  await modal
    .getByLabel("Исправленное значение, исходная строка 3, Табельный номер", {
      exact: true,
    })
    .fill("00010");
  await expect(modal).toContainText("Исходное значение: Инженер");
  await expect(modal).toContainText("Допустимая неполная строка");
  await expect(apply).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("mapped-corrected.png") });
  await apply.click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  const saved = await read(page, created.id);
  expect(saved.items).toHaveLength(2);
  expect(saved.items[0].employeeCategory).toBe("ITR");
  expect(saved.items[0].assignments[0].documentDate).toBe("2026-02-28");
  expect(saved.items[0].assignments[0].fieldOrigins?.documentDate).toBe(
    "MANUAL",
  );
  expect(saved.items[0].assignments[0].outcome?.status || "UNKNOWN").toBe(
    "UNKNOWN",
  );
  expect(saved.items[1].fullNameRu).toBe("");
  expect(saved.items[1].personnelNumber).toBe("00010");
  await fs.writeFile(
    testInfo.outputPath("mapped-readback.json"),
    JSON.stringify(saved, null, 2),
  );
});

test("new real 250-row TSV import replaces only untouched starter and rejects 251 without truncating", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers);
  await page.goto(`/requests/${created.id}/edit`);
  const rows = Array.from(
    { length: 251 },
    (_, index) =>
      `Синтетический ${index + 1}\tҚатысушы ${index + 1}\t${String(index + 1).padStart(6, "0")}`,
  );
  const modal = await pasteImport(
    page,
    "ФИО RU\tФИО KZ\tТабельный номер\n" + rows.join("\n"),
  );
  await expect(modal).toContainText("После импорта получится 251");
  await expect(
    modal.getByRole("button", {
      name: "Добавить 251 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  await modal
    .getByLabel("Импортировать исходную строку 252", { exact: true })
    .uncheck();
  await expect(
    modal.getByRole("button", {
      name: "Добавить 250 строк в черновик",
      exact: true,
    }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("new-250-preview.png") });
  await modal
    .getByRole("button", { name: "Добавить 250 строк в черновик", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  const saved = await read(page, created.id);
  expect(saved.items).toHaveLength(250);
  expect(saved.items[249].fullNameKz).toBe("Қатысушы 250");
  expect(saved.items[249].personnelNumber).toBe("000250");
  expect(new Set(saved.items.map((item) => item.id)).size).toBe(250);
  expect(
    saved.items.every(
      (item) => item.importId && item.sourceRow && !item.assignments.length,
    ),
  ).toBe(true);
  await fs.writeFile(
    testInfo.outputPath("new-250-readback.json"),
    JSON.stringify(saved, null, 2),
  );
});

test("UX-29 and R3 keyboard range paste exposes blank creation and cancel, explicit keep, source rows and saved values", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const first = { ...newRecipient(), fullNameRu: "   ", assignments: [] };
  const created = await create(page, headers, [first]);
  await page.goto(`/requests/${created.id}/edit`);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const text =
    "Синтетический Первый\tТестовая должность\tТестовая компания\n\t\t\nСинтетический Третий\tИнженер\tТестовая компания";
  const paste = async () => {
    await page.evaluate((value) => navigator.clipboard.writeText(value), text);
    await page.getByLabel(/^ФИО(?: RU)?, строка 1$/).focus();
    await page.keyboard.press("Control+V");
  };
  await paste();
  let modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("region", { name: "Новые строки диапазона" }),
  ).toContainText("полностью пустая строка");
  await expect(
    modal.getByRole("button", { name: "Применить диапазон", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("blank-range-choice.png"),
  });
  await modal.getByRole("button", { name: "Отмена", exact: true }).click();
  expect((await read(page, created.id)).items).toEqual([first]);
  await paste();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Полностью пустые строки диапазона", { exact: true })
    .selectOption("SKIP");
  await expect(modal).toContainText(
    "Пустых строк пропущено по вашему выбору: 1",
  );
  await modal
    .getByLabel("Полностью пустые строки диапазона", { exact: true })
    .selectOption("KEEP");
  const patchRoute = `**/api/print-requests/${created.id}`;
  await page.route(patchRoute, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    return route.fulfill({
      status: 503,
      json: { message: "Контролируемый локальный отказ сохранения диапазона" },
    });
  });
  await modal
    .getByRole("button", { name: "Применить диапазон", exact: true })
    .click();
  await expect(modal).toContainText(
    "Контролируемый локальный отказ сохранения диапазона",
  );
  await expect(
    modal.getByRole("button", { name: "Применить диапазон", exact: true }),
  ).toBeEnabled();
  expect((await read(page, created.id)).items).toEqual([first]);
  await page.screenshot({
    path: testInfo.outputPath("blank-range-retry-plan.png"),
  });
  await page.unroute(patchRoute);
  await modal
    .getByRole("button", { name: "Применить диапазон", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  const saved = await read(page, created.id);
  expect(saved.items).toHaveLength(3);
  expect(saved.items[0].fullNameRu).toBe("Синтетический Первый");
  expect(saved.items[1].fullNameRu).toBe("");
  expect(saved.items[2].fullNameRu).toBe("Синтетический Третий");
  await fs.writeFile(
    testInfo.outputPath("blank-range-readback.json"),
    JSON.stringify(
      {
        saved,
        clipboardFixture: true,
        realKeyboardPaste: true,
        controlledPatch503: true,
        failedPatchDidNotChangeStoredItems: true,
        samePlanRetry: true,
      },
      null,
      2,
    ),
  );
});

test("R2 real COMPANY bulk preview shows effective name, language fallback and only creates explicitly selected exception", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const response = await page.request.post("/api/customers", {
    headers,
    data: {
      nameRu: `Синтетическая Общая R2 ${Date.now()}`,
      nameKz: "",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const customer = await response.json();
  expect(customer.nameKz).toBe("");
  const created = await create(
    page,
    headers,
    [{ ...newRecipient(), fullNameRu: "Синтетический R2", assignments: [] }],
    { kind: "COMPANY", customerId: customer.id },
  );
  await page.goto(`/requests/${created.id}/edit`);
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Изменить данные выбранных (1)", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Должность и место работы", { exact: true }).click();
  await modal
    .getByRole("checkbox", { name: "Место работы KZ", exact: true })
    .check();
  await modal
    .getByLabel("Общее значение: Место работы KZ", { exact: true })
    .fill("Жеке синтетикалық ұйым");
  await modal
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  await expect(
    modal.getByRole("region", { name: "Предварительные изменения" }),
  ).toContainText(customer.nameRu);
  await expect(modal).toContainText(
    "Действующее общее значение; индивидуальное поле пусто",
  );
  await page.screenshot({
    path: testInfo.outputPath("effective-company-bulk-preview.png"),
  });
  await modal
    .getByRole("button", { name: "Применить 1 изменений", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  const saved = await read(page, created.id);
  expect(saved.items[0].workplaceRu).toBe("");
  expect(saved.items[0].workplaceKz).toBe("Жеке синтетикалық ұйым");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  const details = page.getByRole("dialog");
  await details.getByRole("tab", { name: /^Личные данные/ }).click();
  await expect(details).toContainText(
    `Работодатель заявки: ${customer.nameRu}`,
  );
  await expect(
    details.getByLabel("Место работы · RU", { exact: true }),
  ).toHaveValue("");
  await expect(
    details.getByLabel("Место работы · KZ", { exact: true }),
  ).toHaveValue("Жеке синтетикалық ұйым");
  await page.screenshot({
    path: testInfo.outputPath("effective-company-details-reload.png"),
  });
  await details.getByRole("button", { name: /^Закрыть(?: диалог)?$/ }).click();
  await page.getByLabel("Выбрать строку 1", { exact: true }).check();
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Изменить данные выбранных (1)", exact: true })
    .click();
  const nextModal = page.getByRole("dialog");
  await nextModal
    .getByText("Должность и место работы", { exact: true })
    .click();
  await nextModal
    .getByRole("combobox", { name: "Режим применения", exact: true })
    .selectOption("INHERITED");
  await expect(
    nextModal.getByRole("checkbox", { name: "Место работы KZ", exact: true }),
  ).toBeDisabled();
  await expect(nextModal).toContainText(
    "Должность и место работы в этом режиме не меняются",
  );
  await nextModal
    .getByRole("combobox", { name: "Режим применения", exact: true })
    .selectOption("REPLACE");
  await nextModal
    .getByRole("checkbox", { name: "Место работы KZ", exact: true })
    .check();
  await nextModal
    .getByLabel("Общее значение: Место работы KZ", { exact: true })
    .fill("Жеке синтетикалық ұйым 2");
  await nextModal
    .getByRole("button", { name: "Показать изменения", exact: true })
    .click();
  await expect(
    nextModal.getByRole("region", { name: "Предварительные изменения" }),
  ).toContainText("Жеке синтетикалық ұйым");
  await expect(nextModal).toContainText("Индивидуальное значение");
  await expect(
    nextModal.getByRole("button", {
      name: "Применить 1 изменений",
      exact: true,
    }),
  ).toBeDisabled();
  await nextModal.getByRole("button", { name: "Отмена", exact: true }).click();
  expect((await read(page, created.id)).items[0]).toEqual(saved.items[0]);
  await fs.writeFile(
    testInfo.outputPath("effective-company-bulk-readback.json"),
    JSON.stringify({ customer, saved }, null, 2),
  );
});

test("R1 controlled slow and failed record queries never expose stale selectable records across debounce, query and page", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers);
  const stored = await page.request.post("/api/recipients", {
    headers,
    data: {
      ...newRecipient(),
      fullNameRu: "EMPTY · страница 2",
      assignments: [],
    },
  });
  expect(stored.status(), await stored.text()).toBe(201);
  const realRecipient = await stored.json();
  await page.goto(`/requests/${created.id}/edit`);
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  let failLookup = true;
  const calls: { query: string; page: number; controlled: boolean }[] = [];
  await page.route("**/api/recipients?*", async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get("search") || "";
    const number = Number(url.searchParams.get("page"));
    calls.push({ query: search, page: number, controlled: true });
    if (gate && (search === "B" || number === 2)) await gate;
    if (search === "FAILED" && failLookup)
      return route.fulfill({
        status: 503,
        json: { message: "Контролируемый локальный отказ поиска" },
      });
    const data = {
      ...realRecipient.data,
      fullNameRu: `${search || "EMPTY"} · страница ${number}`,
      assignments: [],
    };
    await route.fulfill({
      json: { items: [{ id: realRecipient.id, data }], total: 21 },
    });
  });
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  const search = modal.getByLabel("Поиск по справочнику", { exact: true });
  await search.fill("A");
  await expect(modal).toContainText("A · страница 1");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await search.fill("B");
  await expect(
    modal.getByRole("button", { name: "Выбрать", exact: true }),
  ).toHaveCount(0);
  await expect(modal.getByRole("status")).toContainText(
    "Ищем по текущему запросу",
  );
  await expect
    .poll(() => calls.some((call) => call.query === "B" && call.page === 1))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("record-slow-query.png") });
  release?.();
  gate = undefined;
  await expect(modal).toContainText("B · страница 1");
  await search.fill("FAILED");
  await expect(modal).toContainText("Контролируемый локальный отказ поиска");
  await expect(
    modal.getByRole("button", { name: "Выбрать", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("record-failed-query.png"),
  });
  failLookup = false;
  await modal
    .getByRole("button", { name: "Повторить поиск", exact: true })
    .click();
  await expect(search).toHaveValue("FAILED");
  await expect(modal).toContainText("FAILED · страница 1");
  await search.fill("A");
  await expect(modal).toContainText("A · страница 1");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const priorBCalls = calls.filter((call) => call.query === "B").length;
  await search.fill("B");
  await expect
    .poll(() => calls.filter((call) => call.query === "B").length)
    .toBeGreaterThan(priorBCalls);
  await search.fill("A");
  release?.();
  gate = undefined;
  await expect(modal).toContainText("A · страница 1");
  await search.fill("");
  await expect(modal).toContainText("EMPTY · страница 1");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await modal.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "Выбрать", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => calls.some((call) => call.page === 2)).toBe(true);
  release?.();
  gate = undefined;
  await expect(modal).toContainText("EMPTY · страница 2");
  const select = modal.getByRole("button", { name: "Выбрать", exact: true });
  await expect(select).toBeEnabled();
  await select.focus();
  await expect(select).toBeFocused();
  // Final keyboard selection uses a real synthetic directory record; delayed responses were controlled fixtures.
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Найти существующего получателя",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await read(page, created.id)).items[0].recipientId)
    .toBe(realRecipient.id);
  const saved = await read(page, created.id);
  expect(saved.items[0].fullNameRu).toBe(realRecipient.data.fullNameRu);
  expect(saved.items[0].assignments).toHaveLength(0);
  await page.unroute("**/api/recipients?*");
  const companyResponse = await page.request.post("/api/customers", {
    headers,
    data: {
      legalForm: "TOO",
      ownNameRu: "CUST · страница 2",
      ownNameKz: "",
      nameRu: "",
      nameKz: "",
    },
  });
  expect(companyResponse.status(), await companyResponse.text()).toBe(201);
  const realCustomer = await companyResponse.json();
  const companyRequest = await create(page, headers, undefined, {
    kind: "COMPANY",
    customerId: realCustomer.id,
  });
  await page.goto(`/requests/${companyRequest.id}/edit`);
  const customerCalls: { query: string; page: number; controlled: boolean }[] =
    [];
  let failCustomerLookup = true;
  await page.route("**/api/customers?*", async (route) => {
    const url = new URL(route.request().url());
    const value = url.searchParams.get("search") || "";
    const number = Number(url.searchParams.get("page"));
    customerCalls.push({ query: value, page: number, controlled: true });
    if (gate && (value === "B" || number === 2)) await gate;
    if (value === "FAILED" && failCustomerLookup)
      return route.fulfill({
        status: 503,
        json: { message: "Контролируемый локальный отказ поиска компании" },
      });
    return route.fulfill({
      json: {
        items: [
          {
            ...realCustomer,
            nameRu: `${value || "CUST"} · страница ${number}`,
          },
        ],
        total: 21,
      },
    });
  });
  await page
    .getByRole("button", { name: "Сменить компанию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Найти в справочнике", exact: true })
    .click();
  const customerModal = page.getByRole("dialog");
  const customerSearch = customerModal.getByLabel("Поиск по справочнику", {
    exact: true,
  });
  await customerSearch.fill("A");
  await expect(customerModal).toContainText("A · страница 1");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await customerSearch.fill("B");
  await expect(
    customerModal.getByRole("button", { name: "Выбрать", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      customerCalls.some((call) => call.query === "B" && call.page === 1),
    )
    .toBe(true);
  release?.();
  gate = undefined;
  await expect(customerModal).toContainText("B · страница 1");
  await customerSearch.fill("FAILED");
  await expect(customerModal).toContainText(
    "Контролируемый локальный отказ поиска компании",
  );
  await expect(
    customerModal.getByRole("button", { name: "Выбрать", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("customer-failed-query.png"),
  });
  failCustomerLookup = false;
  await customerModal
    .getByRole("button", { name: "Повторить поиск", exact: true })
    .click();
  await expect(customerSearch).toHaveValue("FAILED");
  await expect(customerModal).toContainText("FAILED · страница 1");
  await customerSearch.fill("A");
  await expect(customerModal).toContainText("A · страница 1");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const priorCustomerBCalls = customerCalls.filter(
    (call) => call.query === "B",
  ).length;
  await customerSearch.fill("B");
  await expect
    .poll(() => customerCalls.filter((call) => call.query === "B").length)
    .toBeGreaterThan(priorCustomerBCalls);
  await customerSearch.fill("A");
  release?.();
  gate = undefined;
  await expect(customerModal).toContainText("A · страница 1");
  await customerSearch.fill("");
  await expect(customerModal).toContainText("CUST · страница 1");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await customerModal
    .getByRole("button", { name: "Далее", exact: true })
    .click();
  await expect(
    customerModal.getByRole("button", { name: "Выбрать", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() => customerCalls.some((call) => call.page === 2))
    .toBe(true);
  release?.();
  gate = undefined;
  await expect(customerModal).toContainText("CUST · страница 2");
  await customerModal
    .getByRole("button", { name: "Выбрать", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(customerModal).toHaveCount(0);
  await expect
    .poll(async () => (await read(page, companyRequest.id)).customerId)
    .toBe(realCustomer.id);
  const savedCompany = await read(page, companyRequest.id);
  expect(savedCompany.customerId).toBe(realCustomer.id);
  await fs.writeFile(
    testInfo.outputPath("record-query-protocol.json"),
    JSON.stringify(
      {
        calls,
        customerCalls,
        controlledLocalDelayAndFailure: true,
        realSyntheticRecipientId: realRecipient.id,
        saved,
        savedCompany,
      },
      null,
      2,
    ),
  );
});

test("real sizes 10/100/249 and filled-then-cleared starter preserve authoritative import count", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const checks: unknown[] = [];
  for (const size of [10, 100, 249]) {
    const created = await create(page, headers);
    await page.goto(`/requests/${created.id}/edit`);
    const text =
      "ФИО RU\tФИО KZ\tТабельный номер\n" +
      Array.from(
        { length: size },
        (_, index) =>
          `Синтетический объём ${size} ${index + 1}\tҚатысушы ${index + 1}\t${String(index + 1).padStart(6, "0")}`,
      ).join("\n");
    const modal = await pasteImport(page, text);
    await modal
      .getByRole("button", {
        name: `Добавить ${size} строк в черновик`,
        exact: true,
      })
      .click();
    await expect(modal).toHaveCount(0);
    await page.reload();
    const saved = await read(page, created.id);
    expect(saved.items).toHaveLength(size);
    expect(saved.items.at(-1)?.personnelNumber).toBe(
      String(size).padStart(6, "0"),
    );
    checks.push({
      size,
      id: saved.id,
      revision: saved.revision,
      last: saved.items.at(-1),
      importScaffoldId: saved.importScaffoldId,
    });
  }
  const touched = await create(page, headers);
  await page.goto(`/requests/${touched.id}/edit`);
  await page
    .getByLabel(/^ФИО(?: RU)?, строка 1$/)
    .fill("Синтетический ранее заполненный");
  await expect
    .poll(async () => (await read(page, touched.id)).items[0].fullNameRu)
    .toBe("Синтетический ранее заполненный");
  await page.getByLabel(/^ФИО(?: RU)?, строка 1$/).fill("");
  await expect
    .poll(async () => (await read(page, touched.id)).items[0].fullNameRu)
    .toBe("");
  await page.reload();
  expect((await read(page, touched.id)).importScaffoldId).toBeNull();
  const text =
    "ФИО RU\n" +
    Array.from(
      { length: 250 },
      (_, index) => `Синтетическая новая строка ${index + 1}`,
    ).join("\n");
  const modal = await pasteImport(page, text);
  await expect(modal).toContainText("После импорта получится 251");
  await expect(
    modal.getByRole("button", {
      name: "Добавить 250 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  await modal
    .getByLabel("Импортировать исходную строку 251", { exact: true })
    .uncheck();
  await modal
    .getByRole("button", { name: "Добавить 249 строк в черновик", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const saved = await read(page, touched.id);
  expect(saved.items).toHaveLength(250);
  expect(saved.items[0].id).toBe(touched.items[0].id);
  expect(saved.items[0].fullNameRu).toBe("");
  checks.push({ touchedStarter: true, saved });
  await fs.writeFile(
    testInfo.outputPath("capacity-sizes-readback.json"),
    JSON.stringify(checks, null, 2),
  );
});

test("XLSX selected sheet and CSV quoted multiline data preserve zeros and independent RU/KZ", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const created = await create(page, headers);
  await page.goto(`/requests/${created.id}/edit`);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  const sourceText = modal.getByLabel("Или вставьте таблицу с заголовками");
  const continueToMapping = modal.getByRole("button", {
    name: "Перейти к сопоставлению",
    exact: true,
  });
  await expect(continueToMapping).toBeDisabled();
  await sourceText.fill(" \t\n\u00a0 ");
  await expect(continueToMapping).toBeDisabled();
  const headersOnly = "fullNameRu\tpersonnelNumber\n";
  await sourceText.fill(headersOnly);
  await continueToMapping.click();
  await expect(
    modal.getByRole("button", {
      name: "Добавить 0 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  const afterHeadersOnly = await read(page, created.id);
  expect(afterHeadersOnly.items).toEqual(created.items);
  expect(afterHeadersOnly.revision).toBe(created.revision);
  await page.screenshot({
    path: testInfo.outputPath("headers-only-no-apply.png"),
    fullPage: true,
  });
  await modal.getByRole("button", { name: "Другой файл", exact: true }).click();
  await expect(sourceText).toHaveValue(headersOnly);
  await sourceText.fill("");
  await modal
    .getByLabel("Табличный файл", { exact: true })
    .setInputFiles(path.join(__dirname, "fixtures/import-multiple.xlsx"));
  await modal
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await modal
    .getByRole("combobox", { name: "Лист таблицы", exact: true })
    .selectOption("Получатели");
  await modal
    .getByLabel("Поле для колонки Сотрудник", { exact: true })
    .selectOption("fullNameRu");
  await modal
    .getByLabel("Поле для колонки Аты", { exact: true })
    .selectOption("fullNameKz");
  await modal
    .getByLabel("Поле для колонки Табельный код", { exact: true })
    .selectOption("personnelNumber");
  await modal
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const xlsx = await read(page, created.id);
  expect(xlsx.items[0].fullNameKz).toBe("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  expect(xlsx.items[0].personnelNumber).toBe("00123");
  expect(xlsx.items[1].fullNameKz).toBe("");
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  modal = page.getByRole("dialog");
  const csv =
    'ФИО RU;ФИО KZ;Табельный номер;Должность RU\r\n"Синтетический ""CSV"" Имя";"Ә Ғ Қ Ң Ө Ұ Ү Һ І";"000007";"Строка 1\tвнутри ячейки\nСтрока 2"\r\n';
  await modal.getByLabel("Табличный файл", { exact: true }).setInputFiles({
    name: "synthetic-quoted.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await modal
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Добавить 1 строк в черновик", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  const saved = await read(page, created.id);
  expect(saved.items).toHaveLength(3);
  expect(saved.items[2].fullNameRu).toBe('Синтетический "CSV" Имя');
  expect(saved.items[2].positionRu).toBe("Строка 1\tвнутри ячейки\nСтрока 2");
  expect(saved.items[2].personnelNumber).toBe("000007");
  await fs.writeFile(
    testInfo.outputPath("xlsx-csv-readback.json"),
    JSON.stringify(saved, null, 2),
  );
});

test("section 8 real document bulk uses effective EMPTY, preserves explicit origins in INHERITED, exact event masks, stale review, cancel and atomic retry", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const a = randomUUID(),
    b = randomUUID();
  const origins = [
    "INHERITED",
    "MANUAL",
    "IMPORTED",
    "CLEARED",
    "INHERITED",
  ] as const;
  const items = origins.map((origin, index) => ({
    ...newRecipient(),
    fullNameRu: `Синтетический Массовый ${index + 1}`,
    positionRu: "Синтетическая исходная должность",
    workplaceRu: "Синтетическая организация",
    assignments: [
      {
        ...newAssignment("pb-card"),
        eventId: a,
        protocolMode: "GROUP" as const,
        documentDate:
          origin === "MANUAL"
            ? "2026-09-01"
            : origin === "IMPORTED"
              ? "2026-09-02"
              : "",
        trainingSubject:
          origin === "MANUAL"
            ? "Ручная программа A"
            : origin === "IMPORTED"
              ? "Импортированная программа A"
              : "",
        fieldOrigins: { documentDate: origin, trainingSubject: origin },
        outcome: { status: "UNKNOWN" as const, source: "" },
        result: "",
      },
      {
        ...newAssignment("pb-card"),
        eventId: b,
        protocolMode: "GROUP" as const,
        outcome: { status: "UNKNOWN" as const, source: "" },
        result: "",
      },
      {
        ...newAssignment("ptm-card"),
        documentDate: "2026-08-01",
        reason: "Независимое ПТМ",
        outcome: { status: "UNKNOWN" as const, source: "" },
        result: "",
      },
    ],
  }));
  const created = await create(page, headers, items, {
    commonFields: { documentDate: "2026-10-06" },
    events: [
      {
        id: a,
        title: "Синтетическое ПБ A",
        protocolTemplateId: "pb-protocol",
        protocolMode: "GROUP",
        commonFields: { trainingSubject: "Общая программа A", hours: "8" },
      },
      {
        id: b,
        title: "Синтетическое ПБ B",
        protocolTemplateId: "pb-protocol",
        protocolMode: "GROUP",
        commonFields: {
          trainingSubject: "Независимая программа B",
          hours: "12",
        },
      },
    ],
  });
  await page.goto(`/requests/${created.id}/edit`);
  for (const row of [1, 2, 3, 4])
    await page.getByLabel(`Выбрать строку ${row}`, { exact: true }).check();
  const open = async () => {
    await openRecipientExtraTools(page);
    await page
      .getByRole("button", {
        name: "Изменить данные выбранных (4)",
        exact: true,
      })
      .click();
    const modal = page.getByRole("dialog");
    await modal
      .getByRole("combobox", { name: "Направление", exact: true })
      .selectOption("pb");
    await modal
      .getByRole("combobox", {
        name: "Событие для массовых полей",
        exact: true,
      })
      .selectOption(a);
    return modal;
  };
  const preview = async (modal: ReturnType<Page["getByRole"]>) => {
    await modal
      .getByRole("button", { name: "Показать изменения", exact: true })
      .click();
    return modal.getByRole("region", { name: "Предварительные изменения" });
  };
  const close = async (modal: ReturnType<Page["getByRole"]>) => {
    await modal.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(modal).toHaveCount(0);
  };
  let releaseSave: (() => void) | undefined;
  let holding = false;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  try {
    await page.route(`**/api/print-requests/${created.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      holding = true;
      await saveGate;
      await route.fulfill({ response });
    });
    await page
      .getByLabel("Должность · RU, строка 1", { exact: true })
      .fill("Реальное изменение перед просмотром");
    await expect.poll(() => holding).toBe(true);
    let modal = await open();
    await modal
      .getByRole("checkbox", { name: "Программа / тема", exact: true })
      .check();
    const value = modal.getByLabel("Общее значение: Программа / тема", {
      exact: true,
    });
    await value.fill("Проверка новой редакции");
    await modal
      .getByRole("combobox", { name: "Режим применения", exact: true })
      .selectOption("INHERITED");
    await expect(await preview(modal)).toContainText("Общая программа A");
    releaseSave?.();
    await expect(
      modal.getByRole("region", { name: "Предварительные изменения" }),
    ).toHaveCount(0);
    await expect(value).toHaveValue("Проверка новой редакции");
    await close(modal);
    await page.unroute(`**/api/print-requests/${created.id}`);
    const before = await read(page, created.id);
    modal = await open();
    await modal
      .getByRole("checkbox", { name: "Дата документа", exact: true })
      .check();
    await modal
      .getByLabel("Общее значение: Дата документа", { exact: true })
      .fill("2026-10-10");
    const emptyPreview = await preview(modal);
    await expect(emptyPreview).toContainText("Синтетический Массовый 4");
    await expect(emptyPreview).not.toContainText("Синтетический Массовый 1");
    await expect(emptyPreview).toContainText("Явно очищенное значение");
    await close(modal);
    expect((await read(page, created.id)).items).toEqual(before.items);

    modal = await open();
    await modal
      .getByRole("combobox", { name: "Режим применения", exact: true })
      .selectOption("INHERITED");
    await modal
      .getByRole("checkbox", { name: "Программа / тема", exact: true })
      .check();
    await modal
      .getByLabel("Общее значение: Программа / тема", { exact: true })
      .fill("Выбранная программа A");
    const inheritedPreview = await preview(modal);
    await expect(inheritedPreview).toContainText("Общая программа A");
    await expect(inheritedPreview).toContainText(
      "Общие действующие сведения (наследование)",
    );
    for (const row of [2, 3, 4, 5])
      await expect(inheritedPreview).not.toContainText(
        `Синтетический Массовый ${row}`,
      );
    await page.screenshot({
      path: testInfo.outputPath("document-inherited-preview.png"),
    });
    let failBulk = true;
    const failure = "Контролируемый локальный отказ массовых документов";
    await page.route(`**/api/print-requests/${created.id}`, async (route) => {
      if (route.request().method() === "PATCH" && failBulk)
        return route.fulfill({ status: 503, json: { message: failure } });
      return route.fallback();
    });
    const apply = modal.getByRole("button", {
      name: /^Применить \d+ изменений$/,
    });
    await apply.click();
    await expect(modal).toContainText(failure);
    await expect(inheritedPreview).toBeVisible();
    expect((await read(page, created.id)).items).toEqual(before.items);
    failBulk = false;
    await apply.click();
    await expect(modal).toHaveCount(0);
    await page.unroute(`**/api/print-requests/${created.id}`);
    const inherited = await read(page, created.id);
    expect(inherited.revision).toBe(before.revision + 1);
    for (let index = 0; index < inherited.items.length; index++) {
      const expected = structuredClone(before.items[index]);
      if (index === 0)
        for (const assignment of expected.assignments.filter(
          (entry) => entry.eventId === a,
        )) {
          assignment.trainingSubject = "Выбранная программа A";
          assignment.fieldOrigins = {
            ...assignment.fieldOrigins,
            trainingSubject: "MANUAL",
          };
        }
      expect(inherited.items[index]).toEqual(expected);
    }

    modal = await open();
    await modal
      .getByRole("combobox", { name: "Режим применения", exact: true })
      .selectOption("REPLACE");
    await modal
      .getByRole("checkbox", { name: "Причина проверки", exact: true })
      .check();
    const reason = modal.getByLabel("Общее значение: Причина проверки", {
      exact: true,
    });
    await reason.fill("Только выбранное событие A");
    await preview(modal);
    await expect(
      modal.getByRole("button", { name: /^Применить \d+ изменений$/ }),
    ).toBeDisabled();
    await reason.fill("Обновлённая причина A");
    await expect(
      modal.getByRole("region", { name: "Предварительные изменения" }),
    ).toHaveCount(0);
    await preview(modal);
    await modal
      .getByRole("combobox", {
        name: "Событие для массовых полей",
        exact: true,
      })
      .selectOption(b);
    await expect(
      modal.getByRole("region", { name: "Предварительные изменения" }),
    ).toHaveCount(0);
    await modal
      .getByRole("combobox", {
        name: "Событие для массовых полей",
        exact: true,
      })
      .selectOption(a);
    await preview(modal);
    await close(modal);
    expect((await read(page, created.id)).items).toEqual(inherited.items);
    modal = await open();
    await modal
      .getByRole("combobox", { name: "Режим применения", exact: true })
      .selectOption("REPLACE");
    await modal
      .getByRole("checkbox", { name: "Причина проверки", exact: true })
      .check();
    await modal
      .getByLabel("Общее значение: Причина проверки", { exact: true })
      .fill("Только выбранное событие A");
    await preview(modal);
    await modal
      .getByRole("checkbox", { name: /Подтверждаю замену отмеченных полей/ })
      .check();
    await modal
      .getByRole("button", { name: /^Применить \d+ изменений$/ })
      .click();
    await expect(modal).toHaveCount(0);
    await page.reload();
    const after = await read(page, created.id);
    expect(after.revision).toBe(inherited.revision + 1);
    for (let index = 0; index < after.items.length; index++) {
      const expected = structuredClone(inherited.items[index]);
      if (index < 4)
        for (const assignment of expected.assignments.filter(
          (entry) => entry.eventId === a,
        )) {
          assignment.reason = "Только выбранное событие A";
          assignment.fieldOrigins = {
            ...assignment.fieldOrigins,
            reason: "MANUAL",
          };
        }
      expect(after.items[index]).toEqual(expected);
      for (const assignment of after.items[index].assignments) {
        expect(assignment.outcome?.status || "UNKNOWN").toBe("UNKNOWN");
        expect(assignment.result).toBe("");
      }
    }
    await fs.writeFile(
      testInfo.outputPath("document-bulk-readback.json"),
      JSON.stringify(
        {
          before,
          inherited,
          after,
          events: { a, b },
          controlledPrecommit503: true,
          delayedRealSaveRevisionInvalidatesReview: true,
        },
        null,
        2,
      ),
    );
  } finally {
    releaseSave?.();
  }
});

test("UX32 real COMPANY search uses effective RU/KZ employers, exceptions and changed company without mutating raw people", async ({
  page,
}, testInfo) => {
  const headers = await login(page);
  const stamp = Date.now();
  const addCompany = async (nameRu: string, nameKz = "") => {
    const response = await page.request.post("/api/customers", {
      headers,
      data: { nameRu, nameKz },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  };
  const common = await addCompany(`Общая UX32 RU ${stamp}`);
  const other = await addCompany(
    `Отдельный UX32 RU ${stamp}`,
    `Бөлек UX32 KZ ${stamp}`,
  );
  const bilingual = await addCompany(
    `Новая UX32 RU ${stamp}`,
    `Жаңа UX32 KZ ${stamp}`,
  );
  const ruOnly = `Личное исключение RU ${stamp}`;
  const kzOnly = `Жеке ерекшелік KZ ${stamp}`;
  const created = await create(
    page,
    headers,
    Array.from({ length: 10 }, (_, index) => ({
      ...newRecipient(),
      fullNameRu: `Синтетический поиск ${index + 1}`,
      personnelNumber: `000${String(index + 1).padStart(2, "0")}`,
      workplaceRu: index === 7 ? ruOnly : "",
      workplaceKz: index === 8 ? kzOnly : "",
      employerId: index === 9 ? other.id : undefined,
      assignments: [],
    })),
    { kind: "COMPANY", customerId: common.id },
  );
  await page.goto(`/requests/${created.id}/edit`);
  const baseline = await read(page, created.id);
  expect(
    baseline.items
      .slice(0, 7)
      .every((item) => !item.workplaceRu && !item.workplaceKz),
  ).toBe(true);
  const tools = page.locator(".operator-list-tools");
  if (
    !(await tools.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await tools.locator(":scope > summary").click();
  const search = page.getByLabel("Поиск в заявке", { exact: true });
  const rows = page.locator(".operator-grid tbody tr");
  const searches: { query: string; expectedIds: string[] }[] = [];
  const find = async (query: string, indices: number[]) => {
    await search.fill(query);
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    expect(
      await tools.evaluate((element) => (element as HTMLDetailsElement).open),
    ).toBe(true);
    await expect(rows).toHaveCount(indices.length);
    const expectedIds = indices.map((index) => baseline.items[index].id);
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-recipient-id")),
      ),
    ).toEqual(expectedIds);
    searches.push({ query, expectedIds });
    expect((await read(page, created.id)).items).toEqual(baseline.items);
  };
  const inherited = [0, 1, 2, 3, 4, 5, 6];
  await find(common.nameRu.toLocaleLowerCase("ru"), inherited);
  await find(other.nameRu, [9]);
  await find(other.nameKz, [9]);
  await find(ruOnly, [7]);
  await find(kzOnly, [8]);
  await find("00010", [9]);
  await find("", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const companySelections: {
    searchedName: string;
    initialNativeOptionCount: number;
    exactSearchResultIds: string[];
    before: Draft;
    after: Draft;
  }[] = [];
  const selectCompany = async (company: { id: string; nameRu: string }) => {
    const before = (await read(page, created.id)) as Draft & {
      documents?: unknown[];
    };
    await page
      .getByRole("button", { name: "Сменить компанию", exact: true })
      .click();
    const initialNativeOptionCount = await page
      .getByRole("combobox", { name: "Компания", exact: true })
      .locator(`option[value="${company.id}"]`)
      .count();
    await page
      .getByRole("button", { name: "Найти в справочнике", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Найти заказчика",
      exact: true,
    });
    const searchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/customers" &&
        url.searchParams.get("search") === company.nameRu &&
        url.searchParams.get("page") === "1"
      );
    });
    await picker
      .getByLabel("Поиск по справочнику", { exact: true })
      .fill(company.nameRu);
    const searched = await searchResponse;
    expect(searched.ok()).toBe(true);
    const matching = (await searched.json()) as {
      items: { id: string }[];
    };
    const exactSearchResultIds = matching.items.map((entry) => entry.id);
    expect(exactSearchResultIds).toEqual([company.id]);
    const row = picker.locator("tbody tr").filter({
      has: page.getByText(company.nameRu, { exact: true }),
    });
    await expect(row).toHaveCount(1);
    const patchResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname ===
        `/api/print-requests/${created.id}` &&
      response.request().postDataJSON()?.draft?.customerId === company.id,
    );
    await row.getByRole("button", { name: "Выбрать", exact: true }).click();
    await expect(picker).toHaveCount(0);
    const patched = await patchResponse;
    expect(patched.ok()).toBe(true);
    const saved = (await patched.json()) as Draft;
    expect(saved.customerId).toBe(company.id);
    await expect(page.locator(".save-indicator").first()).toContainText(
      /сохранена/i,
    );
    await expect
      .poll(async () => (await read(page, created.id)).customerId)
      .toBe(company.id);
    const after = (await read(page, created.id)) as Draft & {
      documents?: unknown[];
    };
    expect(after.revision).toBe(saved.revision);
    expect(after.items).toEqual(before.items);
    expect(after.events).toEqual(before.events);
    expect(after.documents).toEqual(before.documents);
    companySelections.push({
      searchedName: company.nameRu,
      initialNativeOptionCount,
      exactSearchResultIds,
      before,
      after,
    });
    await page
      .getByRole("button", { name: `Готово: ${company.nameRu}`, exact: true })
      .click();
  };
  await selectCompany(bilingual);
  await find(common.nameRu, []);
  await find(bilingual.nameRu, inherited);
  await find(bilingual.nameKz, inherited);
  await find(other.nameRu, [9]);
  await find(ruOnly, [7]);
  await find(kzOnly, [8]);
  await page.screenshot({
    path: testInfo.outputPath("effective-employer-search.png"),
  });
  await selectCompany(common);
  await find(bilingual.nameRu, []);
  await find(common.nameRu, inherited);
  await find("00008", [7]);
  await find("", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await page.reload();
  const final = await read(page, created.id);
  expect(final.customerId).toBe(common.id);
  expect(final.items).toEqual(baseline.items);
  await fs.writeFile(
    testInfo.outputPath("effective-employer-search-readback.json"),
    JSON.stringify(
      {
        requestId: created.id,
        searches,
        companySelections,
        rawItemsUnchanged: true,
        generalRuWithoutKz: common,
        independentBilingualEmployer: other,
        changedGeneralEmployer: bilingual,
        localRuOnlyAndKzOnlyExceptions: [ruOnly, kzOnly],
        baseline,
        final,
      },
      null,
      2,
    ),
  );
});
