import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/operator-value/v01-browser",
);
test("V01 one person obtains an actual supported file without company, order or portal", async ({
  page,
  browser,
}) => {
  test.setTimeout(300000);
  await fs.mkdir(evidence, { recursive: true });
  const started = Date.now();
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
  await page.getByRole("button", { name: /Человек Документы/ }).click();
  await page
    .getByLabel("Название заявки", { exact: true })
    .fill(`V01 · синтетический одиночный выпуск ${Date.now()}`);
  await page
    .getByLabel("ФИО RU, строка 1")
    .fill("Синтетический Получатель Одиночного Выпуска");
  await page
    .getByLabel("ФИО KZ, строка 1")
    .fill("Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await page
    .getByLabel("Форма документа", { exact: true })
    .selectOption("biot-worker-card");
  await page.getByLabel("Дата документа", { exact: true }).fill("2026-09-24");
  await page
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill("Синтетическая проверка одиночной услуги БиОТ");
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Исправьте данные перед оформлением", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Подтверждённый результат / оценка", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Подтверждённый результат / оценка", { exact: true })
    .fill("Сдано, синтетическая инженерная проверка");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.reload();
  await expect(page.getByLabel("ФИО KZ, строка 1")).toHaveValue(
    "Синтетикалық Ә Ғ Қ Ң Ө Ұ Ү Һ І",
  );
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "v01-ready.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Оформить комплект", exact: true })
    .click();
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/finalize") && r.request().method() === "POST",
  );
  const renderStarted = Date.now();
  await page.getByRole("button", { name: "Оформить", exact: true }).click();
  const response = await responsePromise;
  const responseBody = await response.json();
  expect(response.ok(), JSON.stringify(responseBody)).toBe(true);
  await expect(page.locator(".title-with-status .status")).toHaveText(
    "Оформлено",
  );
  await expect(page.locator(".files-panel")).toContainText("Готово 4 из 4", {
    timeout: 240000,
  });
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const record = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(record.customerId).toBeNull();
  expect(record.items).toHaveLength(1);
  expect(record.documents).toHaveLength(1);
  expect(record.issuances).toHaveLength(1);
  const pdf = record.artifacts.find(
    (a: { format: string }) => a.format === "PDF",
  );
  expect(pdf).toBeTruthy();
  const download = await page.request.get(`/api/artifacts/${pdf.id}`);
  const bytes = await download.body();
  expect(download.ok()).toBe(true);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(sha256).toBe(pdf.sha256);
  await fs.writeFile(path.join(evidence, "v01-original.pdf"), bytes);
  await page.screenshot({
    path: path.join(evidence, "v01-issued.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "v01-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        syntheticDataOnly: true,
        requestId,
        documentNumber: record.documents[0].number,
        file: "v01-original.pdf",
        sha256,
        browser: browser.version(),
        customerCreated: false,
        orderCreated: false,
        portalConfigured: false,
        forms: ["biot-worker-card"],
        automatedWallMs: Date.now() - started,
        issueToFilesWallMs: Date.now() - renderStarted,
        activeOperatorMs: null,
        baselineMs: null,
        limitation:
          "Single automated synthetic engineering scenario. No real-client usability, paid pilot or timing improvement is established.",
      },
      null,
      2,
    ),
  );
});
