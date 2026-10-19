import {
  test,
  expect,
  type Locator,
  type Page,
  type APIResponse,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
  type RegulatoryProfile,
} from "../../../packages/contracts/src/lms";

const product = path.resolve(__dirname, "../../..");
const output = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/lms-full-tz-pass-01-20261018"),
);
type Version = {
  id: string;
  revision: number;
  status: string;
  content: CourseContent;
  profile: RegulatoryProfile;
};
type Course = { course: { id: string }; versions: Version[] };
async function body<T>(
  response: Pick<APIResponse, "ok" | "status" | "text" | "json">,
): Promise<T> {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json() as Promise<T>;
}
async function openDetails(details: Locator) {
  if (!(await details.getAttribute("open"))) {
    // Boolean open is serialized as an empty attribute, so check the DOM property.
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
  }
}
async function authorQuestion(scope: Locator, kind: string, label: string) {
  await scope
    .getByRole("button", { name: "Добавить вопрос", exact: true })
    .click();
  const details = scope
    .locator(":scope > .lms-assessment-author > details")
    .last();
  await openDetails(details);
  await details.getByLabel("Тип вопроса").selectOption(kind);
  await details.getByLabel("Категория").fill("Синтетическая учебная проверка");
  await details.getByLabel("Вопрос RU").fill(`${label} RU`);
  await details.getByLabel("Вопрос KZ").fill(`${label} KZ`);
  if (kind === "TEXT") {
    await details.getByLabel("Способ проверки").selectOption("EXACT");
    await details
      .getByLabel("Допустимые ответы — по одному на строку")
      .fill("ключ\n");
    await details.getByLabel("Способ проверки").selectOption("MANUAL");
    await details
      .getByLabel("Критерии RU")
      .fill("Ответ должен обосновать безопасное действие.");
    await details
      .getByLabel("Критерии KZ")
      .fill("Жауап қауіпсіз әрекетті негіздеуі керек.");
    return;
  }
  if (kind === "CASE") {
    await details
      .getByLabel("Ситуация RU")
      .fill("Синтетическая ситуация: выберите безопасное действие.");
    await details
      .getByLabel("Ситуация KZ")
      .fill("Синтетикалық жағдай: қауіпсіз әрекетті таңдаңыз.");
  }
  for (let index = 1; index <= 2; index++) {
    const option = details.getByRole("group", {
      name: `${kind === "MATCHING" ? "Левая часть" : "Вариант"} ${index}`,
      exact: true,
    });
    await option.getByLabel("RU").fill(`Вариант ${index}`);
    await option.getByLabel("KZ").fill(`Нұсқа ${index}`);
  }
  if (kind === "MULTIPLE")
    await details
      .getByRole("group", { name: "Вариант 2", exact: true })
      .getByLabel("Правильный ответ")
      .check();
  if (kind === "MATCHING") {
    for (let index = 1; index <= 2; index++) {
      await details
        .getByLabel(`Правая часть ${index} RU`)
        .fill(`Соответствие ${index}`);
      await details
        .getByLabel(`Правая часть ${index} KZ`)
        .fill(`Сәйкестік ${index}`);
      await details
        .getByRole("group", { name: `Левая часть ${index}`, exact: true })
        .getByLabel("Соответствует")
        .selectOption({ label: `Соответствие ${index}` });
    }
  }
  if (kind === "ORDERING") {
    const ordering = details.getByRole("group", {
      name: "Правильная последовательность",
      exact: true,
    });
    await ordering
      .getByRole("button", { name: "Ниже: Вариант 1", exact: true })
      .click();
  }
}
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль").fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("author creates six question types and mixed elements through UI, persists exact draft, publishes and retains RU/KZ geometry", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const origin = process.env.DEMO_ORIGIN!;
  expect(["127.0.0.1", "localhost"]).toContain(new URL(origin).hostname);
  const fixturePath =
    process.env.DEMO_LMS_PASS01_FIXTURE ||
    path.join(product, ".runtime/lms-pass01-20261018/browser-fixture.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    baseUrl: string;
    tenantId: string;
    users: { director: { email: string; password: string } };
  };
  expect(fixture.baseUrl).toBe(origin);
  await login(page, fixture.users.director);
  const session = await body<{ csrfToken: string }>(
    await page.request.get("/api/auth/session"),
  );
  const unique = randomUUID().slice(0, 8);
  const content = courseContentSchema.parse({
    titleRu: `Синтетический автор ${unique}`,
    titleKz: `Синтетикалық автор ${unique}`,
    category: "Синтетическая учебная проверка",
    learningOutcome: "LEARNING",
    modules: [],
    exam: {
      questions: [],
      questionCount: 6,
      durationMinutes: 30,
      maxAttempts: 3,
      thresholdPercent: 80,
      comparison: "GTE",
      revealAnswers: true,
    },
  });
  const profile = regulatoryProfileSchema.parse({
    title: "Синтетическая локальная учебная программа",
    category: content.category,
    synthetic: true,
    assessmentKind: "CENTER_EXAM",
    status: "CONFIRMED",
    examiner: "Синтетический преподаватель",
    issuer: "Синтетический центр",
    reviewReference: "Local browser fixture; not a legal qualification",
    requiresApproval: false,
    requiresEmployeeSignature: false,
  });
  const created = await body<{ course: { id: string }; version: Version }>(
    await page.request.post("/api/lms/courses", {
      headers: { origin, "x-csrf-token": session.csrfToken },
      data: { content, profile },
    }),
  );
  await page.goto(`/lms/courses/${created.course.id}`);
  await expect(
    page.getByRole("heading", {
      name: `Синтетический автор ${unique}`,
      exact: true,
    }),
  ).toBeVisible();
  const settings = page.getByRole("group", {
    name: "Учебные настройки",
    exact: true,
  });
  await settings
    .getByText("Цели, аудитория и параметры программы", { exact: true })
    .click();
  for (const label of [
    "Цель RU",
    "Цель KZ",
    "Аудитория RU",
    "Аудитория KZ",
    "Срок действия документа",
    "Периодичность обучения",
    "Источник параметров программы",
  ])
    await settings.getByLabel(label).fill(`Синтетический параметр: ${label}`);
  await settings.getByLabel("Дата актуализации").fill("2026-10-18");
  await settings.getByLabel("Итог программы").selectOption("LEARNING");
  await settings.getByText("Период доступа", { exact: true }).first().click();
  await settings.getByLabel("Режим доступа").selectOption("UNLIMITED");
  const modules = page.getByRole("group", {
    name: "Модули и уроки",
    exact: true,
  });
  await modules
    .getByRole("button", { name: "Добавить модуль", exact: true })
    .click();
  await modules.getByLabel("Модуль RU").fill("Смешанная программа");
  await modules.getByLabel("Модуль KZ").fill("Аралас бағдарлама");
  for (const [index, kind] of [
    "TEXT",
    "LINK",
    "ASSIGNMENT",
    "SESSION",
  ].entries()) {
    await modules
      .getByRole("button", { name: "Добавить урок", exact: true })
      .click();
    const lesson = modules.getByRole("group", {
      name: `Урок ${index + 1}`,
      exact: true,
    });
    await lesson.getByLabel("Урок RU").fill(`Элемент ${kind}`);
    await lesson.getByLabel("Урок KZ").fill(`Элемент ${kind} KZ`);
    await lesson.getByLabel("Тип элемента").selectOption(kind);
    await lesson
      .getByLabel("Текст RU")
      .fill("Учебный материал синтетического курса.");
    await lesson
      .getByLabel("Текст KZ")
      .fill("Синтетикалық курстың оқу материалы.");
    if (kind === "LINK")
      await lesson
        .getByLabel("Адрес материала (https)")
        .fill("https://example.org/synthetic");
    if (kind === "ASSIGNMENT")
      for (const label of [
        "Инструкция RU",
        "Инструкция KZ",
        "Критерии приёмки RU",
        "Критерии приёмки KZ",
      ])
        await lesson
          .getByLabel(label)
          .fill(`Синтетическая инструкция: ${label}`);
  }
  // Reordering uses the accessible single-pointer/keyboard action and preserves IDs.
  await modules
    .getByRole("group", { name: "Урок 4", exact: true })
    .getByRole("button", { name: "Выше", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Отменить изменение", exact: true })
    .click();
  const exam = page.getByRole("group", {
    name: "Вопросы и оценка",
    exact: true,
  });
  for (const kind of [
    "SINGLE",
    "MULTIPLE",
    "MATCHING",
    "ORDERING",
    "TEXT",
    "CASE",
  ])
    await authorQuestion(exam, kind, `Синтетический ${kind}`);
  await page
    .getByRole("heading", {
      name: `Синтетический автор ${unique}`,
      exact: true,
    })
    .click();
  await expect(page.locator(".lms-save-state")).toHaveText("Сохранено", {
    timeout: 30_000,
  });
  const saved = await body<Course>(
    await page.request.get(`/api/lms/courses/${created.course.id}`),
  );
  const draft = saved.versions.find(
    (version) => version.id === created.version.id,
  )!;
  expect(
    draft.content.exam.questions.map((question) => question.answerSpec?.kind),
  ).toEqual(["SINGLE", "MULTIPLE", "MATCHING", "ORDERING", "TEXT", "CASE"]);
  expect(draft.content.modules[0].lessons.map((lesson) => lesson.kind)).toEqual(
    ["TEXT", "LINK", "ASSIGNMENT", "SESSION"],
  );
  expect(draft.content.accessPolicy?.mode).toBe("UNLIMITED");
  expect(draft.content.learningOutcome).toBe("LEARNING");
  await page.reload();
  await expect(page.locator(".lms-save-state")).toHaveText("Сохранено");
  const publish = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/lms/course-versions/${created.version.id}/publish`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await body(await publish);
  await expect(
    page.getByRole("button", { name: "Создать новую версию", exact: true }),
  ).toBeVisible();
  const readback = await body<Course>(
    await page.request.get(`/api/lms/courses/${created.course.id}`),
  );
  const published = readback.versions.find(
    (version) => version.id === created.version.id,
  )!;
  expect(published.status).toBe("PUBLISHED");
  expect(published.content.modules).toEqual(draft.content.modules);
  expect(
    published.content.exam.questions.map(
      ({
        version: _version,
        libraryQuestionId: _libraryQuestionId,
        libraryRevisionId: _libraryRevisionId,
        ...question
      }) => question,
    ),
  ).toEqual(
    draft.content.exam.questions.map(
      ({
        version: _version,
        libraryQuestionId: _libraryQuestionId,
        libraryRevisionId: _libraryRevisionId,
        ...question
      }) => question,
    ),
  );
  await writeFile(
    path.join(path.dirname(fixturePath), "browser-author.json"),
    JSON.stringify(
      {
        courseId: created.course.id,
        courseVersionId: created.version.id,
        content: published.content,
      },
      null,
      2,
    ),
  );
  await mkdir(output, { recursive: true });
  const geometry = [];
  for (const language of ["RU", "KZ"]) {
    await page.getByRole("button", { name: language, exact: true }).click();
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: path.join(output, `author-${language}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      geometry.push({ language, width, pageOverflow: false });
    }
  }
  await writeFile(
    path.join(output, "UX_BROWSER_author.json"),
    JSON.stringify(
      {
        fixtureTenantId: fixture.tenantId,
        courseId: created.course.id,
        courseVersionId: created.version.id,
        status: "PASS",
        questionKinds: published.content.exam.questions.map(
          (question) => question.answerSpec?.kind,
        ),
        contentHash: createHash("sha256")
          .update(JSON.stringify(published.content))
          .digest("hex"),
        geometry,
        boundary:
          "Local synthetic prepared draft with API setup; six question types and mixed elements authored through UI, real autosave/reload/publish/readback. This is not first-entry cost, provider integration, teacher-review or learner-run evidence.",
      },
      null,
      2,
    ),
  );
});
