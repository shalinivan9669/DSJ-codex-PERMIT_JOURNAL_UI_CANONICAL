import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { measureLmsActions } from "./lms-action-measurement";

const product = path.resolve(__dirname, "../../..");
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE, "lms-operator-live")
  : path.join(
      product,
      "docs/evidence/lms-one-run-20261015/agent-b/operator-live",
    );
const password = "Synthetic-LMS-only-20261015!";
async function login(page: Page, email: string, secret = password) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("prepared document bundle, director approval, employer documents, access extension and local recovery", async ({
  page,
  browser,
}) => {
  test.setTimeout(300000);
  await promisify(execFile)(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-operator-fixture.ts",
    ],
    { cwd: product, env: process.env, timeout: 30000 },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.join(product, ".runtime/lms-one-run/operator-fixture.json"),
      "utf8",
    ),
  );
  await fs.mkdir(evidence, { recursive: true });
  const metrics: unknown[] = [];
  const measure = (
    target: Page,
    scenario: string,
    role: string,
    phase: string,
    startState: string,
    goal: string,
  ) => {
    const measurement = measureLmsActions(target, scenario, role, startState, [
      fixture.setup,
      "Known people, employer relationships, published program and eligible result were prepared through real domain calls. This is a prepared operation, not measured first entry.",
    ]);
    return {
      action: measurement.action,
      finish(result: unknown, extra: Record<string, unknown> = {}) {
        const actual = measurement.finish(result);
        metrics.push({
          ...actual,
          phase,
          startState,
          goal,
          actualSteps: actual.steps,
          filledFields: actual.fields,
          ...extra,
        });
      },
    };
  };
  await login(page, fixture.director);
  await page.goto("/lms/results");
  const prepare = page.getByRole("button", {
    name: "Подготовить документы · 1",
    exact: true,
  });
  await expect(prepare).toBeEnabled();
  const preparation = measure(
    page,
    "prepared eligible result to document set",
    "DIRECTOR",
    "prepared repeat",
    "Result list already open with one eligible result automatically selected",
    "Prepare all three applicable document types without re-entering saved facts",
  );
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/lms/results/documents") &&
      r.request().method() === "POST",
  );
  await preparation.action(
    "click",
    "Prepare the selected document set",
    () => prepare.click(),
    { decision: true, confirmation: true },
  );
  const prepared = await (await response).json();
  expect(prepared.errors).toEqual([]);
  expect(prepared.items).toHaveLength(3);
  await expect(
    page.getByRole("button", { name: "Скачать комплект", exact: true }),
  ).toBeDisabled();
  preparation.finish({
    preparedTypes: prepared.items.length,
    waitingForDirector: true,
  });
  await page.screenshot({
    path: path.join(evidence, "01-awaiting-director.png"),
    fullPage: true,
  });
  const approvals = await (await page.request.get("/api/approvals")).json();
  const proposal = approvals.items.find(
    (item: { requestId: string }) =>
      item.requestId === prepared.items[0].requestId,
  );
  expect(proposal).toBeTruthy();
  const approvalPage = await page.context().newPage();
  const approval = measure(
    approvalPage,
    "required director decision",
    "DIRECTOR",
    "separate authorized decision",
    "Authenticated director has the submitted immutable revision link; approval page not yet opened",
    "Review and explicitly approve the submitted revision",
  );
  await approval.action("navigate", "Open the submitted revision", () =>
    approvalPage.goto(`/approvals?proposal=${proposal.id}`),
  );
  const decision = approvalPage.waitForResponse((r) =>
    r.url().endsWith(`/api/approvals/${proposal.id}/decision`),
  );
  await approval.action(
    "click",
    "Approve this immutable revision",
    () =>
      approvalPage
        .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
        .click(),
    { decision: true, confirmation: true },
  );
  expect((await decision).ok()).toBe(true);
  approval.finish(
    { approved: true, requestId: prepared.items[0].requestId },
    {
      separateFromPreparedDownloadBudget: true,
      reviewBoundary:
        "Automated browser observes the saved revision and explicit approval; human reading speed is not measured.",
    },
  );
  await approvalPage.screenshot({
    path: path.join(evidence, "02-director-approved.png"),
    fullPage: true,
  });
  await approvalPage.close();
  await promisify(execFile)(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "apps/api/tsconfig.json",
      "scripts/verification/lms-operator-fixture.ts",
      "--render",
    ],
    { cwd: product, env: process.env, timeout: 210000 },
  );
  const download = page.getByRole("button", {
    name: "Скачать комплект",
    exact: true,
  });
  await expect(download).toBeEnabled({ timeout: 30000 });
  const downloadMeasurement = measure(
    page,
    "prepared document set download",
    "DIRECTOR",
    "prepared repeat",
    "All three approved files ready, remembered default PDF format",
    "Download the whole ready set once without choosing people or forms again",
  );
  const event = page.waitForEvent("download");
  await downloadMeasurement.action(
    "click",
    "Download the ready set",
    () => download.click(),
    { decision: true },
  );
  const zip = await event;
  await zip.saveAs(path.join(evidence, "documents.zip"));
  const bytes = await fs.readFile(path.join(evidence, "documents.zip"));
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  downloadMeasurement.finish({ validZip: true, bytes: bytes.length });
  await page.screenshot({
    path: path.join(evidence, "03-ready-download.png"),
    fullPage: true,
  });
  const printPage = await page.context().newPage();
  const printEntry = measure(
    printPage,
    "open the prepared set print task",
    "DIRECTOR",
    "prepared task navigation",
    "Director authenticated; the completed three-document request has been automatically archived",
    "Reach the existing issued request row without entering or selecting people again",
  );
  const completedRequest = await (
    await page.request.get(`/api/print-requests/${prepared.items[0].requestId}`)
  ).json();
  expect(completedRequest.archivedAt).toBeTruthy();
  await printEntry.action(
    "navigate",
    "Open the completed requests archive",
    () => printPage.goto("/history"),
  );
  const printRow = printPage.getByRole("row").filter({
    has: printPage.locator(
      `a.row-title[href="/requests/${prepared.items[0].requestId}"]`,
    ),
  });
  await expect(printRow).toBeVisible();
  printEntry.finish({
    requestId: prepared.items[0].requestId,
    readyRowVisible: true,
  });
  await printPage.evaluate(() => {
    const owner = window as typeof window & {
      __lmsNativePrintProof?: Array<{ pages: number; decodedImages: number }>;
    };
    owner.__lmsNativePrintProof = [];
    const observeFrame = (frame: HTMLIFrameElement) => {
      if (!frame.matches("iframe.pdf-print-frame")) return;
      frame.contentWindow?.addEventListener(
        "beforeprint",
        () => {
          owner.__lmsNativePrintProof!.push({
            pages:
              frame.contentDocument?.querySelectorAll("section").length || 0,
            decodedImages: [
              ...(frame.contentDocument?.querySelectorAll("img") || []),
            ].filter((image) => image.complete && image.naturalWidth > 0)
              .length,
          });
        },
        { once: true },
      );
    };
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLIFrameElement) observeFrame(node);
    }).observe(document.body, { childList: true, subtree: true });
  });
  const printing = measure(
    printPage,
    "prepared whole document set browser print",
    "DIRECTOR",
    "prepared repeat",
    "Existing request row visible with all three ready documents; no print plan opened",
    "Prepare the full PDF and invoke real browser printing without selecting people or forms again",
  );
  await printing.action(
    "click",
    "Prepare the latest issue as one PDF",
    () =>
      printRow
        .getByRole("button", { name: "PDF последнего выпуска", exact: true })
        .click(),
    { decision: true },
  );
  const printPart = printRow.getByRole("button", {
    name: "Напечатать эту часть",
    exact: true,
  });
  await expect(printPart).toHaveCount(1);
  await printing.action(
    "click",
    "Print the complete prepared part",
    () => printPart.click(),
    { decision: true },
  );
  await expect
    .poll(
      async () =>
        printPage.evaluate(
          () =>
            (
              window as typeof window & {
                __lmsNativePrintProof?: Array<{
                  pages: number;
                  decodedImages: number;
                }>;
              }
            ).__lmsNativePrintProof || [],
        ),
      { timeout: 90000 },
    )
    .not.toEqual([]);
  const printProof = await printPage.evaluate(
    () =>
      (
        window as typeof window & {
          __lmsNativePrintProof?: Array<{
            pages: number;
            decodedImages: number;
          }>;
        }
      ).__lmsNativePrintProof!,
  );
  expect(printProof).toHaveLength(1);
  expect(printProof[0].pages).toBeGreaterThan(0);
  expect(printProof[0].decodedImages).toBe(printProof[0].pages);
  printing.finish({
    nativeBeforePrintObserved: true,
    printProof,
    nativePrintFunctionOverridden: false,
    nativePrintDialogInspected: false,
    physicalPrint: false,
  });
  await printPage.screenshot({
    path: path.join(evidence, "03b-prepared-browser-print.png"),
    fullPage: true,
  });
  await printPage.close();
  const extensionMeasurement = measure(
    page,
    "extend existing learner access",
    "DIRECTOR",
    "existing learner administration",
    "Results list open with the known learner visible",
    "Enter only a new access date for the existing enrollment",
  );
  await extensionMeasurement.action(
    "click",
    "Open the known learner",
    () =>
      page.getByRole("button", { name: fixture.fullName, exact: true }).click(),
    { decision: true },
  );
  await extensionMeasurement.action("click", "Open access dates", () =>
    page.getByText("Срок доступа", { exact: true }).click(),
  );
  await extensionMeasurement.action("field", "New access date", () =>
    page.getByLabel("Доступ до", { exact: true }).fill("2027-12-31"),
  );
  const extension = page.waitForResponse((r) =>
    r.url().endsWith(`/api/lms/enrollments/${fixture.enrollmentId}/extend`),
  );
  await extensionMeasurement.action(
    "click",
    "Confirm the new access date",
    () =>
      page
        .getByRole("button", { name: "Обновить срок доступа", exact: true })
        .click(),
    { decision: true, confirmation: true },
  );
  expect((await extension).ok()).toBe(true);
  await expect(page.getByText("Срок обновлён", { exact: true })).toBeVisible();
  const detail = await (
    await page.request.get(`/api/lms/enrollments/${fixture.enrollmentId}`)
  ).json();
  expect(detail.dueAt.startsWith("2027-12-31")).toBe(true);
  extensionMeasurement.finish({ dueAt: detail.dueAt });
  const employerContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
    viewport: { width: 390, height: 900 },
  });
  const employer = await employerContext.newPage();
  await login(employer, fixture.employer);
  const employerMeasurement = measure(
    employer,
    "employer own document download",
    "EMPLOYER",
    "other role prepared repeat",
    "Employer authenticated; results page not yet opened",
    "Find and download the saved document of an own employee",
  );
  await employerMeasurement.action("navigate", "Open results", () =>
    employer.goto("/lms/results"),
  );
  await expect(
    employer.getByRole("button", { name: fixture.fullName, exact: true }),
  ).toBeVisible();
  await expect(
    employer.getByText(fixture.foreignName, { exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await employer.request.get(
        `/api/lms/enrollments/${fixture.foreignEnrollmentId}`,
      )
    ).status(),
  ).toBe(404);
  await employerMeasurement.action(
    "click",
    "Open own employee",
    () =>
      employer
        .getByRole("button", { name: fixture.fullName, exact: true })
        .click(),
    { decision: true },
  );
  const ownPdf = employer
    .getByRole("link", { name: "Скачать PDF", exact: true })
    .first();
  await expect(ownPdf).toBeVisible();
  const employerDownload = employer.waitForEvent("download");
  await employerMeasurement.action(
    "click",
    "Download the saved PDF",
    () => ownPdf.click(),
    { decision: true },
  );
  await (
    await employerDownload
  ).saveAs(path.join(evidence, "employer-own-document.pdf"));
  await expect(employer.getByText("Срок доступа", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await employer.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await employer.screenshot({
    path: path.join(evidence, "04-employer-own-documents-390.png"),
    fullPage: true,
  });
  employerMeasurement.finish({
    downloaded: true,
    foreignEnrollmentStatus: 404,
  });
  await employerContext.close();
  const directorRecovery = measure(
    page,
    "create one-time recovery link for a known learner",
    "DIRECTOR",
    "account recovery authorized role",
    "Director remains on the known learner detail",
    "Create one recovery link without entering the learner data again",
  );
  await directorRecovery.action("click", "Open learner access controls", () =>
    page.getByText("Доступ к обучению", { exact: true }).click(),
  );
  await directorRecovery.action(
    "click",
    "Create one-time recovery link",
    () =>
      page
        .getByRole("button", {
          name: "Создать ссылку восстановления",
          exact: true,
        })
        .click(),
    { decision: true, confirmation: true },
  );
  const recoveryUrl = await page
    .getByLabel("Ссылка восстановления доступа", { exact: true })
    .inputValue();
  expect(recoveryUrl).toContain("/learn/recovery?token=");
  directorRecovery.finish({ linkCreated: true, secretExcluded: true });
  const recoveryContext = await browser.newContext({
    baseURL: process.env.DEMO_ORIGIN,
  });
  const recovery = await recoveryContext.newPage();
  const learnerRecovery = measure(
    recovery,
    "exchange one-time recovery link",
    "LEARNER",
    "account recovery other participant",
    "Learner has a one-time recovery URL and an unauthenticated browser context",
    "Choose a new password and return to the ordinary login screen",
  );
  await learnerRecovery.action(
    "navigate",
    "Open the supplied recovery URL",
    () => recovery.goto(recoveryUrl),
  );
  const newPassword = "Synthetic-LMS-recovered-20261015!";
  await learnerRecovery.action("field", "New password", () =>
    recovery.getByLabel("Пароль", { exact: true }).fill(newPassword),
  );
  await learnerRecovery.action(
    "click",
    "Confirm password change",
    () =>
      recovery
        .getByRole("button", { name: "Изменить пароль", exact: true })
        .click(),
    { decision: true, confirmation: true, navigation: true },
  );
  await expect(recovery).toHaveURL(/\/login/);
  learnerRecovery.finish({ passwordChanged: true, redirectedToLogin: true });
  const recoveredLogin = measure(
    recovery,
    "authenticate after recovery",
    "LEARNER",
    "authentication separate from business data",
    "Ordinary login form opened after recovery; existing email and new password known",
    "Authenticate and reach the existing learning records",
  );
  await recoveredLogin.action("field", "Existing login email", () =>
    recovery
      .getByLabel("Электронная почта", { exact: true })
      .fill(fixture.learner),
  );
  await recoveredLogin.action("field", "Chosen recovery password", () =>
    recovery.getByLabel("Пароль", { exact: true }).fill(newPassword),
  );
  await recoveredLogin.action(
    "click",
    "Log in after recovery",
    () => recovery.getByRole("button", { name: "Войти", exact: true }).click(),
    { decision: true, navigation: true },
  );
  await expect(recovery).toHaveURL(/\/learn/);
  recoveredLogin.finish(
    { existingLearningOpened: true },
    {
      authenticationFields: 2,
      repeatedFields: 2,
      repeatedBusinessFields: 0,
      scopeNote:
        "Both known credentials are counted as re-entered authentication fields; no name, employer, program or result is entered again. This is separate from all prepared business-action budgets.",
    },
  );
  await recovery.screenshot({
    path: path.join(evidence, "05-recovered-my-learning.png"),
    fullPage: true,
  });
  await recoveryContext.close();
  await fs.writeFile(
    path.join(evidence, "actions.json"),
    JSON.stringify(
      {
        fixtureVersion: fixture.fixtureVersion,
        setup: fixture.setup,
        checkedAt: new Date().toISOString(),
        metrics,
        measurementConventions:
          "Every measured application action is recorded through measureLmsActions. Counts are derived from completed actions; JS dialogs and visible application dialogs are observed. Explicit business commits are confirmations; disclosure, navigation and download are not. Semantic fill is counted separately from physical keystrokes. Elapsed time includes required response waits and verification readback; screenshots after finish are excluded. Initial director/employer authentication and fixture construction are preconditions, never claimed as first-entry work.",
        checks: {
          actualThreeDocumentZip: true,
          directorDecision: true,
          ownEmployerDownload: true,
          foreignEmployer404: true,
          extensionPersisted: true,
          recoveryLogin: true,
        },
        secretsExcluded: true,
      },
      null,
      2,
    ),
  );
});
