import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import { bootstrapSuperAdmin, saveUser } from "../../../apps/api/src/settings";
import { createCourse } from "../../../apps/api/src/lms/courses";
import {
  createTeachingBinding,
  revokeTeachingBinding,
} from "../../../apps/api/src/lms/teaching-bindings";
import { lmsCourse } from "../../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.use({ trace: "off" });
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../../.runtime/commission-flow/evidence/methodist-programmes",
);

async function fixture(courses = 0) {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID();
  const password = `Synthetic-methodist-${suffix}!`;
  const ownerEmail = `methodist-owner-${suffix}@example.test`;
  const owner = await provision({
    email: ownerEmail,
    password,
    name: "Синтетический кабинет методиста",
    sample: true,
  });
  const context: Context = {
    ...owner,
    role: "DIRECTOR",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: suffix,
  };
  await bootstrapSuperAdmin(context, {
    currentPassword: password,
    confirm: true,
  });
  context.role = "SUPER_ADMIN";
  const methodist = await saveUser(context, {
    email: `methodist-${suffix}@example.test`,
    password,
    displayName: "Синтетический методист",
    role: "METHODIST",
  });
  const author: Context = {
    ...context,
    userId: methodist.id,
    role: "METHODIST",
  };
  const seeded = [];
  for (let index = 0; index < courses; index++) {
    const input = lmsCourse();
    input.content.titleRu = `Синтетическая программа ${String(index + 1).padStart(3, "0")}`;
    input.content.titleKz = `Синтетикалық бағдарлама ${String(index + 1).padStart(3, "0")}`;
    seeded.push(await createCourse(author, input));
  }
  return {
    context,
    author,
    owner: { email: ownerEmail, password },
    account: { email: methodist.email, password },
    seeded,
  };
}

async function login(
  page: Page,
  account: { email: string; password: string },
  expectedPath = /\/lms$/,
) {
  const diagnostics: Array<Record<string, unknown>> = [];
  page.on("pageerror", (error) => {
    diagnostics.push({ type: "pageerror", message: error.message });
  });
  page.on("requestfailed", (request) => {
    diagnostics.push({
      type: "requestfailed",
      path: new URL(request.url()).pathname,
      reason: request.failure()?.errorText,
    });
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/api/auth/") || response.status() >= 400)
      diagnostics.push({
        type: "response",
        path: pathname,
        status: response.status(),
      });
  });
  await page.goto("/login");
  try {
    await page
      .getByLabel("Электронная почта", { exact: true })
      .fill(account.email);
  } catch (error) {
    await test.info().attach("login-hydration-diagnostics", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
    throw error;
  }
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const loggingIn = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const response = await loggingIn;
    if (response.status() === 429) {
      // Respect the real per-IP login limit across isolated synthetic accounts.
      await page.waitForTimeout(31_000);
      continue;
    }
    expect(response.status()).toBe(201);
    await expect(page).toHaveURL(expectedPath);
    return;
  }
  throw new Error("Synthetic methodist suite remained login-rate-limited");
}

test.beforeEach(async ({ page }) => {
  await fs.mkdir(evidence, { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
});
test.afterAll(async () => {
  await db.$disconnect();
});

test("real METHODIST login opens an empty catalogue and can create, autosave and reopen its own programme", async ({
  page,
}) => {
  const seeded = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  const failures: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/lms/") && response.status() >= 400)
      failures.push({ path: url.pathname, status: response.status() });
  });
  const listed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/courses" &&
      response.request().method() === "GET",
  );
  await login(page, seeded.account);
  const listResponse = await listed;
  const listBody = await listResponse.json();
  await fs.writeFile(
    path.join(evidence, "methodist-initial-list.json"),
    JSON.stringify(
      {
        role: "METHODIST",
        status: listResponse.status(),
        code: listBody.code || null,
        total: listBody.total,
        failures,
      },
      null,
      2,
    ),
  );
  expect(listResponse.status()).toBe(200);
  expect(listBody.items).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "Программы обучения", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать программу", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".lms-empty")).toContainText(
    "Программ пока нет. Создайте первую",
  );
  await page.screenshot({
    path: path.join(evidence, "methodist-empty-390.png"),
    fullPage: true,
  });
  const creating = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/courses" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Создать программу", exact: true })
    .click();
  const createdResponse = await creating;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  await expect(page).toHaveURL(
    new RegExp(`/lms/courses/${created.course.id}$`),
  );
  const titleRu = "Синтетическая программа методиста для проверки сохранения";
  const titleKz =
    "Әдіскердің сақтауды тексеруге арналған синтетикалық бағдарламасы";
  await page.getByLabel("Название RU", { exact: true }).fill(titleRu);
  await page.getByLabel("Название KZ", { exact: true }).fill(titleKz);
  await expect(page.locator(".lms-editor-actions .lms-save-state")).toHaveText(
    "Сохранено",
  );
  await page.getByRole("link", { name: "К курсам", exact: true }).click();
  await expect(page).toHaveURL(/\/lms$/);
  await page.getByRole("link", { name: titleRu, exact: true }).click();
  await expect(page.getByLabel("Название RU", { exact: true })).toHaveValue(
    titleRu,
  );
  await expect(page.getByLabel("Название KZ", { exact: true })).toHaveValue(
    titleKz,
  );
  const returned = await page.request.get(
    `/api/lms/courses/${created.course.id}`,
  );
  expect(returned.status()).toBe(200);
  expect((await returned.json()).course.allowedActions).toContain("edit");
  expect(failures).toEqual([]);
  expect(
    await db.lmsTeachingBinding.count({
      where: {
        tenantId: seeded.context.tenantId,
        userId: seeded.author.userId,
        courseId: created.course.id,
        role: "METHODIST",
        revokedAt: null,
      },
    }),
  ).toBe(1);
  await page.screenshot({
    path: path.join(evidence, "methodist-reopened-programme-390.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(evidence, "methodist-create-reopen.json"),
    JSON.stringify(
      {
        role: "METHODIST",
        loginLanding: "/lms",
        initialStatus: listResponse.status(),
        createStatus: createdResponse.status(),
        courseId: created.course.id,
        ownBindingCount: 1,
        titleRu,
        titleKz,
        failures,
      },
      null,
      2,
    ),
  );
});

test("real non-demo gate names the configuration blocker and GET-only access checks never create a programme", async ({
  page,
}) => {
  const seeded = await fixture();
  // All data is synthetic and local. Only this flag exercises the real-data policy branch.
  await db.tenant.update({
    where: { id: seeded.context.tenantId },
    data: { demoOnly: false },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  let writes = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/lms/courses" &&
      request.method() === "POST"
    )
      writes++;
  });
  const initial = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/courses" &&
      response.request().method() === "GET",
  );
  await login(page, seeded.account);
  const response = await initial;
  expect(response.status()).toBe(503);
  expect((await response.json()).code).toBe("LMS_DEPLOYMENT_REVIEW_REQUIRED");
  await expect(
    page.getByText("Доступ к программам пока закрыт", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Обучение пока недоступно. Обратитесь к администратору.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать программу", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".lms-empty")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Повторить загрузку", exact: true }),
  ).toHaveCount(0);
  const checking = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/lms/courses" &&
      candidate.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Проверить доступ", exact: true })
    .click();
  expect((await checking).status()).toBe(503);
  expect(writes).toBe(0);
  await page.screenshot({
    path: path.join(evidence, "methodist-real-gate-390-ru.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "KZ", exact: true }).first().click();
  await expect(
    page.getByText("Бағдарламаларға қолжетімділік әзірге жабық", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Бағдарлама жасау", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: path.join(evidence, "methodist-real-gate-390-kz.png"),
    fullPage: true,
  });
  const session = await (await page.request.get("/api/auth/session")).json();
  const directCreate = await page.request.post("/api/lms/courses", {
    headers: {
      origin: process.env.DEMO_ORIGIN!,
      "x-csrf-token": session.csrfToken,
    },
    data: lmsCourse(),
  });
  expect(directCreate.status()).toBe(503);
  expect((await directCreate.json()).code).toBe(
    "LMS_DEPLOYMENT_REVIEW_REQUIRED",
  );
  expect(
    (await page.request.get("/api/settings/learning-readiness")).status(),
  ).toBe(403);
  expect(
    await db.course.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(0);
  await fs.writeFile(
    path.join(evidence, "methodist-real-gate.json"),
    JSON.stringify(
      {
        localSyntheticTenant: seeded.context.tenantId,
        demoOnly: false,
        loginStatus: 201,
        listStatus: 503,
        code: "LMS_DEPLOYMENT_REVIEW_REQUIRED",
        accessCheckOnlyGet: writes === 0,
        directCreateDenied: true,
        courseCount: 0,
      },
      null,
      2,
    ),
  );
});

test("director can diagnose blocked learning and copy an actionable task without opening registration or mutating policy", async ({
  page,
  context,
}) => {
  const seeded = await fixture();
  const director = await saveUser(seeded.context, {
    email: `director-readiness-${randomUUID()}@example.test`,
    password: seeded.account.password,
    displayName: "Синтетический директор проверки доступа",
    role: "DIRECTOR",
  });
  await db.tenant.update({
    where: { id: seeded.context.tenantId },
    data: { demoOnly: false },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: process.env.DEMO_ORIGIN!,
  });
  await login(
    page,
    { email: director.email, password: seeded.account.password },
    /\/approvals$/,
  );
  const calls: { path: string; method: string }[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.includes("learning-readiness") ||
      pathname.includes("registration-policy")
    )
      calls.push({ path: pathname, method: request.method() });
  });
  const checking = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/settings/learning-readiness",
  );
  await page.goto("/settings?tab=users");
  const response = await checking;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    available: false,
    reason: "NOT_CONFIGURED",
  });
  const panel = page.getByRole("region", {
    name: "Доступ к обучению",
    exact: true,
  });
  await expect(panel).toContainText(
    "На сервере не подключён документ настройки работы с данными центра.",
  );
  await expect(
    panel.getByText("Задание для специалиста", { exact: true }),
  ).toBeVisible();
  expect(calls.some((call) => call.path.includes("registration-policy"))).toBe(
    false,
  );
  await panel
    .getByRole("button", { name: "Скопировать задание", exact: true })
    .click();
  await expect(
    panel.getByText("Задание скопировано.", { exact: true }),
  ).toBeVisible();
  const task = await page.evaluate(() => navigator.clipboard.readText());
  expect(task).toContain(seeded.context.tenantId);
  expect(task).toContain("DEMO_LMS_DEPLOYMENT_EVIDENCE");
  expect(task).toContain("docs/LMS_DEPLOYMENT_RECOVERY_RU.md");
  const rechecked = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/settings/learning-readiness",
  );
  await panel
    .getByRole("button", { name: "Проверить настройку", exact: true })
    .click();
  expect((await rechecked).status()).toBe(200);
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  await panel.screenshot({
    path: path.join(evidence, "director-learning-readiness-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({
    path: path.join(evidence, "director-learning-readiness-390.png"),
  });
  expect((await page.request.get("/api/lms/courses?page=1")).status()).toBe(
    503,
  );
  expect(
    (
      await db.tenant.findUniqueOrThrow({
        where: { id: seeded.context.tenantId },
      })
    ).demoOnly,
  ).toBe(false);
  await fs.writeFile(
    path.join(evidence, "director-learning-readiness.json"),
    JSON.stringify(
      {
        role: "DIRECTOR",
        diagnosis: { available: false, reason: "NOT_CONFIGURED" },
        copiedTaskIncludesTenantAndRecoveryInstructions: true,
        registrationNotRequested: true,
        mutations: calls.filter((call) => call.method !== "GET").length,
        gateStill503: true,
      },
      null,
      2,
    ),
  );
});

test("real non-demo OPERATOR sees training access blocker instead of an empty programme catalogue", async ({
  page,
}) => {
  const seeded = await fixture();
  const operator = await saveUser(seeded.context, {
    email: `operator-${randomUUID()}@example.test`,
    password: seeded.account.password,
    displayName: "Синтетический оператор закрытого LMS",
    role: "OPERATOR",
  });
  await db.tenant.update({
    where: { id: seeded.context.tenantId },
    data: { demoOnly: false },
  });
  await login(
    page,
    { email: operator.email, password: seeded.account.password },
    /\/requests$/,
  );
  const contextResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/assignment-context",
  );
  await page.goto("/lms/assign");
  expect((await contextResponse).status()).toBe(503);
  await expect(
    page.getByText("Обучение для центра пока недоступно", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Пока нет опубликованных программ", { exact: true }),
  ).toHaveCount(0);
  const retry = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/assignment-context",
  );
  await page
    .getByRole("button", { name: "Проверить доступ", exact: true })
    .click();
  expect((await retry).status()).toBe(503);
  expect(
    await db.enrollment.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(evidence, "operator-real-gate-390.png"),
    fullPage: true,
  });
});

test("transient catalogue failure retries GET and preserves search and previously loaded programmes", async ({
  page,
}) => {
  const seeded = await fixture(2);
  const attempts: string[] = [];
  let failNext = true;
  await page.route("**/api/lms/courses?*", async (route) => {
    attempts.push(new URL(route.request().url()).search);
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          message: "Synthetic temporary service failure",
          correlationId: "synthetic-catalogue-retry",
        }),
      });
    } else await route.continue();
  });
  await login(page, seeded.account);
  await expect(
    page.getByText("Не удалось загрузить программы", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lms-empty")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await expect(page.locator(".lms-list-title")).toHaveCount(2);
  failNext = true;
  await page.getByLabel("Найти курс", { exact: true }).fill("002");
  await expect(
    page.getByText("Не удалось загрузить программы", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Найти курс", { exact: true })).toHaveValue(
    "002",
  );
  await expect(page.locator(".lms-list-title")).toHaveCount(2);
  await expect(
    page.getByText("Пока показан ранее загруженный список.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "methodist-search-load-failed.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await expect(page.locator(".lms-list-title")).toHaveCount(1);
  await expect(page.locator(".lms-list-title")).toHaveText(
    "Синтетическая программа 002",
  );
  expect(attempts.slice(-2)).toEqual([
    "?page=1&search=002",
    "?page=1&search=002",
  ]);
  await page
    .getByLabel("Найти курс", { exact: true })
    .fill("Синтетическое отсутствие совпадений");
  await expect(page.locator(".lms-empty")).toContainText(
    "Программы не найдены",
  );
  expect(
    await db.course.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(2);
});

test("known create failure survives successful catalogue refresh and explicit retry creates only one programme", async ({
  page,
}) => {
  const seeded = await fixture();
  await login(page, seeded.account);
  const create = page.getByRole("button", {
    name: "Создать программу",
    exact: true,
  });
  await expect(create).toBeEnabled();
  let posts = 0;
  await page.route("**/api/lms/courses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    if (posts === 1)
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "SYNTHETIC_VALIDATION_REJECTION",
          message: "Синтетическое отклонение создания программы",
        }),
      });
    else await route.continue();
  });
  await create.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(
    page.getByText("Не удалось создать программу", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/courses" &&
      response.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Обновить список программ", exact: true })
    .click();
  expect((await refreshed).status()).toBe(200);
  await expect(
    page.getByText("Не удалось создать программу", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  expect(
    await db.course.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(0);
  await page.screenshot({
    path: path.join(evidence, "methodist-create-error-retained.png"),
    fullPage: true,
  });
  await create.click();
  await expect(page).toHaveURL(/\/lms\/courses\/[^/]+$/);
  expect(posts).toBe(2);
  expect(
    await db.course.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(1);
});

test("lost accepted create response reconciles the full list without a second POST or duplicate course", async ({
  page,
}) => {
  const seeded = await fixture();
  await login(page, seeded.account);
  await expect(page.locator(".lms-empty")).toBeVisible();
  let failFilteredLoad = true;
  await page.route("**/api/lms/courses?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("search") &&
      failFilteredLoad
    ) {
      failFilteredLoad = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          message: "Synthetic filtered-list failure",
        }),
      });
    } else await route.continue();
  });
  await page
    .getByLabel("Найти курс", { exact: true })
    .fill("Фильтр не совпадает с названием нового курса");
  await expect(
    page.getByText("Не удалось загрузить программы", { exact: true }),
  ).toBeVisible();
  const create = page.getByRole("button", {
    name: "Создать программу",
    exact: true,
  });
  await expect(create).toBeEnabled();
  let posts = 0;
  let createdId = "";
  await page.route("**/api/lms/courses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    createdId = (await response.json()).course.id;
    await route.abort("failed");
  });
  await create.click();
  await expect(
    page.getByText("Не удалось подтвердить создание программы", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(create).toBeDisabled();
  await expect(page.getByLabel("Найти курс", { exact: true })).toBeDisabled();
  expect(createdId).not.toBe("");
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/courses" &&
      response.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  const response = await refreshed;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get("search")).toBe("");
  expect(new URL(response.url()).searchParams.get("page")).toBe("1");
  await expect(page.getByLabel("Найти курс", { exact: true })).toHaveValue("");
  await expect(page.locator(".lms-list-title")).toHaveCount(1);
  expect(posts).toBe(1);
  expect(
    await db.course.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(1);
  await page
    .locator(`.lms-list-title[href="/lms/courses/${createdId}"]`)
    .click();
  await expect(page.getByLabel("Название RU", { exact: true })).toHaveValue(
    "Новый курс",
  );
  await fs.writeFile(
    path.join(evidence, "methodist-unknown-create.json"),
    JSON.stringify(
      {
        realAcceptedPost: true,
        courseId: createdId,
        posts,
        courseCount: 1,
        refreshClearedFilter: true,
        priorFilteredLoadRetryReconciledFullList: true,
        openedExistingProgramme: true,
      },
      null,
      2,
    ),
  );
});

test("methodist search and pagination show only its own bound programmes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const seeded = await fixture(52);
  const hidden = lmsCourse();
  hidden.content.titleRu =
    "Чужая синтетическая программа без назначения методисту";
  const inaccessible = await createCourse(seeded.context, hidden);
  await login(page, seeded.account);
  await expect(page.locator(".lms-list-title")).toHaveCount(50);
  const pages = page.getByRole("navigation", {
    name: "Страницы списка",
    exact: true,
  });
  await expect(pages).toContainText("1 / 2");
  const next = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/courses" &&
      new URL(response.url()).searchParams.get("page") === "2",
  );
  await pages.getByRole("button", { name: "Далее", exact: true }).click();
  const response = await next;
  const data = await response.json();
  expect(response.status()).toBe(200);
  expect(data.total).toBe(52);
  expect(data.items).toHaveLength(2);
  await expect(page.locator(".lms-list-title")).toHaveCount(2);
  await expect(pages).toContainText("2 / 2");
  await expect(
    pages.getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Найти курс", { exact: true }).fill("051");
  await expect(page.locator(".lms-list-title")).toHaveCount(1);
  await expect(page.locator(".lms-list-title")).toHaveText(
    "Синтетическая программа 051",
  );
  await expect(pages).toHaveCount(0);
  await page
    .getByLabel("Найти курс", { exact: true })
    .fill("Чужая синтетическая");
  await expect(page.locator(".lms-empty")).toContainText(
    "Программы не найдены",
  );
  expect(
    (
      await page.request.get(`/api/lms/courses/${inaccessible.course.id}`)
    ).status(),
  ).toBe(404);
  await page.getByLabel("Найти курс", { exact: true }).fill("");
  await expect(page.locator(".lms-list-title")).toHaveCount(50);
  await expect(pages).toContainText("1 / 2");
  await fs.writeFile(
    path.join(evidence, "methodist-pagination-scope.json"),
    JSON.stringify(
      {
        syntheticOwnCourses: 52,
        firstPage: 50,
        secondPage: 2,
        searchResetPage: true,
        unboundCourseHidden: true,
        directUnboundReadStatus: 404,
      },
      null,
      2,
    ),
  );
  const own = seeded.seeded[50];
  const binding = await db.lmsTeachingBinding.findFirstOrThrow({
    where: {
      tenantId: seeded.context.tenantId,
      userId: seeded.author.userId,
      courseId: own.course.id,
      revokedAt: null,
    },
  });
  await revokeTeachingBinding(seeded.context, binding.id, {
    reason: "Синтетическая проверка отзыва методиста",
  });
  expect(
    (await page.request.get(`/api/lms/courses/${own.course.id}`)).status(),
  ).toBe(404);
  await page.goto(`/lms/courses/${own.course.id}`);
  await expect(page.getByLabel("Название RU", { exact: true })).toHaveCount(0);
  await createTeachingBinding(seeded.context, {
    userId: seeded.author.userId,
    courseId: own.course.id,
    role: "METHODIST",
  });
  await page.reload();
  await expect(page.getByLabel("Название RU", { exact: true })).toHaveValue(
    "Синтетическая программа 051",
  );
  await fs.writeFile(
    path.join(evidence, "methodist-revoked-binding-recovery.json"),
    JSON.stringify(
      {
        revokedDirectReadStatus: 404,
        hiddenEditing: true,
        restoredOriginalTitle: true,
      },
      null,
      2,
    ),
  );
});

test("readiness refresh waits for an in-flight registration change and remounts its saved value", async ({
  page,
}) => {
  const seeded = await fixture();
  await login(page, seeded.owner, /\/lms\/workplace$/);
  const readinessCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/settings/learning-readiness")
      readinessCalls.push(request.method());
  });
  await page.goto("/settings?tab=users");
  const readiness = page.getByRole("region", {
    name: "Доступ к обучению",
    exact: true,
  });
  await expect(readiness).toContainText(
    "Обучение доступно в учебном режиме с тестовыми данными.",
  );
  const open = page.getByRole("button", {
    name: "Открыть самостоятельную регистрацию",
    exact: true,
  });
  await expect(open).toBeEnabled();
  let releasePatch: () => void = () => {};
  const release = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });
  let held = false;
  let patches = 0;
  await page.route("**/api/lms/registration-policy", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patches++;
    held = true;
    await release;
    await route.continue();
  });
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/lms/registration-policy" &&
      response.request().method() === "PATCH",
  );
  await open.click();
  const recheck = readiness.getByRole("button", {
    name: "Проверить настройку",
    exact: true,
  });
  try {
    await expect.poll(() => held).toBe(true);
    await expect(recheck).toBeDisabled();
    const before = readinessCalls.length;
    await recheck.evaluate((button) => (button as HTMLButtonElement).click());
    expect(readinessCalls).toHaveLength(before);
  } finally {
    releasePatch();
  }
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByRole("button", {
      name: "Закрыть самостоятельную регистрацию",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(recheck).toBeEnabled();
  await recheck.click();
  await expect(
    page.getByRole("button", {
      name: "Закрыть самостоятельную регистрацию",
      exact: true,
    }),
  ).toBeEnabled();
  expect(patches).toBe(1);
  expect(
    (
      await db.tenant.findUniqueOrThrow({
        where: { id: seeded.context.tenantId },
      })
    ).learnerRegistrationEnabled,
  ).toBe(true);
  await fs.writeFile(
    path.join(evidence, "registration-readiness-concurrency.json"),
    JSON.stringify(
      {
        onlySyntheticDemoTenant: true,
        inFlightPatchPreventedReadinessReload: true,
        patches,
        persistedEnabled: true,
        remountedSavedValue: true,
      },
      null,
      2,
    ),
  );
});
