import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { loginRole } from "./operator-role-fixture";
import { measureLmsActions } from "./lms-action-measurement";

test("slow online assignment preserves the selected group and prevents duplicate submission while the real response is delayed", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const product = path.resolve(__dirname, "../../..");
  const directory = process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-slow-response-live")
    : testInfo.outputDir;
  await fs.mkdir(directory, { recursive: true });
  const setupStarted = performance.now();
  await promisify(execFile)(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(product, "scripts/verification/lms-browser-fixture.ts"),
    ],
    {
      cwd: product,
      env: { ...process.env, DEMO_LMS_FIXTURE_READY_EXAM: "" },
      windowsHide: true,
      timeout: 60000,
    },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/lms-one-run/browser-fixture.json"),
      "utf8",
    ),
  );
  await loginRole(page, "OPERATOR");
  await page.goto(
    `/lms/assign?requestId=${fixture.requestId}&versionId=${fixture.courseVersionId}`,
  );
  const primary = page.getByRole("button", {
    name: "Назначить обучение · 2",
    exact: true,
  });
  const program = page.getByRole("combobox", {
    name: "Программа",
    exact: true,
  });
  const selectedRows = page.locator(
    '.lms-table-scroll tbody input[type="checkbox"]',
  );
  await expect(primary).toBeEnabled();
  await expect(selectedRows).toHaveCount(2);
  for (const row of await selectedRows.all()) await expect(row).toBeChecked();
  const setupMilliseconds = performance.now() - setupStarted;
  let markFetched!: () => void;
  let release!: () => void;
  const fetched = new Promise<void>((resolve) => (markFetched = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  let assignmentRequests = 0;
  let responseHoldMilliseconds = 0;
  await page.route("**/api/lms/enrollments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    assignmentRequests++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const at = performance.now();
    markFetched();
    await Promise.all([
      held,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    responseHoldMilliseconds = performance.now() - at;
    await route.fulfill({ response });
  });
  const phase = "prepared assignment with a delayed real success response";
  const startState =
    "Authenticated operator on the prepared assignment page; two known recipients and the published course are already selected";
  const goal =
    "Assign the same group once, retain its selection while waiting and receive the real persisted result without refresh or repeated input";
  const preconditions = [
    fixture.preparedCosts,
    "A fresh unique course, two synthetic learners and a prepared request were created by the existing guarded fixture. Initial authentication and navigation are measured as setup, outside this prepared operation.",
    "Only delivery of the actual successful HTTP response is held for at least1000ms. No request body, response payload, enrollment, clock or UI state is fabricated.",
  ];
  const measurement = measureLmsActions(
    page,
    "UX08 slow online assignment",
    "OPERATOR",
    startState,
    preconditions,
  );
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/lms/enrollments") &&
      response.request().method() === "POST",
  );
  try {
    await measurement.action(
      "click",
      "Assign the prepared group once",
      () => primary.click(),
      { decision: true, confirmation: true },
    );
    await fetched;
    const waiting = page.getByRole("button", {
      name: "Подождите…",
      exact: true,
    });
    await expect(waiting).toBeVisible();
    await expect(waiting).toBeDisabled();
    await expect(program).toBeDisabled();
    await expect(program).toHaveValue(fixture.courseVersionId);
    for (const row of await selectedRows.all()) await expect(row).toBeChecked();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/Назначено:\s*2/)).toHaveCount(0);
    await page.screenshot({
      path: path.join(directory, "01-real-response-pending.png"),
      fullPage: true,
    });
  } finally {
    release();
  }
  const report = await (await completed).json();
  expect(report).toMatchObject({ created: 2, duplicates: 0, errors: [] });
  expect(report.items).toHaveLength(2);
  await expect(primary).toBeEnabled();
  await expect(program).toHaveValue(fixture.courseVersionId);
  await expect(page.getByText(/Назначено:\s*2/)).toBeVisible();
  for (const row of await selectedRows.all()) await expect(row).toBeChecked();
  expect(assignmentRequests).toBe(1);
  expect(responseHoldMilliseconds).toBeGreaterThanOrEqual(990);
  const actual = measurement.finish({
    created: report.created,
    assignmentRequests,
    selectionPreserved: true,
    shortWaitingStateVisible: true,
    repeatedSubmissionDisabled: true,
    automaticSuccessAfterResponse: true,
  });
  const readbackResponse = await page.request.get(
    `/api/lms/enrollments?courseVersionId=${fixture.courseVersionId}&pageSize=250`,
  );
  expect(readbackResponse.ok()).toBe(true);
  const readback = await readbackResponse.json();
  expect(readback.total).toBe(2);
  expect(readback.items.map((item: { id: string }) => item.id).sort()).toEqual(
    report.items.map((item: { id: string }) => item.id).sort(),
  );
  await page.screenshot({
    path: path.join(directory, "02-real-response-saved.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(directory, "acceptance.json"),
    JSON.stringify(
      {
        status: "PASS",
        checkedAt: new Date().toISOString(),
        fixtureVersion: fixture.fixtureVersion,
        requestId: fixture.requestId,
        courseVersionId: fixture.courseVersionId,
        enrollmentIds: report.items.map((item: { id: string }) => item.id),
        setupMilliseconds,
        responseHoldMilliseconds,
        actualPayloadModified: false,
        actualDatabaseRows: readback.total,
        duplicateRows: 0,
        measurements: [
          {
            ...actual,
            phase,
            startState,
            goal,
            actualSteps: actual.steps,
            filledFields: actual.fields,
          },
        ],
        boundary:
          "Prepared operation only. Measured automated wall time includes the deliberate response hold and pending-state assertions/screenshot; final readback is verification outside the action budget. Native dialogs/physical typing are not claimed.",
      },
      null,
      2,
    ),
  );
});
