import {
  test,
  expect,
  type Page,
  type APIResponse,
  type Locator,
  type BrowserContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CourseContent,
  LmsQuestion,
} from "../../../packages/contracts/src/lms";
import { reviewLearningWork } from "./lms-full-review-flow";
import { isoToZonedInput } from "../../../packages/contracts/src/lms/time";

const product = path.resolve(__dirname, "../../..");
const output = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/lms-full-tz-pass-01-20261018"),
);
type User = {
  id: string;
  email: string;
  password: string;
  recipientId?: string;
};
type Fixture = {
  baseUrl: string;
  apiBase: string;
  tenantId: string;
  partnerRecipientId: string;
  users: { director: User; learner: User; teacher: User };
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
  await page.getByLabel("Электронная почта", { exact: true }).fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function answerQuestion(scope: Locator, question: LmsQuestion) {
  const spec = question.answerSpec!,
    response = spec.kind === "CASE" ? spec.response : spec;
  if (response.kind === "TEXT") {
    await scope
      .getByLabel("Ваш ответ")
      .fill(
        "Останавливаю опасную работу, сообщаю преподавателю и выбираю безопасное действие.",
      );
    return;
  }
  if (response.kind === "MATCHING") {
    for (const pair of response.pairs) {
      const label = question.options.find(
        (option) => option.id === pair.leftId,
      )!.textRu;
      await scope.getByLabel(label).selectOption(pair.rightId);
    }
    return;
  }
  if (response.kind === "ORDERING") {
    for (let target = 0; target < response.correctOrderIds.length; target++) {
      const label = question.options.find(
        (option) => option.id === response.correctOrderIds[target],
      )!.textRu;
      let labels = await scope.locator("ol li > span").allTextContents();
      while (labels.indexOf(label) > target) {
        await scope
          .getByRole("button", { name: `Выше: ${label}`, exact: true })
          .click();
        labels = await scope.locator("ol li > span").allTextContents();
      }
    }
    const confirm = scope.getByRole("button", {
      name: "Подтвердить этот порядок",
      exact: true,
    });
    if (await confirm.count()) await confirm.click();
    return;
  }
  for (const id of response.correctOptionIds) {
    const label = question.options.find((option) => option.id === id)!.textRu;
    await scope.getByLabel(label, { exact: true }).check();
  }
}

test("learner completes authored mixed programme, submits six types, teacher reviews and confirms actual attendance through UI", async ({
  browser,
}) => {
  test.setTimeout(300000);
  const fixture = JSON.parse(
    readFileSync(
      process.env.DEMO_LMS_PASS01_FIXTURE ||
        path.join(product, ".runtime/lms-pass01-20261018/browser-fixture.json"),
      "utf8",
    ),
  ) as Fixture;
  const authored = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-author.json"),
      "utf8",
    ),
  ) as { courseId: string; courseVersionId: string; content: CourseContent };
  const origin = fixture.baseUrl;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const externalRequests: string[] = [];
  async function guard(context: BrowserContext) {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (["localhost", "127.0.0.1"].includes(url.hostname))
        return route.continue();
      externalRequests.push(`${url.protocol}//${url.host}${url.pathname}`);
      return route.abort("blockedbyclient");
    });
  }
  const directorContext = await browser.newContext({ baseURL: origin }),
    learnerContext = await browser.newContext({ baseURL: origin }),
    teacherContext = await browser.newContext({ baseURL: origin });
  await Promise.all(
    [directorContext, learnerContext, teacherContext].map(guard),
  );
  const director = await directorContext.newPage(),
    learner = await learnerContext.newPage(),
    teacher = await teacherContext.newPage();
  async function review(target: Parameters<typeof reviewLearningWork>[2]) {
    const context = await browser.newContext({ baseURL: origin });
    await guard(context);
    try {
      return await reviewLearningWork(
        await context.newPage(),
        fixture.users.teacher,
        target,
      );
    } finally {
      await context.close();
    }
  }
  try {
    await login(director, fixture.users.director);
    const session = await body<{ csrfToken: string }>(
        await director.request.get("/api/auth/session"),
      ),
      headers = { origin, "x-csrf-token": session.csrfToken };
    const assignment = await body<{ groupId: string; items: { id: string }[] }>(
      await director.request.post("/api/lms/enrollments", {
        headers,
        data: {
          courseVersionId: authored.courseVersionId,
          recipientIds: [
            fixture.users.learner.recipientId,
            fixture.partnerRecipientId,
          ],
          groupName: `Синтетическая учебная группа ${randomUUID().slice(0, 6)}`,
          operationId: randomUUID(),
        },
      }),
    );
    const group = await body<{
      items: {
        id: string;
        recipient: { id: string; data: { fullNameRu: string } };
      }[];
    }>(await director.request.get(`/api/lms/groups/${assignment.groupId}`));
    const own = group.items.find(
      (item) => item.recipient.id === fixture.users.learner.recipientId,
    )!;
    const enrollmentId = own.id;
    console.log(
      JSON.stringify({
        stage: "setup",
        enrollmentId,
        groupId: assignment.groupId,
      }),
    );
    await body(
      await director.request.post("/api/lms/learning-bindings", {
        headers,
        data: {
          userId: fixture.users.teacher.id,
          role: "TEACHER",
          courseId: authored.courseId,
          groupId: assignment.groupId,
        },
      }),
    );
    await login(learner, fixture.users.learner);
    await learner.goto(`/learn/${enrollmentId}`);
    await learner.getByRole("button", { name: "RU", exact: true }).click();
    const lessons = authored.content.modules.flatMap(
        (module) => module.lessons,
      ),
      assignmentLesson = lessons.find(
        (lesson) => lesson.kind === "ASSIGNMENT",
      )!,
      sessionLesson = lessons.find((lesson) => lesson.kind === "SESSION")!;
    for (const lesson of lessons.filter((item) =>
      ["TEXT", "LINK"].includes(item.kind),
    )) {
      await learner
        .locator(".lms-outline")
        .getByRole("button", { name: new RegExp(lesson.titleRu) })
        .click();
      await learner
        .getByRole("button", { name: "Изучено, дальше", exact: true })
        .click();
    }
    await learner
      .locator(".lms-outline")
      .getByRole("button", { name: new RegExp(assignmentLesson.titleRu) })
      .click();
    const draftText =
      "Синтетическая работа: изучил требования, указал безопасные действия и проверил результат.";
    const saved = learner.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/assignments/${assignmentLesson.id}/submission`) &&
        response.request().method() === "PUT",
    );
    await learner.getByLabel("Ответ").fill(draftText);
    expect((await saved).ok()).toBe(true);
    const attachmentBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=",
      "base64",
    );
    const uploaded = learner.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/assignments/${assignmentLesson.id}/attachments`) &&
        response.request().method() === "POST",
    );
    await learner.getByLabel("Добавить файл").setInputFiles({
      name: "synthetic-work.png",
      mimeType: "image/png",
      buffer: attachmentBytes,
    });
    const attachment = await body<{ id: string; downloadUrl: string }>(
      await uploaded,
    );
    await expect(
      learner.getByRole("link", { name: "synthetic-work.png", exact: true }),
    ).toBeVisible();
    await expect(
      learner.getByText("Черновик сохранён", { exact: true }),
    ).toBeVisible();
    await learner.reload();
    await learner
      .locator(".lms-outline")
      .getByRole("button", { name: new RegExp(assignmentLesson.titleRu) })
      .click();
    await expect(learner.getByLabel("Ответ")).toHaveValue(draftText);
    await expect(
      learner.getByRole("link", { name: "synthetic-work.png", exact: true }),
    ).toBeVisible();
    const privateFile = await learner.request.get(attachment.downloadUrl);
    expect(privateFile.ok()).toBe(true);
    expect(await privateFile.body()).toEqual(attachmentBytes);
    console.log(JSON.stringify({ stage: "draft-reload", status: "PASS" }));
    const submit = learner.waitForResponse((response) =>
      response
        .url()
        .endsWith(`/assignments/${assignmentLesson.id}/submission/submit`),
    );
    await learner
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    expect((await submit).ok()).toBe(true);
    await expect(
      learner.getByText("Работа отправлена. Ожидаем преподавателя.", {
        exact: true,
      }),
    ).toBeVisible();
    const submitted = await body<{ id: string }>(
      await learner.request.get(
        `/api/lms/enrollments/${enrollmentId}/assignments/${assignmentLesson.id}/submission`,
      ),
    );
    const firstReview = await review({
      type: "SUBMISSION",
      id: submitted.id,
      learnerName: own.recipient.data.fullNameRu,
      decision: "RETURNED",
      feedback: "Добавьте проверку результата в заключение.",
    });
    await learner.reload();
    await learner
      .locator(".lms-outline")
      .getByRole("button", { name: new RegExp(assignmentLesson.titleRu) })
      .click();
    await expect(
      learner
        .getByText("Добавьте проверку результата в заключение.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await learner
      .getByLabel("Ответ")
      .fill(`${draftText} Дополнение: результат проверен по критериям.`);
    await learner
      .getByRole("button", { name: "Отправить на проверку", exact: true })
      .click();
    await expect(
      learner.getByText("Работа отправлена. Ожидаем преподавателя.", {
        exact: true,
      }),
    ).toBeVisible();
    const secondReview = await review({
      type: "SUBMISSION",
      id: submitted.id,
      learnerName: own.recipient.data.fullNameRu,
      decision: "ACCEPTED",
    });
    console.log(
      JSON.stringify({
        stage: "practice-return-revision-accept",
        status: "PASS",
      }),
    );
    await login(teacher, fixture.users.teacher);
    await teacher.goto(`/lms/groups/${assignment.groupId}`);
    await teacher
      .getByRole("button", { name: "Назначить занятие", exact: true })
      .click();
    const editor = teacher.locator("form.lms-event-editor");
    await editor
      .getByLabel("Требование программы")
      .selectOption(sessionLesson.id);
    await editor
      .getByLabel("Преподаватель")
      .selectOption(fixture.users.teacher.id);
    await editor
      .getByLabel("Часовой пояс", { exact: true })
      .fill("Asia/Qyzylorda");
    await editor
      .getByLabel("Начало занятия", { exact: true })
      .fill(isoToZonedInput(new Date(Date.now() - 7200000), "Asia/Qyzylorda"));
    await editor
      .getByLabel("Окончание занятия", { exact: true })
      .fill(isoToZonedInput(new Date(Date.now() - 3600000), "Asia/Qyzylorda"));
    const createdEvent = teacher.waitForResponse(
      (response) =>
        response.url().endsWith("/api/lms/teaching-events") &&
        response.request().method() === "POST",
    );
    await editor
      .getByRole("button", { name: "Назначить и уведомить", exact: true })
      .click();
    const event = await body<{ id: string }>(await createdEvent);
    await teacher
      .getByRole("button", { name: "Открыть занятие и участие", exact: true })
      .click();
    await teacher
      .getByLabel("Выбрать участников на этой странице", { exact: true })
      .check();
    await teacher
      .getByLabel("Основание отметки или исправления", { exact: true })
      .fill("Синтетическое подтверждение участия по учебной фикстуре");
    await teacher
      .getByRole("button", { name: /Подтвердить участие выбранных/ })
      .click();
    await expect(
      teacher.getByText("Участвовал", { exact: true }).first(),
    ).toBeVisible();
    console.log(
      JSON.stringify({ stage: "schedule-manual-attendance", status: "PASS" }),
    );
    await learner.reload();
    await learner
      .getByRole("button", { name: "Начать итоговый тест", exact: true })
      .click();
    await expect(learner.locator(".lms-question")).toHaveCount(6);
    await mkdir(output, { recursive: true });
    const questionGeometry: {
      language: string;
      width: number;
      pageOverflow: boolean;
      screenshot: string;
    }[] = [];
    for (const language of ["RU", "KZ"]) {
      await learner
        .getByRole("button", { name: language, exact: true })
        .click();
      for (const width of [360, 390, 768, 1440]) {
        await learner.setViewportSize({ width, height: 900 });
        expect(
          await learner.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
        const screenshot = `learner-six-types-${language}-${width}.png`;
        await learner.screenshot({
          path: path.join(output, screenshot),
          fullPage: true,
        });
        questionGeometry.push({
          language,
          width,
          pageOverflow: false,
          screenshot,
        });
      }
    }
    await learner.getByRole("button", { name: "RU", exact: true }).click();
    for (const question of authored.content.exam.questions) {
      const scope = learner.locator(".lms-question").filter({
        has: learner.locator("legend").filter({ hasText: question.promptRu }),
      });
      await answerQuestion(scope, question);
    }
    await expect(learner.locator(".lms-exam-top [role=status]")).toHaveText(
      "Ответы сохранены",
    );
    await learner.reload();
    await expect(learner.locator(".lms-question")).toHaveCount(6);
    await expect(learner.getByLabel("Ваш ответ")).toHaveValue(
      /Останавливаю опасную работу/,
    );
    const attemptSubmit = learner.waitForResponse((response) =>
      /\/learn\/attempts\/[^/]+\/submit$/.test(response.url()),
    );
    await learner
      .getByRole("button", { name: "Завершить попытку", exact: true })
      .click();
    const pending = await body<{ id: string; state: string }>(
      await attemptSubmit,
    );
    expect(pending.state).toBe("AWAITING_REVIEW");
    console.log(
      JSON.stringify({ stage: "six-answers-reload-submit", status: "PASS" }),
    );
    const finalReview = await review({
      type: "ATTEMPT",
      id: pending.id,
      learnerName: own.recipient.data.fullNameRu,
    });
    await learner.goto(`/learn/${enrollmentId}`);
    await expect(
      learner.getByText("Учебная программа завершена", { exact: true }),
    ).toBeVisible();
    const learning = await body<{
      learningCompletion: { id: string } | null;
      documents: unknown[];
      attempts: { id: string; state: string; result?: { verdict: string } }[];
    }>(await learner.request.get(`/api/learn/enrollments/${enrollmentId}`));
    expect(learning.learningCompletion).not.toBeNull();
    expect(learning.documents).toEqual([]);
    expect(
      learning.attempts.find((item) => item.id === pending.id)?.result?.verdict,
    ).toBe("PASSED");
    await learner.goto("/lms/calendar");
    await learner
      .getByText("Уведомления об обучении", { exact: false })
      .first()
      .click();
    await learner
      .getByRole("button", { name: "Прочитать и открыть", exact: true })
      .first()
      .click();
    await expect(learner.getByText(/Прочитано/).first()).toBeVisible();
    await learner.reload();
    await learner
      .getByText("Уведомления об обучении", { exact: false })
      .first()
      .click();
    await expect(learner.getByText(/Прочитано/).first()).toBeVisible();
    await mkdir(output, { recursive: true });
    const screenshots: string[] = [];
    for (const width of [360, 390, 768, 1440]) {
      await learner.setViewportSize({ width, height: 900 });
      await learner.getByRole("button", { name: "KZ", exact: true }).click();
      await expect(
        learner.getByRole("heading", { name: "Оқу күнтізбесі", exact: true }),
      ).toBeVisible();
      expect(
        await learner.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      const file = `learning-calendar-kz-${width}.png`;
      await learner.screenshot({
        path: path.join(output, file),
        fullPage: true,
      });
      screenshots.push(file);
    }
    await writeFile(
      path.join(output, "BROWSER_LEARNER_CHAIN.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          courseId: authored.courseId,
          courseVersionId: authored.courseVersionId,
          enrollmentId,
          groupId: assignment.groupId,
          eventId: event.id,
          attemptId: pending.id,
          questionTypes: authored.content.exam.questions.map(
            (item) => item.answerSpec?.kind,
          ),
          draftReload: true,
          returnAndResubmit: true,
          privateAttachmentUiUploadAndReload: true,
          attachmentExactBytes: true,
          reviews: [firstReview, secondReview, finalReview],
          manualAttendanceThroughUi: true,
          notificationsPersisted: true,
          learningCompletionId: learning.learningCompletion!.id,
          legalDocuments: 0,
          screenshots,
          questionGeometry,
          externalRequestsBlocked: externalRequests,
          setup: [
            "synthetic users",
            "assignment/group via API",
            "scoped teacher binding via API",
          ],
          uiActions: [
            "learner text/link acknowledgement",
            "practice draft/save/reload/submit",
            "teacher return",
            "learner revision",
            "teacher accept",
            "teacher schedule/attendance",
            "learner six answers/reload/submit",
            "teacher manual grade",
            "learner completion/calendar/read notification",
          ],
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(product, ".runtime/lms-pass01-20261018/browser-learner.json"),
      JSON.stringify(
        {
          enrollmentId,
          groupId: assignment.groupId,
          eventId: event.id,
          attemptId: pending.id,
          submissionId: submitted.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await directorContext.close();
    await learnerContext.close();
    await teacherContext.close();
  }
});
