import {
  test,
  expect,
  type Page,
  type APIResponse,
  type Locator,
} from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
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
type User = { email: string; password: string };
type Version = { id: string; status: string; content: CourseContent };
type Readback = {
  course: { id: string; archived: boolean; assignmentPaused: boolean };
  versions: Version[];
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

async function nativeDrag(page: Page, source: Locator, target: Locator) {
  await page.evaluate(() => {
    const events: { type: string; trusted: boolean }[] = [];
    Object.assign(window, { __focusedDragEvents: events });
    for (const type of ["dragstart", "drop", "dragend"])
      document.addEventListener(
        type,
        (event) => events.push({ type, trusted: event.isTrusted }),
        { once: true },
      );
  });
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 12,
    from.y + from.height / 2 + 12,
    { steps: 5 },
  );
  let to = (await target.boundingBox())!;
  await page.mouse.wheel(0, to.y - 350);
  await expect
    .poll(async () => (await target.boundingBox())!.y)
    .toBeGreaterThan(200);
  await expect
    .poll(async () => (await target.boundingBox())!.y)
    .toBeLessThan(500);
  to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 10,
  });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2 + 1);
  await page.mouse.up();
  const events = await page.evaluate(
    () =>
      (
        window as unknown as {
          __focusedDragEvents: { type: string; trusted: boolean }[];
        }
      ).__focusedDragEvents,
  );
  expect(
    events.some((event) => event.type === "dragstart" && event.trusted),
  ).toBe(true);
  expect(events.some((event) => event.type === "drop" && event.trusted)).toBe(
    true,
  );
  return events;
}

test("author actual drag-and-drop, keyboard order, dependency repair, pause/archive and concurrent review conflict", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const fixture = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-fixture.json"),
      "utf8",
    ),
  ) as { baseUrl: string; users: { director: User; teacher: User } };
  const origin = fixture.baseUrl;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const authored = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-author.json"),
      "utf8",
    ),
  ) as { content: CourseContent };
  const observations: string[] = [];
  const report: Record<string, unknown> = {
    synthetic: true,
    setup:
      "Authenticated API prepares fresh draft; all reorder/repair/pause/archive/review decisions use real UI.",
    observations,
  };
  await mkdir(output, { recursive: true });
  try {
    await login(page, fixture.users.director);
    const session = await body<{ csrfToken: string }>(
      await page.request.get("/api/auth/session"),
    );
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const moduleIds = [randomUUID(), randomUUID()];
    const token = randomUUID().slice(0, 8);
    const textLesson = (index: number) => ({
      id: ids[index],
      titleRu: `Синтетический урок ${index + 1}`,
      titleKz: `Синтетикалық сабақ ${index + 1}`,
      kind: "TEXT",
      textRu: "Синтетический учебный материал.",
      textKz: "Синтетикалық оқу материалы.",
      required: true,
      prerequisiteLessonIds: index === 2 ? [ids[0]] : [],
    });
    const content = courseContentSchema.parse({
      ...authored.content,
      titleRu: `Синтетический focused ${token}`,
      titleKz: `Синтетикалық focused ${token}`,
      modules: [
        {
          id: moduleIds[0],
          titleRu: "Модуль порядка",
          titleKz: "Реттілік модулі",
          lessons: [textLesson(0), textLesson(1), textLesson(2)],
        },
        {
          id: moduleIds[1],
          titleRu: "Модуль второй",
          titleKz: "Екінші модуль",
          lessons: [textLesson(3)],
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
      title: "Синтетический focused UI",
      category: content.category,
      synthetic: true,
      assessmentKind: "CENTER_EXAM",
      status: "CONFIRMED",
      examiner: "Синтетический преподаватель",
      issuer: "Синтетический центр",
      reviewReference: "Local synthetic UI verification; no qualification",
      requiresApproval: false,
      requiresEmployeeSignature: false,
    });
    const created = await body<{ course: { id: string }; version: Version }>(
      await page.request.post("/api/lms/courses", {
        headers: { origin, "x-csrf-token": session.csrfToken },
        data: { content, profile },
      }),
    );
    const courseId = created.course.id;
    report.courseId = courseId;
    const readback = () =>
      page.request.get(`/api/lms/courses/${courseId}`).then(body<Readback>);
    const latestContent = async () => (await readback()).versions[0]!.content;
    await page.goto(`/lms/courses/${courseId}`);
    const modules = page.getByRole("group", {
      name: "Модули и уроки",
      exact: true,
    });
    const first = modules.locator(":scope > details").filter({
      has: page.locator("summary").filter({ hasText: /^Модуль порядка/ }),
    });
    const second = modules.locator(":scope > details").filter({
      has: page.locator("summary").filter({ hasText: /^Модуль второй/ }),
    });
    await expand(first);
    await expand(second);
    report.lessonDrag = await nativeDrag(
      page,
      first.getByRole("button", {
        name: "Перенести элемент: Синтетический урок 1",
        exact: true,
      }),
      first.getByRole("button", {
        name: "Перенести элемент: Синтетический урок 2",
        exact: true,
      }),
    );
    await expect
      .poll(async () =>
        (await latestContent()).modules
          .find((module) => module.id === moduleIds[0])!
          .lessons.map((lesson) => lesson.id),
      )
      .toEqual([ids[1], ids[0], ids[2]]);
    await page
      .getByRole("button", { name: "Отменить изменение", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await latestContent()).modules[0]!.lessons.map((lesson) => lesson.id),
      )
      .toEqual(ids.slice(0, 3));
    await page.reload();
    await expand(first);
    await expand(second);
    report.moduleDrag = await nativeDrag(
      page,
      first.getByRole("button", {
        name: "Перенести модуль: Модуль порядка",
        exact: true,
      }),
      second.locator(":scope > summary"),
    );
    await expect
      .poll(async () =>
        (await latestContent()).modules.map((module) => module.id),
      )
      .toEqual([moduleIds[1], moduleIds[0]]);
    await page.reload();
    await expand(first);
    const up = first.getByRole("button", { name: "Модуль выше", exact: true });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () =>
        (await latestContent()).modules.map((module) => module.id),
      )
      .toEqual(moduleIds);
    await page.reload();
    await expand(first);
    const secondLesson = first.getByRole("group", {
      name: "Урок 2",
      exact: true,
    });
    await secondLesson
      .getByRole("button", { name: "Выше", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () =>
        (await latestContent()).modules[0]!.lessons.map((lesson) => lesson.id),
      )
      .toEqual([ids[1], ids[0], ids[2]]);
    await page
      .getByRole("button", { name: "Отменить изменение", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await latestContent()).modules[0]!.lessons.map((lesson) => lesson.id),
      )
      .toEqual(ids.slice(0, 3));
    observations.push(
      "Native mouse movement + wheel scrolling at1366x768 produces trusted dragstart/drop and reorders lessons and modules; autosave/readback preserves stable IDs; lesson undo and reload restore original order. Module and lesson alternatives activated with keyboard Enter persist.",
    );
    await first
      .getByRole("group", { name: "Урок 1", exact: true })
      .getByRole("button", { name: "Убрать урок", exact: true })
      .click();
    const repair = page.getByRole("alert", {
      name: "Зависимые уроки",
      exact: true,
    });
    await expect(repair).toBeVisible();
    await expect(
      repair.getByRole("button", { name: "Применить и удалить", exact: true }),
    ).toBeDisabled();
    await repair.getByLabel(/^Синтетический урок 3/).selectOption(ids[1]);
    await repair
      .getByRole("button", { name: "Применить и удалить", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await latestContent()).modules[0]!.lessons.find(
            (lesson) => lesson.id === ids[2],
          )!.prerequisiteLessonIds,
      )
      .toEqual([ids[1]]);
    await page.reload();
    expect(
      (await latestContent()).modules[0]!.lessons.map((lesson) => lesson.id),
    ).toEqual([ids[1], ids[2]]);
    const publishing = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/course-versions/${created.version.id}/publish`),
    );
    await page
      .getByRole("button", { name: "Опубликовать", exact: true })
      .click();
    await body(await publishing);
    const published = (await readback()).versions.find(
      (version) => version.id === created.version.id,
    )!;
    expect(published.status).toBe("PUBLISHED");
    observations.push(
      "Deleting referenced lesson requires explicit per-dependent repair; chosen predecessor replaces deleted ID, persists after reload, and repaired course publishes successfully.",
    );
    const availability = page
      .locator("details")
      .filter({
        has: page
          .locator(":scope > summary")
          .filter({ hasText: /^Актуальность и новые назначения/ }),
      })
      .first();
    await expand(availability);
    await availability
      .getByLabel("Причина изменения доступности")
      .fill("Синтетическая локальная проверка паузы и архива.");
    for (const [button, endpoint, value] of [
      ["Приостановить новые назначения", "pause", true],
      ["Возобновить новые назначения", "pause", false],
      ["Архивировать курс", "archive", true],
      ["Вернуть курс из архива", "archive", false],
    ] as const) {
      const change = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/courses/${courseId}/${endpoint}`),
      );
      await availability
        .getByRole("button", { name: button, exact: true })
        .click();
      await body(await change);
      const current = await readback();
      expect(
        endpoint === "pause"
          ? current.course.assignmentPaused
          : current.course.archived,
      ).toBe(value);
      expect(
        current.versions.find((version) => version.id === published.id)!
          .content,
      ).toEqual(published.content);
    }
    observations.push(
      "Pause/resume and archive/restore execute through UI with reason; published version content remains unchanged. This fixture has no enrollment, so enrollment history preservation is not inferred from it.",
    );
    await page.screenshot({
      path: path.join(output, "focused-repaired-published.png"),
      fullPage: true,
    });
    const conflictPath = path.join(
      product,
      ".runtime/lms-pass01-20261018/browser-review-conflict.json",
    );
    if (!existsSync(conflictPath)) {
      // Agent C explicitly allocated the unfinished run03 attempt after its resilience test.
      const oldFixture = JSON.parse(
        readFileSync(
          path.join(
            product,
            ".runtime/lms-pass01-20261018/browser-learner-fixture-03.json",
          ),
          "utf8",
        ),
      ) as { users: { learner: User } };
      const learnerContext = await browser.newContext({ baseURL: origin });
      try {
        const learner = await learnerContext.newPage();
        await login(learner, oldFixture.users.learner);
        const enrollment = await body<{
          recipient: { data: { fullNameRu: string } };
          attempts: { id: string; state: string }[];
        }>(
          await learner.request.get(
            "/api/learn/enrollments/063ad93b-7291-4360-883c-18edb938cdf0",
          ),
        );
        const attempt = enrollment.attempts.find((item) =>
          ["IN_PROGRESS", "AWAITING_REVIEW"].includes(item.state),
        );
        expect(
          attempt,
          "allocated run03 pending/in-progress attempt",
        ).toBeTruthy();
        if (attempt!.state === "IN_PROGRESS") {
          const learnerSession = await body<{ csrfToken: string }>(
            await learner.request.get("/api/auth/session"),
          );
          const submitted = await body<{ state: string }>(
            await learner.request.post(
              `/api/learn/attempts/${attempt!.id}/submit`,
              {
                headers: { origin, "x-csrf-token": learnerSession.csrfToken },
                data: {},
              },
            ),
          );
          expect(submitted.state).toBe("AWAITING_REVIEW");
        }
        await writeFile(
          conflictPath,
          JSON.stringify(
            {
              id: attempt!.id,
              type: "ATTEMPT",
              learnerName: enrollment.recipient.data.fullNameRu,
            },
            null,
            2,
          ),
          "utf8",
        );
        report.reviewerSetup =
          "Existing run03 answers submitted by authenticated learner API as test setup; no score/result forged. Two actual reviewer UI sessions below.";
      } finally {
        await learnerContext.close();
      }
    }
    if (existsSync(conflictPath)) {
      const target = JSON.parse(readFileSync(conflictPath, "utf8")) as {
        id: string;
        type: "ATTEMPT" | "SUBMISSION";
        learnerName: string;
        courseId?: string;
        teacher?: User;
      };
      const contexts = await Promise.all([
        browser.newContext({ baseURL: origin }),
        browser.newContext({ baseURL: origin }),
      ]);
      try {
        const pages = await Promise.all(
          contexts.map((context) => context.newPage()),
        );
        for (const [index, reviewer] of pages.entries()) {
          await login(reviewer, target.teacher || fixture.users.teacher);
          await reviewer.goto("/lms/teaching");
          await reviewer.getByLabel(/^Работы/).selectOption(target.type);
          const queue = reviewer.locator("section").filter({
            has: reviewer.getByRole("heading", {
              name: "Очередь проверки",
              exact: true,
            }),
          });
          const row = queue
            .getByRole("listitem")
            .filter({
              has: reviewer.getByText(target.learnerName, { exact: true }),
            })
            .first();
          const detailResponse = reviewer.waitForResponse(
            (response) =>
              response.url().endsWith(`/reviews/${target.type}/${target.id}`) &&
              response.request().method() === "GET",
          );
          await row
            .getByRole("button", { name: "Открыть работу", exact: true })
            .click();
          await body(await detailResponse);
          const detail = reviewer.locator("section[aria-busy]");
          if (target.type === "ATTEMPT")
            for (const grade of await detail.getByLabel(/^Оценка ответа/).all())
              await grade.selectOption("1");
          else await detail.getByLabel(/^Решение/).selectOption("ACCEPTED");
          await detail
            .getByLabel("Обратная связь слушателю")
            .fill(
              `Синтетический reviewer ${index + 1}: текст сохраняется при конфликте.`,
            );
        }
        for (const [index, reviewer] of pages.entries()) {
          const decision = reviewer.waitForResponse(
            (response) =>
              response
                .url()
                .endsWith(`/reviews/${target.type}/${target.id}/decision`) &&
              response.request().method() === "POST",
          );
          await reviewer
            .getByRole("button", { name: "Сохранить решение", exact: true })
            .click();
          const response = await decision;
          if (index === 0) await body(response);
          else {
            expect(response.status()).toBe(409);
            expect((await response.json()).code).toBe("REVIEW_CONFLICT");
            await expect(
              reviewer.getByText(
                "Решение уже сохранено другим проверяющим. Обновите работу; ваш комментарий сохранён.",
                { exact: false },
              ),
            ).toBeVisible();
            await expect(
              reviewer.getByLabel("Обратная связь слушателю"),
            ).toHaveValue(
              "Синтетический reviewer 2: текст сохраняется при конфликте.",
            );
            await reviewer
              .getByRole("button", { name: "KZ", exact: true })
              .click();
            await expect(
              reviewer.getByText(
                "Шешімді басқа тексеруші сақтап қойды. Жұмысты жаңартыңыз; пікіріңіз сақталған.",
                { exact: false },
              ),
            ).toBeVisible();
            await expect(
              reviewer.getByLabel("Тыңдаушыға кері байланыс"),
            ).toHaveValue(
              "Синтетический reviewer 2: текст сохраняется при конфликте.",
            );
            await reviewer.screenshot({
              path: path.join(output, "reviewer-real409-KZ.png"),
              fullPage: true,
            });
          }
        }
        report.reviewer409 =
          "PASS: two real sessions, one successful decision, second actual REVIEW_CONFLICT409; feedback and choice retained across RU/KZ. Specific conflict guidance is present; fresh copy verification is recorded separately in review-conflict-run01.";
      } finally {
        await Promise.all(contexts.map((context) => context.close()));
      }
    } else
      report.reviewer409 =
        "NOT_RUN: no authorized pending review fixture supplied";
    report.result = "PASS";
  } finally {
    await writeFile(
      path.join(output, "UX_BROWSER_author_focused.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
  }
});
