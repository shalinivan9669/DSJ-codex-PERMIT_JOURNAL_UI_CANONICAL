import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import { bootstrapSuperAdmin, saveUser } from "../../../apps/api/src/settings";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.afterAll(async () => {
  await db.$disconnect();
});

test("one employee's signing roles stay independent through a lost create response and explicit revocation", async ({
  page,
}, testInfo) => {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID(),
    password = `Synthetic-signatory-${suffix}!`;
  const email = `signatory-${suffix}@example.test`;
  const owner = await provision({
    email,
    password,
    name: "Синтетические полномочия ЭЦП",
    sample: true,
  });
  const context: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: suffix,
  };
  await bootstrapSuperAdmin(context, {
    currentPassword: password,
    confirm: true,
  });
  context.role = "SUPER_ADMIN";
  const person = await saveUser(context, {
    email: `signatory-person-${suffix}@example.test`,
    password,
    role: "DIRECTOR",
    displayName: "Синтетический Совмещённый Подписант",
  });
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto("/settings?tab=signatories&focus=signatories");
  const panel = page.locator("#signatory-settings");
  await panel
    .getByRole("combobox", { name: "Пользователь", exact: true })
    .selectOption(person.id);
  await expect(
    panel.getByLabel("ФИО в документах / комиссии", { exact: true }),
  ).toHaveValue(person.displayName);
  await panel
    .getByLabel("ИИН владельца ЭЦП", { exact: true })
    .fill("000000000124");
  const createdIds: string[] = [];
  await page.route("**/api/settings/signatories", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const payload = route.request().postDataJSON();
    if (payload.role !== "DIRECTOR" || !payload.active) return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    createdIds.push((await response.json()).id);
    if (createdIds.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await panel
    .getByRole("button", { name: "Сохранить привязку", exact: true })
    .click();
  await expect(panel).toContainText("Нет связи с сервером");
  await expect(
    panel.getByLabel("ИИН владельца ЭЦП", { exact: true }),
  ).toHaveValue("000000000124");
  await panel
    .getByRole("button", { name: "Сохранить привязку", exact: true })
    .click();
  await expect(
    panel.getByText("Новая привязка подписанта сохранена.", { exact: true }),
  ).toBeVisible();
  expect(createdIds).toHaveLength(2);
  expect(createdIds[1]).toBe(createdIds[0]);
  await expect(
    panel.getByRole("button", { name: "Привязка сохранена", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("combobox", { name: "Роль подписанта", exact: true })
    .selectOption("TEACHER");
  await expect(
    panel.getByRole("combobox", { name: "Пользователь", exact: true }),
  ).toHaveValue(person.id);
  await panel
    .getByRole("button", { name: "Сохранить привязку", exact: true })
    .click();
  await expect(
    panel.getByText("Новая привязка подписанта сохранена.", { exact: true }),
  ).toBeVisible();
  const readBindings = async () => {
    const response = await page.request.get("/api/settings/signatories");
    expect(response.ok()).toBe(true);
    return (await response.json()).items as {
      id: string;
      role: string;
      active: boolean;
    }[];
  };
  const before = await readBindings();
  expect(before).toHaveLength(2);
  const teacher = before.find((entry) => entry.role === "TEACHER")!;
  expect(teacher.active).toBe(true);
  const revoke = panel.getByRole("button", {
    name: `Отозвать полномочие: Преподаватель — ${person.displayName}`,
    exact: true,
  });
  await revoke.click();
  await expect(panel).toContainText("Уже проверенные подписи сохранятся");
  expect(
    (await readBindings()).find((entry) => entry.id === teacher.id)?.active,
  ).toBe(true);
  await panel
    .getByRole("button", { name: "Оставить полномочие", exact: true })
    .click();
  expect(
    (await readBindings()).find((entry) => entry.id === teacher.id)?.active,
  ).toBe(true);
  await revoke.click();
  await panel
    .getByRole("button", { name: "Подтвердить отзыв", exact: true })
    .click();
  await expect(panel).toContainText(
    `Полномочие отозвано: Преподаватель — ${person.displayName}.`,
  );
  const after = await readBindings();
  expect(after).toHaveLength(2);
  expect(after.find((entry) => entry.id === teacher.id)?.active).toBe(false);
  expect(after.find((entry) => entry.id === createdIds[0])?.active).toBe(true);
  await page.reload();
  await expect(
    panel.locator("tbody tr").filter({ hasText: "Преподаватель" }),
  ).toContainText("Полномочие отозвано");
  await expect(
    panel.locator("tbody tr").filter({ hasText: "Директор" }),
  ).toContainText("Действует");
  await page.screenshot({
    path: testInfo.outputPath(
      "independent-signatory-roles-after-revocation.png",
    ),
    fullPage: true,
  });
});
