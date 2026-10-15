import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-learning-live")
    : path.join(
        __dirname,
        "../../../docs/evidence/lms-one-run-20261015/agent-c/learning-live",
      ),
);
const fixturePath = path.resolve(
  __dirname,
  "../../../.runtime/lms-one-run/browser-fixture.json",
);
const password = "Synthetic-LMS-only-20261015!";
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

test("prepared assignment and learner continuation, RU/KZ/mobile, actual exam autosave and offline recovery", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const product = path.resolve(__dirname, "../../..");
  execFileSync(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(product, "scripts/verification/lms-browser-fixture.ts"),
    ],
    {
      cwd: product,
      env: { ...process.env, DEMO_LMS_FIXTURE_READY_EXAM: "0" },
      windowsHide: true,
      stdio: "pipe",
      timeout: 60000,
    },
  );
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  await fs.mkdir(evidence, { recursive: true });
  const metrics: unknown[] = [];
  await login(page, process.env.DEMO_ADMIN_EMAIL!);
  const staffSession = await (
    await page.request.get("/api/auth/session")
  ).json();
  await page.goto(
    `/lms/assign?requestId=${fixture.requestId}&versionId=${fixture.courseVersionId}`,
  );
  const assign = page.getByRole("button", {
    name: "Назначить обучение · 2",
    exact: true,
  });
  await expect(assign).toBeEnabled();
  const assignmentStart = performance.now();
  const assignmentResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lms/enrollments") &&
      r.request().method() === "POST",
  );
  await assign.click();
  const assignment = await (await assignmentResponse).json();
  expect(assignment.errors).toEqual([]);
  expect(assignment.items).toHaveLength(2);
  const enrollmentId = assignment.items.find(
    (x: { recipientId: string }) =>
      x.recipientId === fixture.learner.recipientId,
  ).id;
  await page.screenshot({
    path: path.join(evidence, "01-assigned.png"),
    fullPage: true,
    timeout: 15000,
    animations: "disabled",
  });
  metrics.push({
    scenario: "prepared group assignment",
    phase: "prepared repeat",
    goal: "Assign the already selected group and published course without entering known business data again",
    role: staffSession.user.role,
    startState:
      "Existing group and course selected by prepared request/version URL",
    preconditions: fixture.preparedCosts,
    actualSteps: ["Click Assign training for the two preselected people"],
    counts: {
      clicks: 1,
      keyboardActions: 0,
      filledFields: 0,
      repeatedFields: 0,
      decisions: 1,
      navigation: 0,
      dialogs: 0,
      manualRefresh: 0,
      confirmations: 1,
    },
    instrumentation: { timingIncludesAssertionsAndScreenshots: true },
    elapsedMilliseconds: performance.now() - assignmentStart,
    result: "PASS",
  });

  console.info("LMS_BROWSER_ASSIGNMENT_CONFIRMED");
  const learnerContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
    viewport: { width: 1366, height: 900 },
  });
  learnerContext.setDefaultTimeout(20000);
  learnerContext.setDefaultNavigationTimeout(30000);
  const learner = await learnerContext.newPage();
  try {
    await login(learner, fixture.learner.email);
    await learner.goto("/learn");
    const continuation = learner.getByRole("link", {
      name: "Продолжить",
      exact: true,
    });
    await expect(continuation).toBeVisible();
    const continueStart = performance.now();
    await continuation.click();
    await expect(
      learner.getByRole("heading", { name: "Учебный текст", exact: true }),
    ).toBeVisible();
    metrics.push({
      scenario: "prepared lesson continuation",
      phase: "prepared repeat",
      goal: "Continue the assigned lesson from the learner's existing course card",
      role: "LEARNER",
      startState: "Authenticated My learning screen, assigned program visible",
      preconditions:
        "The actual assignment has completed; the learner is authenticated and has opened My learning. Authentication costs are recorded separately.",
      authentication: { filledFields: 2, clicks: 1, countedSeparately: true },
      actualSteps: ["Click Continue, arrive directly at the lesson"],
      counts: {
        clicks: 1,
        keyboardActions: 0,
        filledFields: 0,
        repeatedFields: 0,
        decisions: 1,
        navigation: 1,
        dialogs: 0,
        manualRefresh: 0,
        confirmations: 0,
      },
      elapsedMilliseconds: performance.now() - continueStart,
      result: "PASS",
    });
    console.info("LMS_BROWSER_LESSON_OPEN");
    for (const width of [360, 390, 768, 1440]) {
      console.info(`LMS_BROWSER_VIEWPORT_${width}`);
      await learner.setViewportSize({ width, height: 900 });
      for (const language of ["KZ", "RU"]) {
        console.info(`LMS_BROWSER_LANGUAGE_${language}`);
        await learner
          .getByRole("button", { name: language, exact: true })
          .click();
        await noPageOverflow(learner);
        const action = learner.getByRole("button", {
          name: language === "RU" ? "Изучено, дальше" : "Оқыдым, келесі",
          exact: true,
        });
        await expect(action).toBeVisible();
        const box = await action.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        await learner.screenshot({
          path: path.join(evidence, `lesson-${width}-${language}.png`),
          fullPage: true,
          timeout: 15000,
          animations: "disabled",
        });
      }
    }
    const examStart = performance.now();
    await learner
      .getByRole("button", { name: "Изучено, дальше", exact: true })
      .click();
    const start = learner.getByRole("button", {
      name: "Начать экзамен",
      exact: true,
    });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(learner.getByRole("timer")).toBeVisible();
    const radios = learner.getByRole("radio", { name: "Первый", exact: true });
    await expect(radios).toHaveCount(10);
    for (let i = 0; i < 9; i++) await radios.nth(i).check();
    await expect(
      learner.getByText("Ответы сохранены", { exact: true }),
    ).toBeVisible();
    await learnerContext.setOffline(true);
    await radios.nth(9).check();
    await expect(radios.nth(9)).toBeChecked();
    await expect(
      learner.getByRole("button", { name: "Повторить", exact: true }),
    ).toBeVisible();
    await learner.screenshot({
      path: path.join(evidence, "exam-offline-answer-preserved.png"),
      fullPage: true,
      timeout: 15000,
      animations: "disabled",
    });
    await learnerContext.setOffline(false);
    await expect(
      learner.getByText("Ответы сохранены", { exact: true }),
    ).toBeVisible();
    await learner.getByRole("button", { name: "KZ", exact: true }).click();
    await expect(
      learner.getByRole("radio", { name: "Бірінші", exact: true }).first(),
    ).toBeChecked();
    await learner.setViewportSize({ width: 360, height: 900 });
    await noPageOverflow(learner);
    await learner.screenshot({
      path: path.join(evidence, "exam-360-KZ.png"),
      fullPage: true,
      timeout: 15000,
      animations: "disabled",
    });
    await learner.getByRole("button", { name: "RU", exact: true }).click();
    await learner
      .getByRole("button", { name: "Завершить попытку", exact: true })
      .click();
    await expect(
      learner.getByText(
        /(?:Правильных ответов: 10 \/ 10|Экзамен центра.*10\/10)/,
      ),
    ).toBeVisible();
    await learner.screenshot({
      path: path.join(evidence, "exam-finished.png"),
      fullPage: true,
      timeout: 15000,
      animations: "disabled",
    });
    const detail = await (
      await learner.request.get(`/api/learn/enrollments/${enrollmentId}`)
    ).json();
    expect(detail.progressPercent).toBe(100);
    expect(detail.results[0].verdict).toBe("PASSED");
    expect(detail.results[0].attemptId).toBeTruthy();
    expect(detail.results[0].score).toBe(10);
    metrics.push({
      scenario:
        "first learner text acknowledgement and exam, including one offline save",
      phase: "learning and first exam",
      goal: "Complete the required text and exam while preserving an answer through a real network interruption",
      role: "LEARNER",
      startState: "Assigned synthetic program open at required text lesson",
      preconditions:
        "The actual learner is authenticated and has continued to the assigned published course. The lesson has not been acknowledged and no exam answers are prefilled.",
      actualSteps: [
        "Acknowledge text",
        "Start exam",
        "Select ten answers; tenth while offline",
        "Network returns; answer saves automatically",
        "Switch language without losing answers",
        "Submit once; actual database-backed result is 10/10",
      ],
      counts: {
        clicks: 15,
        keyboardActions: 0,
        filledFields: 10,
        repeatedFields: 0,
        decisions: 13,
        navigation: 0,
        dialogs: 0,
        manualRefresh: 0,
        confirmations: 2,
      },
      elapsedMilliseconds: performance.now() - examStart,
      result: "PASS",
      viewportChecks: [360, 390, 768, 1440],
      languages: ["ru", "kz"],
      instrumentation:
        "Viewport and network controls are test instrumentation. Elapsed time begins before text acknowledgement and includes the two language changes, assertions, offline wait and screenshots. Eight earlier language geometry clicks are outside this scenario boundary. No API responses were mocked.",
      startBoundary:
        "Required text lesson already open, before acknowledging it",
      endBoundary: "Submitted result and persisted 100% progress confirmed",
    });
  } finally {
    await learnerContext.close();
  }
  await fs.writeFile(
    path.join(evidence, "actions.json"),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        fixtureVersion: fixture.fixtureVersion,
        scenarios: metrics,
        limitations:
          "Prepared fixture cost is explicit; this is not a first-entry course-editor or document issuance acceptance.",
      },
      null,
      2,
    ),
  );
});
