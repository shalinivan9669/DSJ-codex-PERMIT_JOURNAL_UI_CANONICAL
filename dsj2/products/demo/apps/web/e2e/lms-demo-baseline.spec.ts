import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { measureLmsActions } from "./lms-action-measurement";
import {
  knownPrintInput,
  readPrintDetail,
  realApprovalRoles,
  waitOriginalJobs,
  write,
} from "./operator-role-fixture";

const product = path.resolve(__dirname, "../../..");
async function currentRuntime() {
  const distDirectory = process.env.DEMO_NEXT_DIST_DIR || ".next";
  const buildId = await fs
    .readFile(path.join(product, "apps/web", distDirectory, "BUILD_ID"), "utf8")
    .then((value) => value.trim())
    .catch(() => null);
  return {
    origin: process.env.DEMO_ORIGIN,
    distDirectory,
    buildId,
    runtimeKind: buildId
      ? "current production build"
      : "build identity unavailable",
    historicalBeforeMeasurement: false,
  };
}

test("current DEMO draft: known person autosaves and survives a return without a new wizard", async ({
  page,
}) => {
  const root = path.resolve(
    process.env.DEMO_E2E_EVIDENCE ||
      path.join(
        __dirname,
        "../../../docs/evidence/lms-one-run-20261015/agent-c",
      ),
  );
  const phase = process.env.DEMO_LMS_BASELINE_PHASE || "current-draft";
  const directory = path.join(root, phase);
  await fs.mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  const begin = performance.now();
  const steps: string[] = [];
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_ADMIN_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/requests");
  await expect(
    page.getByRole("heading", { name: "Заявки на печать", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(directory, "01-requests.png"),
    fullPage: true,
  });
  steps.push(
    "Authenticate with the actual login form: two entered credentials, one click; open requests.",
  );
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Новая заявка", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/\/requests\/[^/]+\/edit/);
  steps.push(
    "Create person request with default customer kind: New request link, Next button.",
  );
  const editUrl = page.url();
  const name = page
    .locator('[data-field-path="items.0.fullNameRu"]:visible')
    .first();
  await expect(name).toBeVisible();
  await name.fill("Синтетический Тестовый Участник");
  await name.press("Tab");
  await expect
    .poll(async () => {
      const id = new URL(editUrl).pathname.split("/")[2];
      const response = await page.request.get(`/api/print-requests/${id}`);
      const value = await response.json();
      return value.items?.[0]?.fullNameRu;
    })
    .toBe("Синтетический Тестовый Участник");
  await page.screenshot({
    path: path.join(directory, "02-autosaved.png"),
    fullPage: true,
  });
  steps.push(
    "Enter one previously unknown full name, press Tab; real API confirms autosave.",
  );
  await page.goto("/requests");
  await page.goto(editUrl);
  await expect(
    page.locator('[data-field-path="items.0.fullNameRu"]:visible').first(),
  ).toHaveValue("Синтетический Тестовый Участник");
  await expect(
    page.getByRole("heading", { name: "Новая заявка", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(directory, "03-resumed.png"),
    fullPage: true,
  });
  steps.push(
    "Leave and return to existing edit URL; name preserved, no customer-type wizard.",
  );
  await fs.writeFile(
    path.join(directory, "actions.json"),
    JSON.stringify(
      {
        phase,
        scenario: "ordinary DEMO draft entry/autosave/resume",
        startedAt,
        finishedAt: new Date().toISOString(),
        runtime: await currentRuntime(),
        role: "DIRECTOR",
        preconditions:
          "Synthetic center setup through existing setup command; no precreated request. Aggregate counts include the two login fields and login click; the steps identify authentication explicitly.",
        counts: {
          clicks: 3,
          keyboardActions: 1,
          filledFields: 3,
          repeatedFields: 0,
          decisions: 1,
          navigation: 5,
          dialogs: 0,
          confirmations: 0,
          manualRefresh: 0,
          elapsedMilliseconds: Math.round(performance.now() - begin),
        },
        steps,
        result: "PASS",
        limitations: [
          "This measures draft entry/autosave/resume only, not issuance, approval, documents or physical print.",
          "This is current-code regression, not an original before measurement or a claim of measured improvement.",
        ],
      },
      null,
      2,
    ),
  );
});

test("current ordinary DEMO: prepared compact group, manual exception, director preview and decision, real files and honest unsigned publication guard", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(600000);
  const directory = process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "lms-demo-current-cycle")
    : testInfo.outputDir;
  await fs.mkdir(directory, { recursive: true });
  const setupStarted = performance.now();
  const roles = await realApprovalRoles(browser, page);
  const measurements: unknown[] = [];
  const suffix = randomUUID().slice(0, 8);
  const prerequisites = [
    "Prepared current ordinary DEMO regression, not first entry: two known synthetic people, company, print assignments, dates and ordinary center signatories are created through actual authorized API calls before measurement.",
    "Operator and director already authenticated in separate real-role contexts; no LMS course, enrollment, VerifiedExamResult, signing receipt or workflow override is supplied.",
  ];
  const measure = (
    target: Page,
    phase: string,
    role: string,
    startState: string,
    goal: string,
  ) => {
    const value = measureLmsActions(
      target,
      phase,
      role,
      startState,
      prerequisites,
    );
    return {
      action: value.action,
      finish(result: unknown) {
        const actual = value.finish(result);
        measurements.push({
          ...actual,
          phase,
          startState,
          goal,
          actualSteps: actual.steps,
          filledFields: actual.fields,
        });
      },
    };
  };
  try {
    await roles.configureSignatories();
    const customer = await write(page, roles.operator.headers, "/customers", {
      nameRu: `Синтетический обычный работодатель ${suffix}`,
      nameKz: `Синтетикалық кәдімгі жұмыс беруші ${suffix}`,
    });
    const input = knownPrintInput(2, {
      kind: "COMPANY",
      customerId: customer.id,
      title: `Синтетический обычный цикл ${suffix}`,
    });
    for (const row of input.items) {
      row.fullNameRu = `${row.fullNameRu} ${suffix}`;
      for (const assignment of row.assignments)
        assignment.outcome = { status: "PASSED", source: "AUTO" };
    }
    const created = await write(
      page,
      roles.operator.headers,
      "/print-requests",
      input,
    );
    const id = created.id as string;
    const before = await readPrintDetail(page, id);
    const setupMilliseconds = performance.now() - setupStarted;
    const operator = measure(
      page,
      "З: current ordinary prepared group and one manual exception",
      "OPERATOR",
      "Authenticated operator, prepared current request exists; editor not yet open",
      "Keep the compact two-person list, save one individual exception and submit the same group for director review",
    );
    await operator.action(
      "navigate",
      "Open the existing ordinary request",
      () => page.goto(`/requests/${id}/edit`),
    );
    await expect(page.locator(".operator-grid")).toBeVisible();
    await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
      input.items[0].fullNameRu,
    );
    const exception = page
      .locator('[data-field-path="items.1.positionRu"]:visible')
      .first();
    await operator.action(
      "field",
      "New individual position exception in row two",
      () => exception.fill("Синтетический мастер участка"),
    );
    await operator.action("key", "Leave the edited field with Tab", () =>
      exception.press("Tab"),
    );
    await expect
      .poll(async () => (await readPrintDetail(page, id)).items[1].positionRu)
      .toBe("Синтетический мастер участка");
    await operator.action(
      "navigate",
      "Return to requests without losing saved rows",
      () => page.goto("/requests"),
    );
    await operator.action(
      "navigate",
      "Resume the same request without a new wizard",
      () => page.goto(`/requests/${id}/edit`),
    );
    await expect(exception).toHaveValue("Синтетический мастер участка");
    await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
      input.items[0].fullNameRu,
    );
    await expect(
      page.getByRole("heading", { name: "Новая заявка", exact: true }),
    ).toHaveCount(0);
    await operator.action(
      "click",
      "Submit the prepared group to director",
      () =>
        page
          .getByRole("button", { name: /^Проверить и передать директору/ })
          .click(),
      { decision: true, confirmation: true },
    );
    await expect
      .poll(async () => (await readPrintDetail(page, id)).approval?.status)
      .toBe("PENDING");
    const pending = await readPrintDetail(page, id);
    operator.finish({
      status: "PENDING",
      requestId: id,
      people: pending.items.length,
      exceptionRetained: true,
      namesReentered: false,
    });
    await page.screenshot({
      path: path.join(directory, "01-current-compact-group.png"),
      fullPage: true,
    });

    const director = measure(
      roles.directorPage,
      "З: separate director preview, download and decision",
      "DIRECTOR",
      "Director already authenticated; submitted immutable revision exists",
      "Inspect a real PDF, download its DOCX and approve that exact revision",
    );
    await director.action("navigate", "Open the submitted revision", () =>
      roles.directorPage.goto(
        `/approvals?proposal=${pending.approval!.proposalId}`,
      ),
    );
    const viewer = roles.directorPage.getByRole("region", {
      name: "Предпросмотр назначенных документов",
    });
    await director.action(
      "select",
      "Choose existing first person and form for preview",
      () =>
        viewer
          .getByRole("combobox", {
            name: "Человек и форма документа",
            exact: true,
          })
          .selectOption(
            JSON.stringify({
              kind: "ASSIGNMENT",
              rowId: pending.items[0].id,
              assignmentId: pending.items[0].assignments[0].id,
            }),
          ),
      { decision: true },
    );
    await director.action(
      "click",
      "Render the actual submitted document preview",
      () =>
        viewer
          .getByRole("button", {
            name: /^(Создать|Обновить|Повторить) предпросмотр$/,
          })
          .click(),
      { decision: true },
    );
    await expect(
      viewer.getByRole("img", { name: /^Страница 1 из/ }),
    ).toBeVisible({ timeout: 180000 });
    const downloadedPreview = roles.directorPage.waitForEvent("download");
    await director.action(
      "click",
      "Download actual preview DOCX",
      () =>
        viewer.getByRole("link", { name: "Скачать DOCX", exact: true }).click(),
      { decision: true },
    );
    await (
      await downloadedPreview
    ).saveAs(path.join(directory, "director-preview.docx"));
    expect(
      (await fs.readFile(path.join(directory, "director-preview.docx")))
        .subarray(0, 2)
        .toString(),
    ).toBe("PK");
    await director.action(
      "click",
      "Approve this exact ordinary revision",
      () =>
        roles.directorPage
          .getByRole("button", {
            name: "Согласовать эту редакцию",
            exact: true,
          })
          .click(),
      { decision: true, confirmation: true },
    );
    await expect
      .poll(async () => (await readPrintDetail(page, id)).approval?.status)
      .toBe("APPROVED");
    director.finish({
      approved: true,
      preview: "real PDF",
      downloaded: "real DOCX",
      proposalId: pending.approval!.proposalId,
    });
    await roles.directorPage.screenshot({
      path: path.join(directory, "02-director-preview-approved.png"),
      fullPage: true,
    });

    const generation = measure(
      page,
      "З: approved ordinary prepared files",
      "OPERATOR",
      "Original operator editor still open; director decision arrives without manual refresh",
      "Generate saved ordinary files with no LMS fields or repeated people/forms",
    );
    const generate = page.getByRole("button", {
      name: "Сформировать документы",
      exact: true,
    });
    await expect(generate).toBeEnabled({ timeout: 60000 });
    await generation.action(
      "click",
      "Generate the approved ordinary documents",
      () => generate.click(),
      { decision: true, confirmation: true },
    );
    await expect
      .poll(async () => (await readPrintDetail(page, id)).issuances.length)
      .toBe(1);
    await waitOriginalJobs(page, id, 240000);
    const prepared = await readPrintDetail(page, id);
    expect(prepared.items[0].positionRu).toBe(before.items[0].positionRu);
    expect(prepared.items[1].positionRu).toBe("Синтетический мастер участка");
    for (const row of prepared.items)
      for (const assignment of row.assignments) {
        expect(assignment.outcome?.status).toBe("PASSED");
        expect(assignment.outcome?.source).toBe("AUTO");
        expect(assignment.lms).toBeUndefined();
      }
    generation.finish({
      requestId: id,
      documents: prepared.documents.length,
      realOriginalFiles: prepared.artifacts.filter(
        (value) => value.provenance === "ORIGINAL",
      ).length,
      historicalAutoPreserved: true,
      assignmentLmsMetadataAdded: false,
    });

    const inspection = measure(
      page,
      "З: ordinary saved PDF and unsigned publication boundary",
      "OPERATOR",
      "Ordinary documents and artifacts prepared; genuine required signatures are not configured",
      "Download a real prepared PDF and see the precise block on official unsigned publication",
    );
    await inspection.action(
      "navigate",
      "Open the current saved request record",
      () => page.goto(`/requests/${id}`),
    );
    const artifact = prepared.artifacts.find(
      (value) => value.provenance === "ORIGINAL" && value.format === "PDF",
    )!;
    expect(artifact).toBeTruthy();
    const download = page.waitForEvent("download");
    await inspection.action(
      "click",
      "Download the saved prepared PDF",
      () =>
        page
          .locator(`.artifact-list a[href="/api/artifacts/${artifact.id}"]`)
          .click(),
      { decision: true },
    );
    await (
      await download
    ).saveAs(path.join(directory, "ordinary-prepared.pdf"));
    expect(
      (await fs.readFile(path.join(directory, "ordinary-prepared.pdf")))
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    await expect(
      page.getByRole("button", { name: "Реестр XLSX", exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .locator("summary")
        .filter({ hasText: "Ссылка и QR для проверки записи" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Комплект ожидает электронных подписей/),
    ).toBeVisible();
    const guard = await page.request.post("/api/verification-links", {
      headers: roles.operator.headers,
      data: {
        documentId: prepared.documents[0].id,
        publicationConfirmed: true,
      },
    });
    expect(guard.status()).toBe(409);
    expect((await guard.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
    inspection.finish({
      downloadedPreparedPdf: true,
      officialRegistryDisabled: true,
      unsignedQrUnavailable: true,
      verificationGuardStatus: 409,
      noSignatureInvented: true,
    });
    await page.screenshot({
      path: path.join(directory, "03-ordinary-prepared-signature-boundary.png"),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(directory, "actions.json"),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          runtime: await currentRuntime(),
          source: {
            requestId: id,
            proposalId: pending.approval!.proposalId,
            issuanceId: prepared.issuances[0].id,
          },
          phase: "current ordinary regression",
          prerequisites,
          setupMilliseconds,
          measurements,
          historicalBeforeMeasurement:
            "Excluded by user instruction; this current test does not fabricate a before value or time saving.",
          publicationBoundary:
            "Ordinary prepared files retain the existing real-signature requirement. Positive registry/QR is covered separately by the LMS information-card flow; this ordinary path proves its honest unsigned guard without bypass.",
          physicalPrint: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await roles.close();
  }
});
