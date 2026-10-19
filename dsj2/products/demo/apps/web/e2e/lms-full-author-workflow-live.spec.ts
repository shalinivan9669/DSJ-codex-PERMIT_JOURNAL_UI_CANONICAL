import {
  test,
  expect,
  type Page,
  type APIResponse,
  type Locator,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
} from "../../../packages/contracts/src/lms";

const product = path.resolve(__dirname, "../../..");
const output = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/lms-full-tz-pass-01-20261018"),
);
type User = { id: string; email: string; password: string };
type Version = {
  id: string;
  revision: number;
  status: string;
  content: CourseContent;
  allowedActions: string[];
  review?: {
    state: string;
    revision: number;
    contentHash: string;
    feedback?: string;
  } | null;
};
type Course = { course: { id: string }; versions: Version[] };
type Material = {
  id: string;
  revision: number;
  familyId: string;
  supersedesMaterialId?: string;
};
async function body<T>(
  response: Pick<APIResponse, "ok" | "status" | "text" | "json">,
): Promise<T> {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json() as Promise<T>;
}
async function login(page: Page, user: User) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль").fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function expand(details: Locator) {
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator(":scope > summary").click();
}
async function version(page: Page, courseId: string) {
  const result = await body<Course>(
    await page.request.get(`/api/lms/courses/${courseId}`),
  );
  return result.versions[0]!;
}
async function library(page: Page, courseId: string) {
  await page.goto(`/lms/courses/${courseId}`);
  const modules = page.getByRole("group", {
    name: "Модули и уроки",
    exact: true,
  });
  await expand(modules.locator(":scope > details").first());
  const found = modules.locator(".lms-material-library").first();
  await expand(found);
  return found;
}
async function reviewAction(
  page: Page,
  name: string,
  action: string,
  id: string,
) {
  const response = page.waitForResponse(
    (value) =>
      value.request().method() === "POST" &&
      value.url().endsWith(`/course-versions/${id}/review`) &&
      value.request().postDataJSON().action === action,
  );
  await page.getByRole("button", { name, exact: true }).click();
  await body(await response);
}

test("scoped roles, material reuse and immutable replacement, methodist-expert review and revoke through UI", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const origin = process.env.DEMO_ORIGIN!;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const fixture = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-fixture.json"),
      "utf8",
    ),
  ) as {
    baseUrl: string;
    users: { director: User; methodist: User; expert: User };
  };
  expect(fixture.baseUrl).toBe(origin);
  const authored = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-author.json"),
      "utf8",
    ),
  ) as { content: CourseContent };
  const token = randomUUID().slice(0, 8);
  const observations: Record<string, unknown> = {
    synthetic: true,
    setup:
      "Two course drafts prepared through authenticated local API; all material/role/review transitions below use actual UI.",
    observations: [],
  };
  const checks = observations.observations as string[];
  await mkdir(output, { recursive: true });
  const methodistContext = await browser.newContext({ baseURL: origin });
  const expertContext = await browser.newContext({ baseURL: origin });
  const methodist = await methodistContext.newPage();
  const expert = await expertContext.newPage();
  try {
    await login(page, fixture.users.director);
    const session = await body<{ csrfToken: string }>(
      await page.request.get("/api/auth/session"),
    );
    async function createCourse(suffix: string) {
      const content = courseContentSchema.parse({
        ...authored.content,
        titleRu: `Синтетический workflow ${token} ${suffix}`,
        titleKz: `Синтетикалық workflow ${token} ${suffix}`,
        modules: [
          {
            id: randomUUID(),
            titleRu: "Материалы",
            titleKz: "Материалдар",
            lessons: [
              {
                id: randomUUID(),
                titleRu: "Файл программы",
                titleKz: "Бағдарлама файлы",
                kind: "FILE",
                required: true,
              },
            ],
          },
        ],
        exam: {
          ...authored.content.exam,
          questions: [
            authored.content.exam.questions.find(
              (question) => question.answerSpec?.kind === "SINGLE",
            )!,
          ],
          questionCount: 1,
        },
      });
      const profile = regulatoryProfileSchema.parse({
        title: "Синтетический локальный workflow",
        category: content.category,
        synthetic: true,
        assessmentKind: "CENTER_EXAM",
        status: "CONFIRMED",
        examiner: "Синтетический преподаватель",
        issuer: "Синтетический центр",
        reviewReference: "Local synthetic workflow; not a qualification",
        requiresApproval: false,
        requiresEmployeeSignature: false,
      });
      return body<{ course: { id: string }; version: Version }>(
        await page.request.post("/api/lms/courses", {
          headers: { origin, "x-csrf-token": session.csrfToken },
          data: { content, profile },
        }),
      );
    }
    const source = await createCourse("source");
    const target = await createCourse("target");
    observations.courseIds = [source.course.id, target.course.id];
    const originalName = `synthetic-shared-${token}.png`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0H0AAAAASUVORK5CYII=",
      "base64",
    );
    const sourceLibrary = await library(page, source.course.id);
    const upload = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/courses/${source.course.id}/materials`),
    );
    await sourceLibrary.getByLabel("Загрузить файл").setInputFiles({
      name: originalName,
      mimeType: "image/png",
      buffer: png,
    });
    const original = await body<Material>(await upload);
    await expect
      .poll(
        async () =>
          (await version(page, source.course.id)).content.modules[0]!
            .lessons[0]!.materialId,
      )
      .toBe(original.id);
    checks.push("Source material uploaded through UI and autosaved to lesson.");
    const targetLibrary = await library(page, target.course.id);
    await targetLibrary
      .getByLabel("Найти в библиотеке центра")
      .fill(originalName);
    const materialRow = targetLibrary
      .locator("li")
      .filter({ hasText: originalName });
    const bind = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/materials/${original.id}/bind`),
    );
    await materialRow
      .getByRole("button", { name: "Использовать", exact: true })
      .click();
    await body(await bind);
    await expect
      .poll(
        async () =>
          (await version(page, target.course.id)).content.modules[0]!
            .lessons[0]!.materialId,
      )
      .toBe(original.id);
    await materialRow
      .getByRole("button", { name: "Скрыть из выбора", exact: true })
      .click();
    await expect(
      materialRow.getByRole("button", { name: "Показать", exact: true }),
    ).toBeVisible();
    await expect(
      materialRow.getByRole("button", { name: "Выбран", exact: true }),
    ).toHaveCount(0);
    await materialRow
      .getByRole("button", { name: "Показать", exact: true })
      .click();
    await expect(
      materialRow.getByRole("button", { name: "Выбран", exact: true }),
    ).toBeVisible();
    checks.push(
      "Same material explicitly bound to second course; hide/show changes choice availability through UI.",
    );
    const replacementUpload = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/courses/${target.course.id}/materials`),
    );
    await targetLibrary
      .getByLabel("Загрузить новую редакцию файла")
      .setInputFiles({
        name: `synthetic-new-${token}.png`,
        mimeType: "image/png",
        buffer: png,
      });
    const replacement = await body<Material>(await replacementUpload);
    expect(replacement.id).not.toBe(original.id);
    const materialVersions = await body<{ items: Material[] }>(
      await page.request.get(
        `/api/lms/material-library?courseId=${target.course.id}&search=${encodeURIComponent(`synthetic-new-${token}.png`)}&page=1&pageSize=25`,
      ),
    );
    expect(
      materialVersions.items.find((item) => item.id === replacement.id)
        ?.supersedesMaterialId,
    ).toBe(original.id);
    await expect
      .poll(
        async () =>
          (await version(page, target.course.id)).content.modules[0]!
            .lessons[0]!.materialId,
      )
      .toBe(replacement.id);
    expect(
      (await version(page, source.course.id)).content.modules[0]!.lessons[0]!
        .materialId,
    ).toBe(original.id);
    checks.push(
      "UI replacement creates separate revision; other course retains original material ID.",
    );
    await page.goto("/lms/learning-roles");
    const grantForm = page.locator("form").filter({
      has: page.getByRole("heading", {
        name: "Назначить учебную роль",
        exact: true,
      }),
    });
    async function grant(user: User, role: "METHODIST" | "EXPERT") {
      await grantForm
        .getByRole("searchbox", { name: "Поиск пользователя", exact: true })
        .fill(user.email);
      await grantForm
        .getByRole("searchbox", { name: "Поиск курса", exact: true })
        .fill(`workflow ${token} target`);
      const userSelect = grantForm
        .getByLabel(/^Пользователь/)
        .filter({ has: page.locator("option") });
      await expect(
        grantForm.locator(`select option[value="${user.id}"]`),
      ).toHaveCount(1);
      await userSelect.selectOption(user.id);
      await grantForm
        .getByLabel(/^Роль/)
        .filter({ has: page.locator("option") })
        .selectOption(role);
      await expect(
        grantForm.locator(`select option[value="${target.course.id}"]`),
      ).toHaveCount(1);
      await grantForm
        .getByLabel(/^Курс/)
        .filter({ has: page.locator("option") })
        .selectOption(target.course.id);
      const response = page.waitForResponse(
        (value) =>
          value.request().method() === "POST" &&
          value.url().endsWith("/lms/learning-bindings"),
      );
      await grantForm
        .getByRole("button", { name: "Назначить роль", exact: true })
        .click();
      const binding = await body<{ id: string }>(await response);
      await expect(
        grantForm.getByRole("button", { name: "Назначить роль", exact: true }),
      ).toBeEnabled();
      return binding.id;
    }
    const methodistBinding = await grant(fixture.users.methodist, "METHODIST");
    await grant(fixture.users.expert, "EXPERT");
    checks.push(
      "Director grants METHODIST and EXPERT through independent user/course search and UI selectors.",
    );
    await login(methodist, fixture.users.methodist);
    await methodist.goto(`/lms/courses/${target.course.id}`);
    await expect(
      methodist.getByRole("button", { name: "Опубликовать", exact: true }),
    ).toHaveCount(0);
    await methodist
      .getByLabel("Название RU")
      .fill(`Синтетический workflow ${token} исправлен`);
    const modules = methodist.getByRole("group", {
      name: "Модули и уроки",
      exact: true,
    });
    await modules
      .getByRole("button", { name: "Добавить урок", exact: true })
      .click();
    const intermediate = modules.getByRole("group", {
      name: "Урок 2",
      exact: true,
    });
    await intermediate
      .getByLabel("Урок RU")
      .fill("Синтетическая промежуточная проверка");
    await intermediate
      .getByLabel("Урок KZ")
      .fill("Синтетикалық аралық тексеру");
    await intermediate.getByLabel("Тип элемента").selectOption("ASSESSMENT");
    await intermediate
      .getByLabel("Текст RU")
      .fill("Проверьте усвоение материала.");
    await intermediate
      .getByLabel("Текст KZ")
      .fill("Материалды меңгеруді тексеріңіз.");
    await intermediate
      .getByRole("button", { name: "Добавить вопрос", exact: true })
      .click();
    const question = intermediate
      .locator(".lms-assessment-author > details")
      .last();
    await expand(question);
    await question
      .getByLabel("Вопрос RU")
      .fill("Синтетический промежуточный вопрос");
    await question.getByLabel("Вопрос KZ").fill("Синтетикалық аралық сұрақ");
    await question.getByLabel("Категория").fill("Синтетическая проверка");
    for (let number = 1; number <= 2; number++) {
      const option = question.getByRole("group", {
        name: `Вариант ${number}`,
        exact: true,
      });
      await option.getByLabel("RU").fill(`Ответ ${number}`);
      await option.getByLabel("KZ").fill(`Жауап ${number}`);
    }
    await expect(
      methodist.getByText("Сохранено", { exact: true }),
    ).toBeVisible();
    await reviewAction(
      methodist,
      "Отправить на проверку",
      "SUBMIT",
      target.version.id,
    );
    await expect(
      methodist.getByText("Согласование: На проверке", { exact: true }),
    ).toBeVisible();
    const submitted = await version(page, target.course.id);
    expect(submitted.review?.state).toBe("PENDING");
    await login(expert, fixture.users.expert);
    await expert.goto(`/lms/courses/${target.course.id}`);
    await expect(expert.getByLabel("Название RU")).toBeDisabled();
    await expert
      .getByLabel("Комментарий к решению")
      .fill("Синтетическая проверка: уточните цель программы.");
    await reviewAction(
      expert,
      "Вернуть на доработку",
      "RETURN",
      target.version.id,
    );
    await methodist.reload();
    await expect(
      methodist.getByText("Синтетическая проверка: уточните цель программы.", {
        exact: true,
      }),
    ).toBeVisible();
    await methodist
      .getByText("Цели, аудитория и параметры программы", { exact: true })
      .click();
    await methodist
      .getByLabel("Цель RU")
      .fill("Синтетическая цель после обратной связи эксперта.");
    await expect(
      methodist.getByText("Сохранено", { exact: true }),
    ).toBeVisible();
    await reviewAction(
      methodist,
      "Отправить на проверку",
      "SUBMIT",
      target.version.id,
    );
    await expert.reload();
    await reviewAction(
      expert,
      "Одобрить редакцию",
      "APPROVE",
      target.version.id,
    );
    const approved = await version(page, target.course.id);
    expect(approved.review?.state).toBe("APPROVED");
    expect(approved.review?.contentHash).not.toBe(
      submitted.review?.contentHash,
    );
    const publishing = expert.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/course-versions/${target.version.id}/publish`),
    );
    await expert
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await body(await publishing);
    const published = await version(page, target.course.id);
    expect(published.status).toBe("PUBLISHED");
    expect(
      published.content.modules[0]!.lessons[1]!.assessment?.questions,
    ).toHaveLength(1);
    checks.push(
      "METHODIST authors an actual ASSESSMENT element and question through UI; persisted and published with final assessment independently.",
    );
    await writeFile(
      path.join(
        product,
        ".runtime/lms-pass01-20261018/browser-author-workflow.json",
      ),
      JSON.stringify(
        {
          courseId: target.course.id,
          courseVersionId: published.id,
          content: published.content,
        },
        null,
        2,
      ),
      "utf8",
    );
    expect(published.review?.contentHash).toBe(approved.review?.contentHash);
    checks.push(
      "METHODIST edit→submit; EXPERT read-only return; METHODIST revision→resubmit; EXPERT approve→publish exact approved content hash.",
    );
    await expert.screenshot({
      path: path.join(output, "expert-published-RU.png"),
      fullPage: true,
    });
    await expert.getByRole("button", { name: "KZ", exact: true }).click();
    await expect(
      expert.getByText("Келісу: Ағымдағы редакция мақұлданған", {
        exact: true,
      }),
    ).toBeVisible();
    await expert.screenshot({
      path: path.join(output, "expert-published-KZ.png"),
      fullPage: true,
    });
    await page.reload();
    const bindings = await body<{
      items: { id: string; user: { displayName: string } }[];
    }>(
      await page.request.get(
        `/api/lms/learning-bindings?courseId=${target.course.id}&page=1&pageSize=25`,
      ),
    );
    const methodistName = bindings.items.find(
      (binding) => binding.id === methodistBinding,
    )!.user.displayName;
    const row = page
      .locator("section li")
      .filter({ hasText: methodistName })
      .filter({ hasText: `workflow ${token}` });
    await row.getByRole("button", { name: "Отозвать", exact: true }).click();
    await page
      .getByLabel("Причина отзыва")
      .fill("Завершена синтетическая локальная проверка области доступа.");
    const revoke = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/learning-bindings/${methodistBinding}/revoke`),
    );
    await page
      .getByRole("button", { name: "Отозвать назначение", exact: true })
      .click();
    await body(await revoke);
    await methodist.reload();
    await expect(methodist.getByLabel("Название RU")).toHaveCount(0);
    expect([403, 404]).toContain(
      (
        await methodist.request.get(`/api/lms/courses/${target.course.id}`)
      ).status(),
    );
    checks.push(
      "Grant revoked through UI; methodist cannot reopen or read former course. Publication retained.",
    );
    observations.result = "PASS";
  } finally {
    await writeFile(
      path.join(output, "UX_BROWSER_author_workflow.json"),
      JSON.stringify(observations, null, 2),
      "utf8",
    );
    await methodistContext.close();
    await expertContext.close();
  }
});
