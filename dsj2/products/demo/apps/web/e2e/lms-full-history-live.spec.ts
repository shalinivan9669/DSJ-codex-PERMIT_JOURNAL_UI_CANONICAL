import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CourseContent } from "../../../packages/contracts/src/lms";
const product = path.resolve(__dirname, "../../..");
test("expired learner access preserves submitted revisions and manually confirmed historical attendance read-only", async ({
  browser,
}) => {
  const fixture = JSON.parse(
    readFileSync(process.env.DEMO_LMS_PASS01_FIXTURE!, "utf8"),
  );
  const learned = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-learner.json"),
      "utf8",
    ),
  );
  const authored = JSON.parse(
    readFileSync(
      path.join(product, ".runtime/lms-pass01-20261018/browser-author.json"),
      "utf8",
    ),
  ) as { content: CourseContent };
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
    await page.goto(`/learn/${learned.enrollmentId}`);
    await page.getByRole("button", { name: "RU", exact: true }).click();
    await expect(page.getByText(/Период доступа завершён/)).toBeVisible();
    const lessons = authored.content.modules.flatMap(
        (module) => module.lessons,
      ),
      assignment = lessons.find((lesson) => lesson.kind === "ASSIGNMENT")!,
      session = lessons.find((lesson) => lesson.kind === "SESSION")!;
    await page
      .locator(".lms-outline")
      .getByRole("button", { name: new RegExp(assignment.titleRu) })
      .click();
    await expect(
      page.getByText("Работа принята", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Ответ")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Отправить на проверку", exact: true }),
    ).toHaveCount(0);
    await page.getByText("История подачи и проверки", { exact: true }).click();
    await expect(page.getByText("Версия 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Версия 2", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Добавьте проверку результата в заключение.", {
        exact: true,
      }),
    ).toBeVisible();
    const href = await page
      .getByRole("link", { name: "synthetic-work.png", exact: true })
      .first()
      .getAttribute("href");
    const attachment = await page.request.get(href!);
    expect(attachment.status()).toBe(200);
    await page
      .locator(".lms-outline")
      .getByRole("button", { name: new RegExp(session.titleRu) })
      .click();
    await expect(
      page.getByText("Преподаватель подтвердил ваше участие", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Учебная программа завершена", { exact: true }),
    ).toBeVisible();
    const output = process.env.DEMO_E2E_EVIDENCE!;
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width: 390, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(output, "expired-history-390.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(output, "BROWSER_EXPIRED_HISTORY.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          enrollmentId: learned.enrollmentId,
          controlledSetup:
            "only completed synthetic enrollment dueAt moved to prior instant",
          acceptedWorkReadOnly: true,
          immutableRevisionHistory: [1, 2],
          privateSubmittedAttachmentStatus: 200,
          historicalManualAttendance: true,
          learningCompletionRetained: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
