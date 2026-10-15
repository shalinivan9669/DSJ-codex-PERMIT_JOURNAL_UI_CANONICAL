import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { loginRole } from "./operator-role-fixture";

test("prepared 1/10/100/250 assignments preserve good rows and repair only one employment error without reentry", async ({
  page,
}, testInfo) => {
  test.setTimeout(240000);
  const root = path.resolve(__dirname, "../../..");
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(root, "tsconfig.base.json"),
      path.join(root, "scripts/verification/lms-assignment-fixture.ts"),
    ],
    {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: "pipe",
      timeout: 60000,
    },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(root, ".runtime/lms-one-run/assignment-fixture.json"),
      "utf8",
    ),
  );
  const evidence = process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-assignment-batches-live")
    : testInfo.outputDir;
  await fs.mkdir(evidence, { recursive: true });
  await loginRole(page, "OPERATOR");
  const measurements = [];
  for (const group of fixture.groups) {
    await page.setViewportSize({
      width: group.count >= 100 ? 390 : 1440,
      height: 900,
    });
    await page.goto(
      `/lms/assign?requestId=${group.requestId}&versionId=${fixture.courseVersionId}`,
    );
    const primary = page.getByRole("button", {
      name: `Назначить обучение · ${group.count}`,
      exact: true,
    });
    await expect(primary).toBeEnabled();
    const started = performance.now();
    const response = page.waitForResponse(
      (value) =>
        value.url().endsWith("/lms/enrollments") &&
        value.request().method() === "POST",
    );
    await primary.focus();
    await page.keyboard.press("Enter");
    const report = await (await response).json();
    expect(report.created).toBe(group.count - 1);
    expect(report.errors).toEqual([
      {
        recipientId: group.errorPerson.id,
        code: "EMPLOYMENT_REQUIRED",
        message: "Проверьте связь сотрудника с организацией",
      },
    ]);
    const failedRow = page
      .getByRole("row")
      .filter({ hasText: group.errorPerson.name });
    await expect(failedRow.getByRole("checkbox")).toBeChecked();
    expect(
      await page
        .getByRole("row")
        .filter({ has: page.getByRole("checkbox", { checked: true }) })
        .count(),
    ).toBe(1);
    await expect(
      page.getByRole("combobox", { name: "Программа", exact: true }),
    ).toHaveValue(fixture.courseVersionId);
    const repair = failedRow.getByRole("button", {
      name: /Подтвердить работодателя/,
    });
    const repaired = page.waitForResponse(
      (value) =>
        value.url().endsWith(`/recipients/${group.errorPerson.id}`) &&
        value.request().method() === "PATCH",
    );
    await repair.click();
    expect((await repaired).status()).toBe(200);
    const finish = page.waitForResponse(
      (value) =>
        value.url().endsWith("/lms/enrollments") &&
        value.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Назначить обучение · 1", exact: true })
      .click();
    const completed = await (await finish).json();
    expect(completed.created).toBe(1);
    expect(completed.errors).toEqual([]);
    expect(
      new Set(
        [...report.items, ...completed.items].map(
          (item: { id: string }) => item.id,
        ),
      ).size,
    ).toBe(group.count);
    const replay = page.waitForResponse(
      (value) =>
        value.url().endsWith("/lms/enrollments") &&
        value.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Назначить обучение · 1", exact: true })
      .click();
    const repeated = await (await replay).json();
    expect(repeated.created).toBe(0);
    expect(repeated.duplicates).toBe(1);
    expect(repeated.items[0].id).toBe(completed.items[0].id);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({
      path: path.join(evidence, `assignment-${group.count}.png`),
      fullPage: true,
    });
    measurements.push({
      count: group.count,
      role: "OPERATOR",
      phase: "prepared mixed-group assignment and one-row repair",
      goal: "Assign the prepared group, preserve successful rows and repair only the missing employer relationship without re-entering known business data",
      preconditions:
        "Synthetic known recipients, published course and prepared request already exist; exactly one recipient lacks the saved employer relationship",
      startState:
        "Prepared known group with one missing employer relationship; published course already selected",
      fixtureSetupNotCountedAsFirstEntry: true,
      actualSteps: [
        "Activate one group assignment using keyboard",
        "Confirm only the failed row's known employer",
        "Assign only the still selected failed row",
      ],
      result: {
        firstCreated: report.created,
        repairedCreated: completed.created,
        duplicateReplayCreated: repeated.created,
      },
      counts: {
        clicks: 2,
        keyboardActions: 1,
        filledFields: 0,
        repeatedFields: 0,
        decisions: 3,
        navigation: 0,
        dialogs: 0,
        confirmations: 1,
        manualRefresh: 0,
      },
      verificationOnly: { replayClicks: 1 },
      elapsedMilliseconds: performance.now() - started,
    });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  const ambiguousStarted = performance.now();
  await page.goto(`/lms/assign?versionId=${fixture.courseVersionId}`);
  await page
    .getByRole("searchbox", { name: "Найти сотрудника", exact: true })
    .fill(fixture.ambiguous.name);
  const ambiguousRows = page
    .getByRole("row")
    .filter({ hasText: fixture.ambiguous.name });
  await expect(ambiguousRows).toHaveCount(2);
  await expect(
    ambiguousRows.getByRole("checkbox", { checked: true }),
  ).toHaveCount(0);
  const electrician = ambiguousRows.filter({ hasText: "Электрик" });
  const welder = ambiguousRows.filter({ hasText: "Сварщик" });
  await expect(electrician).toBeVisible();
  await expect(welder).toBeVisible();
  await electrician.getByRole("checkbox").click();
  const firstSelected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/lms/enrollments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Назначить обучение · 1", exact: true })
    .click();
  const firstPerson = await (await firstSelected).json();
  expect(firstPerson.created).toBe(1);
  expect(
    firstPerson.items.map((item: { recipientId: string }) => item.recipientId),
  ).toEqual([fixture.ambiguous.people[0].id]);
  await expect(welder.getByRole("checkbox")).not.toBeChecked();
  await electrician.getByRole("checkbox").click();
  await welder.getByRole("checkbox").click();
  const secondSelected = page.waitForResponse(
    (response) =>
      response.url().endsWith("/lms/enrollments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Назначить обучение · 1", exact: true })
    .click();
  const secondPerson = await (await secondSelected).json();
  expect(secondPerson.created).toBe(1);
  expect(
    secondPerson.items.map((item: { recipientId: string }) => item.recipientId),
  ).toEqual([fixture.ambiguous.people[1].id]);
  expect(secondPerson.items[0].id).not.toBe(firstPerson.items[0].id);
  const ambiguousElapsed = performance.now() - ambiguousStarted;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidence, "same-name-explicit-position-selection.png"),
    fullPage: true,
  });
  const ambiguousSelection = {
    role: "OPERATOR",
    phase: "explicit selection of existing people with the same name",
    goal: "Choose two distinct saved identities by their visible position without merging them or repeating their details",
    preconditions:
      "A published course and two saved recipients with equal names and distinct positions/IDs exist",
    startState:
      "Published version known; two existing recipients share the same name and have different saved positions",
    actualSteps: [
      "Open assignment with known course",
      "Search the shared name once",
      "Choose the electrician row by its visible saved position and assign",
      "Clear that row, choose the welder by visible position and assign separately",
    ],
    counts: {
      clicks: 5,
      keyboardActions: 0,
      filledFields: 1,
      repeatedFields: 0,
      decisions: 4,
      navigation: 1,
      dialogs: 0,
      confirmations: 2,
      manualRefresh: 0,
    },
    elapsedMilliseconds: ambiguousElapsed,
    distinctRecipientIds: fixture.ambiguous.people.map(
      (person: { id: string }) => person.id,
    ),
    distinctEnrollmentIds: [firstPerson.items[0].id, secondPerson.items[0].id],
    automaticIdentityMerge: false,
    result: "PASS",
  };
  await fs.writeFile(
    path.join(evidence, "actions.json"),
    JSON.stringify(
      {
        status: "PASS",
        fixtureVersion: fixture.fixtureVersion,
        checkedAt: new Date().toISOString(),
        measurements,
        ambiguousSelection,
      },
      null,
      2,
    ),
  );
});
