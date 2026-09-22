import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const evidence = path.resolve(process.env.DEMO_E2E_EVIDENCE || "../../docs/evidence/biot-finish/browser");
const forms = ["biot-worker-card", "biot-protocol", "biot-itr-certificate", "biot-itr-protocol"];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("new isolated synthetic issuer: four current BIOT forms preview and issue through UI", async ({ page, browser }) => {
  test.setTimeout(600000);
  // The profile is shared by a tenant. This scenario must never use an existing operator tenant.
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  expect(process.env.DEMO_E2E_EMAIL).toMatch(/^biot-finish-/);
  await fs.mkdir(evidence, { recursive: true });
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(process.env.DEMO_E2E_EMAIL!);
  await page.getByLabel("Пароль", { exact: true }).fill(process.env.DEMO_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Заявки на печать" })).toBeVisible();
  await page.goto("/settings");
  for (const [label, value] of [
    ["Юридическое название · RU", "ТЕСТОВЫЙ учебный центр БиОТ"],
    ["Юридическое название · KZ", "БиОТ СЫНАҚ оқу орталығы"],
    ["БИН учебного центра", "000000000001"],
    ["ФИО руководителя учебного центра", "Синтетический Руководитель Әли"],
    ["Город · RU", "Кызылорда"], ["Город · KZ", "Қызылорда"],
    ["Адрес · RU", "Тестовый адрес, 1"], ["Адрес · KZ", "Сынақ мекенжайы, 1"],
    ["Основание утверждения / полномочий", "ТЕСТ: синтетическая комиссия для проверки макета; не выданный документ"],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  while (await page.locator(".commission-row").count() < 3)
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
  const names = ["Тестовый Председатель Әли", "Тестовый Первый Член", "Тестовый Второй Член"];
  for (const [index, name] of names.entries()) {
    const row = page.locator(".commission-row").nth(index);
    await row.getByLabel("ФИО", { exact: true }).fill(name);
    await row.getByLabel("Роль в комиссии / должность", { exact: true }).fill(index ? "Член комиссии" : "Председатель комиссии");
  }
  await page.getByLabel("Реквизиты и состав комиссии проверены уполномоченным сотрудником центра").check();
  await page.getByRole("button", { name: "Сохранить новую версию", exact: true }).click();
  await expect(page.getByText(/Создана новая версия реквизитов/)).toBeVisible();
  await page.goto("/requests");
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page.getByLabel("Название заявки", { exact: true }).fill(`ТЕСТ · новые четыре формы БиОТ · ${Date.now()}`);
  await page.getByLabel("ФИО RU, строка 1").fill("Тестовый Получатель БиОТ");
  await page.getByLabel("ФИО KZ, строка 1").fill("Сынақ Әли Қасымұлы");
  for (const [index, form] of forms.entries()) {
    if (index) await page.getByRole("button", { name: "Добавить документ", exact: true }).click();
    const block = page.locator(".assignment-list details").nth(index);
    if (!(await block.evaluate((element) => (element as HTMLDetailsElement).open))) await block.locator("summary").click();
    await block.getByLabel("Форма документа", { exact: true }).selectOption(form);
    const itr = form.includes("-itr-");
    await expect(block.getByLabel("Категория обучения БиОТ", { exact: true })).toHaveValue(itr ? "OHS_SPECIALIST_SPECIAL" : "WORKER");
    await block.getByLabel("Дата документа", { exact: true }).fill("2026-09-22");
    await expect(block.getByLabel("Действителен до", { exact: true })).toHaveValue(itr ? "2029-09-22" : "2027-09-22");
    await block.getByLabel("Дата протокола", { exact: true }).fill("2026-09-22");
    await block.getByLabel("Начало обучения", { exact: true }).fill("2026-09-18");
    await block.getByLabel("Окончание обучения", { exact: true }).fill("2026-09-21");
    await block.getByLabel("Программа / тема обучения", { exact: true }).fill("ТЕСТ: программа по безопасности и охране труда");
    await block.getByLabel("Подтверждённый результат / оценка", { exact: true }).fill("сдал / тапсырды (ТЕСТ)");
    if (itr) {
      await block.getByLabel("Отрасль специальных компетенций · RU", { exact: true }).fill("ТЕСТ: промышленное строительство");
      await block.getByLabel("Отрасль специальных компетенций · KZ", { exact: true }).fill("СЫНАҚ: өнеркәсіптік құрылыс");
    }
    if (form === "biot-itr-protocol") {
      await expect(block.getByLabel("Фактический результат проверки знаний", { exact: true })).toHaveValue("");
      await expect(block.getByLabel("Фактический результат прокторинга", { exact: true })).toHaveValue("");
      await block.getByLabel("Фактический результат проверки знаний", { exact: true }).fill("ТЕСТ: 92 из 100");
      await block.getByLabel("Фактический результат прокторинга", { exact: true }).fill("ТЕСТ: прошел / өткен");
      await expect(block.getByLabel("Уникальный номер сертификата БиОТ", { exact: true })).toHaveValue("");
    }
  }
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  for (const [label, value] of [
    ["Должность · RU", "Тестовый инженер"], ["Должность · KZ", "Сынақ инженері"],
    ["Место работы · RU", "ТЕСТОВОЕ предприятие"], ["Место работы · KZ", "СЫНАҚ кәсіпорны"],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByText("Реквизиты работодателя для форм БиОТ", { exact: true }).click();
  for (const [label, value] of [
    ["Подразделение · RU", "Тестовый участок"], ["Подразделение · KZ", "Сынақ учаскесі"],
    ["БИН работодателя", "000000000002"],
    ["Юридический адрес работодателя · RU", "Тестовый адрес предприятия, 2"],
    ["Юридический адрес работодателя · KZ", "Сынақ кәсіпорын мекенжайы, 2"],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(page.getByText("Данные прошли проверку", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  const view = page.getByRole("button", { name: "Посмотреть", exact: true }).first();
  await expect(view).toBeVisible({ timeout: 240000 });
  await view.click();
  const preview = await page.request.get((await page.locator("iframe").getAttribute("src"))!);
  expect(preview.headers()["content-type"]).toContain("application/pdf");
  await fs.writeFile(path.join(evidence, "biot-browser-preview.pdf"), await preview.body());
  await page.screenshot({ path: path.join(evidence, "preview.png") });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Оформить комплект", exact: true }).click();
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  await expect(page.locator(".title-with-status .status")).toHaveText("Оформлено");
  await expect(page.locator(".files-panel")).toContainText("Готово 18 из 18", { timeout: 300000 });
  await page.screenshot({ path: path.join(evidence, "issued.png"), fullPage: true });
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const snapshot = await (await page.request.get(`/api/print-requests/${requestId}`)).json();
  expect(snapshot.issuances).toHaveLength(1);
  expect(snapshot.documents).toHaveLength(4);
  expect(snapshot.artifacts).toHaveLength(18);
  const artifacts = [];
  for (const artifact of snapshot.artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(sha(bytes)).toBe(artifact.sha256);
    const file = `${artifact.id}-${artifact.fileName}`;
    await fs.writeFile(path.join(evidence, file), bytes);
    artifacts.push({ ...artifact, file });
  }
  await fs.writeFile(path.join(evidence, "issue-result.json"), JSON.stringify({
    status: "PASS", requestId, requestUrl: page.url(), browser: browser.version(),
    syntheticDataOnly: true, profileConfiguredThroughUi: true,
    templates: snapshot.issuances[0].snapshot.templates,
    assignments: snapshot.issuances[0].snapshot.draft.items[0].assignments,
    documents: snapshot.documents, artifacts,
  }, null, 2));
});
