import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { draftSchema } from "@demo/contracts";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveCustomer,
  saveProfile,
  saveUser,
} from "../../../apps/api/src/settings";
import { createRequest } from "../../../apps/api/src/requests";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.use({ trace: "off" });
test("accepted transfer with failed refresh keeps success and flushes edits before recovery reload", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const seeded = await fixture(
    {
      commission: [
        { name: "Синтетический Председатель", position: "" },
        { name: "Синтетический Член Один", position: "" },
        { name: "Синтетический Член Два", position: "" },
      ],
    },
    false,
    1,
    true,
  );
  await login(page, seeded.email, seeded.password);
  await page.goto(`/requests/${seeded.request.id}/edit`);
  const panel = page.getByRole("region", {
    name: "Готовность и состав следующего выпуска",
    exact: true,
  });
  const requestPath = `/api/print-requests/${seeded.request.id}`;
  let posts = 0;
  let abortRefresh = false;
  let checkingRecovery = false;
  let heldPatch = false;
  let readDuringHeldPatch = false;
  let releasePatch!: () => void;
  const patchGate = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });
  await page.route(`**${requestPath}`, async (route) => {
    if (route.request().method() === "GET") {
      if (abortRefresh) {
        abortRefresh = false;
        await route.abort("failed");
        return;
      }
      if (checkingRecovery && heldPatch) readDuringHeldPatch = true;
    }
    if (route.request().method() === "PATCH" && checkingRecovery) {
      heldPatch = true;
      await patchGate;
      const response = await route.fetch();
      heldPatch = false;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.route(`**${requestPath}/approval/submit`, async (route) => {
    posts++;
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    abortRefresh = true;
    await route.fulfill({ response });
  });
  await panel.getByRole("button", { name: /^Проверить и передать/ }).click();
  await expect(panel).toContainText(
    "Состав передан директору, но не удалось обновить состояние страницы.",
  );
  await expect(panel).not.toContainText("Не удалось передать выбранный состав");
  expect(posts).toBe(1);
  expect(
    await db.requestProposal.count({
      where: { requestId: seeded.request.id, status: "PENDING" },
    }),
  ).toBe(1);
  checkingRecovery = true;
  await page
    .locator('[data-field-path="items.0.positionRu"]')
    .fill("Сохранённая новая должность");
  const recovery = panel
    .getByRole("button", { name: "Обновить состояние", exact: true })
    .click();
  await expect.poll(() => heldPatch).toBe(true);
  expect(readDuringHeldPatch).toBe(false);
  releasePatch();
  await recovery;
  await expect
    .poll(
      async () => (await detail(page, seeded.request.id)).items[0].positionRu,
    )
    .toBe("Сохранённая новая должность");
  await expect(
    page.locator('[data-field-path="items.0.positionRu"]'),
  ).toHaveValue("Сохранённая новая должность");
  expect(readDuringHeldPatch).toBe(false);
  expect(posts).toBe(1);
});

test("lost successful transfer response recovers existing approval without a duplicate submission", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const seeded = await fixture({
    commission: [
      { name: "Синтетический Председатель", position: "" },
      { name: "Синтетический Член Один", position: "" },
      { name: "Синтетический Член Два", position: "" },
    ],
  });
  await login(page, seeded.email, seeded.password);
  await page.goto(`/requests/${seeded.request.id}/edit`);
  const panel = page.getByRole("region", {
    name: "Готовность и состав следующего выпуска",
    exact: true,
  });
  let posts = 0;
  await page.route(
    `**/api/print-requests/${seeded.request.id}/approval/submit`,
    async (route) => {
      posts++;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      await route.abort("failed");
    },
  );
  await panel.getByRole("button", { name: /^Проверить и передать/ }).click();
  await expect(panel).toContainText("Не удалось подтвердить передачу");
  await expect(panel).toContainText("Состав мог быть передан");
  expect(posts).toBe(1);
  expect(
    await db.requestProposal.count({
      where: { requestId: seeded.request.id, status: "PENDING" },
    }),
  ).toBe(1);
  const allCourses = panel.getByRole("checkbox", {
    name: /Все подтверждённые ещё не оформленные курсы/,
  });
  await allCourses.uncheck();
  await expect(panel).toContainText("Не удалось подтвердить передачу");
  const checkTransfer = panel.getByRole("button", {
    name: "Проверить состояние передачи",
    exact: true,
  });
  await expect(checkTransfer).toBeEnabled();
  await checkTransfer.click();
  expect((await detail(page, seeded.request.id)).approval.status).toBe(
    "PENDING",
  );
  await allCourses.check();
  await expect(panel).toContainText("Выбранный состав на согласовании");
  await expect(
    panel.getByRole("button", { name: /^Проверить и передать/ }),
  ).toHaveCount(0);
  expect(posts).toBe(1);
  expect(
    await db.requestProposal.count({
      where: { requestId: seeded.request.id, status: "PENDING" },
    }),
  ).toBe(1);
});
for (const recovery of ["same-page", "settings-return"] as const) {
  test(`blocked director transfer clears after ${recovery} commission repair without losing the selected recipients or submitting early`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await fixture({}, false, 2);
    const operator = await saveUser(seeded.context, {
      email: `transfer-operator-${randomUUID()}@example.test`,
      password: seeded.password,
      displayName: "Синтетический Оператор",
      role: "OPERATOR",
    });
    await login(
      page,
      recovery === "same-page" ? operator.email : seeded.email,
      seeded.password,
    );
    await page.goto(`/requests/${seeded.request.id}/edit`);
    const panel = page.getByRole("region", {
      name: "Готовность и состав следующего выпуска",
      exact: true,
    });
    await panel.locator("summary").click();
    const secondPerson = panel.getByRole("checkbox", {
      name: /Синтетический Получатель 2/,
    });
    await secondPerson.uncheck();
    const firstPerson = panel.getByRole("checkbox", {
      name: /^Синтетический Получатель ·/,
    });
    await expect(firstPerson).toBeChecked();
    await expect(secondPerson).not.toBeChecked();
    const transfer = panel.getByRole("button", {
      name: /^Проверить и передать/,
    });
    await transfer.click();
    const issue = panel
      .getByRole("button", {
        name: /Для протокола БиОТ нужны председатель.*исправить/,
      })
      .first();
    await expect(issue).toBeVisible();
    await expect(panel).toContainText("Выбранный состав не передан директору");
    await expect(panel).toContainText("автосохранение работает");
    await expect(panel.getByText(/Код обращения:/)).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Посмотреть документы", exact: true }),
    ).toBeEnabled();
    expect(
      await db.requestProposal.count({
        where: { requestId: seeded.request.id, status: "PENDING" },
      }),
    ).toBe(0);
    expect((await detail(page, seeded.request.id)).approval).toBeFalsy();
    await page.screenshot({
      path: path.join(
        evidence,
        `commission-transfer-${recovery}-blocked-390.png`,
      ),
    });

    await issue.click();
    const dialog = page.getByRole("dialog", { name: "Комиссия для протокола" });
    await expect(dialog).toBeVisible();
    if (recovery === "same-page") {
      // The director saves the actual centre profile while this operator keeps the selected batch.
      await saveProfile(seeded.context, {
        ...(seeded.initial.profile as object),
        commission: [
          { name: "Синтетический Председатель", position: "" },
          { name: "Синтетический Член Один", position: "" },
          { name: "Синтетический Член Два", position: "" },
        ],
      });
      await dialog
        .getByRole("button", { name: "Обновить составы", exact: true })
        .click();
    } else {
      await dialog
        .getByRole("link", { name: "Заполнить комиссию", exact: true })
        .click();
      await page
        .getByRole("textbox", {
          name: "Председатель комиссии — ФИО",
          exact: true,
        })
        .fill("Синтетический Председатель");
      await page
        .getByRole("textbox", { name: "Член комиссии 1 — ФИО", exact: true })
        .fill("Синтетический Член Один");
      await page
        .getByRole("textbox", { name: "Член комиссии 2 — ФИО", exact: true })
        .fill("Синтетический Член Два");
      await page
        .getByRole("button", { name: "Сохранить комиссию", exact: true })
        .click();
      await page
        .getByRole("link", { name: "Вернуться к заявке", exact: true })
        .click();
      await expect(dialog).toBeVisible();
    }
    await dialog
      .getByRole("button", { name: "Применить комиссию к заявке", exact: true })
      .click();
    await expect(dialog).not.toBeVisible({ timeout: 180_000 });
    await expect(issue).toHaveCount(0, { timeout: 180_000 });
    await expect(panel).not.toContainText(
      "Сначала заполните обязательные данные",
    );
    await expect(panel).not.toContainText(
      "Выбранный состав не передан директору",
    );
    await expect(panel.getByText(/Код обращения:/)).not.toBeVisible();
    if (recovery === "settings-return") {
      await panel
        .locator("summary")
        .filter({ hasText: "Состав по людям и курсам" })
        .click();
    }
    await expect(firstPerson).toBeChecked();
    await expect(secondPerson).not.toBeChecked();
    await expect(transfer).toBeEnabled();
    expect(
      await db.requestProposal.count({
        where: { requestId: seeded.request.id, status: "PENDING" },
      }),
    ).toBe(0);
    await page.screenshot({
      path: path.join(
        evidence,
        `commission-transfer-${recovery}-ready-390.png`,
      ),
    });
    await transfer.click();
    await expect(panel).toContainText("Выбранный состав на согласовании", {
      timeout: 180_000,
    });
    const submitted = await detail(page, seeded.request.id);
    expect(submitted.approval.status).toBe("PENDING");
    await expect(transfer).toHaveCount(0);
    if (!seeded.request.items?.[0])
      throw new Error("Synthetic request must contain its first recipient");
    expect([
      ...new Set(
        submitted.approval.assignments.map(
          (entry: { rowId: string }) => entry.rowId,
        ),
      ),
    ]).toEqual([seeded.request.items[0].id]);
    expect(
      await db.requestProposal.count({
        where: { requestId: seeded.request.id, status: "PENDING" },
      }),
    ).toBe(1);
    await page.screenshot({
      path: path.join(
        evidence,
        `commission-transfer-${recovery}-submitted-390.png`,
      ),
    });
  });
}
test("superadmin follows a city validation error through settings and explicitly applies corrected profile", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const seeded = await fixture(
    {
      cityRu: "",
      commission: [
        { name: "Синтетический Председатель", position: "" },
        { name: "Синтетический Член Один", position: "" },
        { name: "Синтетический Член Два", position: "" },
      ],
    },
    true,
  );
  await login(page, seeded.email, seeded.password);
  await page.goto(`/requests/${seeded.request.id}/edit`);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  await page
    .locator(".validation-result")
    .getByRole("button", {
      name: "Укажите город учебной организации",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Реквизиты для документов" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("link", {
      name: "Исправить реквизиты в настройках",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/settings\?.*focus=profile/);
  await page
    .getByRole("textbox", { name: "Город · RU", exact: true })
    .fill("Кызылорда");
  await page
    .getByRole("button", { name: "Сохранить реквизиты", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Вернуться к заявке", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Кызылорда");
  expect((await detail(page, seeded.request.id)).profileVersionId).toBe(
    seeded.initial.id,
  );
  await dialog
    .getByRole("button", { name: "Применить реквизиты к заявке", exact: true })
    .click();
  await expect(dialog).not.toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".validation-result")).toContainText(
    "Данные прошли проверку",
    { timeout: 180_000 },
  );
  expect((await detail(page, seeded.request.id)).profileVersionId).not.toBe(
    seeded.initial.id,
  );
});
test.afterAll(async () => {
  await db.$disconnect();
});

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE || "../../../.runtime/commission-flow/evidence",
);

async function fixture(
  profilePatch: Record<string, unknown> = {},
  superAdmin = false,
  recipientCount = 1,
  company = false,
) {
  assertTestDatabase();
  const suffix = randomUUID();
  const password = `Synthetic-commission-${suffix}!`;
  const email = `commission-${suffix}@example.test`;
  const owner = await provision({
    email,
    password,
    name: "Синтетическая комиссия",
    sample: true,
  });
  const context: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: suffix,
  };
  if (superAdmin) {
    await bootstrapSuperAdmin(context, {
      currentPassword: password,
      confirm: true,
    });
    context.role = "SUPER_ADMIN";
  }
  const source = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: owner.tenantId },
  });
  const initial = await saveProfile(context, {
    ...(source.profile as object),
    headName: "Синтетический Директор",
    commission: [],
    ...profilePatch,
  });
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    title: "Проверка исправления комиссии",
    demoMode: true,
    items: [
      {
        id: randomUUID(),
        fullNameRu: "Синтетический Получатель",
        fullNameKz: "Синтетикалық Алушы",
        positionRu: "Рабочий",
        positionKz: "Жұмысшы",
        employeeCategory: "WORKER",
        workplaceRu: "Синтетическое предприятие",
        workplaceKz: "Синтетикалық кәсіпорын",
        assignments: ["biot-worker-card", "biot-protocol"].map(
          (templateId) => ({
            id: randomUUID(),
            templateId,
            documentDate: "2026-11-08",
            trainingStart: "2026-11-01",
            trainingEnd: "2026-11-07",
            protocolDate: "2026-11-08",
            trainingSubject: "Синтетическая программа",
            result: "Сдал",
            outcome: { status: "PASSED", source: "Синтетическая ведомость" },
            biotCategory: "WORKER",
            biotCheckType: "PERIODIC",
            hours: "10",
            productionHours: "16",
            validUntil: "2027-11-08",
          }),
        ),
      },
    ],
  });
  for (let index = 1; index < recipientCount; index++) {
    draft.items.push({
      ...draft.items[0],
      id: randomUUID(),
      fullNameRu: `Синтетический Получатель ${index + 1}`,
      assignments: draft.items[0].assignments.map((assignment) => ({
        ...assignment,
        id: randomUUID(),
      })),
    });
  }
  if (company) {
    draft.kind = "COMPANY";
    draft.customerId = (
      await saveCustomer(context, {
        nameRu: "Синтетический заказчик",
        nameKz: "Синтетикалық тапсырыс беруші",
      })
    ).id;
  }
  const request = await createRequest(context, draft);
  expect(request.profileVersionId).toBe(initial.id);
  return { context, email, password, request, initial };
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function detail(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function openCommissionError(page: Page, id: string) {
  await page.goto(`/requests/${id}/edit`);
  await page
    .getByRole("button", { name: "Проверить данные", exact: true })
    .click();
  const errors = page.locator(".validation-result");
  await expect(errors).toContainText("Для протокола БиОТ нужны председатель");
  await errors
    .getByRole("button", { name: /Для протокола БиОТ нужны председатель/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Комиссия для протокола" });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`commission error recovers through settings and applies to saved request at ${viewport.width}px`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await fs.mkdir(evidence, { recursive: true });
    await page.setViewportSize(viewport);
    const seeded = await fixture();
    await login(page, seeded.email, seeded.password);
    const dialog = await openCommissionError(page, seeded.request.id);
    await page.screenshot({
      path: path.join(
        evidence,
        `commission-error-dialog-${viewport.width}.png`,
      ),
    });
    await dialog
      .getByRole("link", { name: "Заполнить комиссию", exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings\?.*focus=commission/);
    const chair = page.getByRole("textbox", {
      name: "Председатель комиссии — ФИО",
      exact: true,
    });
    await expect(chair).toBeFocused();

    // Missing names keep the entered chair and focus the actionable field.
    await chair.fill("Синтетический Председатель");
    await page
      .getByRole("button", { name: "Сохранить комиссию", exact: true })
      .click();
    const memberOne = page.getByRole("textbox", {
      name: "Член комиссии 1 — ФИО",
      exact: true,
    });
    await expect(memberOne).toBeFocused();
    await expect(chair).toHaveValue("Синтетический Председатель");
    await memberOne.fill("Синтетический Член Один");
    await page
      .getByRole("textbox", { name: "Член комиссии 2 — ФИО", exact: true })
      .fill("Синтетический Член Два");
    await page.screenshot({
      path: path.join(evidence, `commission-settings-${viewport.width}.png`),
      fullPage: false,
    });
    if (viewport.width === 390) {
      await page.route("**/api/settings/profile", async (route) => {
        if (route.request().method() === "POST") await route.abort("failed");
        else await route.continue();
      });
      await page
        .getByRole("button", { name: "Сохранить комиссию", exact: true })
        .click();
      await expect(page.getByText(/Нет связи с сервером/)).toBeVisible();
      await expect(chair).toHaveValue("Синтетический Председатель");
      await expect(memberOne).toHaveValue("Синтетический Член Один");
      await page.unroute("**/api/settings/profile");
    }
    await page
      .getByRole("button", { name: "Сохранить комиссию", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Вернуться к заявке", exact: true })
      .click();

    const returned = page.getByRole("dialog", {
      name: "Комиссия для протокола",
    });
    await expect(returned).toBeVisible();
    await expect(returned).toContainText("Синтетический Член Два");
    await page.screenshot({
      path: path.join(
        evidence,
        `commission-apply-dialog-${viewport.width}.png`,
      ),
    });
    // Saving settings alone preserves the old draft pin until explicit application.
    expect((await detail(page, seeded.request.id)).profileVersionId).toBe(
      seeded.initial.id,
    );
    await returned
      .getByRole("button", { name: "Применить комиссию к заявке", exact: true })
      .click();
    await expect(returned).not.toBeVisible({ timeout: 180_000 });
    await expect(page.locator(".validation-result")).toContainText(
      "Данные прошли проверку",
      { timeout: 180_000 },
    );
    const applied = await detail(page, seeded.request.id);
    expect(applied.profileVersionId).not.toBe(seeded.initial.id);
    await page.reload();
    expect((await detail(page, seeded.request.id)).profileVersionId).toBe(
      applied.profileVersionId,
    );
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(page.locator(".validation-result")).toContainText(
      "Данные прошли проверку",
    );
    await expect(page.locator(".validation-result")).not.toContainText(
      "Для протокола БиОТ нужны председатель",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(evidence, `commission-recovered-${viewport.width}.png`),
      fullPage: false,
    });
    const oldProfile = await db.issuerProfileVersion.findUniqueOrThrow({
      where: { id: seeded.initial.id },
    });
    expect(
      (oldProfile.profile as { commission: unknown[] }).commission,
    ).toEqual([]);
  });
}

test("operator can apply a saved commission without being offered inaccessible settings", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const seeded = await fixture();
  const operator = await saveUser(seeded.context, {
    email: `commission-operator-${randomUUID()}@example.test`,
    password: seeded.password,
    displayName: "Синтетический Оператор",
    role: "OPERATOR",
  });
  await login(page, operator.email, seeded.password);
  const dialog = await openCommissionError(page, seeded.request.id);
  await expect(
    dialog.getByRole("link", { name: "Заполнить комиссию", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("Состав в настройках меняет директор");
  const newest = await saveProfile(seeded.context, {
    ...(seeded.initial.profile as object),
    commission: [
      { name: "Синтетический Председатель", position: "" },
      { name: "Синтетический Член Один", position: "" },
      { name: "Синтетический Член Два", position: "" },
    ],
  });
  await dialog
    .getByRole("button", { name: "Обновить составы", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Применить комиссию к заявке", exact: true })
    .click();
  await expect(dialog).not.toBeVisible({ timeout: 180_000 });
  expect((await detail(page, seeded.request.id)).profileVersionId).toBe(
    newest.id,
  );
  await expect(page.locator(".validation-result")).toContainText(
    "Данные прошли проверку",
    { timeout: 180_000 },
  );
});
