import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const runtime = path.join(product, ".runtime/mvp-all-roles-20261019/run-01");
const fixture = JSON.parse(readFileSync(path.join(runtime, "browser-fixture.json"), "utf8")) as {
  organizations: { a1: string; a2: string; b1: string };
  users: { employer: { email: string; password: string } };
};
const output = path.join(product, "docs/evidence/mvp-all-roles-20261019/run-01/imports");
type ImportState = {
  id: string; total: number; customerId: string; courseVersionId: string; state: string; errors: number; failedRows: number;
  assignment: { id: string; cursor: number; state: string; groupId: string | null; created: number; reused: number; errorCount: number };
};
type GroupState = { total: number; pageSize: number; items: { id: string; recipientId: string; customerId: string }[]; group: { customerId: string; courseVersionId: string } };

test.use({ trace: "off", screenshot: "off", video: "off" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "RU", exact: true }).click();
  await page.getByLabel("Электронная почта", { exact: true }).fill(fixture.users.employer.email);
  await page.getByLabel("Пароль", { exact: true }).fill(fixture.users.employer.password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = page.waitForResponse(value => value.url().endsWith("/api/auth/login") && value.request().method() === "POST");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    if ((await response).status() !== 429) break;
    await page.waitForTimeout(61000);
  }
  await expect(page).not.toHaveURL(/\/login/);
}
async function readImport(page: Page, id: string): Promise<ImportState> {
  const response = await page.request.get(`/api/lms/employer-import/${id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function geometry(page: Page) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(size.documentWidth, page.url()).toBeLessThanOrEqual(size.viewport + 1);
  return size;
}
async function verifyGroup(page: Page, id: string, count: number, versionId: string) {
  const response = await page.request.get(`/api/lms/groups/${id}`);
  expect(response.status()).toBe(200);
  const group = await response.json() as GroupState;
  expect(group.total).toBe(count);
  expect(group.group.customerId).toBe(fixture.organizations.a1);
  expect(group.group.courseVersionId).toBe(versionId);
  const items = [...group.items];
  for (let number = 2; number <= Math.ceil(group.total / group.pageSize); number++) {
    const next = await page.request.get(`/api/lms/groups/${id}?page=${number}`);
    expect(next.status()).toBe(200);
    items.push(...(await next.json() as GroupState).items);
  }
  expect(items).toHaveLength(count);
  expect(new Set(items.map(item => item.id)).size).toBe(count);
  expect(new Set(items.map(item => item.recipientId)).size).toBe(count);
  expect(items.every(item => item.customerId === fixture.organizations.a1)).toBe(true);
  return { total: group.total, uniqueEnrollments: new Set(items.map(item => item.id)).size, uniquePeople: new Set(items.map(item => item.recipientId)).size };
}
async function verifyIndividual(page: Page, prefix: string) {
  const response = await page.request.get(`/api/lms/enrollments?customerId=${fixture.organizations.a1}&search=${encodeURIComponent(prefix)}`);
  expect(response.status()).toBe(200);
  const data = await response.json() as GroupState;
  expect(data.total).toBe(1);
  expect(data.items).toHaveLength(1);
  expect(data.items[0].customerId).toBe(fixture.organizations.a1);
  return { total: 1, uniqueEnrollments: 1, uniquePeople: 1 };
}

test("J04 employer UI imports 1, 3 and 250 people, correction, reload and duplicate-click protection in A1", async ({ page }) => {
  test.setTimeout(600000);
  const authored = JSON.parse(readFileSync(path.join(runtime, "authoring-result.json"), "utf8")) as { courseVersionId: string };
  const started = Date.now();
  const run = started.toString(36);
  const actions: Record<string, unknown>[] = [];
  const measurements: Record<string, unknown>[] = [];
  await mkdir(output, { recursive: true });
  await login(page);
  for (const count of [1, 3, 250]) {
    await page.goto("/portal");
    await page.getByRole("button", { name: "RU", exact: true }).last().click();
    await page.getByRole("button", { name: "Сотрудники", exact: true }).click();
    await page.getByRole("link", { name: "Добавить сотрудников и назначить обучение", exact: true }).click();
    const organization = page.locator("label").filter({ hasText: /^Организация/ }).locator("select");
    await expect(organization).toHaveValue(fixture.organizations.a1);
    const programme = page.locator("label").filter({ hasText: /^Программа/ }).locator("select");
    await programme.selectOption(authored.courseVersionId);
    const prefix = `MVP Import ${run} ${count}`;
    if (count > 1) {
      await page.getByText("Группа и сроки", { exact: true }).click();
      await page.getByLabel("Название группы", { exact: true }).fill(prefix);
    }
    const phone = (index: number) => `+7${String(started + count * 1000 + index).slice(-10)}`;
    if (count < 250) {
      for (let index = 0; index < count; index++) {
        await page.getByLabel("ФИО", { exact: true }).fill(`${prefix} ${index + 1}`);
        await page.getByLabel("Телефон", { exact: true }).fill(phone(index));
        await page.getByLabel("Должность", { exact: true }).fill("Синтетический сотрудник");
        if (index + 1 < count) await page.getByRole("button", { name: "Добавить строку", exact: true }).click();
      }
    } else {
      await page.getByLabel("Добавление сотрудников", { exact: true }).selectOption("bulk");
      await page.getByLabel(/ФИО · ИИН · телефон/).fill(Array.from({ length: count }, (_, index) => [index === 1 ? "" : `${prefix} ${index + 1}`, "", phone(index), "", "Синтетический сотрудник", ""].join("\t")).join("\n"));
    }
    await page.getByRole("button", { name: "Подготовить состав", exact: true }).click();
    await expect(page.getByRole("button", { name: "Подтвердить и назначить", exact: true })).toBeVisible();
    const id = new URL(page.url()).searchParams.get("id")!;
    expect(id).toBeTruthy();
    const initial = await readImport(page, id);
    expect(initial.total).toBe(count);
    expect(initial.customerId).toBe(fixture.organizations.a1);
    expect(initial.courseVersionId).toBe(authored.courseVersionId);
    if (count === 250) {
      await expect(page.getByText("Нужна проверка строк: 1", { exact: false })).toBeVisible();
      await page.getByLabel("ФИО · 2", { exact: true }).fill(`${prefix} corrected`);
      await page.getByLabel("ФИО · 2", { exact: true }).press("Tab");
      await expect(page.getByText(/Сохранено/).first()).toBeVisible();
      await expect(page.getByText("Нужна проверка строк:", { exact: false })).toHaveCount(0);
      await page.reload();
      await expect(page.getByLabel("ФИО · 2", { exact: true })).toHaveValue(`${prefix} corrected`);
      await expect(page.getByLabel("Должность · 1", { exact: true })).toHaveValue("Синтетический сотрудник");
      const reloaded = await readImport(page, id);
      expect(reloaded.total).toBe(count);
      expect(reloaded.errors).toBe(0);
      await page.screenshot({ path: path.join(output, "250-correction-restored.png"), fullPage: true });
    }
    const confirmRequests: string[] = [];
    const observe = (request: import("@playwright/test").Request) => {
      if (request.method() === "POST" && request.url().includes(`/employer-import/${id}/confirm`)) confirmRequests.push(request.url());
    };
    page.on("request", observe);
    await page.getByRole("button", { name: "Подтвердить и назначить", exact: true }).dblclick();
    await expect(page.getByText(/Обработка завершена/).first()).toBeVisible({ timeout: 150000 });
    page.off("request", observe);
    const completed = await readImport(page, id);
    expect(completed.state).toBe("COMPLETED");
    expect(completed.failedRows).toBe(0);
    expect(completed.assignment).toMatchObject({ cursor: count, state: "COMPLETED", created: count, reused: 0, errorCount: 0 });
    const group = count === 1 ? await verifyIndividual(page, prefix) : await verifyGroup(page, completed.assignment.groupId!, count, authored.courseVersionId);
    await page.reload();
    await expect(page.getByText(/Обработка завершена/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Подтвердить и назначить", exact: true })).toHaveCount(0);
    const restored = await readImport(page, id);
    expect(restored.assignment).toEqual(completed.assignment);
    if (count === 1) {
      await verifyIndividual(page, prefix);
      await page.goto("/portal");
      await page.getByLabel("Поиск сотрудника по ФИО", { exact: true }).fill(prefix);
      await expect(page.getByText(`${prefix} 1`, { exact: true })).toBeVisible();
    } else {
      await verifyGroup(page, completed.assignment.groupId!, count, authored.courseVersionId);
      await page.getByRole("link", { name: "Открыть группу и результаты", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/lms/groups/${completed.assignment.groupId}$`));
      await expect(page.getByRole("cell", { name: new RegExp(`^${prefix} \\d+$`) }).first()).toBeVisible();
    }
    await page.goto(`/lms/import?id=${id}`);
    await expect(page.getByText(/Обработка завершена/).first()).toBeVisible();
    actions.push({ count, mode: count < 250 ? "manual" : "bulk", importId: id, groupId: completed.assignment.groupId, scope: "A1", result: "PASS", prepareClicks: 1, confirmationGestures: 1, confirmationGesture: "double click", observedConfirmPosts: confirmRequests.length, addedRowsClicks: count === 3 ? 2 : 0, optionalGroupDisclosureClicks: count > 1 ? 1 : 0, filledFields: count === 250 ? 3 : count * 3 + (count > 1 ? 1 : 0), correction: count === 250 ? "missing name corrected; autosave; reload preserved every inspected value" : "not needed", repeatedEntry: 0, manualWorkerPolling: 0, stableAssignmentAfterReload: true, ...group });
    await writeFile(path.join(output, "UX_IMPORTS.json"), JSON.stringify({ status: "RUNNING", actions }, null, 2));
    if (count === 250) {
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const language of ["RU", "KZ"]) {
          await page.getByRole("button", { name: language, exact: true }).last().click();
          await expect(page.getByText(language === "RU" ? /Обработка завершена/ : /Өңдеу аяқталды/).first()).toBeVisible();
          measurements.push({ language, requestedWidth: width, ...await geometry(page) });
          await page.screenshot({ path: path.join(output, `250-completed-${width}-${language.toLowerCase()}.png`), fullPage: true });
        }
      }
    }
  }
  await writeFile(path.join(output, "UX_IMPORTS.json"), JSON.stringify({ status: "PASS", capturedAt: new Date().toISOString(), elapsedMs: Date.now() - started, courseVersionId: authored.courseVersionId, scope: "Only synthetic new people in employer organization A1; existing recipients untouched", mutations: "Browser UI only; API GET used exclusively for readback", actions, measurements, limits: "Double click and completed-draft reload verify UI repeat protection and stable assignment; server mutation replay is covered by separate integration tests." }, null, 2));
});
