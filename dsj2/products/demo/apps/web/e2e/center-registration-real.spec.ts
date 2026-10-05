import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { assertTestDatabase } from "../../../tests/integration/test-database";
import { templateIds } from "@demo/contracts";
import templateManifest from "../../../assets/templates/manifest.json";

const expectedTemplates = [
  ...templateManifest.templates,
  ...templateManifest.groupTemplates,
  ...templateManifest.specialTemplates,
]
  .map((entry) => ({
    templateId: entry.id,
    version: String(entry.version),
    checksum: entry.sha256,
    ownerKind: "ownerKind" in entry ? entry.ownerKind : "INDIVIDUAL",
  }))
  .sort((a, b) =>
    `${a.templateId}:${a.version}`.localeCompare(`${b.templateId}:${b.version}`),
  );

test("real local proxy registration, cookies, onboarding version save and first draft", async ({
  page,
}, info) => {
  assertTestDatabase();
  const origin = new URL(process.env.DEMO_ORIGIN || "http://localhost:3100");
  assert.ok(
    ["localhost", "127.0.0.1"].includes(origin.hostname),
    "Real registration smoke is restricted to a disposable local runtime",
  );
  const suffix = randomUUID();
  await page.goto("/register");
  await page.getByLabel("Форма организации").selectOption("TOO");
  await page
    .getByRole("textbox", { name: "Собственное наименование", exact: false })
    .fill(`Synthetic browser ${suffix}`);
  await page.getByLabel("Ваше имя").fill("Синтетический администратор E2E");
  await page
    .getByLabel("Электронная почта")
    .fill(`browser-register-${suffix}@example.test`);
  await page
    .getByLabel("Пароль", { exact: false })
    .fill("Synthetic-browser-only-password!");
  const registered = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/register"),
  );
  await page
    .getByRole("button", { name: "Создать центр и продолжить" })
    .click();
  expect((await registered).status()).toBe(201);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Подготовим ваш центр к работе" }),
  ).toBeVisible();
  const contextResponse = await page.request.get("/api/context");
  expect(contextResponse.status()).toBe(200);
  const initialContext = await contextResponse.json();
  expect(initialContext.user.role).toBe("DIRECTOR");
  expect(initialContext.profile.approved).toBe(false);
  expect(templateManifest.templates.map((entry) => entry.id).sort()).toEqual(
    [...templateIds].sort(),
  );
  expect(
    initialContext.templates
      .map((entry: {
        templateId: string;
        version: string;
        checksum: string;
        contract: { ownerKind?: string };
      }) => ({
        templateId: entry.templateId,
        version: entry.version,
        checksum: entry.checksum,
        ownerKind: entry.contract.ownerKind || "INDIVIDUAL",
      }))
      .sort(
        (a: { templateId: string; version: string }, b: { templateId: string; version: string }) =>
          `${a.templateId}:${a.version}`.localeCompare(`${b.templateId}:${b.version}`),
      ),
  ).toEqual(expectedTemplates);
  expect(
    initialContext.templates.every(
      (entry: { approved: boolean }) => !entry.approved,
    ),
  ).toBeTruthy();
  await page
    .getByLabel("ФИО руководителя учебного центра")
    .fill("Синтетический руководитель E2E");
  await page.getByRole("button", { name: "Добавить председателя" }).click();
  await page
    .locator(".commission-row")
    .getByLabel("ФИО", { exact: true })
    .fill("Синтетический председатель E2E");
  await page
    .locator(".commission-row")
    .getByLabel("Роль в комиссии / должность")
    .fill("Председатель комиссии");
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/settings/profile") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Сохранить новую версию" }).click();
  expect((await savedResponse).status()).toBe(201);
  await expect(
    page.getByText("Создана новая версия реквизитов.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("real-center-onboarding.png"),
    fullPage: true,
  });
  const after = await (await page.request.get("/api/context")).json();
  expect(after.profileVersionId).not.toBe(initialContext.profileVersionId);
  expect(after.profile.headName).toBe("Синтетический руководитель E2E");
  expect(after.profile.approved).toBe(false);
  expect(after.templates).toEqual(initialContext.templates);
  await page.getByRole("link", { name: "Начать черновик заявки" }).click();
  await page.getByRole("radio", { name: /^Физическое лицо/ }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+\/edit$/);
  const person = page.locator(".person-editor");
  await expect(person.getByLabel("ФИО", { exact: true })).toBeFocused();
  await expect(person.getByLabel("ФИО", { exact: true })).toHaveValue("");
  await expect(person.getByLabel("Должность", { exact: true })).toHaveValue("");
  const requestId = page.url().split("/").at(-2);
  const draft = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(draft.status).toBe("DRAFT");
  expect(draft.profileVersionId).toBe(after.profileVersionId);
  expect(draft.items[0].assignments).toEqual([]);
  await page.screenshot({
    path: info.outputPath("real-first-draft.png"),
    fullPage: true,
  });
});
