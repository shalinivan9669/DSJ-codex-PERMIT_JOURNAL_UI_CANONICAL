import { createRequestWithWorkerDocument } from "./operator-keyboard-helpers";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/final-completion/operator/text-quality",
);
test("real editor warns about mixed alphabets and invisible symbols without rewriting Kazakh or foreign names or blocking valid issue data", async ({
  page,
}) => {
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
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await page
    .getByLabel("ФИО RU, строка 1", { exact: true })
    .fill("Ивaнов Синтетический");
  await page
    .getByLabel("ФИО KZ, строка 1", { exact: true })
    .fill("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  const row = page.locator(".recipient-table tbody tr").first();
  await expect(row.locator(".field-hint")).toHaveCount(1);
  await page
    .getByLabel("Программа / тема обучения", { exact: true })
    .fill("Синтетическая проверка текста");
  await page
    .getByLabel("Подтверждённый результат / оценка", { exact: true })
    .fill("Фактически подтверждённый синтетический результат");
  await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
  const invisible = "Электрик\u200B";
  await page.getByLabel("Должность · RU", { exact: true }).fill(invisible);
  await expect(
    page.locator(".person-fields").getByText(/Проверка источника:.*невидим/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(
    page.getByText("Данные прошли проверку", { exact: true }),
  ).toBeVisible();
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  await page.reload();
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toHaveValue("Ивaнов Синтетический");
  await expect(
    page.getByLabel("ФИО KZ, строка 1", { exact: true }),
  ).toHaveValue("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  const record = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(record.items[0].positionRu).toBe(invisible);
  await page.getByLabel("ФИО RU, строка 1", { exact: true }).fill("John Smith");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  await page.reload();
  await expect(
    page.getByLabel("ФИО RU, строка 1", { exact: true }),
  ).toHaveValue("John Smith");
  await expect(row.locator(".field-hint")).toHaveCount(0);
  await fs.writeFile(
    path.join(evidence, "text-quality-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        mixedScriptWarning: true,
        invisibleWarning: true,
        kazakhPreserved: true,
        foreignNamePreserved: true,
        noAutomaticNameRewrite: true,
        nonblockingServerValidation: true,
        noMocks: true,
      },
      null,
      2,
    ),
  );
});
