import { test, expect, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  fullSuiteApiCooldown,
  fullSuiteRunId,
  requireEmptyFullPreparation,
} from "./operator-full-suite";
import { draftSchema } from "@demo/contracts";
import { newAssignment, newRecipient, type Customer } from "../lib/types";
import { loginIsolated } from "./operator-full-fix-session";
import { openRecipientExtraTools } from "./operator-keyboard-helpers";
import {
  readCommon,
  commonEvidence,
  expandCommon,
  commonSettings,
  personRecord,
  directorCommonSession,
  verifyCommonFiles,
  type CommonCheckpoint,
  type ExpectedCommonRow,
  type CommonDetail,
} from "./operator-common-history-helpers";

test.use({ trace: "off" });
const evidence = commonEvidence("producer");
test("100 common assignments and supported individual overrides render consistently, real director approval and employer history preserve the issued snapshot", async ({
  page,
  browser,
}) => {
  test.setTimeout(3600000);
  await requireEmptyFullPreparation(evidence);
  await fs.mkdir(evidence, { recursive: true });
  await fullSuiteApiCooldown(evidence, "common-producer-before-ui");
  const headers = await loginIsolated(page),
    started = performance.now(),
    checkpoints: CommonCheckpoint["checkpoints"] = [];
  const sessionResponse = await page.request.get("/api/auth/session");
  expect(sessionResponse.ok()).toBe(true);
  const session = await sessionResponse.json();
  expect(session.tenant.demoOnly).toBe(true);
  await fs.writeFile(
    path.join(evidence, "common-session-readback.json"),
    JSON.stringify(
      {
        suiteRunId: fullSuiteRunId(),
        tenantId: session.tenant.id,
        tenantDemoOnly: session.tenant.demoOnly,
        userId: session.user.id,
        role: session.user.role,
        origin: new URL(page.url()).origin,
        actualAuthenticatedSessionVerified: true,
        capturedUtc: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  let requestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requestCount++;
  });
  let companies: Customer[] = [];
  let requestId: string, personId: string, externalId: string;
  let expected: ExpectedCommonRow[],
    issued: CommonDetail,
    checkpoint: CommonCheckpoint;
  let modal: Locator;
  const continuationDirectory = process.env.DEMO_E2E_COMMON_CONTINUE_CHECKPOINT;
  if (continuationDirectory) {
    const directory = path.resolve(continuationDirectory);
    const ownedRoots = [
      path.resolve(
        __dirname,
        "../../../docs/evidence/operator-flow-full-fix-20261003/preparation/attempts",
      ),
      path.resolve(
        __dirname,
        "../../../docs/evidence/operator-details-ux-20261005/full-e2e-02/common-prepared",
      ),
    ];
    expect(
      ownedRoots.some((owned) => {
        const relative = path.relative(owned, directory);
        return (
          !path.isAbsolute(relative) &&
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`)
        );
      }),
    ).toBe(true);
    checkpoint = JSON.parse(
      await fs.readFile(path.join(directory, "checkpoint.json"), "utf8"),
    );
    expect(checkpoint.version).toBe(2);
    expect(checkpoint.synthetic).toBe(true);
    expect(checkpoint.status).toBe("ISSUED_WAITING_FILES");
    requestId = checkpoint.requestId;
    personId = checkpoint.personId;
    companies = checkpoint.companies;
    issued = checkpoint.issued;
    externalId = issued.items[0].externalId!;
    const actual = await readCommon(page, requestId);
    expect(actual.status).toBe("FINALIZED");
    const documentOrder = (records: CommonDetail["documents"]) =>
      [...records].sort((a, b) => a.id.localeCompare(b.id));
    expect(documentOrder(actual.documents)).toEqual(
      documentOrder(issued.documents),
    );
    expect(actual.issuances).toEqual(issued.issuances);
    expect(actual.items).toEqual(issued.items);
    checkpoints.push(...checkpoint.checkpoints, {
      step: "continued-same-issued-checkpoint-without-reapproval-or-regeneration",
      originalEvidence: directory,
      elapsedMs: performance.now() - started,
    });
    checkpoint.checkpoints = checkpoints;
    await page.goto(`/requests/${requestId}`);
    await fs.writeFile(
      path.join(evidence, "checkpoint.json"),
      JSON.stringify(checkpoint, null, 2),
    );
  } else {
    for (const [index, suffix] of ["A", "B"].entries()) {
      const response = await page.request.post("/api/customers", {
        headers,
        data: {
          nameRu: `Синтетический исторический работодатель ${suffix} ${randomUUID().slice(0, 8)}`,
          nameKz: `Синтетикалық жұмыс беруші ${suffix}`,
          bin: `000${Date.now().toString().slice(-8)}${index}`,
          addressRu: "Синтетический адрес",
          addressKz: "Синтетикалық мекенжай",
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      companies.push(await response.json());
    }
    const group = randomUUID(),
      individual = randomUUID(),
      importedSubject =
        "Синтетическая индивидуальная импортированная программа Б",
      manualSubject = "Синтетическая индивидуальная ручная программа А",
      commonSubject = "Синтетическая общая подтверждённая программа В";
    externalId = "common-history-" + randomUUID();
    const input = draftSchema.parse({
      kind: "COMPANY",
      customerId: companies[0].id,
      demoMode: true,
      schemaVersion: 2,
      commonFields: {
        documentDate: "2026-10-03",
        trainingSubject: "Синтетическая исходная общая программа",
        trainingStart: "2026-09-20",
        trainingEnd: "2026-09-22",
        protocolDate: "2026-09-22",
        hours: "10",
      },
      events: [
        {
          id: group,
          title: "Синтетические 100 общих назначений БиОТ",
          protocolTemplateId: "biot-protocol",
          protocolMode: "GROUP",
          commonFields: {
            biotCategory: "WORKER",
            productionHours: "16",
            biotCheckType: "PERIODIC",
          },
        },
        {
          id: individual,
          title: "Синтетические 2 индивидуальных назначения ПТМ",
          protocolTemplateId: "ptm-protocol",
          protocolMode: "INDIVIDUAL",
          protocolModeSource: "MANUAL",
          commonFields: {},
        },
      ],
      items: Array.from({ length: 100 }, (_, index) => ({
        ...newRecipient(),
        id: randomUUID(),
        fullNameRu: `Синтетический Общий Получатель ${String(index + 1).padStart(3, "0")}`,
        fullNameKz: `Синтетикалық Алушы ${String(index + 1).padStart(3, "0")}`,
        employeeCategory: "WORKER",
        positionRu: index ? "Синтетический рабочий" : "Должность A до выпуска",
        employerId: companies[0].id,
        employerBin: companies[0].bin,
        workplaceRu: companies[0].nameRu,
        workplaceKz: companies[0].nameKz,
        employmentPeriod: "2025–2026 · синтетический период A",
        personnelNumber: String(index + 1).padStart(6, "0"),
        externalId: index ? `common-${randomUUID()}` : externalId,
        assignments: [
          {
            ...newAssignment("biot-worker-card"),
            id: randomUUID(),
            eventId: group,
            protocolMode: "GROUP",
            hours: "",
            productionHours: "",
            trainingSubject: "",
            fieldOrigins: {
              trainingSubject: "INHERITED",
              hours: "INHERITED",
              productionHours: "INHERITED",
            },
            outcome: { status: "UNKNOWN", source: "" },
          },
          ...(index < 2
            ? [
                {
                  ...newAssignment("ptm-card"),
                  id: randomUUID(),
                  eventId: individual,
                  protocolMode: "INDIVIDUAL",
                  hours: "8",
                  trainingSubject: index ? importedSubject : "",
                  fieldOrigins: {
                    trainingSubject: index ? "IMPORTED" : "INHERITED",
                  },
                  outcome: { status: "UNKNOWN", source: "" },
                },
              ]
            : []),
        ],
      })),
    });
    const createdResponse = await page.request.post("/api/print-requests", {
      headers: {
        ...headers,
        "idempotency-key": "common-history-" + randomUUID(),
      },
      data: input,
    });
    expect(createdResponse.ok(), await createdResponse.text()).toBe(true);
    const created = await createdResponse.json();
    requestId = created.id as string;
    await page.goto(`/requests/${requestId}/edit`);
    await expect(page.locator(".operator-grid tbody tr")).toHaveCount(100);
    expect(
      (await readCommon(page, requestId)).items.every((item) =>
        item.assignments.every(
          (assignment) =>
            assignment.outcome?.status === "UNKNOWN" &&
            !assignment.outcome.confirmedAt,
        ),
      ),
    ).toBe(true);
    checkpoints.push({
      step: "fresh-100-UNKNOWN",
      elapsedMs: performance.now() - started,
      revision: created.revision,
      rows: 100,
      apiSetup: true,
    });
    await page
      .getByRole("button", { name: "Детали получателя 1", exact: true })
      .click();
    modal = page.getByRole("dialog");
    const ptm = modal.locator("details[data-assignment-id]").filter({
      has: page.locator(
        '[data-field-path="items.0.assignments.1.trainingSubject"]',
      ),
    });
    await expandCommon(ptm);
    await ptm
      .getByRole("tab", { name: "Обучение и результат", exact: true })
      .click();
    await modal
      .locator('[data-field-path="items.0.assignments.1.trainingSubject"]')
      .fill(manualSubject);
    await modal
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await readCommon(page, requestId)).items[0].assignments[1]
            .trainingSubject,
      )
      .toBe(manualSubject);
    let root = await commonSettings(page);
    await root
      .getByLabel("Программа / тема для заявки", { exact: true })
      .fill(commonSubject);
    await expect
      .poll(
        async () =>
          (await readCommon(page, requestId)).commonFields?.trainingSubject,
      )
      .toBe(commonSubject);
    await page.reload();
    const resolvedResponse = await page.request.get(
        `/api/print-requests/${requestId}/resolved`,
      ),
      resolved = await resolvedResponse.json(),
      beforeIssue = await readCommon(page, requestId);
    expect(
      beforeIssue.items[0].assignments[1].fieldOrigins?.trainingSubject,
    ).toBe("MANUAL");
    expect(
      beforeIssue.items[1].assignments[1].fieldOrigins?.trainingSubject,
    ).toBe("IMPORTED");
    expected = resolved.draft.items.map(
      (item: (typeof beforeIssue.items)[number], index: number) => ({
        rowId: item.id,
        fullNameRu: item.fullNameRu,
        assignments: item.assignments.map((assignment) => {
          expect(assignment.trainingSubject).toBe(
            assignment.templateId.startsWith("ptm-")
              ? index
                ? importedSubject
                : manualSubject
              : commonSubject,
          );
          expect(assignment.trainingStart).toBe("2026-09-20");
          expect(assignment.trainingEnd).toBe("2026-09-22");
          return {
            id: assignment.id,
            templateId: assignment.templateId,
            trainingSubject: assignment.trainingSubject,
            documentDate: assignment.documentDate,
            trainingStart: assignment.trainingStart,
            trainingEnd: assignment.trainingEnd,
          };
        }),
      }),
    );
    for (const row of [1, 2, 100]) {
      await page
        .getByRole("button", { name: `Детали получателя ${row}`, exact: true })
        .click();
      modal = page.getByRole("dialog");
      const main = modal.locator("details[data-assignment-id]").first();
      await main
        .getByRole("tab", { name: "Обучение и результат", exact: true })
        .click();
      await expect(
        modal.locator(
          `[data-field-path="items.${row - 1}.assignments.0.trainingSubject"]`,
        ),
      ).toHaveValue(commonSubject);
      if (row < 3) {
        const extra = modal.locator("details[data-assignment-id]").nth(1);
        await expandCommon(extra);
        await extra
          .getByRole("tab", { name: "Обучение и результат", exact: true })
          .click();
        await expect(
          modal.locator(
            `[data-field-path="items.${row - 1}.assignments.1.trainingSubject"]`,
          ),
        ).toHaveValue(row === 1 ? manualSubject : importedSubject);
      }
      await modal
        .getByRole("button", { name: "Вернуться к списку", exact: true })
        .click();
    }
    checkpoints.push({
      step: "100-common-and-two-supported-individual-overrides-reloaded",
      elapsedMs: performance.now() - started,
      rawOrigins: ["MANUAL", "IMPORTED"],
      uiRows: [1, 2, 100],
    });
    modal = await personRecord(page);
    await modal
      .getByLabel(
        "Подтверждаю актуальность сведений для постоянной записи человека",
      )
      .check();
    await modal
      .getByRole("button", {
        name: "Сохранить человека в справочник",
        exact: true,
      })
      .click();
    await expect(
      modal.getByText(
        "Текущие сведения человека сохранены в справочнике. Оформленные документы остаются неизменными.",
        { exact: true },
      ),
    ).toBeVisible();
    await modal
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await expect
      .poll(
        async () => (await readCommon(page, requestId)).items[0].recipientId,
      )
      .toBeTruthy();
    personId = (await readCommon(page, requestId)).items[0].recipientId!;
    root = await commonSettings(page);
    for (const eventId of [group, individual]) {
      await root
        .getByLabel("Обучение для общих данных и результатов", { exact: true })
        .selectOption(eventId);
      await root
        .getByLabel("Известный результат", { exact: true })
        .selectOption("PASSED");
      await root
        .getByLabel("Источник подтверждения", { exact: true })
        .fill(
          "СИНТЕТИЧЕСКАЯ известная ведомость для проверки 100; не реальное обучение",
        );
      await expect(
        root.locator("details.outcome-entry > .preparation-status"),
      ).toContainText("сохранена");
      await root
        .getByRole("button", {
          name: /^Применить результат · \d+ человек$/,
        })
        .click();
      await expect
        .poll(async () =>
          (await readCommon(page, requestId)).items
            .flatMap((item) => item.assignments)
            .filter((assignment) => assignment.eventId === eventId)
            .every(
              (assignment) =>
                assignment.outcome?.status === "PASSED" &&
                !!assignment.outcome.confirmedBy &&
                !!assignment.outcome.confirmedAt,
            ),
        )
        .toBe(true);
    }
    let applied = await readCommon(page, requestId);
    checkpoints.push({
      step: "explicit-UI-results-server-confirmed",
      elapsedMs: performance.now() - started,
      revision: applied.revision,
      outcomes: applied.items.flatMap((item) => item.assignments).length,
    });
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible({ timeout: 180000 });
    await page
      .getByLabel(/Все подтверждённые ещё не оформленные курсы/)
      .check();
    await page
      .getByRole("button", { name: /Проверить и передать директору/ })
      .click();
    await expect
      .poll(async () => (await readCommon(page, requestId)).approval?.status)
      .toBe("PENDING");
    applied = await readCommon(page, requestId);
    const directorContext = await browser.newContext(),
      directorPage = await directorContext.newPage();
    try {
      await directorCommonSession(directorPage);
      await directorPage.goto(
        `/approvals?proposal=${applied.approval!.proposalId}`,
      );
      await directorPage
        .getByLabel("Комментарий к решению", { exact: true })
        .fill(
          "СИНТЕТИЧЕСКОЕ согласование 100 назначений и двух индивидуальных исключений",
        );
      await directorPage
        .getByRole("button", { name: "Согласовать эту редакцию", exact: true })
        .click();
      await expect
        .poll(async () => (await readCommon(page, requestId)).approval?.status)
        .toBe("APPROVED");
      await directorPage.screenshot({
        path: path.join(evidence, "director-100-approved.png"),
        fullPage: true,
      });
    } finally {
      await directorContext.close();
    }
    await page.reload();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    await expect
      .poll(async () => (await readCommon(page, requestId)).status)
      .toBe("FINALIZED");
    issued = await readCommon(page, requestId);
    expect(issued.documents).toHaveLength(105);
    checkpoint = {
      version: 2,
      suiteRunId: fullSuiteRunId(),
      synthetic: true,
      status: "ISSUED_WAITING_FILES",
      requestId,
      personId,
      companies,
      expected,
      expectedDocuments: 105,
      expectedDocumentFiles: 210,
      issued,
      checkpoints,
    };
    checkpoints.push({
      step: "approved-and-issued-105-documents",
      elapsedMs: performance.now() - started,
      revision: issued.revision,
      documents: issued.documents.length,
    });
    await fs.writeFile(
      path.join(evidence, "checkpoint.json"),
      JSON.stringify(checkpoint, null, 2),
    );
    console.log(
      `[COMMON_RENDER_DISPATCHED] ${requestId}; 105 actual documents; immutable issuance saved`,
    );
  }
  const verified = await verifyCommonFiles(page, checkpoint, evidence);
  checkpoints.push({
    step: "rendered-and-inspected-210-real-document-files",
    elapsedMs: performance.now() - started,
    jobs: verified.jobs.length,
    files: verified.files.length,
  });
  checkpoint.files = verified.files;
  const denied = await page.request.post(
    `/api/print-requests/${requestId}/export`,
    { headers, data: { format: "XLSX" } },
  );
  expect(denied.status()).toBe(409);
  expect((await denied.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
  const savedAggregates = verified.issued.artifacts.filter(
    (artifact) =>
      artifact.issuanceId === checkpoint.issued.issuances[0].id &&
      ["XLSX", "ZIP"].includes(artifact.format || ""),
  );
  expect(
    savedAggregates.filter((artifact) => artifact.format === "XLSX"),
  ).toHaveLength(1);
  expect(
    savedAggregates.filter((artifact) => artifact.format === "ZIP").length,
  ).toBeGreaterThanOrEqual(1);
  const aggregateGuardReadback = [];
  for (const artifact of savedAggregates) {
    const download = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(download.status()).toBe(409);
    const guard = await download.json();
    expect(guard.code).toBe("ISSUANCE_NOT_COMPLETE");
    aggregateGuardReadback.push({
      id: artifact.id,
      format: artifact.format,
      issuanceId: artifact.issuanceId,
      sha256: artifact.sha256,
      size: artifact.size,
      publicStatus: download.status(),
      publicCode: guard.code,
    });
  }
  await fs.writeFile(
    path.join(evidence, "common-public-aggregate-guard.json"),
    JSON.stringify(
      {
        suiteRunId: fullSuiteRunId(),
        requestId,
        tenantId: session.tenant.id,
        issuanceId: checkpoint.issued.issuances[0].id,
        status: "VERIFIED_PUBLIC_UNSIGNED_DELIVERY_GUARD",
        files: aggregateGuardReadback,
        noSignatureOrWorkflowMutation: true,
      },
      null,
      2,
    ),
  );
  const nextResponse = await page.request.post("/api/print-requests", {
    headers,
    data: {
      kind: "COMPANY",
      customerId: companies[0].id,
      schemaVersion: 2,
      demoMode: true,
      commonFields: { documentDate: "2026-10-03" },
      events: [],
      trainingDefaults: [],
      items: [],
    },
  });
  expect(nextResponse.ok(), await nextResponse.text()).toBe(true);
  const nextCreated = await nextResponse.json(),
    nextId = nextCreated.id as string;
  await page.goto(`/requests/${nextId}/edit`);
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Найти человека", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(externalId);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await expect
    .poll(async () => (await readCommon(page, nextId)).items[0]?.recipientId)
    .toBe(personId);
  const reused = await readCommon(page, nextId);
  expect(reused.items[0].assignments).toHaveLength(0);
  expect(reused.events).toHaveLength(0);
  expect(reused.documents).toHaveLength(0);
  modal = await personRecord(page);
  await modal
    .getByRole("button", { name: "Выбрать работодателя", exact: true })
    .click();
  await page
    .getByLabel("Поиск по справочнику", { exact: true })
    .fill(companies[1].nameRu);
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Выбрать", exact: true })
    .click();
  await modal
    .locator('[data-field-path="items.0.positionRu"]')
    .fill("Должность B после выпуска");
  await modal
    .getByLabel("Период работы / основание актуальности", { exact: true })
    .fill("2027 · синтетический период B");
  await modal
    .getByLabel(
      "Подтверждаю актуальность сведений для постоянной записи человека",
    )
    .check();
  await modal
    .getByRole("button", {
      name: "Обновить текущие сведения человека",
      exact: true,
    })
    .click();
  await expect(
    modal.getByText(
      "Текущие сведения человека сохранены в справочнике. Оформленные документы остаются неизменными.",
      { exact: true },
    ),
  ).toBeVisible();
  await modal
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  await expect
    .poll(async () => (await readCommon(page, nextId)).items[0].employerId)
    .toBe(companies[1].id);
  const historyResponse = await page.request.get(`/api/recipients/${personId}`),
    history = await historyResponse.json();
  expect(history.employment).toHaveLength(2);
  const preserved = await readCommon(page, requestId);
  expect(preserved.issuances).toEqual(issued.issuances);
  expect(preserved.items[0].employerId).toBe(companies[0].id);
  expect(preserved.items[0].positionRu).toBe("Должность A до выпуска");
  for (const file of verified.files.filter(
    (file) =>
      preserved.documents.find((document) => document.id === file.documentId)
        ?.rowId === preserved.items[0].id,
  )) {
    const response = await page.request.get(`/api/artifacts/${file.id}`);
    expect(response.ok()).toBe(true);
    const { createHash } = await import("node:crypto");
    expect(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    ).toBe(file.sha256);
  }
  await page.goto(`/requests/${requestId}`);
  await expect(
    page.getByRole("button", { name: "Сформировать документы", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidence, "historical-issued-unchanged.png"),
    fullPage: true,
  });
  checkpoints.push({
    step: "employer-history-and-existing-file-hashes-preserved",
    elapsedMs: performance.now() - started,
    historyPeriods: history.employment.length,
    nextRequestAssignments: 0,
  });
  checkpoint.nextId = nextId;
  checkpoint.status = "FILES_AND_HISTORY_VERIFIED";
  await fs.writeFile(
    path.join(evidence, "checkpoint.json"),
    JSON.stringify(checkpoint, null, 2),
  );
  await fs.writeFile(
    path.join(evidence, "common-history-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        suiteRunId: fullSuiteRunId(),
        requestId,
        nextId,
        personId,
        companies,
        actualRecipients: 100,
        actualDocuments: 105,
        actualDocumentFiles: 210,
        actualJobs: verified.jobs.length,
        mappedFieldsUiAndResolvedAndRenderedWordAgree: true,
        programmeScope:
          "Programs verified in UI/resolver and the 102 personal cards. Preserved BIOT/PTM protocol templates do not map SUBJECT; protocol dates/results/numbers/names verified in saved Word.",
        twoSupportedIndividualOverrides: ["MANUAL", "IMPORTED"],
        currentEmployerChanged: true,
        historicalSnapshotAndFileHashesUnchanged: true,
        reusedPersonHasNoOldAssignmentsDatesOrResult: true,
        officialUnsignedExport: "DENIED_ISSUANCE_NOT_COMPLETE",
        apiSetup: true,
        realUiResultApplyAndDirectorApproval: true,
        noMocks: true,
        sameFreshCheckpointContinuation: continuationDirectory || null,
        apiRequests: requestCount,
        elapsedMs: performance.now() - started,
        humanActiveMs: null,
        checkpoints,
      },
      null,
      2,
    ),
  );
});
