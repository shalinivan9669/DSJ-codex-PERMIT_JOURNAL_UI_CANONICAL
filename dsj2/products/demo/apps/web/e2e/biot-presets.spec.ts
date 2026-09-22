import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/commercial-acceptance/browser/biot-presets",
);
test.beforeAll(() => fs.mkdir(evidence, { recursive: true }));

for (const form of ["biot-worker-card", "biot-itr-certificate"] as const) {
  test(`${form}: category defaults, manual overrides and server draft survive reload`, async ({
    page,
  }) => {
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
    await page.getByRole("button", { name: /Человек Документы/ }).click();
    await page
      .getByLabel("ФИО RU, строка 1")
      .fill("Тестовый Получатель Категории БиОТ");
    await page.getByLabel("ФИО KZ, строка 1").fill("Тест Ә Ғ Қ Ң Ө Ұ Ү Һ І");
    await page
      .getByLabel("Название заявки")
      .fill(`ПРОВЕРКА КАТЕГОРИИ ${form} ${Date.now()}`);
    await page
      .getByLabel("Форма документа", { exact: true })
      .selectOption(form);
    const category = page.getByLabel("Категория обучения БиОТ", {
      exact: true,
    });
    const hours = page.getByLabel(
      /^(Теоретическое обучение|Обучение), акад\. ч\.$/,
    );
    const until = page.getByLabel("Действителен до", { exact: true });
    const worker = form === "biot-worker-card";
    await expect(category).toHaveValue(
      worker ? "WORKER" : "OHS_SPECIALIST_SPECIAL",
    );
    await expect(hours).toHaveValue(worker ? "10" : "40");
    await page.getByLabel("Дата документа", { exact: true }).fill("2028-02-29");
    await expect(until).toHaveValue(worker ? "2029-02-28" : "2031-02-28");
    if (worker) {
      await expect(
        page.getByLabel("Производственное обучение, часов", { exact: true }),
      ).toHaveValue("16");
      await expect(
        page.getByText(/Теория — не менее 10 академических часов/),
      ).toBeVisible();
    } else {
      await category.selectOption("MANAGER_GENERAL");
      await expect(hours).toHaveValue("16");
      await expect(
        page.getByText(/DEMO не выдаёт и не заменяет сертификат ЕЦС/),
      ).toBeVisible();
      await category.selectOption("OHS_SPECIALIST_SPECIAL");
      await expect(hours).toHaveValue("40");
    }
    await page.screenshot({
      path: path.join(evidence, `${form}-defaults.png`),
      fullPage: true,
    });
    await hours.fill(worker ? "12" : "48");
    if (worker)
      await page
        .getByLabel("Производственное обучение, часов", { exact: true })
        .fill("20");
    await until.fill(worker ? "2028-12-31" : "2030-12-31");
    await page.getByLabel("Дата документа", { exact: true }).fill("2028-03-01");
    if (!worker) {
      await category.selectOption("MANAGER_GENERAL");
      await expect(hours).toHaveValue("48");
      await category.selectOption("OHS_SPECIALIST_SPECIAL");
    }
    await expect(until).toHaveValue(worker ? "2028-12-31" : "2030-12-31");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.locator(".save-indicator")).toContainText("Сохранено");
    const requestId = /requests\/([^/]+)/.exec(page.url())![1];
    const response = await page.request.get(`/api/print-requests/${requestId}`);
    expect(response.status()).toBe(200);
    const draft = await response.json();
    expect(draft.status).toBe("DRAFT");
    expect(draft.issuances || []).toHaveLength(0);
    expect(draft.items[0].assignments[0].biotCategory).toBe(
      worker ? "WORKER" : "OHS_SPECIALIST_SPECIAL",
    );
    await page.reload();
    await expect(category).toHaveValue(
      worker ? "WORKER" : "OHS_SPECIALIST_SPECIAL",
    );
    await expect(hours).toHaveValue(worker ? "12" : "48");
    await expect(until).toHaveValue(worker ? "2028-12-31" : "2030-12-31");
    if (worker)
      await expect(
        page.getByLabel("Производственное обучение, часов", { exact: true }),
      ).toHaveValue("20");
    await page.screenshot({
      path: path.join(evidence, `${form}-manual-reload.png`),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(evidence, `${form}.json`),
      JSON.stringify(
        {
          status: "PASS",
          requestId,
          requestUrl: page.url(),
          syntheticOnly: true,
          scope:
            "Actual browser defaults/manual overrides/server save/reload; no issuance or renderer run",
          assignment: draft.items[0].assignments[0],
        },
        null,
        2,
      ),
    );
  });
}
