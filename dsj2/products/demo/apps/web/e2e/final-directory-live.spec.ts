import {
  createRequestWithWorkerDocument,
  openRecipientExtraTools,
} from "./operator-keyboard-helpers";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const product = path.resolve("../..");
test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/final-completion/directory",
);
test.beforeAll(() =>
  execFileSync(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(product, "scripts/verification/provision-final-service-ui.ts"),
      "--directory",
    ],
    { cwd: product, env: process.env, windowsHide: true, stdio: "pipe" },
  ),
);
test("server directory finds the 101st company and person outside the first page and preserves stable links", async ({
  page,
  context,
}) => {
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
  const auth = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/final-directory-ui-auth.json"),
      "utf8",
    ),
  );
  await fs.mkdir(evidence, { recursive: true });
  const queries: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
    void fs.writeFile(path.join(evidence, "page-errors.json"), JSON.stringify(pageErrors, null, 2));
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/(customers|recipients)$/.test(url.pathname))
      queries.push(url.pathname + url.search);
  });
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const sourceResponse = await page.request.get(`/api/recipients/${auth.person.id}`);
  expect(sourceResponse.ok()).toBe(true);
  const sourceBefore = await sourceResponse.json();
  expect(sourceBefore.data).toEqual(auth.person.data);
  expect(sourceBefore.data).not.toHaveProperty("positionRu");
  await page.goto("/requests/new");
  await createRequestWithWorkerDocument(page, "COMPANY");
  await page.getByRole("button", { name: "Из справочника", exact: true }).click();
  await page
    .getByRole("button", { name: "Найти в справочнике", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill("Поиск компании");
  await expect(
    dialog.getByText("Найдено: 101 · страница 1", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(auth.customer.nameRu, { exact: true }),
  ).toHaveCount(0);
  for (let number = 2; number <= 6; number++) {
    await dialog.getByRole("button", { name: "Далее", exact: true }).click();
    await expect(
      dialog.getByText(`Найдено: 101 · страница ${number}`, { exact: true }),
    ).toBeVisible();
  }
  await dialog
    .getByRole("row")
    .filter({ hasText: auth.customer.nameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect(page.locator(".request-organization-selected-compact"))
    .toContainText(auth.customer.nameRu);
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  await dialog
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill("Поиск человека");
  await expect(
    dialog.getByText("Найдено: 101 · страница 1", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(auth.person.data.fullNameRu, { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill("000101");
  await expect(
    dialog.getByText("Найдено: 1 · страница 1", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("row")
    .filter({ hasText: auth.person.data.fullNameRu })
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  const details = page.getByRole("dialog", { name: "Настройки строки 1", exact: true });
  await expect(details).toBeVisible();
  await details.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await expect(details.getByLabel("ФИО", { exact: true })).toHaveValue(auth.person.data.fullNameRu);
  await expect(details.getByLabel("Должность", { exact: true })).toHaveValue("");
  await details.getByRole("button", { name: "Вернуться к списку", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
  const id = /\/requests\/([^/]+)/.exec(new URL(page.url()).pathname)![1];
  await page.reload();
  await expect(page.locator(".request-organization-selected-compact"))
    .toContainText(auth.customer.nameRu);
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok()).toBe(true);
  const request = await response.json();
  expect(request.customerId).toBe(auth.customer.id);
  const person = request.items.find(
    (row: { recipientId: string }) => row.recipientId === auth.person.id,
  );
  expect(person.personnelNumber).toBe("000101");
  expect(person.fullNameKz).toBe("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  expect(person.employerId).toBe(auth.customer.id);
  expect(person.positionRu).toBe("");
  expect(person.positionKz).toBe("");
  expect(person.workplaceKz).toBe("");
  expect(person.photoAssetId).toBeNull();
  expect(person.assignments).toHaveLength(0);
  expect(
    person.assignments.every(
      (a: { documentDate: string; result: string }) =>
        a.documentDate === "" && a.result === "",
    ),
  ).toBe(true);
  expect(queries.some((q) => q.includes("page=6"))).toBe(true);
  expect(queries.some((q) => q.includes("search=000101"))).toBe(true);
  const sourceAfter = await (await page.request.get(`/api/recipients/${auth.person.id}`)).json();
  expect(sourceAfter.data).toEqual(sourceBefore.data);
  expect(sourceAfter.updatedAt).toBe(sourceBefore.updatedAt);
  expect(pageErrors).toEqual([]);
  await page.screenshot({
    path: path.join(evidence, "directory-101-persisted.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "directory-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        synthetic: true,
        realBrowser: true,
        mockedBusinessResponses: false,
        tenantId: auth.tenantId,
        companyId: auth.customer.id,
        personId: auth.person.id,
        queries,
        pageErrors,
        storedSourceUnchanged: true,
        reusedPersonalDefaults: { positionRu: person.positionRu, positionKz: person.positionKz, workplaceKz: person.workplaceKz, photoAssetId: person.photoAssetId, assignmentCount: person.assignments.length },
        checks: [
          "101st company absent first page and selected sixth page",
          "101st person absent first page and server searched by zero-prefixed personnel number",
          "recipient and employer IDs persisted across reload",
          "KZ and leading zeros preserved",
          "previous assignments and dates not reused",
          "partial historical person opens actual details without exception, saves only missing personal defaults, and original directory data is unchanged",
        ],
      },
      null,
      2,
    ),
  );
});
