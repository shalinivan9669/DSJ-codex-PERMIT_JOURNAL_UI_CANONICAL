import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const product = path.resolve("../..");
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
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/(customers|recipients)$/.test(url.pathname))
      queries.push(url.pathname + url.search);
  });
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.goto("/requests/new");
  await page.getByRole("button", { name: /Организация Заказчик/ }).click();
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
  await expect(
    page.getByRole("combobox", { name: "Заказчик", exact: true }),
  ).toHaveValue(auth.customer.id);
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
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".save-indicator")).toContainText("Сохранено");
  const id = /\/requests\/([^/]+)/.exec(new URL(page.url()).pathname)![1];
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Заказчик", exact: true }),
  ).toHaveValue(auth.customer.id);
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok()).toBe(true);
  const request = await response.json();
  const person = request.items.find(
    (row: { recipientId: string }) => row.recipientId === auth.person.id,
  );
  expect(person.personnelNumber).toBe("000101");
  expect(person.fullNameKz).toBe("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  expect(person.employerId).toBe(auth.customer.id);
  expect(
    person.assignments.every(
      (a: { documentDate: string; result: string }) =>
        a.documentDate === "" && a.result === "",
    ),
  ).toBe(true);
  expect(queries.some((q) => q.includes("page=6"))).toBe(true);
  expect(queries.some((q) => q.includes("search=000101"))).toBe(true);
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
        checks: [
          "101st company absent first page and selected sixth page",
          "101st person absent first page and server searched by zero-prefixed personnel number",
          "recipient and employer IDs persisted across reload",
          "KZ and leading zeros preserved",
          "previous assignments and dates not reused",
        ],
      },
      null,
      2,
    ),
  );
});
