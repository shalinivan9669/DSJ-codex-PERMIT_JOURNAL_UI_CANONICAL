import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  CourseContent,
  RegulatoryProfile,
} from "../../../packages/contracts/src/lms";
import { measureLmsActions } from "./lms-action-measurement";

type Version = {
  id: string;
  revision: number;
  status: string;
  content: CourseContent;
  profile: RegulatoryProfile;
};
type Course = { course: { id: string }; versions: Version[] };
type Attempt = {
  id: string;
  serverNow?: string;
  questions: Array<{ id: string }>;
  result: { verdict: string } | null;
};
const product = path.resolve(__dirname, "../../..");
const output = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/lms-tz-completion-20261018"),
);
const fixture = JSON.parse(
  readFileSync(
    process.env.DEMO_LMS_SCALING_FIXTURE ||
      path.join(product, ".runtime/lms-scaling/browser-fixture.json"),
    "utf8",
  ),
) as {
  fixtureVersion: string;
  courseId: string;
  courseVersionId: string;
  customerId: string;
  director: { email: string; password: string };
  people: Array<{ recipientId: string; email: string; password: string }>;
};
const records: unknown[] = [];
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json() as Promise<T>;
}
const stableAttempt = ({ serverNow: _serverNow, ...attempt }: Attempt) =>
  attempt;

test.afterEach(async ({ page }, info) => {
  void page;
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "UX_BROWSER_course-correction.json"),
    JSON.stringify(
      {
        name: info.title,
        status: info.status,
        fixtureVersion: fixture.fixtureVersion,
        records,
        boundary:
          "One prepared synthetic F2 correction chain. API setup and verification are explicit prerequisites, not measured first-entry course creation or learner UX. No real qualification or external action.",
      },
      null,
      2,
    ) + "\n",
  );
});

test("V4 F2 dependency replacement, module removal and undo, correct-answer removal and publication preserve history", async ({
  page,
  playwright,
}) => {
  test.setTimeout(180_000);
  records.length = 0;
  const origin = process.env.DEMO_ORIGIN!;
  expect(["127.0.0.1", "localhost"]).toContain(new URL(origin).hostname);
  expect(fixture.fixtureVersion).toBe("lms-tz-scaling-browser-v1");
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(fixture.director.email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(fixture.director.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const staff = await json<{ csrfToken: string }>(
    await page.request.get("/api/auth/session"),
  );
  const mutate = <T>(
    client: APIRequestContext,
    url: string,
    data: unknown,
    csrf = staff.csrfToken,
    method = "POST",
  ) =>
    client
      .fetch(url, { method, headers: { origin, "x-csrf-token": csrf }, data })
      .then(json<T>);
  const source = await json<Course>(
    await page.request.get(`/api/lms/courses/${fixture.courseId}`),
  );
  const sourceVersion = source.versions.find(
    (version) => version.id === fixture.courseVersionId,
  )!;
  expect(sourceVersion.profile.synthetic).toBe(true);
  const lesson = (id: string, title: string, dependencies: string[] = []) => ({
    ...sourceVersion.content.modules[0].lessons[0],
    id,
    titleRu: title,
    titleKz: `Синтетикалық ${id}`,
    kind: "TEXT" as const,
    textRu: "Синтетический текст для проверки редактора.",
    textKz: "Редакторды тексеруге арналған синтетикалық мәтін.",
    materialId: null,
    durationSeconds: null,
    required: true,
    prerequisiteLessonIds: dependencies,
  });
  const content: CourseContent = {
    ...sourceVersion.content,
    titleRu: `Синтетическая коррекция F2 ${randomUUID().slice(0, 8)}`,
    titleKz: "Синтетикалық F2 түзету",
    modules: [
      {
        id: "f2-base",
        titleRu: "Синтетический базовый модуль",
        titleKz: "Синтетикалық негізгі модуль",
        lessons: [
          lesson("f2-a", "Синтетическая исходная зависимость"),
          lesson("f2-b", "Синтетическая замена"),
        ],
      },
      {
        id: "f2-dependent",
        titleRu: "Синтетический зависимый модуль",
        titleKz: "Синтетикалық тәуелді модуль",
        lessons: [lesson("f2-c", "Синтетический зависимый урок", ["f2-a"])],
      },
      {
        id: "f2-remove",
        titleRu: "Синтетический удаляемый модуль",
        titleKz: "Синтетикалық жойылатын модуль",
        lessons: [lesson("f2-d", "Синтетический удаляемый урок")],
      },
    ],
    exam: {
      ...sourceVersion.content.exam,
      questionCount: 1,
      revealAnswers: true,
      questions: [
        {
          id: "f2-question",
          version: 1,
          category: "Синтетическая проверка",
          multiple: true,
          promptRu: "Синтетический вопрос F2",
          promptKz: "Синтетикалық F2 сұрағы",
          options: [
            {
              id: "f2-answer-a",
              textRu: "Синтетический правильный A",
              textKz: "Синтетикалық дұрыс A",
            },
            {
              id: "f2-answer-b",
              textRu: "Синтетический правильный B",
              textKz: "Синтетикалық дұрыс B",
            },
            {
              id: "f2-answer-c",
              textRu: "Синтетический неверный C",
              textKz: "Синтетикалық қате C",
            },
          ],
          correctOptionIds: ["f2-answer-a", "f2-answer-b"],
        },
      ],
    },
  };
  const created = await mutate<{ course: { id: string }; version: Version }>(
    page.request,
    "/api/lms/courses",
    { content, profile: sourceVersion.profile },
  );
  await mutate(
    page.request,
    `/api/lms/course-versions/${created.version.id}/publish`,
    { revision: created.version.revision },
  );
  const assigned = await mutate<{ items: Array<{ id: string }> }>(
    page.request,
    "/api/lms/enrollments",
    {
      operationId: randomUUID(),
      courseVersionId: created.version.id,
      recipientIds: [fixture.people[0].recipientId],
      customerId: fixture.customerId,
    },
  );
  const enrollmentId = assigned.items[0].id;
  const learner = await playwright.request.newContext({ baseURL: origin });
  const learnerLogin = await json<{ csrfToken: string }>(
    await learner.post("/api/auth/login", {
      headers: { origin },
      data: {
        email: fixture.people[0].email,
        password: fixture.people[0].password,
      },
    }),
  );
  let measurement: ReturnType<typeof measureLmsActions> | undefined;
  let result: Record<string, unknown> = { completed: false };
  try {
    for (const item of content.modules.flatMap((module) => module.lessons))
      await mutate(
        learner,
        `/api/learn/enrollments/${enrollmentId}/lessons/${item.id}/progress`,
        { sequence: 1, acknowledge: true },
        learnerLogin.csrfToken,
      );
    const attempt = await mutate<Attempt>(
      learner,
      `/api/learn/enrollments/${enrollmentId}/attempts`,
      {},
      learnerLogin.csrfToken,
    );
    await mutate(
      learner,
      `/api/learn/attempts/${attempt.id}/answers`,
      {
        sequence: 1,
        answers: { [attempt.questions[0].id]: ["f2-answer-a", "f2-answer-b"] },
      },
      learnerLogin.csrfToken,
      "PUT",
    );
    const finished = await mutate<Attempt>(
      learner,
      `/api/learn/attempts/${attempt.id}/submit`,
      {},
      learnerLogin.csrfToken,
    );
    expect(finished.result?.verdict).toBe("PASSED");
    const oldAttempt = stableAttempt(
      await json<Attempt>(
        await learner.get(`/api/learn/attempts/${attempt.id}`),
      ),
    );
    const courseUrl = `/api/lms/courses/${created.course.id}`;
    const oldVersion = (
      await json<Course>(await page.request.get(courseUrl))
    ).versions.find((v) => v.id === created.version.id)!;
    const draft = await mutate<Version>(
      page.request,
      `/api/lms/courses/${created.course.id}/versions`,
      {},
    );
    records.push({
      setupOnly: true,
      courseId: created.course.id,
      oldVersionId: oldVersion.id,
      draftVersionId: draft.id,
      enrollmentId,
      attemptId: attempt.id,
      prerequisites:
        "Separate synthetic course created/published via scoped APIs, four synthetic required text lessons acknowledged, genuine attempt graded PASSED, draft cloned before measured UI actions. Existing scaling course and its attempt are unchanged.",
    });
    const readDraft = async () =>
      (await json<Course>(await page.request.get(courseUrl))).versions.find(
        (v) => v.id === draft.id,
      )!;
    measurement = measureLmsActions(
      page,
      "F2 correct connected draft and publish without changing history",
      "DIRECTOR",
      "Signed in; prepared draft exists; editor not open",
      [
        "Separate synthetic course, published v1 and finished attempt are prepared via product APIs; this is correction UX, not first-entry authoring or learner UX.",
      ],
    );
    const action = measurement.action;
    await action("navigate", "Open prepared draft", () =>
      page.goto(`/lms/courses/${created.course.id}`),
    );
    const moduleByName = (name: string) =>
      page.locator("details").filter({
        has: page.locator("summary").filter({ hasText: `${name} ·` }),
      });
    const baseModule = moduleByName("Синтетический базовый модуль");
    await action("click", "Open module containing the used prerequisite", () =>
      baseModule.locator("summary").first().click(),
    );
    await action(
      "click",
      "Remove used prerequisite lesson",
      () =>
        baseModule
          .getByRole("group", { name: "Урок 1", exact: true })
          .getByRole("button", { name: "Убрать урок", exact: true })
          .click(),
      { decision: true },
    );
    const affected = page.getByRole("alert", {
      name: "Зависимые уроки",
      exact: true,
    });
    await expect(affected).toContainText("Синтетический зависимый урок");
    await expect(
      affected.getByRole("button", {
        name: "Применить и удалить",
        exact: true,
      }),
    ).toBeDisabled();
    await action(
      "select",
      "Explicitly replace the affected dependency",
      () => affected.getByRole("combobox").selectOption("f2-b"),
      { decision: true },
    );
    await action(
      "click",
      "Apply dependency replacement and deletion",
      () =>
        affected
          .getByRole("button", { name: "Применить и удалить", exact: true })
          .click(),
      { confirmation: true },
    );
    await expect(affected).toHaveCount(0);
    await measurement.exclude(async () => {
      await expect
        .poll(
          async () =>
            (await readDraft()).content.modules[1].lessons[0]
              .prerequisiteLessonIds,
          { intervals: [250, 500, 1000] },
        )
        .toEqual(["f2-b"]);
      expect(
        (await readDraft()).content.modules
          .flatMap((m) => m.lessons)
          .map((l) => l.id),
      ).not.toContain("f2-a");
    });
    const removable = moduleByName("Синтетический удаляемый модуль");
    await action("click", "Open removable module", () =>
      removable.locator("summary").first().click(),
    );
    await action(
      "click",
      "Remove module and its lesson",
      () =>
        removable
          .getByRole("button", { name: "Убрать модуль", exact: true })
          .click(),
      { decision: true },
    );
    await expect(removable).toHaveCount(0);
    await action("click", "Undo reversible module removal", () =>
      page
        .getByRole("button", { name: "Отменить изменение", exact: true })
        .click(),
    );
    await expect(removable).toBeVisible();
    await measurement.exclude(async () => {
      await expect
        .poll(
          async () => (await readDraft()).content.modules.map((m) => m.id),
          { intervals: [250, 500, 1000] },
        )
        .toContain("f2-remove");
    });
    await action("click", "Reopen restored module", () =>
      removable.locator("summary").first().click(),
    );
    await action(
      "click",
      "Apply intended module removal again",
      () =>
        removable
          .getByRole("button", { name: "Убрать модуль", exact: true })
          .click(),
      { decision: true },
    );
    const question = page.locator("details").filter({
      has: page
        .locator("summary")
        .filter({ hasText: /^1\. Синтетический вопрос F2$/ }),
    });
    await action("click", "Open question with two marked correct options", () =>
      question.locator("summary").first().click(),
    );
    await expect(
      question
        .getByRole("group", { name: "Ответ 1", exact: true })
        .getByLabel("Правильный ответ", { exact: true }),
    ).toBeChecked();
    await action(
      "click",
      "Remove a marked correct answer",
      () =>
        question
          .getByRole("group", { name: "Ответ 1", exact: true })
          .getByRole("button", { name: "Убрать ответ", exact: true })
          .click(),
      { decision: true },
    );
    await measurement.exclude(async () => {
      await expect
        .poll(
          async () =>
            (await readDraft()).content.exam.questions[0].correctOptionIds,
          { intervals: [250, 500, 1000] },
        )
        .toEqual(["f2-answer-b"]);
      const saved = await readDraft();
      expect(saved.content.modules.map((m) => m.id)).toEqual([
        "f2-base",
        "f2-dependent",
      ]);
      expect(saved.content.exam.questions[0].options.map((o) => o.id)).toEqual([
        "f2-answer-b",
        "f2-answer-c",
      ]);
    });
    await expect(
      question
        .getByRole("group", { name: "Ответ 1", exact: true })
        .getByLabel("Правильный ответ", { exact: true }),
    ).toBeChecked();
    await action(
      "click",
      "Publish corrected draft",
      () =>
        page.getByRole("button", { name: "Опубликовать", exact: true }).click(),
      { decision: true },
    );
    await expect(
      page.getByRole("button", { name: "Создать новую версию", exact: true }),
    ).toBeVisible();
    await measurement.exclude(async () => {
      const after = await json<Course>(await page.request.get(courseUrl));
      expect(after.versions.find((v) => v.id === draft.id)?.status).toBe(
        "PUBLISHED",
      );
      expect(after.versions.find((v) => v.id === oldVersion.id)).toEqual(
        oldVersion,
      );
      const afterAttempt = stableAttempt(
        await json<Attempt>(
          await learner.get(`/api/learn/attempts/${attempt.id}`),
        ),
      );
      expect(afterAttempt).toEqual(oldAttempt);
      expect(
        (
          await json<Course>(
            await page.request.get(`/api/lms/courses/${fixture.courseId}`),
          )
        ).versions.find((v) => v.id === fixture.courseVersionId),
      ).toEqual(sourceVersion);
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, "course-correction-published.png"),
        fullPage: false,
      });
      result = {
        completed: true,
        explicitDependencyReplacement: true,
        moduleRemovalAndUndo: true,
        removedAnswerNoLongerCorrect: true,
        correctedDraftPublished: true,
        publishedSnapshotUnchanged: true,
        oldAttemptAndGradeUnchanged: true,
        mainFixturePublishedVersionUnchanged: true,
        beforeVersionHash: digest(oldVersion),
        afterVersionHash: digest(
          after.versions.find((v) => v.id === oldVersion.id),
        ),
        beforeAttemptHash: digest(oldAttempt),
        afterAttemptHash: digest(afterAttempt),
        repeatedFields: 0,
      };
    });
  } finally {
    if (measurement) records.push(measurement.finish(result));
    await learner.dispose();
  }
});
