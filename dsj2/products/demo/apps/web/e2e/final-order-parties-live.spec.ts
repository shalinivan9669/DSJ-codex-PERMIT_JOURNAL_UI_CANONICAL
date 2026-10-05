import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
test.use({ trace: "off" });

const product = path.resolve("../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "order-parties")
    : "../../docs/evidence/final-completion/order-parties",
);
test.beforeAll(() =>
  execFileSync(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(product, "scripts/verification/final-order-parties-fixture.ts"),
    ],
    { cwd: product, env: process.env, windowsHide: true, stdio: "pipe" },
  ),
);

test("customer A, payer B and employer C stay separate in the actual order UI and invalid scope cannot hide people", async ({
  page,
  context,
}) => {
  const auth = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/final-order-parties-auth.json"),
      "utf8",
    ),
  );
  await fs.mkdir(evidence, { recursive: true });
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(auth.email);
  await page.getByLabel("Пароль", { exact: true }).fill(auth.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.goto("/workbench");
  await page
    .getByRole("button", { name: /Заказ А для работодателя В/ })
    .click();
  const panel = page.locator("details").filter({
    has: page.locator("summary", {
      hasText: "Заказчик, плательщик и работодатель участников",
    }),
  });
  await panel.locator("summary").click();
  await expect(panel.getByTestId("order-employer")).toHaveText(
    auth.parties[2].nameRu,
  );
  await expect(
    page.getByRole("cell", {
      name: /Получить фактический результат: Синтетический сотрудник работодателя В/,
    }),
  ).toBeVisible();
  const before = await (
    await context.request.get(`/api/orders/${auth.orderId}`)
  ).json();
  expect(before.summary.people).toBe(1);
  expect(before.summary.events).toBe(1);
  expect(before.requests[0].itemCount).toBe(1);
  const selectParty = async (button: string, name: string) => {
    await panel.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Поиск по справочнику", { exact: true }).fill(name);
    await dialog
      .getByRole("row", { name: new RegExp(name) })
      .getByRole("button", { name: "Выбрать", exact: true })
      .click();
  };
  await selectParty("Выбрать плательщика", auth.parties[1].nameRu);
  await panel
    .getByRole("button", { name: "Сохранить стороны заказа", exact: true })
    .click();
  await expect(
    panel.getByText("Стороны заказа сохранены.", { exact: false }),
  ).toBeVisible();
  const saved = await (
    await context.request.get(`/api/orders/${auth.orderId}`)
  ).json();
  expect([saved.customerId, saved.payerId, saved.employerId]).toEqual([
    auth.parties[0].id,
    auth.parties[1].id,
    auth.parties[2].id,
  ]);
  expect(saved.summary.people).toBe(1);
  await selectParty("Выбрать работодателя участников", auth.parties[3].nameRu);
  await panel
    .getByRole("button", { name: "Сохранить стороны заказа", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  const rejected = await (
    await context.request.get(`/api/orders/${auth.orderId}`)
  ).json();
  expect(rejected.revision).toBe(saved.revision);
  expect(rejected.employerId).toBe(saved.employerId);
  expect(rejected.summary.people).toBe(1);
  await page.reload();
  await page
    .getByRole("button", { name: /Заказ А для работодателя В/ })
    .click();
  await panel.locator("summary").click();
  await expect(panel.getByTestId("order-employer")).toHaveText(
    auth.parties[2].nameRu,
  );
  await expect(panel.getByTestId("order-payer")).toHaveText(
    auth.parties[1].nameRu,
  );
  await page.screenshot({
    path: path.join(evidence, "three-distinct-parties.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        realUi: true,
        tenantId: auth.tenantId,
        requestId: auth.requestId,
        orderId: auth.orderId,
        parties: [saved.customerId, saved.payerId, saved.employerId],
        people: saved.summary.people,
        events: saved.summary.events,
        invalidEmployerRejectedWithoutRevisionChange: true,
        unknownResultVisible: true,
        persistedAfterReload: true,
      },
      null,
      2,
    ),
  );
});
