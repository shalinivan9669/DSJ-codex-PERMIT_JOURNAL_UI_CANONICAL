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
  await loginIsolated(page);
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await page.getByLabel("ФИО, строка 1", { exact: true }).fill(personName);
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
    ["Окончание обучения для заявки", "2026-09-24"],
    ["Дата проверки / протокола для заявки", "2026-09-24"],
  ])
    await eventPanel.getByLabel(label, { exact: true }).fill(value);
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
  const requestPath = new URL(page.url()).pathname;
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  await page.reload();
  const record = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  const title = record.title;
  expect(title).toBe(personName);
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
  const currentOrder = page.getByRole("button", { name: title, exact: true });
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
