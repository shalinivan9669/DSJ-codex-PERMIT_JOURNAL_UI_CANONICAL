import { createRequestWithWorkerDocument } from "./operator-keyboard-helpers";
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE || "../../docs/evidence/operator-value-browser",
);
test.beforeAll(() => fs.mkdir(evidence, { recursive: true }));
test("live operator creates a simple request, grouped event, linked order, obligation and exact service calculation", async ({
  page,
}) => {
  test.setTimeout(300000);
  expect(process.env.DEMO_E2E_EMAIL).toBeTruthy();
  expect(process.env.DEMO_E2E_PASSWORD).toBeTruthy();
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await expect(page.getByLabel("ФИО RU, строка 1")).toBeVisible();
  const title = `Проверка рабочего цикла ${Date.now()}`;
  await page.getByLabel("Название заявки").fill(title);
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Синтетический Получатель Рабочего Цикла");
  await page
    .getByLabel("ФИО KZ, строка 1")
    .fill("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await page.getByLabel("Выбрать всех получателей").check();
  await page.getByRole("button", { name: "Настроить даты и протоколы" }).click();
  await page
    .getByRole("button", { name: "Добавить событие", exact: true })
    .click();
  await page
    .getByLabel("Название события", { exact: true })
    .fill("Синтетическая программа ПБ");
  const eventPanel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Общие сведения и события" }),
  });
  await eventPanel
    .getByLabel("Дата документа", { exact: true })
    .fill("2026-09-24");
  await eventPanel
    .getByLabel("Начало обучения", { exact: true })
    .fill("2026-09-20");
  await eventPanel
    .getByLabel("Окончание обучения", { exact: true })
    .fill("2026-09-24");
  await eventPanel
    .getByLabel("Дата проверки / протокола", { exact: true })
    .fill("2026-09-24");
  await eventPanel
    .getByLabel("Программа / тема", { exact: true })
    .fill("Синтетическая программа ПБ 2026");
  await eventPanel
    .getByLabel("Объём обучения, часов", { exact: true })
    .fill("40");
  await page
    .getByRole("button", { name: "Назначить набор выбранным (1)" })
    .click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  const requestPath = new URL(page.url()).pathname;
  await page.reload();
  await expect(
    page.getByLabel("Название события", { exact: true }),
  ).toHaveValue("Синтетическая программа ПБ");
  await expect(
    page.getByText("1 назначений · 1 общий протокол при оформлении"),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "live-request-context-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Открыть действия", exact: true })
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
  await page.getByRole("button", { name: title, exact: true }).click();
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
  await expect(page.getByLabel("ФИО RU, строка 1")).toHaveValue(
    "Синтетический Получатель Рабочего Цикла",
  );
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
