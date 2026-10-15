import { test, expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-first-entry-live")
    : path.join(
        __dirname,
        "../../../docs/evidence/lms-one-run-20261015/agent-c/first-entry-live",
      ),
);
const password = "Synthetic-LMS-only-20261015!";
async function capture(page: Page, name: string) {
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: path.join(evidence, name),
    fullPage: true,
    timeout: 15000,
    animations: "disabled",
  });
}

test("first learner registration uses three fields and explicit consent without center onboarding", async ({
  page,
}) => {
  const email = `lms-browser-registration-${Date.now()}@example.test`;
  await page.goto("/learn/register");
  const started = performance.now();
  await page
    .getByLabel("ФИО", { exact: true })
    .fill("Синтетический Слушатель Әбдірахманов");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const language of ["KZ", "RU"]) {
      await page.getByRole("button", { name: language, exact: true }).click();
      await expect(page.getByRole("textbox").first()).toHaveValue(
        "Синтетический Слушатель Әбдірахманов",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const button = page.getByRole("button", {
        name: language === "RU" ? "Продолжить" : "Жалғастыру",
        exact: true,
      });
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await capture(page, `registration-${width}-${language}.png`);
    }
  }
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/learn/register") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page).toHaveURL(/\/learn$/);
  const me = await (await page.request.get("/api/auth/session")).json();
  expect(me.user.role).toBe("LEARNER");
  await expect(
    page.getByRole("link", { name: "Настройки", exact: true }),
  ).toHaveCount(0);
  await capture(page, "registration-complete.png");
  await fs.writeFile(
    path.join(evidence, "registration-actions.json"),
    JSON.stringify(
      {
        result: "PASS",
        measuredAt: new Date().toISOString(),
        role: "NEW_LEARNER",
        startState:
          "Public registration page, empty form, no authenticated session",
        actualSteps: [
          "Enter name, email and password",
          "Check versioned consent",
          "Continue; actual server creates LEARNER and opens My learning",
        ],
        counts: {
          filledFields: 3,
          repeatedFields: 0,
          clicks: 2,
          keyboardActions: 0,
          decisions: 1,
          navigation: 1,
          dialogs: 0,
          manualRefresh: 0,
          confirmations: 1,
        },
        instrumentation: {
          languageClicks: 8,
          viewportChanges: 4,
          notIncludedInBusinessCounts: true,
          timingIncludesAssertionsAndScreenshots: true,
        },
        startBoundary:
          "Registration page already loaded; entering three fields begins measurement",
        endBoundary: "Actual LEARNER session and My learning screen confirmed",
        elapsedMilliseconds: performance.now() - started,
      },
      null,
      2,
    ),
  );
});

test("first course is authored and published through UI, autosave survives navigation, calendar persists", async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_ADMIN_EMAIL!);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const authenticated = await (
    await page.request.get("/api/auth/session")
  ).json();
  await page.goto("/lms");
  const started = performance.now();
  const actions: { kind: string; target: string }[] = [];
  const click = async (locator: Locator, target: string) => {
    await locator.click();
    actions.push({ kind: "click", target });
  };
  const fill = async (label: string, value: string) => {
    await page.getByLabel(label, { exact: true }).fill(value);
    actions.push({ kind: "fill", target: label });
  };
  await click(
    page.getByRole("button", { name: "Создать курс", exact: true }),
    "Create course",
  );
  await expect(page).toHaveURL(/\/lms\/courses\//);
  actions.push({ kind: "navigation", target: "Created course editor opened" });
  const courseUrl = page.url();
  const courseId = courseUrl.split("/").at(-1);
  await fill("Название RU", "Синтетический первый учебный курс");
  await fill("Название KZ", "Синтетикалық бірінші оқу курсы");
  await fill("Категория слушателей", "Синтетическая учебная группа");
  await click(
    page.getByRole("button", { name: "Добавить модуль", exact: true }),
    "Add module",
  );
  await fill("Модуль RU", "Первый модуль");
  await fill("Модуль KZ", "Бірінші модуль");
  await click(
    page.getByRole("button", { name: "Добавить урок", exact: true }),
    "Add lesson",
  );
  await fill("Урок RU", "Синтетический текст");
  await fill("Урок KZ", "Синтетикалық мәтін");
  await fill(
    "Текст RU",
    "Учебный текст для инженерной проверки, не нормативное утверждение.",
  );
  await fill("Текст KZ", "Инженерлік тексеруге арналған оқу мәтіні.");
  await click(
    page.getByRole("button", { name: "Добавить вопрос", exact: true }),
    "Add question",
  );
  await click(
    page.locator("summary").filter({ hasText: "1. Новый вопрос" }),
    "Open question",
  );
  await fill("Вопрос RU", "Какой ответ выбран для синтетической проверки?");
  await fill("Вопрос KZ", "Синтетикалық тексеру үшін қай жауап таңдалған?");
  for (let index = 0; index < 2; index++) {
    await page
      .getByLabel("RU", { exact: true })
      .nth(index)
      .fill(index ? "Второй" : "Первый");
    actions.push({ kind: "fill", target: `Answer ${index + 1} RU` });
    await page
      .getByLabel("KZ", { exact: true })
      .nth(index)
      .fill(index ? "Екінші" : "Бірінші");
    actions.push({ kind: "fill", target: `Answer ${index + 1} KZ` });
  }
  await click(
    page.locator("summary").filter({ hasText: "Основание и оформление" }),
    "Open basis",
  );
  await expect(
    page.getByRole("combobox", { name: "Оценка", exact: true }),
  ).toHaveValue("PRACTICE");
  await page
    .getByLabel("Синтетическая учебная программа", { exact: true })
    .check();
  actions.push({ kind: "click", target: "Synthetic program" });
  await click(
    page.getByRole("link", { name: "К курсам", exact: true }),
    "Leave editor, autosave flushes",
  );
  await expect(page).toHaveURL(/\/lms$/);
  actions.push({ kind: "navigation", target: "Return to course catalogue" });
  await page.goto(courseUrl);
  actions.push({ kind: "navigation", target: "Return to exact course" });
  await expect(page.getByLabel("Название RU", { exact: true })).toHaveValue(
    "Синтетический первый учебный курс",
  );
  const persisted = await (
    await page.request.get(`/api/lms/courses/${courseId}`)
  ).json();
  expect(persisted.versions[0].content.exam.questions).toHaveLength(1);
  expect(persisted.versions[0].content.modules[0].lessons[0].textKz).toContain(
    "Инженерлік",
  );
  await capture(page, "course-persisted-draft.png");
  const publication = page.waitForResponse(
    (r) => r.url().endsWith("/publish") && r.request().method() === "POST",
  );
  await click(
    page.getByRole("button", { name: "Опубликовать", exact: true }),
    "Publish practice course",
  );
  expect((await publication).status()).toBe(201);
  await expect(
    page.getByRole("button", { name: "Создать новую версию", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Название RU", { exact: true })).toBeDisabled();
  await capture(page, "course-published.png");
  await fs.writeFile(
    path.join(evidence, "course-actions.json"),
    JSON.stringify(
      {
        result: "PASS",
        measuredAt: new Date().toISOString(),
        role: authenticated.user.role,
        startState:
          "Authenticated course catalogue; no course exists for this scenario",
        actions,
        counts: {
          filledFields: actions.filter((a) => a.kind === "fill").length,
          clicks: actions.filter((a) => a.kind === "click").length,
          selections: actions.filter((a) => a.kind === "select").length,
          repeatedFields: 0,
          dialogs: 0,
          manualSaveButtons: 0,
          keyboardActions: 0,
          decisions: 7,
          navigation: actions.filter((a) => a.kind === "navigation").length,
          manualRefresh: 0,
          confirmations: 1,
        },
        decisionBoundary:
          "Create course, add module, add lesson, add question, mark synthetic, leave editor, publish; expanding details is not a business decision",
        startBoundary: "Authenticated catalogue already loaded",
        endBoundary: "Published immutable course shown",
        instrumentation: {
          timingIncludesAssertionsAndScreenshots: true,
          nativeFilePickerObserved: false,
          fileSelections: 0,
        },
        authenticationCountedSeparately: { fields: 2, clicks: 1 },
        elapsedMilliseconds: performance.now() - started,
        boundary:
          "Synthetic PRACTICE program, profile still NEEDS_LEGAL_REVIEW. Publication does not establish regulated examination authority or document eligibility.",
      },
      null,
      2,
    ),
  );
  const calendarStarted = performance.now();
  await page.goto("/lms/sanitary");
  await page.locator("summary").filter({ hasText: "Параметры центра" }).click();
  await page
    .locator("summary")
    .filter({ hasText: "Производственный календарь" })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "Добавить версию календаря" })
    .click();
  await page
    .getByLabel("Название календаря", { exact: true })
    .fill(`Синтетический UI календарь ${Date.now()}`);
  await page.getByLabel("Начало периода", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Конец периода", { exact: true }).fill("2027-12-31");
  await page
    .getByLabel("Источники календаря, по одному в строке", { exact: true })
    .fill("Synthetic engineering calendar; no legal calendar claim");
  await page
    .getByLabel("Учебный календарь для проверки", { exact: true })
    .check();
  const calendar = page.waitForResponse(
    (r) =>
      r.url().endsWith("/lms/sanitary/calendars") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Сохранить версию", exact: true })
    .click();
  expect((await calendar).status()).toBe(201);
  await expect(
    page.getByText("Версия сохранена. Её можно выбрать в программе курса.", {
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "calendar-created.png");
  await fs.writeFile(
    path.join(evidence, "calendar-actions.json"),
    JSON.stringify(
      {
        result: "PASS",
        measuredAt: new Date().toISOString(),
        role: authenticated.user.role,
        startState:
          "Authenticated staff member, fresh synthetic calendar not entered",
        startBoundary: "Before opening sanitary screen",
        endBoundary: "Saved version confirmation visible",
        actualSteps: [
          "Open sanitary screen",
          "Expand center settings, calendar and new version",
          "Enter title, start, end and synthetic source",
          "Mark synthetic calendar",
          "Save version",
        ],
        counts: {
          clicks: 5,
          keyboardActions: 0,
          filledFields: 4,
          repeatedFields: 0,
          decisions: 3,
          navigation: 1,
          dialogs: 0,
          manualRefresh: 0,
          confirmations: 1,
        },
        decisionBoundary:
          "Create calendar version, mark it synthetic, save version; opening settings disclosure is navigation only",
        elapsedMilliseconds: performance.now() - calendarStarted,
        instrumentation: { timingIncludesAssertionsAndScreenshots: true },
        limitation:
          "Synthetic calendar sources only; no official production-calendar confirmation claimed",
      },
      null,
      2,
    ),
  );
});
