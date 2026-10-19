import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CourseContent } from "../../../packages/contracts/src/lms";
const product = path.resolve(__dirname, "../../..");
test("keyboard matching and ordering persist while a transient failed answer save retains text through RU KZ and explicit retry", async ({
  browser,
}) => {
  const fixture = JSON.parse(
    readFileSync(process.env.DEMO_LMS_PASS01_FIXTURE!, "utf8"),
  );
  const authored = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-author.json"),
      "utf8",
    ),
  ) as { courseVersionId: string; content: CourseContent };
  expect(["localhost", "127.0.0.1"]).toContain(
    new URL(fixture.baseUrl).hostname,
  );
  const context = await browser.newContext({ baseURL: fixture.baseUrl });
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page
      .getByLabel("Электронная почта")
      .fill(fixture.users.learner.email);
    await page.getByLabel("Пароль").fill(fixture.users.learner.password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    const enrollments = await page.request.get("/api/learn/enrollments");
    expect(enrollments.ok()).toBe(true);
    const enrollment = (await enrollments.json()).items.find(
      (row: { courseVersionId: string }) =>
        row.courseVersionId === authored.courseVersionId,
    );
    expect(enrollment).toBeTruthy();
    await page.goto(`/learn/${enrollment.id}`);
    await page.getByRole("button", { name: "RU", exact: true }).click();
    await expect(page.locator(".lms-question")).toHaveCount(6);
    let injected = false;
    await page.route("**/api/learn/attempts/*/answers", async (route) => {
      if (!injected && route.request().method() === "PUT") {
        injected = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "TEMPORARY_UNAVAILABLE",
            message: "Синтетический временный сбой сохранения",
            params: {},
          }),
        });
      } else await route.continue();
    });
    const answer =
      "Набранный ответ сохраняется при временном сбое и переключении языка.";
    const failed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/answers") && response.status() === 503,
    );
    await page.getByLabel("Ваш ответ").fill(answer);
    await failed;
    await expect(
      page.getByRole("button", { name: "Повторить", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "KZ", exact: true }).click();
    await expect(page.getByLabel("Жауабыңыз")).toHaveValue(answer);
    await page.getByRole("button", { name: "RU", exact: true }).click();
    await expect(page.getByLabel("Ваш ответ")).toHaveValue(answer);
    const retried = page.waitForResponse(
      (response) =>
        response.url().endsWith("/answers") && response.status() === 200,
    );
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await retried;
    const matchingQuestion = authored.content.exam.questions.find(
        (question) => question.answerSpec?.kind === "MATCHING",
      )!,
      orderingQuestion = authored.content.exam.questions.find(
        (question) => question.answerSpec?.kind === "ORDERING",
      )!;
    const matching = page.locator(".lms-question").filter({
        has: page
          .locator("legend")
          .filter({ hasText: matchingQuestion.promptRu }),
      }),
      ordering = page.locator(".lms-question").filter({
        has: page
          .locator("legend")
          .filter({ hasText: orderingQuestion.promptRu }),
      });
    const select = matching.locator("select").first();
    await select.focus();
    await select.press("ArrowDown");
    await select.press("Enter");
    const selection = await select.inputValue();
    expect(selection).not.toBe("");
    const before = await ordering.locator("ol li > span").allTextContents();
    await ordering.getByRole("button", { name: /Ниже:/ }).first().focus();
    await page.keyboard.press("Enter");
    const after = await ordering.locator("ol li > span").allTextContents();
    expect(after).not.toEqual(before);
    await expect(page.locator(".lms-exam-top [role=status]")).toHaveText(
      "Ответы сохранены",
    );
    await page.reload();
    await expect(page.getByLabel("Ваш ответ")).toHaveValue(answer);
    await expect(matching.locator("select").first()).toHaveValue(selection);
    expect(await ordering.locator("ol li > span").allTextContents()).toEqual(
      after,
    );
    const output = process.env.DEMO_E2E_EVIDENCE!;
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: path.join(output, "keyboard-resume.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "BROWSER_ANSWER_RESILIENCE.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          enrollmentId: enrollment.id,
          local503Injected: true,
          errorTextRetainedRuKz: true,
          explicitRetry: true,
          keyboardMatching: "focus ArrowDown Enter",
          keyboardOrdering: "focus Enter",
          savedAnswersReloaded: true,
          submitted: false,
          officialResultCreated: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
