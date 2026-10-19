import { test, expect, type APIResponse, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CourseContent } from "../../../packages/contracts/src/lms";

const product = path.resolve(__dirname, "../../..");
async function body<T>(
  response: Pick<APIResponse, "ok" | "status" | "text" | "json">,
): Promise<T> {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль").fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("learner passes separately authored intermediate assessment without creating an official result or completing final", async ({
  browser,
}) => {
  const fixture = JSON.parse(
    readFileSync(process.env.DEMO_LMS_PASS01_FIXTURE!, "utf8"),
  ) as {
    baseUrl: string;
    users: {
      director: { email: string; password: string };
      learner: { email: string; password: string; recipientId: string };
    };
  };
  const authored = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/lms-pass01-20261018/browser-author-workflow.json",
      ),
      "utf8",
    ),
  ) as { courseId: string; courseVersionId: string; content: CourseContent };
  expect(["localhost", "127.0.0.1"]).toContain(
    new URL(fixture.baseUrl).hostname,
  );
  const staff = await browser.newContext({ baseURL: fixture.baseUrl }),
    student = await browser.newContext({ baseURL: fixture.baseUrl });
  for (const context of [staff, student])
    await context.route("**/*", (route) =>
      ["localhost", "127.0.0.1"].includes(
        new URL(route.request().url()).hostname,
      )
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
  try {
    const director = await staff.newPage(),
      learner = await student.newPage();
    await login(director, fixture.users.director);
    const session = await body<{ csrfToken: string }>(
      await director.request.get("/api/auth/session"),
    );
    const assigned = await body<{ items: { id: string }[] }>(
      await director.request.post("/api/lms/enrollments", {
        headers: { origin: fixture.baseUrl, "x-csrf-token": session.csrfToken },
        data: {
          courseVersionId: authored.courseVersionId,
          recipientIds: [fixture.users.learner.recipientId],
          operationId: randomUUID(),
        },
      }),
    );
    const enrollmentId = assigned.items[0].id;
    await login(learner, fixture.users.learner);
    await learner.goto(`/learn/${enrollmentId}`);
    await learner.getByRole("button", { name: "RU", exact: true }).click();
    const lessons = authored.content.modules.flatMap(
      (module) => module.lessons,
    );
    for (const lesson of lessons.filter((item) =>
      ["FILE", "TEXT", "LINK", "PDF"].includes(item.kind),
    )) {
      await learner
        .locator(".lms-outline")
        .getByRole("button", { name: new RegExp(lesson.titleRu) })
        .click();
      const complete = learner.getByRole("button", {
        name: "Изучено, дальше",
        exact: true,
      });
      if (await complete.isVisible()) await complete.click();
    }
    const lesson = lessons.find((item) => item.kind === "ASSESSMENT")!;
    await learner
      .locator(".lms-outline")
      .getByRole("button", { name: new RegExp(lesson.titleRu) })
      .click();
    await expect(
      learner.getByRole("button", {
        name: "Начать итоговый тест",
        exact: true,
      }),
    ).toBeDisabled();
    await learner
      .getByRole("button", { name: "Начать тест", exact: true })
      .click();
    const questions = lesson.assessment!.questions;
    await expect(learner.locator(".lms-question")).toHaveCount(
      questions.length,
    );
    for (const question of questions) {
      const spec = question.answerSpec!;
      expect(spec.kind).toBe("SINGLE");
      if (spec.kind !== "SINGLE") throw new Error("EXPECTED_AUTHORED_SINGLE");
      const option = question.options.find(
        (item) => item.id === spec.correctOptionIds[0],
      )!;
      await learner
        .locator(".lms-question")
        .filter({
          has: learner.locator("legend").filter({ hasText: question.promptRu }),
        })
        .getByLabel(option.textRu, { exact: true })
        .check();
    }
    const submitted = learner.waitForResponse((response) =>
      /\/learn\/attempts\/[^/]+\/submit$/.test(response.url()),
    );
    await learner
      .getByRole("button", { name: "Завершить попытку", exact: true })
      .click();
    const result = await body<{
      id: string;
      purpose: string;
      result: { verdict: string; eligible: boolean };
    }>(await submitted);
    expect(result.purpose).toBe("INTERMEDIATE");
    expect(result.result.verdict).toBe("PASSED");
    expect(result.result.eligible).toBe(false);
    await expect(
      learner.getByText("Промежуточная проверка", { exact: true }),
    ).toBeVisible();
    await learner
      .getByRole("button", { name: "Вернуться к курсу", exact: true })
      .click();
    await expect(
      learner.getByRole("button", {
        name: "Начать итоговый тест",
        exact: true,
      }),
    ).toBeEnabled();
    const readback = await body<{
      results: unknown[];
      documents: unknown[];
      learningCompletion: unknown;
      progressPercent: number;
      attempts: unknown[];
    }>(await learner.request.get(`/api/learn/enrollments/${enrollmentId}`));
    expect(readback.results).toEqual([]);
    expect(readback.documents).toEqual([]);
    expect(readback.learningCompletion).toBeNull();
    expect(readback.attempts).toEqual([]);
    expect(readback.progressPercent).toBe(100);
    const output = process.env.DEMO_E2E_EVIDENCE!;
    await mkdir(output, { recursive: true });
    await learner.screenshot({
      path: path.join(output, "intermediate-passed-no-official-result.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "BROWSER_INTERMEDIATE.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          courseId: authored.courseId,
          courseVersionId: authored.courseVersionId,
          enrollmentId,
          attemptId: result.id,
          authorSource:
            "browser-author-workflow.json from actual METHODIST author UI",
          learnerUi: true,
          intermediateResult: "PASSED",
          officialResults: 0,
          documents: 0,
          finalAttempts: 0,
          learningCompletion: null,
          progressPercent: 100,
        },
        null,
        2,
      ),
    );
  } finally {
    await staff.close();
    await student.close();
  }
});
