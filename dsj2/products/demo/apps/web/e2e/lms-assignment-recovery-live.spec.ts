import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { provision } from "../../../scripts/setup";
import { db, type Context } from "../../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveCustomer,
  saveUser,
} from "../../../apps/api/src/settings";
import { saveRecipient } from "../../../apps/api/src/recipients";
import {
  createCourse,
  publishVersion,
  setCoursePause,
} from "../../../apps/api/src/lms/courses";
import { lmsCourse } from "../../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../../tests/integration/test-database";

test.use({ trace: "off" });
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
});
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../../.runtime/commission-flow/evidence/lms-assignment",
);

async function fixture(people = 2, published = false) {
  assertTestDatabase();
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(process.env.DATABASE_URL!).hostname,
  );
  const suffix = randomUUID();
  const password = `Synthetic-assignment-${suffix}!`;
  const email = `assignment-owner-${suffix}@example.test`;
  const owner = await provision({
    email,
    password,
    name: "Синтетическая подготовка обучения",
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
  const accounts = { SUPER_ADMIN: { email, password } } as Record<
    "SUPER_ADMIN" | "DIRECTOR" | "METHODIST" | "OPERATOR",
    { email: string; password: string }
  >;
  for (const role of ["DIRECTOR", "METHODIST", "OPERATOR"] as const) {
    const user = await saveUser(context, {
      email: `assignment-${role.toLowerCase()}-${suffix}@example.test`,
      password,
      displayName: `Синтетический ${role}`,
      role,
    });
    accounts[role] = { email: user.email, password };
  }
  const recipients = [];
  for (let index = 1; index <= people; index++) {
    recipients.push(
      await saveRecipient(context, {
        id: randomUUID(),
        fullNameRu: `Синтетический Слушатель ${index}`,
        fullNameKz: `Синтетикалық Тыңдаушы ${index}`,
        positionRu: "Работник",
        assignments: [],
      }),
    );
  }
  let versionId = "";
  if (published) {
    const course = await createCourse(context, lmsCourse());
    await publishVersion(context, course.version.id, { revision: 0 });
    versionId = course.version.id;
  }
  return { context, accounts, recipients, versionId };
}

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(account.email);
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
      // This suite uses multiple real roles on one localhost IP. Respect the
      // production ten-logins/minute limit without changing server policy.
      await page.waitForTimeout(31_000);
      continue;
    }
    expect(response.ok(), `Login HTTP ${response.status()}`).toBe(true);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    return;
  }
  throw new Error("Synthetic browser login remained rate-limited");
}

async function group(page: Page, name: string) {
  const summary = page.locator("summary").filter({ hasText: "Группа и сроки" });
  if (!(await summary.locator("..").getAttribute("open"))) {
    // An open details element has an empty-string attribute.
    if (
      !(await summary
        .locator("..")
        .evaluate((node) => (node as HTMLDetailsElement).open))
    )
      await summary.click();
  }
  await page
    .getByLabel("Название группы · необязательно", { exact: true })
    .fill(name);
}

async function selectPeople(page: Page) {
  await page
    .getByRole("checkbox", { name: "Выбрать видимый список", exact: true })
    .check();
  await expect(
    page.getByRole("button", { name: "Назначить обучение · 2", exact: true }),
  ).toBeVisible();
}

async function screenshot(page: Page, name: string) {
  await fs.mkdir(evidence, { recursive: true });
  await expect(
    page.getByText("Загружаем организации…", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidence, `${name}.png`),
    fullPage: true,
  });
}

async function assertTwoEnrollments(tenantId: string) {
  await expect.poll(() => db.enrollment.count({ where: { tenantId } })).toBe(2);
  expect(await db.lmsAssignmentOperation.count({ where: { tenantId } })).toBe(
    1,
  );
}

test.afterAll(async () => {
  await db.$disconnect();
});

for (const role of ["SUPER_ADMIN", "DIRECTOR", "OPERATOR"] as const) {
  test(`fresh ${role} distinguishes failed loading from an empty programme catalogue`, async ({
    page,
  }) => {
    const seeded = await fixture(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, seeded.accounts[role]);
    let failNext = true;
    await page.route("**/api/lms/assignment-context?*", async (route) => {
      if (failNext) {
        await route.abort("failed");
      } else await route.continue();
    });
    await page.goto("/lms/assign");
    await expect(
      page.getByText("Не удалось загрузить данные для назначения", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Пока нет опубликованных программ", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("button", { name: "Назначить обучение · 0", exact: true })
        .and(page.locator(":enabled")),
    ).toHaveCount(0);
    await screenshot(page, `context-failure-${role}-390`);
    failNext = false;
    await page
      .getByRole("button", { name: "Повторить загрузку", exact: true })
      .click();
    await expect(
      page.getByText("Пока нет опубликованных программ", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Не удалось загрузить данные для назначения", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Добавить человека", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("link", { name: "Открыть программы", exact: true }),
    ).toHaveAttribute("href", "/lms?returnTo=%2Flms%2Fassign");
    await expect(
      page.getByRole("button", { name: "Обновить список", exact: true }),
    ).toBeEnabled();
    await screenshot(page, `empty-${role}-390`);
  });
}

test("methodist preparation and director publication let the operator assign the preserved mobile draft", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const seeded = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded.accounts.OPERATOR);
  await page.goto("/lms/assign");
  await expect(
    page.getByText("Пока нет опубликованных программ", { exact: true }),
  ).toBeVisible();
  await selectPeople(page);
  await group(page, "Подготовленная группа до публикации");
  await page
    .getByRole("checkbox", {
      name: "Задать общий период доступа для состава",
      exact: true,
    })
    .check();
  await page.getByLabel("Дней доступа", { exact: true }).fill("45");
  await expect(
    page.getByRole("button", { name: "Назначить обучение · 2", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("link", { name: "Открыть программы", exact: true })
    .click();
  await expect(page).toHaveURL(/\/lms\?returnTo=/);
  await page
    .getByRole("link", { name: "Вернуться к назначению", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Выбрать видимый список", exact: true }),
  ).toBeChecked();
  await page.locator("summary").filter({ hasText: "Группа и сроки" }).click();
  await expect(
    page.getByLabel("Название группы · необязательно", { exact: true }),
  ).toHaveValue("Подготовленная группа до публикации");
  await expect(page.getByLabel("Дней доступа", { exact: true })).toHaveValue(
    "45",
  );

  const methodistContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const directorContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  try {
    const methodist = await methodistContext.newPage();
    await methodist.routeWebSocket(/\/_next\/webpack-hmr/, (socket) =>
      socket.close(),
    );
    await login(methodist, seeded.accounts.METHODIST);
    await methodist.goto("/lms");
    const createdResponse = methodist.waitForResponse(
      (response) =>
        response.url().endsWith("/api/lms/courses") &&
        response.request().method() === "POST",
    );
    await methodist
      .getByRole("button", { name: "Создать программу", exact: true })
      .click();
    const created = await (await createdResponse).json();
    expect(created.course.id).toBeTruthy();
    await expect(methodist).toHaveURL(
      new RegExp(`/lms/courses/${created.course.id}$`),
    );
    // The authoring editor itself has separate broad coverage. Populate this
    // synthetic teaching material through the methodist's authenticated API.
    const sessionResponse = await methodist.request.get("/api/auth/session");
    const session = await sessionResponse.json();
    const updated = await methodist.request.put(
      `/api/lms/course-versions/${created.version.id}`,
      {
        headers: {
          origin: process.env.DEMO_ORIGIN!,
          "x-csrf-token": session.csrfToken,
        },
        data: { revision: 0, ...lmsCourse() },
      },
    );
    expect(updated.ok(), await updated.text()).toBe(true);
    await methodist.reload();
    await methodist
      .getByRole("navigation", { name: "Разделы программы", exact: true })
      .getByRole("button", { name: "Публикация", exact: true })
      .click();
    await expect(
      methodist.getByRole("button", { name: "Опубликовать", exact: true }),
    ).toHaveCount(0);
    await methodist
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    await expect(
      methodist.getByRole("region", {
        name: "Согласование программы",
        exact: true,
      }),
    ).toContainText("Ожидает проверки администратором");
    await screenshot(methodist, "methodist-submitted-for-review");

    const director = await directorContext.newPage();
    await director.routeWebSocket(/\/_next\/webpack-hmr/, (socket) =>
      socket.close(),
    );
    await login(director, seeded.accounts.DIRECTOR);
    await director.goto(`/lms/courses/${created.course.id}`);
    await director
      .getByRole("navigation", { name: "Разделы программы", exact: true })
      .getByRole("button", { name: "Публикация", exact: true })
      .click();
    await director
      .getByRole("button", { name: "Одобрить редакцию", exact: true })
      .click();
    await expect(
      director.getByRole("region", {
        name: "Согласование программы",
        exact: true,
      }),
    ).toContainText("Ожидает публикации");
    await director
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.courseVersion.findUniqueOrThrow({
              where: { id: created.version.id },
            })
          ).status,
      )
      .toBe("PUBLISHED");
    await expect(
      director.getByRole("region", { name: "Согласование программы", exact: true }),
    ).toContainText("Одобрено");
    await expect(
      director.getByRole("region", { name: "Согласование программы", exact: true }),
    ).not.toContainText("Ожидает публикации");
    await expect(
      director
        .getByRole("link", { name: "Назначить обучение", exact: true })
        .first(),
    ).toHaveAttribute("href", `/lms/assign?versionId=${created.version.id}`);
    await director
      .getByRole("button", { name: "Создать новую версию", exact: true })
      .click();
    await expect(
      director
        .getByRole("link", { name: "Назначить опубликованную программу", exact: true })
        .first(),
    ).toHaveAttribute("href", `/lms/assign?versionId=${created.version.id}`);
    await expect
      .poll(async () =>
        (
          await db.courseVersion.findMany({
            where: {
              tenantId: seeded.context.tenantId,
              courseId: created.course.id,
            },
          })
        )
          .map((version) => version.status)
          .sort(),
      )
      .toEqual(["DRAFT", "PUBLISHED"]);
    await expect(
      director.getByRole("button", { name: "Опубликовать", exact: true }),
    ).toBeVisible();
    await expect(
      director
        .getByRole("link", { name: "Назначить опубликованную программу", exact: true })
        .first(),
    ).toHaveAttribute("href", `/lms/assign?versionId=${created.version.id}`);
    expect(
      await db.enrollment.count({
        where: { tenantId: seeded.context.tenantId },
      }),
    ).toBe(0);
    await page
      .getByRole("button", { name: "Обновить список", exact: true })
      .click();
    const programme = page.getByRole("combobox", {
      name: "Программа",
      exact: true,
    });
    await expect(
      programme.locator(`option[value="${created.version.id}"]`),
    ).toHaveCount(1);
    await programme.selectOption(created.version.id);
    await expect(
      page.getByRole("checkbox", {
        name: "Выбрать видимый список",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Название группы · необязательно", { exact: true }),
    ).toHaveValue("Подготовленная группа до публикации");
    await expect(page.getByLabel("Дней доступа", { exact: true })).toHaveValue(
      "45",
    );
    await screenshot(page, "published-programme-preserved-draft-390");
    await page
      .getByRole("button", { name: "Назначить обучение · 2", exact: true })
      .click();
    await expect(
      page.getByText("Назначено: 2.", { exact: false }).first(),
    ).toBeVisible();
    await assertTwoEnrollments(seeded.context.tenantId);
    const savedGroup = await db.lmsGroup.findFirstOrThrow({
      where: { tenantId: seeded.context.tenantId },
    });
    expect(savedGroup.name).toBe("Подготовленная группа до публикации");
    await expect(
      page
        .getByRole("region", { name: "Слушатели и доступ", exact: true })
        .getByRole("row"),
    ).toHaveCount(3);
    await screenshot(page, "assignment-complete-390");
  } finally {
    await methodistContext.close();
    await directorContext.close();
  }
});

test("failed context refresh keeps selected people programme and group until retry succeeds", async ({
  page,
}) => {
  const seeded = await fixture(2, true);
  await login(page, seeded.accounts.OPERATOR);
  await page.goto("/lms/assign");
  await selectPeople(page);
  await group(page, "Состав после сбоя загрузки");
  await expect(
    page.getByRole("combobox", { name: "Программа", exact: true }),
  ).toHaveValue(seeded.versionId);
  let failNext = true;
  await page.route("**/api/lms/assignment-context?*", async (route) => {
    if (failNext) {
      failNext = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Обновить список", exact: true })
    .click();
  await expect(
    page.getByText("Не удалось загрузить данные для назначения", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Выбрать видимый список", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Программа", exact: true }),
  ).toHaveValue(seeded.versionId);
  await expect(
    page.getByLabel("Название группы · необязательно", { exact: true }),
  ).toHaveValue("Состав после сбоя загрузки");
  await page
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await expect(
    page.getByText("Не удалось загрузить данные для назначения", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Назначить обучение · 2", exact: true }),
  ).toBeEnabled();
  expect(
    await db.enrollment.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(0);
  const version = await db.courseVersion.findUniqueOrThrow({
    where: { id: seeded.versionId },
  });
  await setCoursePause(seeded.context, version.courseId, {
    paused: true,
    reason: "Синтетическая приостановка назначений",
  });
  await page
    .getByRole("button", { name: "Обновить список", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Назначить обучение · 2", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("combobox", { name: "Программа", exact: true })
      .locator(`option[value="${seeded.versionId}"]`),
  ).toBeDisabled();
  await expect(
    page.getByText(/Назначения приостановлены\. Для возобновления/),
  ).toBeVisible();
  await setCoursePause(seeded.context, version.courseId, {
    paused: false,
    reason: "",
  });
  await page
    .getByRole("button", { name: "Обновить список", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Назначить обучение · 2", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Название группы · необязательно", { exact: true }),
  ).toHaveValue("Состав после сбоя загрузки");
});

test("lost accepted assignment response resumes the same operation without duplicate enrollments", async ({
  page,
}) => {
  const seeded = await fixture(2, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, seeded.accounts.OPERATOR);
  await page.goto("/lms/assign");
  await selectPeople(page);
  await group(page, "Группа с потерянным ответом");
  const operations: string[] = [];
  let loseNext = true;
  await page.route("**/api/lms/enrollments", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    operations.push(route.request().postDataJSON().operationId);
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    if (loseNext) {
      loseNext = false;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Назначить обучение · 2", exact: true })
    .click();
  await expect(
    page.getByText("Результат назначения пока неизвестен", { exact: true }),
  ).toBeVisible();
  await assertTwoEnrollments(seeded.context.tenantId);
  await expect(
    page.getByRole("combobox", { name: "Программа", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Выбрать видимый список", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Название группы · необязательно", { exact: true }),
  ).toBeDisabled();
  await screenshot(page, "lost-assignment-response-390");
  await page
    .getByRole("button", { name: "Повторить назначение", exact: true })
    .click();
  await expect(
    page.getByText("Назначено: 2.", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Результат назначения пока неизвестен", { exact: true }),
  ).toHaveCount(0);
  await assertTwoEnrollments(seeded.context.tenantId);
  expect(operations).toHaveLength(2);
  expect(new Set(operations).size).toBe(1);
});

test("archived organizations cannot be selected and an old link reports unavailable context", async ({
  page,
}) => {
  const seeded = await fixture(0);
  const active = await saveCustomer(seeded.context, {
    nameRu: "Синтетическая организация действующая",
  });
  const archived = await saveCustomer(seeded.context, {
    nameRu: "Синтетическая организация архивная",
    archived: true,
  });
  await login(page, seeded.accounts.OPERATOR);
  await page.goto("/lms/assign");
  const organizations = page.getByRole("combobox", {
    name: "Выбрать организацию",
    exact: true,
  });
  await expect(
    organizations.locator(`option[value="${active.id}"]`),
  ).toHaveCount(1);
  await expect(
    organizations.locator(`option[value="${archived.id}"]`),
  ).toHaveCount(0);
  await page
    .getByLabel("Организация · поиск по названию или БИН", { exact: true })
    .fill("архивная");
  await expect(organizations.locator("option")).toHaveCount(1);
  await expect(
    page.getByText(
      "Организации не найдены. Измените поиск или создайте новую.",
      { exact: true },
    ),
  ).toBeVisible();
  const unavailable = page.waitForResponse(
    (response) =>
      response.url().includes("/api/lms/assignment-context?") &&
      response.url().includes(archived.id),
  );
  await page.goto(`/lms/assign?customerId=${archived.id}`);
  expect((await unavailable).status()).toBe(404);
  await expect(
    page.getByText("Не удалось загрузить данные для назначения", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Запись недоступна. Обновите список и проверьте доступ.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Пока нет опубликованных программ", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Открыть новое назначение", exact: true })
    .click();
  await expect(page).toHaveURL(/\/lms\/assign$/);
  await expect(
    page.getByText("Пока нет опубликованных программ", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Не удалось загрузить данные для назначения", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("rejected assignment remains visible through context refresh and retries the preserved draft", async ({
  page,
}) => {
  const seeded = await fixture(2, true);
  const company = await saveCustomer(seeded.context, {
    nameRu: "Синтетическая организация для восстановления",
  });
  for (const recipient of seeded.recipients) {
    await saveRecipient(
      seeded.context,
      { ...(recipient.data as object), employerId: company.id },
      recipient.id,
    );
  }
  await login(page, seeded.accounts.OPERATOR);
  await page.goto(`/lms/assign?customerId=${company.id}`);
  await selectPeople(page);
  await group(page, "Состав после восстановления организации");
  // Another authorized operator archives the organization after the form loads.
  await saveCustomer(
    seeded.context,
    { nameRu: company.nameRu, archived: true },
    company.id,
  );
  const refused = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/lms/enrollments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Назначить обучение · 2", exact: true })
    .click();
  expect((await refused).status()).toBe(404);
  await expect(
    page.getByText("Назначение не завершено", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Результат назначения пока неизвестен", { exact: true }),
  ).toHaveCount(0);
  expect(
    await db.enrollment.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Обновить список", exact: true })
    .click();
  await expect(
    page.getByText("Не удалось загрузить данные для назначения", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Назначение не завершено", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Выбрать видимый список", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Название группы · необязательно", { exact: true }),
  ).toHaveValue("Состав после восстановления организации");
  await saveCustomer(
    seeded.context,
    { nameRu: company.nameRu, archived: false },
    company.id,
  );
  await page
    .getByRole("button", { name: "Повторить загрузку", exact: true })
    .click();
  await expect(
    page.getByText("Не удалось загрузить данные для назначения", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Назначение не завершено", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Программа", exact: true }),
  ).toHaveValue(seeded.versionId);
  await page
    .getByRole("button", { name: "Повторить назначение", exact: true })
    .click();
  await expect(
    page.getByText("Назначено: 2.", { exact: false }).first(),
  ).toBeVisible();
  await assertTwoEnrollments(seeded.context.tenantId);
});

test("completed failed rows can be repaired and retried in a new operation with unchanged selection", async ({
  page,
}) => {
  const seeded = await fixture(2, true);
  await login(page, seeded.accounts.OPERATOR);
  await page.goto("/lms/assign");
  await selectPeople(page);
  await group(page, "Повтор исправленных строк");
  const operations: Array<{ operationId: string; recipientIds: string[] }> = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/lms/enrollments" &&
      request.method() === "POST"
    )
      operations.push(request.postDataJSON());
  });
  await db.recipient.updateMany({
    where: { tenantId: seeded.context.tenantId },
    data: { archived: true },
  });
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/lms/enrollments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Назначить обучение · 2", exact: true })
    .click();
  const failedReport = await (await rejected).json();
  expect(failedReport).toMatchObject({
    state: "COMPLETED",
    created: 0,
    errorCount: 2,
  });
  expect(
    failedReport.errors.map((entry: { code: string }) => entry.code),
  ).toEqual(["RECIPIENT_UNAVAILABLE", "RECIPIENT_UNAVAILABLE"]);
  await expect(
    page.getByRole("checkbox", { name: "Выбрать видимый список", exact: true }),
  ).toBeChecked();
  await db.recipient.updateMany({
    where: { tenantId: seeded.context.tenantId },
    data: { archived: false },
  });
  await page
    .getByRole("button", { name: "Назначить обучение · 2", exact: true })
    .click();
  await expect(
    page.getByText("Назначено: 2.", { exact: false }).first(),
  ).toBeVisible();
  expect(
    await db.enrollment.count({ where: { tenantId: seeded.context.tenantId } }),
  ).toBe(2);
  expect(
    await db.lmsAssignmentOperation.count({
      where: { tenantId: seeded.context.tenantId },
    }),
  ).toBe(2);
  expect(operations).toHaveLength(2);
  expect([...operations[0].recipientIds].sort()).toEqual(
    [...operations[1].recipientIds].sort(),
  );
  expect(operations[0].operationId).not.toBe(operations[1].operationId);
});

test("pending group assignment restores its exact payload after server group changes and page reload", async ({
  page,
}) => {
  const seeded = await fixture(2, true);
  const sourceGroup = await db.lmsGroup.create({
    data: {
      tenantId: seeded.context.tenantId,
      name: "Синтетическая исходная группа",
      courseVersionId: seeded.versionId,
      createdBy: seeded.context.userId,
      dueAt: new Date(Date.now() + 30 * 86400_000),
    },
  });
  await login(page, seeded.accounts.OPERATOR);
  await page.goto(`/lms/assign?groupId=${sourceGroup.id}`);
  await selectPeople(page);
  const inputs: unknown[] = [];
  let loseNext = true;
  await page.route("**/api/lms/enrollments", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    inputs.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    if (loseNext) {
      loseNext = false;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Назначить обучение · 2", exact: true })
    .click();
  await expect(
    page.getByText("Результат назначения пока неизвестен", { exact: true }),
  ).toBeVisible();
  await assertTwoEnrollments(seeded.context.tenantId);
  await db.lmsGroup.update({
    where: { id: sourceGroup.id },
    data: {
      name: "Синтетическая группа переименована другим оператором",
      dueAt: new Date(Date.now() + 40 * 86400_000),
    },
  });
  await page.reload();
  await expect(
    page.getByText("Результат назначения пока неизвестен", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Выбрать видимый список", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Повторить назначение", exact: true })
    .click();
  await expect(
    page.getByText("Назначено: 2.", { exact: false }).first(),
  ).toBeVisible();
  await assertTwoEnrollments(seeded.context.tenantId);
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toEqual(inputs[0]);
});
