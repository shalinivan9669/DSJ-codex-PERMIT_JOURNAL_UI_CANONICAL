import {
  assertTechnicalBlankRemoval,
  createRequestWithWorkerDocument,
} from "./operator-keyboard-helpers";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
test.use({ trace: "off" });
test("V04 exact revised list: six imported people, four unchanged, one changed, one added, one absent, and actionable copied clarification", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const product = path.resolve("../.."),
    evidence = path.resolve(
      process.env.DEMO_E2E_EVIDENCE
        ? path.join(process.env.DEMO_E2E_EVIDENCE, "revised-six")
        : "../../docs/evidence/final-completion/revised-six",
    );
  await fs.mkdir(evidence, { recursive: true });
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/verification/provision-final-service-ui.ts"],
    { cwd: product, env: process.env, windowsHide: true, stdio: "pipe" },
  );
  const auth = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/final-service-ui-auth.json"),
      "utf8",
    ),
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/DAILY_WORKFLOWS.json"),
      "utf8",
    ),
  );
  const fields = [
    "externalId",
    "personnelNumber",
    "fullNameRu",
    "fullNameKz",
    "positionRu",
    "positionKz",
    "departmentRu",
    "departmentKz",
    "workplaceRu",
    "workplaceKz",
  ];
  const toTsv = (rows: Record<string, string>[]) =>
    fields.join("\t") +
    "\n" +
    rows
      .map((row) =>
        fields
          .map((field) =>
            field === "externalId" ? row.externalPersonKey : row[field] || "",
          )
          .join("\t"),
      )
      .join("\n");
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "COMPANY");
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await assertTechnicalBlankRemoval(page);
  async function openImport(tsv: string, revised = false) {
    await page.getByRole("button", { name: "Импорт", exact: true }).click();
    if (revised)
      await page
        .getByLabel("Это исправленный список для существующей заявки", {
          exact: true,
        })
        .check();
    await page.getByLabel("Или вставьте таблицу с заголовками").fill(tsv);
    await page
      .getByRole("button", { name: "Проверить таблицу", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .locator(".import-document-options > summary")
      .click();
    await page
      .getByRole("combobox", {
        name: "Документ для импортируемых строк",
        exact: true,
      })
      .selectOption("pb-card");
  }
  await openImport(toTsv(fixture.cases.V04.sourcePeople));
  await page
    .getByRole("button", { name: "Добавить 6 строк в черновик", exact: true })
    .click();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(6);
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  const id = /requests\/([^/]+)/.exec(page.url())![1];
  const read = async () => {
    const r = await page.request.get(`/api/print-requests/${id}`);
    expect(r.ok()).toBe(true);
    return r.json();
  };
  const original = await read();
  await openImport(toTsv(fixture.cases.V04.revisedPeople), true);
  await page
    .getByRole("button", { name: "Сравнить с текущим списком", exact: true })
    .click();
  const comparison = page.getByRole("region", {
    name: "Сравнение исправленного списка",
  });
  await expect(comparison.getByText("Новые: 1", { exact: true })).toBeVisible();
  await expect(
    comparison.getByText("Изменились: 1", { exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByText("Без изменений: 4", { exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByText("Нет в новом файле: 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Применить согласованные изменения",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByLabel("Проверил изменения и сохраняемый состав", { exact: true })
    .check();
  await page
    .getByRole("button", {
      name: "Применить согласованные изменения",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".operator-grid tbody tr")).toHaveCount(7);
  const revised = await read();
  const keyed = (
    items: {
      externalId: string;
      positionRu: string;
      id: string;
      assignments: unknown[];
      fullNameRu: string;
    }[],
  ) => new Map(items.map((row) => [row.externalId, row]));
  const before = keyed(original.items),
    after = keyed(revised.items);
  for (const row of original.items) {
    const next = after.get(row.externalId) as typeof row;
    expect(next).toBeTruthy();
    expect(next.id).toBe(row.id);
    expect(next.assignments).toEqual(row.assignments);
    if (row.externalId !== "DEMO-P002")
      expect(next.fullNameRu).toBe(row.fullNameRu);
  }
  expect((after.get("DEMO-P002") as { positionRu: string }).positionRu).toBe(
    "Тестовая уточнённая должность",
  );
  expect(after.has("DEMO-P006")).toBe(true);
  expect(after.has("DEMO-P007")).toBe(true);
  expect(before.has("DEMO-P007")).toBe(false);
  // The exact revised fixture is complete. Exercise a separate missing-field
  // branch after proving its reconciliation, rather than inventing an issue.
  await page.getByLabel("ФИО, строка 7", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Детали получателя 7", exact: true })
    .click();
  const personal = page.getByRole("dialog", {
    name: "Настройки строки 7",
    exact: true,
  });
  await personal
    .getByRole("tab", { name: "Личные данные", exact: true })
    .click();
  await personal.locator("summary", { hasText: "Казахский вариант" }).click();
  await personal.getByLabel("ФИО · KZ", { exact: true }).fill("");
  await personal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  const withMissingName = await read();
  await page
    .getByRole("button", { name: "Дополнительные действия", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Согласование и передача", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подготовить запрос уточнений", exact: true })
    .click();
  const textarea = page.getByRole("textbox", {
    name: "Текст запроса уточнений",
    exact: true,
  });
  await expect(textarea).not.toHaveValue("");
  const prepared = await textarea.inputValue();
  expect(prepared).not.toMatch(
    /PHOTO_REQUIRED|RESULT_REQUIRED|correlationId|пароль|secret/i,
  );
  expect(prepared).toContain("000007");
  const edited =
    "Здравствуйте! Список обновлён: один новый сотрудник, одна уточнённая должность. Уточните фотографии и результаты, отсутствующий сотрудник сохранён до согласования.";
  await textarea.fill(edited);
  let mutations = 0;
  const observer = (r: { url(): string; method(): string }) => {
    if (
      r.url().includes("/api/") &&
      ["POST", "PATCH", "PUT", "DELETE"].includes(r.method())
    )
      mutations++;
  };
  page.on("request", observer);
  await page
    .getByRole("button", { name: "Копировать запрос уточнений", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    edited,
  );
  page.off("request", observer);
  expect(mutations).toBe(0);
  expect((await read()).items).toEqual(withMissingName.items);
  await page.screenshot({
    path: path.join(evidence, "revised-clarification.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        fixture: "DAILY_WORKFLOWS.V04",
        requestId: id,
        initialRows: 6,
        revisedInputRows: 6,
        retainedRows: 7,
        counts: { added: 1, changed: 1, unchanged: 4, missing: 1 },
        stableIdsPreserved: true,
        assignmentsPreserved: true,
        missingNotDeleted: true,
        copyMutations: mutations,
        checks: [
          "both source and revised lists entered through actual import UI",
          "comparison and explicit apply",
          "reload retains changed values and all stable links",
          "missing person retained without implicit deletion",
          "clarification edited and copied without transmission",
        ],
      },
      null,
      2,
    ),
  );
});
