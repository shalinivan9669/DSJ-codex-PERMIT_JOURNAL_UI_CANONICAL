import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("real concurrent tabs preserve saved answers, explain conflict, and Enter never submits an exam", async ({
  page,
  context,
}) => {
  const root = path.resolve(__dirname, "../../..");
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(root, "tsconfig.base.json"),
      path.join(root, "scripts/verification/lms-browser-fixture.ts"),
    ],
    {
      cwd: root,
      env: { ...process.env, DEMO_LMS_FIXTURE_READY_EXAM: "1" },
      windowsHide: true,
      stdio: "pipe",
      timeout: 60000,
    },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(root, ".runtime/lms-one-run/browser-fixture.json"),
      "utf8",
    ),
  );
  const evidence = path.join(
    process.env.DEMO_E2E_EVIDENCE
      ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-conflict-live")
      : path.join(
          root,
          "docs/evidence/lms-one-run-20261015/agent-c/conflict-live",
        ),
  );
  await fs.mkdir(evidence, { recursive: true });
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(fixture.learner.email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`/learn/${fixture.enrollmentId}`);
  const started = performance.now();
  const courseUrl = page.url();
  const startedAttempt = page.waitForResponse(
    (response) =>
      response.url().endsWith("/attempts") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Начать экзамен", exact: true })
    .click();
  const attempt = await (await startedAttempt).json();
  await expect(page.getByRole("timer")).toBeVisible();
  const timerSeconds = async () => {
    const [minutes, seconds] = (await page.getByRole("timer").innerText())
      .split(":")
      .map(Number);
    return minutes * 60 + seconds;
  };
  const remainingBeforeClockChange = await timerSeconds();
  for (const shift of [86400000, -86400000]) {
    const beforeShift = await timerSeconds();
    await page.evaluate((offset) => {
      const clock = window as typeof window & {
        lmsOriginalDateNow?: () => number;
      };
      clock.lmsOriginalDateNow ||= Date.now;
      Date.now = () => clock.lmsOriginalDateNow!() + offset;
    }, shift);
    await expect.poll(timerSeconds).toBeLessThan(beforeShift);
    await expect
      .poll(timerSeconds)
      .toBeLessThanOrEqual(remainingBeforeClockChange + 1);
    await expect
      .poll(timerSeconds)
      .toBeGreaterThan(remainingBeforeClockChange - 10);
    const actual = await page.request.get(`/api/learn/attempts/${attempt.id}`);
    expect(actual.status()).toBe(200);
    const value = await actual.json();
    expect(value.deadlineAt).toBe(attempt.deadlineAt);
    expect(value.state).toBe("IN_PROGRESS");
  }
  await page.evaluate(() => {
    const clock = window as typeof window & {
      lmsOriginalDateNow?: () => number;
    };
    Date.now = clock.lmsOriginalDateNow!;
  });
  const second = await context.newPage();
  await second.goto(courseUrl);
  await expect(second.getByRole("timer")).toBeVisible();
  const firstAnswer = page
    .getByRole("radio", { name: "Первый", exact: true })
    .first();
  await firstAnswer.focus();
  await expect(firstAnswer).toBeFocused();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/answers") && r.request().method() === "PUT",
  );
  await page.keyboard.press("Space");
  expect((await saved).status()).toBe(200);
  let submitted = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/submit") && request.method() === "POST")
      submitted++;
  });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("timer")).toBeVisible();
  expect(submitted).toBe(0);
  await second.setViewportSize({ width: 360, height: 900 });
  const conflict = second.waitForResponse(
    (r) => r.url().endsWith("/answers") && r.request().method() === "PUT",
  );
  await second
    .getByRole("radio", { name: "Второй", exact: true })
    .first()
    .check();
  expect((await conflict).status()).toBe(409);
  const reopen = second.getByRole("button", {
    name: "Открыть сохранённые ответы",
    exact: true,
  });
  await expect(reopen).toBeVisible();
  const recoveryStarted = performance.now();
  await expect(
    second.getByRole("button", { name: "Завершить попытку", exact: true }),
  ).toBeDisabled();
  expect(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await second.screenshot({
    path: path.join(evidence, "conflict-360.png"),
    fullPage: true,
    timeout: 15000,
    animations: "disabled",
  });
  await reopen.click();
  await expect(
    second.getByRole("radio", { name: "Первый", exact: true }).first(),
  ).toBeChecked();
  await expect(
    second.getByRole("radio", { name: "Второй", exact: true }).first(),
  ).not.toBeChecked();
  const recoveryElapsed = performance.now() - recoveryStarted;
  await second.reload();
  await expect(
    second.getByRole("radio", { name: "Первый", exact: true }).first(),
  ).toBeChecked();
  await second.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(second).toHaveURL(/\/login/);
  await second
    .getByLabel("Электронная почта", { exact: true })
    .fill(fixture.learner.email);
  await second
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await second.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(second).not.toHaveURL(/\/login/);
  await second.goto(courseUrl);
  await expect(
    second.getByRole("radio", { name: "Первый", exact: true }).first(),
  ).toBeChecked();
  await second.screenshot({
    path: path.join(evidence, "relogin-resumed.png"),
    fullPage: true,
    timeout: 15000,
    animations: "disabled",
  });
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        result: "PASS",
        checkedAt: new Date().toISOString(),
        fixtureVersion: fixture.fixtureVersion,
        source:
          "Actual browser, real API, same attempt opened in two authenticated tabs, no mocked requests",
        expected:
          "Stale answer gets409 and cannot replace newer answer; explicit read saved answer restores authoritative value; reload/relogin keep it; keyboardEnter does not finalize",
        actual: "Verified all assertions",
        viewport: 360,
        keyboard: ["focus", "Space", "Enter", "Tab", "Escape"],
        dialogs: 0,
        duplicateFinalizations: submitted,
        clientClockOffsetsMilliseconds: [86400000, -86400000],
        serverDeadlineUnchanged: attempt.deadlineAt,
        displayedCountdownUnaffected: true,
        actionMeasurements: [
          {
            scenario:
              "Restore authoritative answers after a real concurrent-tab conflict",
            role: "LEARNER",
            startState:
              "A real409 response displayed an explanation and Open saved answers; submit is disabled",
            endState:
              "The saved first answer is checked and the stale second answer is not checked",
            actualSteps: ["Click Open saved answers"],
            counts: {
              clicks: 1,
              keyboardActions: 0,
              filledFields: 0,
              repeatedFields: 0,
              decisions: 1,
              navigation: 0,
              dialogs: 0,
              manualRefresh: 0,
              confirmations: 0,
            },
            elapsedMilliseconds: recoveryElapsed,
            instrumentation:
              "Elapsed includes disabled-submit, geometry and screenshot assertions before recovery; conflict setup is counted in the separate full test measurement",
            result: "PASS",
          },
          {
            scenario:
              "Concurrent-tab, keyboard, clock, reload and relogin verification",
            role: "LEARNER",
            startState:
              "Authenticated learner course already open with prerequisites complete",
            endState:
              "After deliberate reload and relogin the server-saved answer is still selected",
            actualSteps: [
              "Start exam",
              "Open same course in second tab",
              "Space selects first answer; Enter, Tab and Escape do not submit",
              "Select conflicting answer in second tab",
              "Open saved answers",
              "Reload deliberately",
              "Log out; re-enter email/password; log in",
              "Open course and confirm saved answer",
            ],
            counts: {
              clicks: 5,
              keyboardActions: 4,
              filledFields: 4,
              repeatedFields: 3,
              decisions: 6,
              navigation: 4,
              dialogs: 0,
              manualRefresh: 1,
              confirmations: 0,
            },
            repeatedFieldsBreakdown: {
              deliberateConflictingAnswer: 1,
              reauthenticationCredentials: 2,
              requiredBusinessReentryForRecovery: 0,
            },
            filledFieldsBreakdown: {
              answerSelections: 2,
              reauthenticationCredentials: 2,
            },
            authenticationBeforeBoundary: {
              fields: 2,
              clicks: 1,
              excluded: true,
            },
            elapsedMilliseconds: performance.now() - started,
            instrumentation:
              "Programmatic focus, ±24h Date.now changes, viewport changes, API reads and screenshots are test instrumentation. Clock waits and assertions remain in elapsed time; two-tab setup is counted as one navigation. No final submission occurs.",
            result: "PASS",
          },
        ],
      },
      null,
      2,
    ),
  );
});
