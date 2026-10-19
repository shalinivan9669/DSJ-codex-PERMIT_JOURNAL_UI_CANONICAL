import { test, expect, type Page, type APIResponse } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CourseContent } from "../../../packages/contracts/src/lms";
const product = path.resolve(__dirname, "../../..");
const output = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/lms-full-tz-pass-01-20261018"),
);
type User = { email: string; password: string };
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
test("actual concurrent reviewer409 explains existing decision and preserves feedback and verdict across RU/KZ", async ({
  browser,
}) => {
  const fixture = JSON.parse(
    readFileSync(
      path.join(
        product,
        ".runtime/lms-pass01-20261018/browser-learner-fixture-04.json",
      ),
      "utf8",
    ),
  ) as { baseUrl: string; users: { learner: User; teacher: User } };
  const authored = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-author.json"),
      "utf8",
    ),
  ) as { content: CourseContent };
  const origin = fixture.baseUrl;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const contexts = await Promise.all([
    browser.newContext({ baseURL: origin }),
    browser.newContext({ baseURL: origin }),
    browser.newContext({ baseURL: origin }),
  ]);
  try {
    const learner = await contexts[0].newPage();
    await login(learner, fixture.users.learner);
    const enrollmentId = "ff273490-5600-48ee-bd09-f73500f24cc9";
    const lessonId = authored.content.modules
      .flatMap((module) => module.lessons)
      .find((lesson) => lesson.kind === "ASSIGNMENT")!.id;
    const endpoint = `/api/lms/enrollments/${enrollmentId}/assignments/${lessonId}/submission`;
    const enrollment = await body<{
      recipient: { data: { fullNameRu: string } };
    }>(await learner.request.get(`/api/learn/enrollments/${enrollmentId}`));
    const session = await body<{ csrfToken: string }>(
      await learner.request.get("/api/auth/session"),
    );
    const headers = { origin, "x-csrf-token": session.csrfToken };
    let draft = await body<{
      id: string;
      sequence: number;
      text: string;
      status: string;
      attachments: { id: string }[];
    }>(await learner.request.get(endpoint));
    if (draft.status === "DRAFT") {
      draft = await body(
        await learner.request.put(endpoint, {
          headers,
          data: {
            sequence: draft.sequence + 1,
            text:
              draft.text ||
              "Синтетический ответ: выполнена проверка безопасности и результата.",
            attachmentIds: draft.attachments.map((file) => file.id),
          },
        }),
      );
      draft = await body(
        await learner.request.post(`${endpoint}/submit`, {
          headers,
          data: { sequence: draft.sequence },
        }),
      );
    }
    expect(draft.status).toBe("SUBMITTED");
    const pages = await Promise.all(
      contexts.slice(1).map((context) => context.newPage()),
    );
    const feedback =
      "Синтетический второй проверяющий: этот комментарий должен остаться при конфликте.";
    for (const [index, reviewer] of pages.entries()) {
      await login(reviewer, fixture.users.teacher);
      await reviewer.goto("/lms/teaching");
      await reviewer.getByLabel(/^Работы/).selectOption("SUBMISSION");
      const row = reviewer
        .locator("section li")
        .filter({
          has: reviewer.getByText(enrollment.recipient.data.fullNameRu, {
            exact: true,
          }),
        })
        .first();
      const loading = reviewer.waitForResponse(
        (response) =>
          response.url().endsWith(`/reviews/SUBMISSION/${draft.id}`) &&
          response.request().method() === "GET",
      );
      await row
        .getByRole("button", { name: "Открыть работу", exact: true })
        .click();
      await body(await loading);
      const detail = reviewer.locator("section[aria-busy]");
      await detail.getByLabel(/^Решение/).selectOption("ACCEPTED");
      await detail
        .getByLabel("Обратная связь слушателю")
        .fill(index ? feedback : "Синтетическая проверка: критерии выполнены.");
    }
    for (const [index, reviewer] of pages.entries()) {
      const saved = reviewer.waitForResponse(
        (response) =>
          response.url().endsWith(`/reviews/SUBMISSION/${draft.id}/decision`) &&
          response.request().method() === "POST",
      );
      await reviewer
        .getByRole("button", { name: "Сохранить решение", exact: true })
        .click();
      const response = await saved;
      if (!index) await body(response);
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
        ).toHaveValue(feedback);
        await expect(
          reviewer.locator("section[aria-busy]").getByLabel(/^Решение/),
        ).toHaveValue("ACCEPTED");
        await mkdir(output, { recursive: true });
        await reviewer.screenshot({
          path: path.join(output, "reviewer409-RU.png"),
          fullPage: true,
        });
        await reviewer.getByRole("button", { name: "KZ", exact: true }).click();
        await expect(
          reviewer.getByText(
            "Шешімді басқа тексеруші сақтап қойды. Жұмысты жаңартыңыз; пікіріңіз сақталған.",
            { exact: false },
          ),
        ).toBeVisible();
        await expect(
          reviewer.getByLabel("Тыңдаушыға кері байланыс"),
        ).toHaveValue(feedback);
        await expect(
          reviewer.locator("section[aria-busy]").getByLabel(/^Шешім/),
        ).toHaveValue("ACCEPTED");
        await reviewer.screenshot({
          path: path.join(output, "reviewer409-KZ.png"),
          fullPage: true,
        });
      }
    }
    await writeFile(
      path.join(output, "UX_BROWSER_review_conflict.json"),
      JSON.stringify(
        {
          result: "PASS",
          targetType: "SUBMISSION",
          submissionId: draft.id,
          enrollmentId,
          setup:
            "Allocated unfinished synthetic run04 practice submitted via authenticated learner API; existing draft preserved. Two actual reviewer UI sessions opened same frozen revision before first decision.",
          observations: [
            "First decision200, second actual REVIEW_CONFLICT409",
            "Specific conflict/reload guidance shown in RU and KZ",
            "Feedback and ACCEPTED selection unchanged across refusal and locale switch",
          ],
          requestsMocked: false,
        },
        null,
        2,
      ),
      "utf8",
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
