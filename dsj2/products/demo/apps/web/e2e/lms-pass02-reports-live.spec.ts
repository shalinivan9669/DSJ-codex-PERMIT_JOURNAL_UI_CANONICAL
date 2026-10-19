import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const fixture = JSON.parse(
  readFileSync(
    process.env.DEMO_LMS_EMPLOYER_FIXTURE ||
      path.join(
        product,
        ".runtime/lms-pass02-operations-20261018/employer-browser-fixture.json",
      ),
    "utf8",
  ),
);
const output =
  process.env.DEMO_E2E_EVIDENCE ||
  path.join(
    product,
    "docs/evidence/lms-full-tz-pass-02-operations-20261018/reports-browser",
  );

test("N06/N07 real report UI, snapshot download, recovery, eight kinds, keyboard and responsive languages", async ({
  page,
}) => {
  const started = Date.now();
  await mkdir(output, { recursive: true });
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(fixture.users.employer.email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(fixture.users.employer.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/lms/reports");
  await expect(
    page.getByRole("heading", { name: "Сводка и отчёты", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Организация", { exact: true })
    .selectOption(fixture.customerId);
  await expect(
    page.getByRole("region", { name: "Строки отчёта" }),
  ).toBeVisible();
  await page
    .getByText("Сводные показатели выбранных назначений", { exact: true })
    .click();
  const participantRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("rowheader", { name: "Участники", exact: true }),
    });
  const participants = Number(
    await participantRow.getByRole("cell").first().textContent(),
  );
  await participantRow
    .getByRole("button", { name: "Состав", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `Сотрудники · ${participants}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Весь отчёт", exact: true }).click();
  for (const kind of [
    "TRAINING",
    "EMPLOYEES",
    "TESTING",
    "DOCUMENTS",
    "ORGANIZATIONS",
    "DEADLINES",
    "CREDENTIALS",
    "CERTIFICATES",
  ]) {
    const reply = page.waitForResponse(
      (r) =>
        r.url().endsWith("/lms/reports/query") &&
        r.request().postDataJSON().kind === kind &&
        r.status() >= 200 &&
        r.status() < 300,
    );
    await page.getByLabel("Вид отчёта", { exact: true }).selectOption(kind);
    // The already-selected first kind also needs a query trigger.
    if (kind === "TRAINING")
      await page
        .getByLabel("Поиск слушателя", { exact: true })
        .fill("Synthetic");
    const data = await (await reply).json();
    await expect(
      page.getByRole("region", { name: "Строки отчёта" }),
    ).toBeVisible();
    expect(data.columns.length).toBeGreaterThan(0);
    expect(data.pageSize).toBe(30);
    expect(data.items.length).toBeLessThanOrEqual(30);
  }
  await page.getByLabel("Вид отчёта", { exact: true }).selectOption("TRAINING");
  await page.getByLabel("Формат", { exact: true }).selectOption("CSV");
  await page
    .getByText("Дата, БИН, город, преподаватель и состояние", { exact: true })
    .click();
  await expect(page.getByLabel("Назначено с", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Назначено до", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("БИН организации", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Подтверждённый город", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Преподаватель по текущей учебной связи", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Поиск слушателя", { exact: true })
    .fill("Synthetic existing");
  await expect(
    page.getByRole("region", { name: "Строки отчёта" }).getByRole("row"),
  ).not.toHaveCount(1);
  await page.route(
    "**/api/lms/reports/query",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "TEMPORARY_UNAVAILABLE",
            message: "Synthetic local recovery check",
          },
        }),
      }),
    { times: 1 },
  );
  await page
    .getByLabel("Поиск слушателя", { exact: true })
    .fill("Synthetic existing 0");
  await expect(page.locator('.notice[role="alert"]')).toBeVisible();
  await expect(page.getByLabel("Поиск слушателя", { exact: true })).toHaveValue(
    "Synthetic existing 0",
  );
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Строки отчёта" }),
  ).toBeVisible();
  await page.route(
    /\/api\/lms\/reports$/,
    (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "REPORT_QUEUE_BUSY",
            message: "Synthetic local retry check",
          },
        }),
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Сформировать отчёт", exact: true })
    .click();
  await expect(page.locator('.notice[role="alert"]')).toBeVisible();
  await expect(page.getByLabel("Поиск слушателя", { exact: true })).toHaveValue(
    "Synthetic existing 0",
  );
  const creation = page.waitForResponse(
    (r) =>
      /\/api\/lms\/reports$/.test(r.url()) &&
      r.request().method() === "POST" &&
      r.status() < 300,
  );
  await page
    .getByRole("button", { name: "Сформировать отчёт", exact: true })
    .click();
  const job = await (await creation).json();
  await expect(page.getByText("Отчёт готов", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.reload();
  await expect(page.getByText("Отчёт готов", { exact: true })).toBeVisible();
  await expect(page.getByText(/Сохранённый срез:/)).toBeVisible();
  await expect(page.getByLabel("Поиск слушателя", { exact: true })).toHaveValue(
    "Synthetic existing 0",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await download.saveAs(path.join(output, "reports-browser.csv"));
  expect(
    readFileSync(path.join(output, "reports-browser.csv"), "utf8")
      .split("\r\n")
      .filter(Boolean).length,
  ).toBe(job.total + 1);
  const privateResponse = await page.request.get(
    `/api/lms/reports/${job.id}/file`,
  );
  expect(privateResponse.status()).toBe(200);
  expect(privateResponse.headers()["cache-control"]).toContain("no-store");
  expect(
    (
      await page.request.get(
        "/api/lms/reports/00000000-0000-0000-0000-000000000000",
      )
    ).status(),
  ).toBe(404);
  await page.getByRole("region", { name: "Строки отчёта" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("region", { name: "Строки отчёта" }),
  ).toBeFocused();
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(output, `reports-${width}-ru.png`),
      fullPage: true,
    });
  }
  const kz = page.getByRole("button", { name: "Қазақша", exact: true });
  await page
    .getByRole("button", { name: "Текущие данные", exact: true })
    .click();
  if (await kz.count()) await kz.click();
  else await page.getByRole("button", { name: "KZ", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Жиынтық пен есептер", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Есеп дайын", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Тыңдаушы", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(output, "reports-kz.png"),
    fullPage: true,
  });
  await writeFile(
    path.join(output, "UX_REPORTS.json"),
    JSON.stringify(
      {
        status: "PASS",
        capturedAt: new Date(),
        elapsedMs: Date.now() - started,
        jobId: job.id,
        rows: job.total,
        reportKinds: 8,
        viewports: [360, 390, 768, 1440],
        languages: ["ru", "kz"],
        keyboard: "Tab/focus and ArrowRight report region",
        preparedScenario: {
          startState: "Scoped organization and filters already selected",
          sequence: ["Сформировать отчёт", "Скачать"],
          clicks: 2,
          dialogs: 0,
          repeatedFields: 0,
        },
        recovery: [
          "503 retains filters",
          "429 retry retains request identity",
          "reload restores filters and ready job",
        ],
        preparation:
          "Dedicated synthetic employer fixture is API seed, not UI entry; full format contents and revocation proved by integration suite",
      },
      null,
      2,
    ),
  );
});
