import { loginIsolated } from "./operator-full-fix-session";
import {
  commonSettings,
  expandCommon,
} from "./operator-common-history-helpers";
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE || "../../docs/evidence/operator-value-browser",
);
test.beforeAll(() => fs.mkdir(evidence, { recursive: true }));
test("live operator creates a simple request, grouped event, linked order, obligation and exact service calculation", async ({
  page,
}) => {
  test.setTimeout(300000);
  const personName = `Синтетический Получатель Рабочего Цикла ${randomUUID()}`;
  const companyName = `Синтетическая организация рабочего цикла ${randomUUID()}`;
  await loginIsolated(page);
  const customerWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/customers")
      customerWrites.push(request.url());
  });
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  // This flow creates an actual GROUP event, so use the company workflow.
  await page.getByRole("radio", { name: /^Организация/ }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByLabel("Название компании", { exact: true }).fill(companyName);
  await page.getByLabel("ФИО, строка 1", { exact: true }).fill(personName);
  await page.getByLabel("Должность · RU, строка 1", { exact: true }).fill("Электромонтёр");
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await expandCommon(modal.locator("details.person-fields-wide").first());
  await modal
    .locator('[data-field-path="items.0.fullNameKz"]')
    .fill("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expandCommon(page.locator("#request-training"));
  await page
    .getByRole("button", {
      name: "ПБ: добавить всем в заявке (1)",
      exact: true,
    })
    .click();
  const eventPanel = await commonSettings(page);
  await page
    .getByRole("combobox", { name: /^Протокол:/ })
    .selectOption("GROUP");
  await expandCommon(
    eventPanel
      .getByText("Название группы, профиль центра и паспорт услуги", {
        exact: true,
      })
      .locator(".."),
  );
  await eventPanel
    .getByLabel("Название события", { exact: true })
    .fill("Синтетическая программа ПБ");
  await eventPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Синтетическая программа ПБ 2026");
  await eventPanel
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("40");
  for (const [label, value] of [
    ["Дата документа для заявки", "2026-09-24"],
    ["Начало обучения для заявки", "2026-09-20"],
    ["Окончание обучения для заявки", "2026-09-23"],
    ["Дата проверки / протокола для заявки", "2026-09-24"],
  ])
    await eventPanel.getByLabel(label, { exact: true }).fill(value);
  await expect(page.locator(".save-indicator")).toContainText(
    "Ввод компании сохранён",
  );
  // Leaving event fields must persist their undo checkpoint without committing
  // the staged directory entry or disabling the next business action.
  await page.getByRole("heading", { level: 1 }).click();
  const stagedRequestId = /requests\/([^/]+)/.exec(page.url())![1];
  await expect.poll(async () => {
    const response = await page.request.get(
      `/api/print-requests/${stagedRequestId}`,
    );
    expect(response.ok(), await response.text()).toBe(true);
    const saved = await response.json();
    return {
      companyId: saved.customerId,
      protocolDate: saved.commonFields.protocolDate,
      hours: saved.events[0]?.commonFields.hours,
      name: saved.items[0].fullNameRu,
      companyWrites: customerWrites.length,
    };
  }).toEqual({
    companyId: null, protocolDate: "2026-09-24", hours: "40",
    name: personName, companyWrites: 0,
  });
  await expect(page.locator(".save-indicator")).toContainText("Ввод компании сохранён");
  const validated = page.waitForResponse(
    (response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/print-requests/${stagedRequestId}/validate`,
  );
  // Explicit validation saves and attaches the staged company. Autosave before
  // this business action intentionally keeps the directory unchanged.
  const companyCreated = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/customers"),
  );
  await page.getByRole("button", { name: "Проверить данные", exact: true }).click();
  const companyResponse = await companyCreated;
  expect(companyResponse.ok(), await companyResponse.text()).toBe(true);
  const createdCompany = await companyResponse.json();
  const validationResponse = await validated;
  expect(validationResponse.ok(), await validationResponse.text()).toBe(true);
  const checked = await validationResponse.json();
  expect(checked.valid).toBe(true);
  expect(checked.errors || checked.issues || []).toEqual([]);
  expect(customerWrites).toHaveLength(1);
  await expect(page.locator(".save-indicator")).toContainText("Рабочая версия сохранена");
  await expect(page.getByText("Данные прошли проверку", { exact: true })).toBeVisible();
  const requestPath = new URL(page.url()).pathname;
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  await page.reload();
  const record = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  const title = record.title;
  expect(record.kind).toBe("COMPANY");
  expect(JSON.parse(validationResponse.request().postData()!).expectedRevision).toBe(record.revision);
  expect(record.customerId).toBe(createdCompany.id);
  expect(record.items[0].fullNameRu).toBe(personName);
  expect(record.items[0].fullNameKz).toBe("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await expect(page.locator("#request-customer")).toContainText(companyName);
  expect(record.events).toHaveLength(1);
  expect(record.events[0].title).toBe("Синтетическая программа ПБ");
  expect(record.events[0].protocolMode).toBe("GROUP");
  expect(record.items).toHaveLength(1);
  expect(record.items[0].assignments[0].eventId).toBe(record.events[0].id);
  await expandCommon(page.locator("#request-training"));
  await page.screenshot({
    path: path.join(evidence, "live-request-context-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Прочее", exact: true })
    .getByRole("button", { name: "Связанные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать связанный заказ", exact: true })
    .click();
  await expect(
    page.getByText("Создан заказ со связанной заявкой."),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Открыть работу центра", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Работа центра", exact: true }),
  ).toBeVisible();
  const currentOrder = page.getByRole("row").filter({ hasText: companyName })
    .getByRole("button", { name: title, exact: true });
  await expect(currentOrder).toHaveCount(1);
  await currentOrder.click();
  await page
    .getByText("Добавить согласованное обязательство", { exact: true })
    .click();
  await page
    .getByLabel("Что требуется сделать", { exact: true })
    .fill("Передать согласованный комплект заказчику");
  await page
    .getByLabel("Источник требования", { exact: true })
    .fill("Синтетический договор для инженерной проверки");
  await page
    .getByRole("button", { name: "Добавить обязательство", exact: true })
    .click();
  await expect(
    page.getByText("Обязательство добавлено в заказ."),
  ).toBeVisible();
  await page
    .getByLabel("Подтверждение выполнения", { exact: true })
    .fill("Синтетическая передача тестового комплекта, 24.09.2026");
  await page
    .getByRole("button", { name: "Зафиксировать выполнение", exact: true })
    .click();
  await expect(
    page.getByText("Обязательство выполнено, основание сохранено."),
  ).toBeVisible();
  await page
    .getByText("Расчёты и финансовые основания", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить согласованную услугу", exact: true })
    .click();
  await page
    .getByLabel("Услуга 1", { exact: true })
    .fill("Согласованная услуга ПБ");
  await page.getByLabel("Количество услуги 1", { exact: true }).fill("2");
  await page.getByLabel("Цена услуги 1", { exact: true }).fill("12345,67");
  await page
    .getByRole("combobox", { name: "Налоговая ставка", exact: true })
    .selectOption("0");
  await page
    .getByLabel("Основание налогового расчёта", { exact: true })
    .fill("Только синтетический тест: нулевая ставка задана явно");
  await page
    .getByRole("button", {
      name: "Сохранить согласованный расчёт",
      exact: true,
    })
    .click();
  await expect(page.getByText(/Согласовано: 24691,34 KZT/)).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "live-order-finance-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(evidence, "live-workbench-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto(requestPath);
  await expect(page.getByLabel("ФИО, строка 1")).toHaveValue(personName);
  await page.screenshot({
    path: path.join(evidence, "live-request-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
