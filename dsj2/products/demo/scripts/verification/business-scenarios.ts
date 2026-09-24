import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { db, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../setup";
import { context, saveCustomer, saveUser } from "../../apps/api/src/settings";
import {
  listRecipients,
  recipientDetail,
  saveRecipient,
} from "../../apps/api/src/recipients";
import {
  createRequest,
  patchRequest,
  requestDetail as rawRequestDetail,
  listRequests,
  resolvedRequest,
  validateRequest,
  finalize,
  correction,
} from "../../apps/api/src/requests";
import {
  importPreview,
  collectRegistryRows,
  readArtifact,
  registryExport,
  store,
} from "../../apps/api/src/files";
import {
  previewImportReconciliation,
  applyImportReconciliation,
} from "../../apps/api/src/imports";
import { saveExportProfile } from "../../apps/api/src/delivery";
import {
  controlSheet,
  exportControlSheet,
  confirmControlSheet,
  clarificationRequest,
  recordTransfer,
  listTransfers,
} from "../../apps/api/src/delivery-approval";
import * as value from "../../apps/api/src/operator-value";
import {
  claimJob,
  executeJob,
  heartbeat,
} from "../../apps/render-worker/src/queue";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
  type Draft,
  type RequestItemInput,
} from "../../packages/contracts/src";
import { PRODUCT_ROOT } from "../../packages/printing/src";
import { assertTestDatabase } from "../../tests/integration/test-database";
import { businessBackupEvidence } from "./business-backup-evidence";

type Step = {
  operation: string;
  phase: "API" | "RENDER";
  durationMs: number;
  status: "PASS" | "FAIL";
};
type Scenario = {
  id: string;
  status: "RUNNING" | "PASS" | "FAIL";
  layer: string;
  steps: Step[];
  assertions: string[];
  evidence: Record<string, unknown>;
  automationActiveMs?: number;
  renderWorkerMs?: number;
  apiActionCount?: number;
  humanActiveMs: null;
  manualReentryCount: null;
  browserVerified: false;
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const code = (expected: string) => (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "getResponse" in error &&
  (error as { getResponse(): { code: string } }).getResponse().code ===
    expected;
const round = (n: number) => Math.round(n * 100) / 100;
async function requestDetail(c: Context, id: string) {
  const record = await rawRequestDetail(c, id);
  return { ...record, ...draftSchema.parse(record.draft) };
}

/** Real persisted API services and worker; deliberately does not label automation time as operator time. */
export async function runBusinessScenarios(
  output = join(
    PRODUCT_ROOT,
    "docs/evidence/operator-value/business-execution.json",
  ),
) {
  assertTestDatabase();
  const started = performance.now();
  const directory = join(output, "..", "business-execution");
  await mkdir(directory, { recursive: true });
  const fixturePath = join(
    PRODUCT_ROOT,
    "tests/fixtures/operator-value/DAILY_WORKFLOWS.json",
  );
  const fixtureBytes = await readFile(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.productionUseAllowed, false);
  const report = {
    schema: "executed-daily-workflows-v1",
    synthetic: true,
    productionUseAllowed: false,
    executedAt: new Date().toISOString(),
    fixture: "tests/fixtures/operator-value/DAILY_WORKFLOWS.json",
    fixtureSha256: sha(fixtureBytes),
    executionLayer:
      "API_SERVICE_INTEGRATION_WITH_REAL_POSTGRESQL_AND_RENDER_WORKER",
    status: "RUNNING",
    tenantId: "",
    database: new URL(process.env.DATABASE_URL!).pathname.slice(1),
    measurement:
      "apiActionCount counts recorded calls to actual API service functions, including explicit denied/replayed calls. It is not clicks, human steps or SQL count. automationActiveMs sums API service wall durations, including server validation and import/XLSX/ZIP derivatives; renderWorkerMs separately sums canonical document worker durations including conversion. Wall time also includes assertions, fixture setup, file IO and evidence inspection. Human time, re-entry and ROI were not measured.",
    excluded: [
      "V01 and V07 have separately owned browser evidence",
      "No claim of human usability, ROI, legal approval, Microsoft Word verification or physical printing",
    ],
    scenarios: [] as Scenario[],
    wallMs: 0,
    resumedAt: [] as string[],
    failedAttempts: [] as Scenario[],
  };
  let priorWallMs = 0;
  if (process.env.DEMO_BUSINESS_RESUME === "1") {
    const previous = JSON.parse(await readFile(output, "utf8"));
    assert.equal(previous.fixtureSha256, report.fixtureSha256);
    assert.equal(previous.database, report.database);
    assert.equal(previous.synthetic, true);
    Object.assign(report, previous);
    priorWallMs = previous.wallMs;
    report.resumedAt = [
      ...(previous.resumedAt || []),
      new Date().toISOString(),
    ];
    report.failedAttempts = [
      ...(previous.failedAttempts || []),
      ...report.scenarios.filter((s) => s.status === "FAIL"),
    ];
    report.scenarios = report.scenarios.filter((s) => s.status === "PASS");
    report.status = "RUNNING";
  }
  let active: Scenario;
  const persist = async () => {
    for (const s of report.scenarios) {
      s.apiActionCount = s.steps.filter((step) => step.phase === "API").length;
      s.automationActiveMs = round(
        s.steps
          .filter((step) => step.phase === "API")
          .reduce((n, step) => n + step.durationMs, 0),
      );
      s.renderWorkerMs = round(
        s.steps
          .filter((step) => step.phase === "RENDER")
          .reduce((n, step) => n + step.durationMs, 0),
      );
    }
    report.wallMs = round(priorWallMs + performance.now() - started);
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  };
  const step = async <T>(
    operation: string,
    fn: () => Promise<T>,
    phase: Step["phase"] = "API",
  ): Promise<T> => {
    const mark = performance.now();
    try {
      const result = await fn();
      active.steps.push({
        operation,
        phase,
        durationMs: round(performance.now() - mark),
        status: "PASS",
      });
      return result;
    } catch (error) {
      active.steps.push({
        operation,
        phase,
        durationMs: round(performance.now() - mark),
        status: "FAIL",
      });
      throw error;
    }
  };
  const scenario = async (id: string, run: () => Promise<void>) => {
    if (report.scenarios.some((s) => s.id === id && s.status === "PASS"))
      return;
    active = {
      id,
      status: "RUNNING",
      layer: report.executionLayer,
      steps: [],
      assertions: [],
      evidence: {},
      humanActiveMs: null,
      manualReentryCount: null,
      browserVerified: false,
    };
    report.scenarios.push(active);
    try {
      await run();
      active.status = "PASS";
      console.log(`${id} PASS (${active.steps.length} recorded actions)`);
    } catch (error) {
      active.status = "FAIL";
      active.evidence.error = String(error);
      report.status = "FAIL";
      throw error;
    } finally {
      await persist();
    }
  };
  let c: Context;
  let operator: Context;
  const person = new Map<string, RequestItemInput>();
  let customerA: string, customerB: string;
  let simpleRequest: string,
    historyRequest: string,
    supplementalHistory: string,
    smallRequest: string,
    handoverOrder: string;
  let originalPdf: {
    id: string;
    sha256: string;
    number: string;
    documentId: string;
  };
  if (report.tenantId) {
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: report.tenantId },
    });
    assert.equal(tenant.demoOnly, true);
    const user = await db.user.findFirstOrThrow({
      where: { tenantId: tenant.id, role: "ADMIN" },
    });
    c = {
      tenantId: tenant.id,
      userId: user.id,
      role: "ADMIN",
      sessionId: "verification",
      csrfHash: "verification",
      correlationId: randomUUID(),
    };
    const savedEvidence = (id: string) =>
      report.scenarios.find((s) => s.id === id)?.evidence;
    simpleRequest = savedEvidence("V10")?.requestId as string;
    const setup = savedEvidence("FIXTURE_SETUP");
    if (setup) {
      customerA = setup.customerA as string;
      customerB = setup.customerB as string;
      historyRequest = setup.historyRequest as string;
      supplementalHistory = setup.supplementalHistory as string;
      originalPdf = setup.originalPdf as typeof originalPdf;
      for (const [key, recipientId] of Object.entries(
        setup.recipients as Record<string, string>,
      )) {
        const record = await db.recipient.findFirstOrThrow({
          where: { tenantId: c.tenantId, id: recipientId },
        });
        const source = fixture.people.find(
          (p: { externalPersonKey: string }) => p.externalPersonKey === key,
        );
        const { externalPersonKey: _key, ...fields } = source;
        person.set(
          key,
          itemSchema.parse({
            ...fields,
            id: key,
            externalId: key,
            recipientId: record.id,
            employerId: customerA,
            employmentPeriod: "2026-01-01 — ACTIVE",
          }),
        );
      }
      const second = await db.user.findFirstOrThrow({
        where: { tenantId: c.tenantId, displayName: "SYNTHETIC_OPERATOR_B" },
      });
      operator = { ...c, userId: second.id, role: "OPERATOR" };
    }
    smallRequest = savedEvidence("V03")?.requestId as string;
    handoverOrder = savedEvidence("V05")?.orderId as string;
  }
  const assignment = () =>
    assignmentSchema.parse({
      id: "pb",
      templateId: "pb-card",
      protocolMode: "EXTERNAL_REFERENCE",
      externalBasisNumber: "DEMO-DAILY-EXTERNAL-1",
      documentDate: "2026-09-22",
      protocolDate: "2026-09-22",
      trainingStart: "2026-09-20",
      trainingEnd: "2026-09-22",
      trainingSubject: "Синтетическая программа ПБ",
      result: "Сдал",
      outcome: {
        status: "PASSED",
        source:
          "DAILY_WORKFLOWS separateSyntheticResults: explicit synthetic input",
      },
    });
  const row = (key: string, order?: number) => ({
    ...person.get(key)!,
    assignments: [assignment()],
    ...(order === undefined ? {} : { sourceOrder: order }),
  });
  const drain = async (requestId: string) => {
    const owner = "business-scenarios-" + randomUUID();
    const initial = await db.generationJob.count({
      where: { tenantId: c.tenantId, requestId },
    });
    assert.ok(initial > 0);
    for (let n = 0; n < initial + 1; n++) {
      const pending = await db.generationJob.count({
        where: {
          tenantId: c.tenantId,
          requestId,
          status: { not: "SUCCEEDED" },
        },
      });
      if (!pending) break;
      await step(
        "render-worker.claim-and-execute",
        async () => {
          const job = await claimJob(db, owner, c.tenantId);
          assert.ok(job, "Expected a claimable real generation job");
          assert.equal(job.requestId, requestId);
          const beat = setInterval(() => {
            void heartbeat(db, job, owner);
          }, 5000);
          try {
            await executeJob(
              db,
              store,
              job,
              owner,
              new AbortController().signal,
            );
          } finally {
            clearInterval(beat);
          }
          const completed = await db.generationJob.findUniqueOrThrow({
            where: { id: job.id },
          });
          assert.equal(
            completed.status,
            "SUCCEEDED",
            `${completed.kind}: ${completed.errorCode} ${completed.errorMessage}`,
          );
        },
        "RENDER",
      );
    }
    assert.equal(
      await db.generationJob.count({
        where: {
          tenantId: c.tenantId,
          requestId,
          status: { not: "SUCCEEDED" },
        },
      }),
      0,
    );
  };
  const issue = async (draft: Draft) => {
    const request = await step("requests.create", () =>
      createRequest(c, draft),
    );
    const validation = await step("requests.validate", () =>
      validateRequest(c, request.id, { expectedRevision: 0 }),
    );
    assert.deepEqual(validation.issues, []);
    await step("requests.finalize", () =>
      finalize(c, request.id, { expectedRevision: 0 }, randomUUID()),
    );
    await drain(request.id);
    return request.id;
  };
  try {
    await scenario("V10", async () => {
      const seeded = await step("setup.provision-supported-demo-center", () =>
        provision({
          email: `daily-${randomUUID()}@example.test`,
          password: "Synthetic-daily-Password!",
          name: "DAILY — синтетический учебный центр",
          sample: true,
        }),
      );
      c = {
        ...seeded,
        role: "ADMIN",
        sessionId: "verification",
        csrfHash: "verification",
        correlationId: randomUUID(),
      };
      report.tenantId = c.tenantId;
      const initial = await step("settings.context", () =>
        context(c, "verification"),
      );
      assert.equal(initial.tenant.demoOnly, true);
      assert.ok(
        initial.templates.some((t) => t.templateId === "pb-card" && t.approved),
      );
      const first = fixture.people[0];
      const initialDraft = draftSchema.parse({
        kind: "PERSON",
        demoMode: true,
        title: "V10 — первый простой документ",
        items: [
          {
            id: first.externalPersonKey,
            fullNameRu: first.fullNameRu,
            fullNameKz: first.fullNameKz,
            positionRu: first.positionRu,
            assignments: [
              { ...assignment(), outcome: { status: "UNKNOWN" }, result: "" },
            ],
          },
        ],
      });
      const incomplete = await step("requests.create-unknown-result", () =>
        createRequest(c, initialDraft),
      );
      const help = await step("requests.validate-contextual-issues", () =>
        validateRequest(c, incomplete.id, { expectedRevision: 0 }),
      );
      assert.ok(
        help.issues.some(
          (i) => i.code === "RESULT_UNCONFIRMED" || i.code.includes("RESULT"),
        ),
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
        0,
      );
      const completed = {
        ...initialDraft,
        items: initialDraft.items.map((p) => ({
          ...p,
          assignments: [assignment()],
        })),
      };
      await step("requests.save-explicit-synthetic-result", () =>
        patchRequest(c, incomplete.id, {
          expectedRevision: 0,
          draft: completed,
        }),
      );
      assert.deepEqual(
        (
          await step("requests.validate-complete", () =>
            validateRequest(c, incomplete.id, { expectedRevision: 1 }),
          )
        ).issues,
        [],
      );
      await step("requests.finalize", () =>
        finalize(c, incomplete.id, { expectedRevision: 1 }, randomUUID()),
      );
      simpleRequest = incomplete.id;
      await drain(simpleRequest);
      const detail = await step("requests.read-saved-files", () =>
        requestDetail(c, simpleRequest),
      );
      assert.ok(detail.artifacts.some((a) => a.format === "PDF"));
      assert.equal(detail.customerId, null);
      assert.equal(
        await db.serviceOrder.count({ where: { tenantId: c.tenantId } }),
        0,
      );
      assert.equal(
        await db.employerMembership.count({ where: { tenantId: c.tenantId } }),
        0,
      );
      active.evidence = {
        requestId: simpleRequest,
        issueHints: help.issues.map((i) => ({
          code: i.code,
          path: i.path,
          message: i.message,
        })),
        documentIds: detail.documents.map((d) => d.id),
        setupPath:
          "supported scripts/setup.ts provision(sample:true); no raw SQL edits",
      };
      active.assertions.push(
        "Demo-only supported setup yields approved pinned form/profile/counters",
        "Missing result produces contextual validation and no number",
        "Explicit synthetic result then actual finalized PDF with no customer, order, payment or portal dependency",
      );
    });
    await scenario("FIXTURE_SETUP", async () => {
      const customerFixture = JSON.parse(
        await readFile(
          join(
            PRODUCT_ROOT,
            "tests/fixtures/operator-value/issuer_and_customer.json",
          ),
          "utf8",
        ),
      );
      const createdCustomers = [];
      for (const source of customerFixture.customers) {
        const { id: _key, ...payload } = source;
        createdCustomers.push(
          await step("settings.create-customer", () =>
            saveCustomer(c, payload),
          ),
        );
      }
      [customerA, customerB] = createdCustomers.map((record) => record.id);
      for (const source of fixture.people) {
        const { externalPersonKey, ...fields } = source;
        const input = itemSchema.parse({
          ...fields,
          id: externalPersonKey,
          externalId: externalPersonKey,
          employerId: customerA,
          employmentPeriod: "2026-01-01 — ACTIVE",
        });
        const saved = await step("recipients.create-with-employment", () =>
          saveRecipient(c, input),
        );
        person.set(externalPersonKey, { ...input, recipientId: saved.id });
      }
      const second = await step("settings.create-second-operator", () =>
        saveUser(c, {
          email: `daily-operator-${randomUUID()}@example.test`,
          displayName: "SYNTHETIC_OPERATOR_B",
          role: "OPERATOR",
          password: "Synthetic-Operator-Password!",
        }),
      );
      operator = { ...c, userId: second.id, role: "OPERATOR" };
      // The order in this actual historical issuance is the explicit V08 source order.
      historyRequest = await issue(
        draftSchema.parse({
          kind: "COMPANY",
          customerId: customerA,
          demoMode: true,
          title: "V02/V06/V08/V09 — оформленная история",
          items: fixture.cases.V08.personKeys.map(
            (key: string, index: number) => row(key, index),
          ),
        }),
      );
      supplementalHistory = await issue(
        draftSchema.parse({
          kind: "COMPANY",
          customerId: customerA,
          demoMode: true,
          title: "V06 — история для внешнего основания и завершённой работы",
          items: [row("DEMO-P004"), row("DEMO-P005")],
        }),
      );
      const document = await db.issuedDocument.findFirstOrThrow({
        where: {
          tenantId: c.tenantId,
          requestId: historyRequest,
          rowId: "DEMO-P001",
          templateId: "pb-card",
        },
      });
      const artifact = await db.artifact.findFirstOrThrow({
        where: { tenantId: c.tenantId, documentId: document.id, format: "PDF" },
      });
      originalPdf = {
        id: artifact.id,
        sha256: artifact.sha256,
        number: document.number,
        documentId: document.id,
      };
      active.evidence = {
        historyRequest,
        supplementalHistory,
        customerA,
        customerB,
        recipients: Object.fromEntries(
          [...person].map(([key, p]) => [key, p.recipientId]),
        ),
        originalPdf,
      };
      active.assertions.push(
        "Fixture history was finalized by real product API and all jobs actually rendered, not inserted as fake finalized records",
      );
    });
    await scenario("V02", async () => {
      const saved = person.get("DEMO-P001")!;
      const before = await step("recipients.read-history", () =>
        recipientDetail(c, saved.recipientId!),
      );
      const originalSnapshot = await db.issuance.findFirstOrThrow({
        where: { requestId: historyRequest },
      });
      const search = await step("recipients.search-stable-id", () =>
        listRecipients(c, { search: saved.externalId }),
      );
      assert.ok(search.items.some((p) => p.id === saved.recipientId));
      const changed = {
        ...saved,
        employerId: customerB,
        positionRu: "Новая синтетическая должность у работодателя B",
        workplaceRu: "ДЕМО — Вторая тестовая организация",
        employmentPeriod: "2026-09-23 — ACTIVE",
        assignments: [],
      };
      await step("recipients.save-current-employer", () =>
        saveRecipient(c, changed, saved.recipientId),
      );
      const history = await step("recipients.reopen-employment-history", () =>
        recipientDetail(c, saved.recipientId!),
      );
      assert.equal(history.employment.length, before.employment.length + 1);
      assert.ok(history.employment.some((e) => e.employerId === customerA));
      assert.ok(history.employment.some((e) => e.employerId === customerB));
      assert.ok(history.requests.some((r) => r.requestId === historyRequest));
      const fresh = await step("requests.new-employer-unknown-result", () =>
        createRequest(
          c,
          draftSchema.parse({
            kind: "COMPANY",
            customerId: customerB,
            demoMode: true,
            items: [
              {
                ...changed,
                assignments: [
                  {
                    id: "new",
                    templateId: "pb-card",
                    outcome: { status: "UNKNOWN" },
                  },
                ],
              },
            ],
          }),
        ),
      );
      assert.equal(fresh.items[0].assignments[0].outcome?.status, "UNKNOWN");
      assert.equal(fresh.items[0].assignments[0].result, "");
      await step("requests.reject-new-unknown-result-issuance", () =>
        assert.rejects(
          finalize(c, fresh.id, { expectedRevision: 0 }, randomUUID()),
          code("FINALIZE_VALIDATION"),
        ),
      );
      assert.equal(
        hash(
          (
            await db.issuance.findUniqueOrThrow({
              where: { id: originalSnapshot.id },
            })
          ).snapshot,
        ),
        hash(originalSnapshot.snapshot),
      );
      assert.equal(
        sha(
          (
            await step("artifacts.read-original-after-employer-change", () =>
              readArtifact(c, originalPdf.id),
            )
          ).buffer,
        ),
        originalPdf.sha256,
      );
      active.evidence = {
        recipientId: saved.recipientId,
        oldEmployerId: customerA,
        newEmployerId: customerB,
        newRequestId: fresh.id,
        employmentIds: history.employment.map((e) => e.id),
        originalPdf,
      };
      active.assertions.push(
        "Stable person lookup, old/new employer periods persist separately",
        "Old request snapshot and PDF hash unchanged after current employer update",
        "New employer request has explicit UNKNOWN and empty result",
      );
    });
    await scenario("V03", async () => {
      const draft = draftSchema.parse({
        kind: "COMPANY",
        customerId: customerA,
        demoMode: true,
        title: "V03 — три человека, два направления",
        commonFields: {
          trainingSubject: "Общая согласованная тема",
          documentDate: "2026-09-22",
        },
        items: fixture.cases.V03.personKeys.map((key: string) => ({
          ...row(key),
          positionRu:
            key === "DEMO-P003"
              ? fixture.cases.V03.individualOverride.value
              : "Общая тестовая должность",
          assignments: [
            { id: "pb", templateId: "pb-card" },
            { id: "ptm", templateId: "ptm-card" },
          ],
        })),
      });
      const created = await step(
        "requests.create-two-service-small-order",
        () => createRequest(c, draft),
      );
      const changed = {
        ...draft,
        commonFields: {
          ...draft.commonFields,
          trainingSubject: "Уточнённая общая тема",
        },
      };
      await step("requests.change-shared-value", () =>
        patchRequest(c, created.id, { expectedRevision: 0, draft: changed }),
      );
      const reopened = await step("requests.reopen", () =>
        requestDetail(c, created.id),
      );
      const resolved = await step("requests.resolve-shared-values", () =>
        resolvedRequest(c, created.id),
      );
      assert.equal(reopened.items.length, 3);
      assert.equal(
        resolved.draft.items.flatMap((p) => p.assignments).length,
        6,
      );
      assert.ok(
        resolved.draft.items
          .flatMap((p) => p.assignments)
          .every((a) => a.trainingSubject === "Уточнённая общая тема"),
      );
      assert.equal(
        reopened.items.find((p) => p.id === "DEMO-P003")!.positionRu,
        fixture.cases.V03.individualOverride.value,
      );
      assert.ok(
        reopened.items
          .filter((p) => p.id !== "DEMO-P003")
          .every((p) => p.positionRu === "Общая тестовая должность"),
      );
      smallRequest = created.id;
      active.evidence = {
        requestId: created.id,
        revision: reopened.revision,
        assignments: 6,
        individualPosition: reopened.items.find((p) => p.id === "DEMO-P003")!
          .positionRu,
      };
      active.assertions.push(
        "Three persisted people each retain two assignments",
        "Shared value change resolves across six assignments on reopen while individual position exception persists",
      );
    });
    await scenario("V04", async () => {
      const source = fixture.cases.V04.sourcePeople as Record<string, string>[];
      const sourceKeys = source.map((p) => p.externalPersonKey);
      const initial = draftSchema.parse({
        kind: "COMPANY",
        customerId: customerA,
        demoMode: true,
        title: "V04 — сверка небольшого списка",
        items: sourceKeys.map((key) => row(key)),
      });
      const request = await step("requests.create-six-source-rows", () =>
        createRequest(c, initial),
      );
      const changedPeople = fixture.cases.V04.revisedPeople as Record<
        string,
        string
      >[];
      const fields = [
        "externalPersonKey",
        "personnelNumber",
        "fullNameRu",
        "fullNameKz",
        "positionRu",
        "positionKz",
        "departmentRu",
        "departmentKz",
        "workplaceRu",
        "workplaceKz",
      ];
      const bytes = Buffer.from(
        [
          fields.join("\t"),
          ...changedPeople.map((p) => fields.map((f) => p[f] || "").join("\t")),
        ].join("\r\n"),
      );
      const imported = await step("imports.upload-real-tsv", () =>
        importPreview(c, {
          buffer: bytes,
          size: bytes.length,
          originalname: "V04-revised.tsv",
        } as Express.Multer.File),
      );
      const incoming = changedPeople.map((p, index) => {
        const { externalPersonKey, ...fields } = p;
        return itemSchema.parse({
          ...fields,
          id: "import-" + index,
          externalId: externalPersonKey,
          employerId: customerA,
          employmentPeriod: "2026-01-01 — ACTIVE",
          importId: imported.importId,
          sourceRow: imported.rows[index].sourceRow,
        });
      });
      const payload = {
        expectedRevision: 0,
        importId: imported.importId,
        rows: incoming,
      };
      const difference = await step("imports.preview-reconciliation", () =>
        previewImportReconciliation(c, request.id, payload),
      );
      assert.deepEqual(difference.counts, {
        added: 1,
        changed: 1,
        unchanged: 4,
        missing: 1,
        ambiguous: 0,
      });
      const op = { ...payload, operationKey: randomUUID() };
      const applied = await step("imports.apply-explicit-diff", () =>
        applyImportReconciliation(c, request.id, op),
      );
      await step("imports.replay-same-operation", () =>
        applyImportReconciliation(c, request.id, op),
      );
      const after = await step("requests.reopen-reconciled", () =>
        requestDetail(c, request.id),
      );
      assert.equal(after.revision, 1);
      assert.equal(after.items.length, 7);
      assert.ok(
        after.items.every((p) => /^0\d{5}$/.test(p.personnelNumber || "")),
      );
      assert.equal(
        after.items.find((p) => p.externalId === "DEMO-P002")!.positionRu,
        "Тестовая уточнённая должность",
      );
      assert.ok(after.items.some((p) => p.externalId === "DEMO-P006"));
      assert.deepEqual(
        after.items.find((p) => p.externalId === "DEMO-P001")!.assignments,
        request.items[0].assignments,
      );
      assert.ok(
        await db.recipient.findFirst({
          where: {
            id: person.get("DEMO-P006")!.recipientId,
            tenantId: c.tenantId,
          },
        }),
      );
      const control = await step("control-sheet.read-current-facts", () =>
        controlSheet(c, request.id),
      );
      const controlFile = await step(
        "control-sheet.export-unnumbered-xlsx",
        () => exportControlSheet(c, request.id, { format: "XLSX" }),
      );
      await writeFile(
        join(directory, "V04-control-sheet.xlsx"),
        controlFile.buffer,
      );
      await step("control-sheet.record-explicit-synthetic-confirmation", () =>
        confirmControlSheet(c, request.id, {
          expectedRevision: after.revision,
          meaningfulHash: control.meaningfulHash,
          confirmedBy: "Синтетический представитель A",
          source:
            "DAILY_WORKFLOWS V04: explicit synthetic confirmation, not sending or e-signature",
        }),
      );
      const withMissingName = draftSchema.parse(after.draft);
      withMissingName.items = withMissingName.items.map((p) =>
        p.externalId === "DEMO-P007" ? { ...p, fullNameRu: "" } : p,
      );
      await step("requests.change-significant-confirmed-field", () =>
        patchRequest(c, request.id, {
          expectedRevision: after.revision,
          draft: withMissingName,
        }),
      );
      const stale = await step("control-sheet.check-stale-confirmation", () =>
        controlSheet(c, request.id),
      );
      assert.notEqual(stale.meaningfulHash, control.meaningfulHash);
      assert.ok(
        stale.confirmations.length === 1 && !stale.confirmations[0].current,
      );
      const clarification = await step(
        "clarification.prepare-current-source-row-only",
        () => clarificationRequest(c, request.id),
      );
      const sourceRow = withMissingName.items.find(
        (p) => p.externalId === "DEMO-P007",
      )!.sourceRow;
      assert.ok(
        clarification.items.length > 0 &&
          clarification.items.every(
            (i) => i.sourceRow === sourceRow && i.personnelNumber === "000007",
          ),
      );
      assert.equal(clarification.sent, false);
      await writeFile(
        join(directory, "V04-clarification.txt"),
        clarification.text,
      );
      active.evidence = {
        requestId: request.id,
        importId: imported.importId,
        diff: difference.counts,
        result: applied,
        rowsAfterRetainingMissing: 7,
        controlHash: control.meaningfulHash,
        changedHash: stale.meaningfulHash,
        confirmationCurrent: stale.confirmations[0].current,
        clarification: { items: clarification.items, sent: clarification.sent },
      };
      active.assertions.push(
        "Actual TSV parse retains leading-zero personnel identifiers",
        "Exact fixture diff 1 added / 1 changed / 1 missing / 4 unchanged",
        "One atomic revision with idempotent replay; missing person and assignments retained",
        "Explicit control confirmation goes stale after significant edit; clarification names only current source row, sent=false",
      );
    });
    await scenario("V05", async () => {
      const events = ["TEST-EVENT-A", "TEST-EVENT-B"].map((key) => ({
        id: randomUUID(),
        title: key,
        protocolTemplateId: "pb-protocol",
        commonFields: {
          trainingSubject: key,
          documentDate: "2026-09-22",
          protocolDate: "2026-09-22",
          trainingStart: "2026-09-20",
          trainingEnd: "2026-09-22",
        },
      }));
      const draft = draftSchema.parse({
        kind: "COMPANY",
        customerId: customerA,
        title: "V05 — передача работы",
        demoMode: true,
        events,
        items: fixture.cases.V05.personKeys.map((key: string, i: number) => ({
          ...row(key),
          assignments: [
            {
              ...assignment(),
              protocolMode: "GROUP",
              eventId: events[i < 4 ? 0 : 1].id,
              ...(key === "DEMO-P008"
                ? { result: "", outcome: { status: "UNKNOWN" } }
                : {}),
            },
          ],
        })),
      });
      const request = await step(
        "requests.create-eight-people-two-events",
        () => createRequest(c, draft),
      );
      const order = await step("orders.create-linked-working-order", () =>
        value.createServiceOrder(c, {
          title: "V05 — рабочая очередь",
          customerId: customerA,
          ownerId: c.userId,
          requestIds: [request.id],
        }),
      );
      handoverOrder = order.id;
      const resultTask = await step(
        "orders.assign-pending-result-to-second-operator",
        () =>
          value.createOrderMilestone(c, order.id, {
            label: "result_for_DEMO-P008",
            category: "RESULTS",
            source: "CONTRACT",
            sourceReference: "DAILY_WORKFLOWS V05",
            ownerId: operator.userId,
          }),
      );
      const material = await step(
        "orders.record-pending-customer-material",
        () =>
          value.createOrderMilestone(c, order.id, {
            label: "agreed_material_to_customer",
            category: "EVIDENCE",
            source: "CONTRACT",
            sourceReference: "DAILY_WORKFLOWS V05",
          }),
      );
      await step("orders.transfer-order-owner", () =>
        value.patchServiceOrder(c, order.id, {
          expectedRevision: 0,
          ownerId: operator.userId,
        }),
      );
      const queue = await step("operator-B.open-work-queue", () =>
        value.listServiceOrders(operator, "V05"),
      );
      assert.ok(
        queue.items[0].nextActions.some(
          (a) => a.id === resultTask.id && a.ownerId === operator.userId,
        ),
      );
      const overview = await step("manager.read-live-blocker-summary", () =>
        value.operatorValueSummary(c),
      );
      assert.ok(
        overview.actions.some(
          (a) =>
            a.orderId === order.id &&
            a.id === resultTask.id &&
            a.ownerId === operator.userId,
        ),
      );
      const read = await step("operator-B.reopen-request", () =>
        requestDetail(operator, request.id),
      );
      const completed = draftSchema.parse({
        ...draft,
        items: read.items.map((p) =>
          p.id === "DEMO-P008"
            ? {
                ...p,
                assignments: p.assignments.map((a) => ({
                  ...a,
                  result: "Сдал",
                  outcome: {
                    status: "PASSED",
                    source:
                      "SYNTHETIC-RESULT-8: explicit second-operator entry",
                  },
                })),
              }
            : p,
        ),
      });
      await step("operator-B.save-explicit-missing-result", () =>
        patchRequest(operator, request.id, {
          expectedRevision: read.revision,
          draft: completed,
        }),
      );
      await step("operator-B.close-only-completed-result-action", () =>
        value.patchOrderMilestone(operator, order.id, resultTask.id, {
          status: "DONE",
          evidence: "SYNTHETIC-RESULT-8: результат внесён в сохранённую заявку",
        }),
      );
      const after = await step("orders.reopen-after-handover", () =>
        value.serviceOrderDetail(c, order.id),
      );
      assert.equal(after.ownerId, operator.userId);
      assert.equal(after.events.length, 2);
      assert.equal(
        after.milestones.find((m) => m.id === resultTask.id)!.status,
        "DONE",
      );
      assert.equal(
        after.milestones.find((m) => m.id === material.id)!.status,
        "PENDING",
      );
      assert.equal(after.status, "OPEN");
      const overviewAfter = await step(
        "manager.refresh-after-actual-result",
        () => value.operatorValueSummary(c),
      );
      assert.ok(!overviewAfter.actions.some((a) => a.id === resultTask.id));
      assert.ok(overviewAfter.actions.some((a) => a.id === material.id));
      await step("orders.reject-premature-completion", () =>
        assert.rejects(
          value.patchServiceOrder(operator, order.id, {
            expectedRevision: after.revision,
            status: "COMPLETED",
          }),
          code("ORDER_INCOMPLETE"),
        ),
      );
      active.evidence = {
        orderId: order.id,
        requestId: request.id,
        operatorA: c.userId,
        operatorB: operator.userId,
        completedActionId: resultTask.id,
        pendingActionId: material.id,
      };
      active.assertions.push(
        "Second operator sees persisted two-event order and assigned unfinished result",
        "Actual result save precedes closing its task",
        "Agreed missing material remains pending; order completion is rejected",
      );
    });
    await scenario("V06", async () => {
      const needs = new Map<string, string>();
      for (const state of fixture.cases.V06.states) {
        const key = state.personKey;
        const sourceRequestId = ["DEMO-P004", "DEMO-P005"].includes(key)
          ? supplementalHistory
          : historyRequest;
        const need = await step("renewals.identify-history-backed-need", () =>
          value.createRenewalNeed(c, {
            customerId: customerA,
            recipientId: person.get(key)!.recipientId,
            sourceRequestId,
            sourceRowId: key,
            assignmentId: "pb",
            policySource:
              "DAILY_WORKFLOWS: explicit synthetic customer review, no invented legal interval",
            policyVersion: "daily-1",
            basisDate: "2026-09-22",
          }),
        );
        needs.set(key, need.id);
      }
      const reviewed = await step("renewals.review-bases", () =>
        value.listRenewals(c),
      );
      assert.equal(reviewed.items.length, 5);
      assert.ok(reviewed.items.every((n) => n.nextCheckDate === null));
      for (const key of ["DEMO-P001", "DEMO-P002"])
        await step("renewals.record-explicit-synthetic-confirmation", () =>
          value.recordRenewalContact(c, needs.get(key)!, {
            occurredOn: "2026-09-22",
            channel: "MANUAL",
            outcome: "CONFIRMED",
            note: "EXPLICIT_CUSTOMER_REQUEST: синтетическое подтверждение актуальности сотрудника и направления",
          }),
        );
      const external = await step("evidence.record-external-issuer", () =>
        value.createExternalEvidence(c, {
          customerId: customerA,
          recipientId: person.get("DEMO-P004")!.recipientId,
          program: "Синтетическая программа ПБ",
          issuer: "ДЕМО — другой учебный центр",
          originalNumber: "DEMO-EXTERNAL-P004",
          documentDate: "2026-09-22",
          source: "SYNTHETIC_EXTERNAL_RECORD",
        }),
      );
      await step("evidence.confirm-external-record", () =>
        value.verifyExternalEvidence(c, external.id, {
          status: "VERIFIED",
          verificationNote:
            "Synthetic source was explicitly compared; no legal authority claim",
        }),
      );
      await step("renewals.exclude-satisfied-externally", () =>
        value.recordRenewalContact(c, needs.get("DEMO-P004")!, {
          occurredOn: "2026-09-22",
          channel: "MANUAL",
          outcome: "IRRELEVANT",
          note: `SATISFIED_EXTERNALLY: ${external.id}`,
        }),
      );
      await step("renewals.exclude-confirmed-ended-employment", () =>
        value.recordRenewalContact(c, needs.get("DEMO-P005")!, {
          occurredOn: "2026-09-22",
          channel: "MANUAL",
          outcome: "IRRELEVANT",
          note: "CONFIRMED_EMPLOYMENT_END: синтетическое явное подтверждение заказчика; сотрудник не входит в текущий состав",
        }),
      );
      const fresh: Awaited<ReturnType<typeof requestDetail>>[] = [];
      for (const key of ["DEMO-P001", "DEMO-P002"]) {
        const created = await step(
          "renewals.create-confirmed-clean-repeat",
          () =>
            value.repeatFromRenewal(c, needs.get(key)!, {
              confirmedCurrent: true,
            }),
        );
        const replay = await step("renewals.retry-without-duplicate", () =>
          value.repeatFromRenewal(c, needs.get(key)!, {
            confirmedCurrent: true,
          }),
        );
        assert.equal(replay.id, created.id);
        const request = await step("requests.inspect-new-repeat", () =>
          requestDetail(c, created.id),
        );
        assert.equal(request.items[0].assignments[0].result, "");
        assert.equal(request.items[0].assignments[0].documentDate, "");
        assert.ok(
          !request.items[0].assignments[0].outcome ||
            request.items[0].assignments[0].outcome?.status === "UNKNOWN",
        );
        fresh.push(request);
      }
      for (const key of ["DEMO-P003", "DEMO-P004", "DEMO-P005"])
        await step("renewals.reject-unconfirmed-or-irrelevant", () =>
          assert.rejects(
            value.repeatFromRenewal(c, needs.get(key)!, {
              confirmedCurrent: true,
            }),
            code("CURRENTNESS_REQUIRED"),
          ),
        );
      assert.deepEqual(
        fresh.flatMap((r) => r.items.map((p) => p.externalId)).sort(),
        fixture.cases.V06.expectedNewRequestPersonKeys,
      );
      const order = await step(
        "orders.combine-two-confirmed-repeat-drafts",
        () =>
          value.createServiceOrder(c, {
            title: "V06 — две подтверждённые потребности",
            customerId: customerA,
            requestIds: fresh.map((r) => r.id),
          }),
      );
      active.evidence = {
        needIds: Object.fromEntries(needs),
        newRequestIds: fresh.map((r) => r.id),
        orderId: order.id,
        personKeys: fresh.flatMap((r) => r.items.map((p) => p.externalId)),
        externalEvidenceId: external.id,
        modelAdaptation:
          "One clean linked draft per confirmed need, both linked into one order; employment ending retained as explicit contact evidence, not inferred from date.",
      };
      active.assertions.push(
        "All five fixture states have persisted history-backed review records",
        "Exactly two confirmed people get clean new drafts; retries reuse same IDs",
        "Unknown, externally satisfied and explicitly ended cases cannot create repeats",
        "Dates not inferred from a fabricated legal interval",
      );
    });
    await scenario("V08", async () => {
      const profile = await step("delivery.save-customer-preferences", () =>
        saveExportProfile(c, {
          name: "V08 — согласованный комплект",
          customerId: customerA,
          sort: "SOURCE_ORDER",
          dateFormat: "DD.MM.YYYY",
          columns: fixture.cases.V08.requiredColumns.map((field: string) => ({
            field,
            title: field,
            type: field === "documentDate" ? "DATE_ONLY" : "TEXT",
          })),
          files: {
            grouping: "BY_PERSON",
            nameFields: ["personnelNumber", "fullNameRu", "documentNumber"],
            includeRegistry: true,
            includeInventory: true,
            includeCoverText: true,
          },
        }),
      );
      const registry = await step("delivery.export-customer-registry", () =>
        registryExport(
          c,
          { format: "XLSX", profileId: profile.id },
          historyRequest,
        ),
      );
      const artifacts = await db.artifact.findMany({
        where: {
          tenantId: c.tenantId,
          requestId: historyRequest,
          documentId: { not: null },
          format: { in: ["PDF", "DOCX"] },
        },
      });
      const bundle = await step("delivery.export-selected-saved-files", () =>
        registryExport(
          c,
          {
            format: "ZIP",
            profileId: profile.id,
            artifactIds: artifacts.map((a) => a.id),
          },
          historyRequest,
        ),
      );
      const xlsxPath = join(directory, "V08-registry.xlsx"),
        zipPath = join(directory, bundle.fileName);
      await writeFile(xlsxPath, registry.buffer);
      await writeFile(zipPath, bundle.buffer);
      const inspection = JSON.parse(
        execFileSync(
          process.env.DEMO_PYTHON!,
          [
            "-c",
            "import sys,json,zipfile,hashlib,openpyxl\nw=openpyxl.load_workbook(sys.argv[1]);s=w.active\nz=zipfile.ZipFile(sys.argv[2]);m=json.loads(z.read('manifest.json'))\nfor f in m['files']+m.get('attachments',[]): assert hashlib.sha256(z.read(f['file'])).hexdigest()==f['sha256']\nprint(json.dumps({'rows':list(s.values),'files':m['files'],'names':z.namelist()},ensure_ascii=True,default=str))",
            xlsxPath,
            zipPath,
          ],
          { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 },
        ),
      );
      assert.deepEqual(
        inspection.rows.slice(1).map((r: string[]) => r[0]),
        ["000003", "000001", "000002"],
      );
      assert.ok(
        inspection.rows
          .slice(1)
          .every(
            (r: string[]) => /^PB-CARD-/.test(r[2]) && r[3] === "22.09.2026",
          ),
      );
      assert.equal(inspection.files.length, 6);
      assert.ok(
        inspection.names.includes("Реестр.xlsx") &&
          inspection.names.includes("Опись.tsv") &&
          inspection.names.includes("Сопроводительное письмо.txt"),
      );
      for (const saved of artifacts)
        assert.ok(
          inspection.files.some(
            (f: { id: string; sha256: string }) =>
              f.id === saved.id && f.sha256 === saved.sha256,
          ),
        );
      const before = await db.numberReservation.count({
        where: { tenantId: c.tenantId },
      });
      assert.equal(
        sha(
          (
            await step("artifacts.repeat-download-existing-file", () =>
              readArtifact(c, originalPdf.id),
            )
          ).buffer,
        ),
        originalPdf.sha256,
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
        before,
      );
      const transferBefore = await step(
        "delivery.check-download-is-not-handover",
        () => listTransfers(c, historyRequest),
      );
      assert.equal(transferBefore.items.length, 0);
      await step("delivery.record-explicit-one-file-handover", () =>
        recordTransfer(c, historyRequest, {
          artifactIds: [originalPdf.id],
          recipient: "Синтетический представитель A",
          occurredOn: "2026-09-22",
          method: "OTHER",
          kind: "TRANSFER",
          reason:
            "DAILY_WORKFLOWS V08: explicit synthetic handover record; no external message sent",
        }),
      );
      const transfer = await step("delivery.reopen-saved-handover", () =>
        listTransfers(c, historyRequest),
      );
      assert.equal(transfer.items.length, 1);
      assert.deepEqual(
        (transfer.items[0].metadata as { artifactIds: string[] }).artifactIds,
        [originalPdf.id],
      );
      active.evidence = {
        requestId: historyRequest,
        profileId: profile.id,
        registry: xlsxPath,
        bundle: zipPath,
        bundleSha256: sha(bundle.buffer),
        fileCount: artifacts.length,
        transferId: transfer.items[0].id,
        personnelOrder: inspection.rows.slice(1).map((r: string[]) => r[0]),
        inspection:
          "Independent openpyxl/zipfile readback and SHA256 check; human recipient review not run",
      };
      active.assertions.push(
        "Configured source order and leading zeros appear in real XLSX",
        "Six actual saved files keep original hashes under friendly names",
        "Registry, inventory and cover text included automatically",
        "Repeated existing file download changes neither bytes nor number count",
        "Download does not create handover; explicit handover names exactly one existing artifact",
      );
    });
    await scenario("V09", async () => {
      const matches = await step("requests.search-person-history", () =>
        listRequests(c, {
          search: person.get("DEMO-P001")!.fullNameRu,
          history: "true",
        }),
      );
      assert.ok(matches.items.some((r) => r.id === historyRequest));
      const historical = await step("registry.find-document-number", () =>
        collectRegistryRows(c, { history: true }, historyRequest),
      );
      assert.ok(JSON.stringify(historical.rows).includes(originalPdf.number));
      const before = await db.numberReservation.count({
        where: { tenantId: c.tenantId },
      });
      const original = await step("artifacts.redownload-original", () =>
        readArtifact(c, originalPdf.id),
      );
      assert.equal(sha(original.buffer), originalPdf.sha256);
      const request = await step("requests.read-history-revision", () =>
        requestDetail(c, historyRequest),
      );
      await step("correction.reject-empty-reason", () =>
        assert.rejects(
          correction(c, historyRequest, {
            expectedRevision: request.revision,
            reason: "",
          }),
        ),
      );
      const corrected = await step(
        "correction.create-separate-authorized-draft",
        () =>
          correction(c, historyRequest, {
            expectedRevision: request.revision,
            reason:
              "V09 — синтетический запрос исправления написания должности; оригинал сохранить",
          }),
      );
      const draft = draftSchema.parse(corrected.draft);
      const originalPosition = draft.items.find(
        (p) => p.externalId === "DEMO-P001",
      )!.positionRu;
      draft.items = draft.items.map((p) =>
        p.externalId === "DEMO-P001"
          ? { ...p, positionRu: "Уточнённая тестовая должность" }
          : p,
      );
      await step("correction.save-reviewed-change", () =>
        patchRequest(c, corrected.id, {
          expectedRevision: corrected.revision,
          draft,
        }),
      );
      const saved = await step("correction.reopen", () =>
        requestDetail(c, corrected.id),
      );
      assert.ok(saved.correctsIssuanceId);
      assert.equal(
        saved.items.find((p) => p.externalId === "DEMO-P001")!.positionRu,
        "Уточнённая тестовая должность",
      );
      assert.equal(
        (
          await step("requests.recheck-unchanged-history", () =>
            requestDetail(c, historyRequest),
          )
        ).items.find((p) => p.externalId === "DEMO-P001")!.positionRu,
        originalPosition,
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
        before,
      );
      assert.equal(
        sha(
          (
            await step("artifacts.recheck-original-after-correction", () =>
              readArtifact(c, originalPdf.id),
            )
          ).buffer,
        ),
        originalPdf.sha256,
      );
      assert.deepEqual(
        (
          await step("correction.validate-linked-edition", () =>
            validateRequest(c, corrected.id, {
              expectedRevision: saved.revision,
            }),
          )
        ).issues,
        [],
      );
      await step("correction.finalize-linked-edition", () =>
        finalize(
          c,
          corrected.id,
          { expectedRevision: saved.revision },
          randomUUID(),
        ),
      );
      await drain(corrected.id);
      const issuedCorrection = await step(
        "correction.read-issued-links-and-files",
        () => requestDetail(c, corrected.id),
      );
      assert.equal(issuedCorrection.status, "FINALIZED");
      assert.equal(issuedCorrection.documents.length, 3);
      assert.equal(
        issuedCorrection.artifacts.filter((a) => a.format === "PDF").length,
        3,
      );
      assert.equal(
        issuedCorrection.correctsIssuanceId,
        saved.correctsIssuanceId,
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
        before + 3,
      );
      assert.equal(
        sha(
          (
            await step(
              "artifacts.original-still-readable-after-issued-correction",
              () => readArtifact(c, originalPdf.id),
            )
          ).buffer,
        ),
        originalPdf.sha256,
      );
      active.evidence = {
        originalPdf,
        correctionRequestId: corrected.id,
        correctsIssuanceId: saved.correctsIssuanceId,
        status: issuedCorrection.status,
        correctedDocumentIds: issuedCorrection.documents.map((d) => d.id),
        correctedPdfIds: issuedCorrection.artifacts
          .filter((a) => a.format === "PDF")
          .map((a) => a.id),
        boundary:
          "Separate authorized correction issuance with reason and three new saved PDFs; original bytes and number still readable, no claim of e-signature authenticity.",
      };
      active.assertions.push(
        "Person search and registry reach real historical document",
        "Redownload preserves original SHA and number",
        "Empty correction reason rejected; corrected edition validated, finalized and rendered under new document IDs while original SHA and issuance link remain",
      );
    });
    await scenario("V11", async () => {
      const f = fixture.cases.V11;
      const order = await step("orders.reuse-known-payer-and-people", () =>
        value.createServiceOrder(c, {
          title: "V11 — согласованные услуги",
          customerId: customerA,
          payerId: customerB,
          requestIds: [smallRequest],
        }),
      );
      const commercial = (quantity: number, expectedRevision: number) => ({
        expectedRevision,
        taxRateBasisPoints: null,
        lines: [
          {
            label: "Согласованная тестовая услуга",
            unit: "PERSON_SERVICE",
            quantity,
            unitPriceMinor: "1000000",
          },
        ],
      });
      const initial = await step("commercial.save-three-agreed-units", () =>
        value.saveCommercial(
          c,
          order.id,
          commercial(f.initialAgreedQuantity, 0),
        ),
      );
      const initialExchange = await step(
        "commercial.export-initial-agreed-table",
        () => value.commercialExchange(c, order.id),
      );
      assert.equal(initialExchange.subtotalMinor, "3000000");
      assert.equal(initialExchange.payer?.id, customerB);
      const basis = await step("orders.record-revised-scope-basis", () =>
        value.createOrderMilestone(c, order.id, {
          label: "Объём изменён с 3 до 2 услуг",
          category: "DATA",
          source: "CONTRACT",
          sourceReference:
            "DAILY_WORKFLOWS V11: SYNTHETIC-AGREEMENT-REVISION-2",
        }),
      );
      await step("orders.confirm-revised-scope-evidence", () =>
        value.patchOrderMilestone(c, order.id, basis.id, {
          status: "DONE",
          evidence:
            "Синтетический заказчик явно согласовал 2 услуги по 10000.00 KZT вместо 3",
        }),
      );
      const revised = await step("commercial.save-two-agreed-units", () =>
        value.saveCommercial(
          c,
          order.id,
          commercial(f.revisedAgreedQuantity, initial.revision),
        ),
      );
      assert.equal(initial.subtotalMinor, "3000000");
      assert.equal(revised.subtotalMinor, "2000000");
      assert.equal(revised.taxMinor, null);
      assert.equal(revised.totalMinor, null);
      await step("payments.record-five-thousand-kzt", () =>
        value.recordPayment(c, order.id, {
          amountMinor: "500000",
          occurredOn: "2026-09-22",
          source: "V11 — синтетическая сверенная частичная оплата",
        }),
      );
      const after = await step("commercial.reopen-and-check-payment", () =>
        value.serviceOrderDetail(c, order.id),
      );
      assert.equal(after.payerId, customerB);
      assert.equal(after.commercial.paidMinor, "500000");
      assert.equal(after.commercial.paymentState, "RECONCILIATION_REQUIRED");
      assert.equal(after.financialDocuments.length, 0);
      const revisedExchange = await step(
        "commercial.export-revised-agreed-table",
        () => value.commercialExchange(c, order.id),
      );
      assert.equal(revisedExchange.subtotalMinor, "2000000");
      assert.equal(revisedExchange.paidMinor, "500000");
      await writeFile(
        join(directory, "V11-commercial-before-after.json"),
        JSON.stringify(
          { initial: initialExchange, revised: revisedExchange },
          null,
          2,
        ),
      );
      const unconfirmed = await step(
        "requests.verify-payment-did-not-change-results",
        () => requestDetail(c, smallRequest),
      );
      assert.ok(
        unconfirmed.items
          .flatMap((p) => p.assignments)
          .every(
            (a) => !a.result && (!a.outcome || a.outcome.status === "UNKNOWN"),
          ),
      );
      assert.equal(unconfirmed.issuances.length, 0);
      const outside = await step(
        "requests.read-actual-issuance-without-commercial",
        () => requestDetail(c, simpleRequest),
      );
      assert.equal(outside.status, "FINALIZED");
      assert.ok(outside.artifacts.some((a) => a.format === "PDF"));
      assert.equal(
        await db.serviceOrderRequest.count({
          where: { tenantId: c.tenantId, requestId: simpleRequest },
        }),
        0,
      );
      await step("payments.deny-operator-role", () =>
        assert.rejects(
          value.recordPayment(operator, order.id, {
            amountMinor: "1",
            occurredOn: "2026-09-22",
            source: "Недопустимое действие",
          }),
          code("ROLE_DENIED"),
        ),
      );
      active.evidence = {
        orderId: order.id,
        payerId: after.payerId,
        initialSubtotalMinor: initial.subtotalMinor,
        revisedSubtotalMinor: revised.subtotalMinor,
        paidMinor: after.commercial.paidMinor,
        taxMinor: revised.taxMinor,
        totalMinor: revised.totalMinor,
        paymentState: after.commercial.paymentState,
        scopeBasisId: basis.id,
        independentIssuedRequest: simpleRequest,
      };
      active.assertions.push(
        "Existing payer reused, agreed 3→2 quantity change has durable explicit basis",
        "30000→20000 KZT subtotal and 5000 KZT payment computed from integer minor units",
        "Unknown tax remains unknown; no regulated invoice fabricated",
        "Payment write denied to operator; ordinary real issuance independent of commercial workflow",
      );
    });
    await scenario("V12", async () => {
      const order = await step("orders.create-customer-dossier-scope", () =>
        value.createServiceOrder(c, {
          title: "V12 — разрешённые основания",
          customerId: customerA,
          requestIds: [historyRequest],
        }),
      );
      const missing = await step("orders.record-missing-signed-copy", () =>
        value.createOrderMilestone(c, order.id, {
          label: "AGREED_SIGNED_COPY",
          category: "EVIDENCE",
          source: "CONTRACT",
          sourceReference:
            "DAILY_WORKFLOWS V12 — согласованный подписанный экземпляр",
        }),
      );
      const original = await step(
        "artifacts.read-saved-available-evidence",
        () => readArtifact(c, originalPdf.id),
      );
      const attachment = await step(
        "evidence.attach-existing-unsigned-material",
        () =>
          value.addValueAttachment(c, {
            orderId: order.id,
            category: "MATERIAL",
            source:
              "Синтетический доступный неподписанный материал; не замена подписанному экземпляру",
            fileName: "available-unsigned-material.pdf",
            contentBase64: original.buffer.toString("base64"),
            customerVisible: true,
          }),
      );
      const inventory = await step("dossier.assemble-and-see-missing", () =>
        value.assembleOrderDossier(c, order.id),
      );
      assert.ok(inventory.missing.some((m) => m.id === missing.id));
      assert.equal(
        inventory.attachments.filter((a) => a.category === "SIGNED_SCAN")
          .length,
        0,
      );
      assert.ok(
        inventory.artifacts.every((a) => a.requestId === historyRequest),
      );
      const exported = await step(
        "dossier.export-permitted-available-bases",
        () => value.exportOrderDossier(c, order.id),
      );
      const dossierPath = join(directory, "V12-dossier.zip");
      await writeFile(dossierPath, exported.buffer);
      const checked = JSON.parse(
        execFileSync(
          process.env.DEMO_PYTHON!,
          [
            "-c",
            "import sys,json,zipfile,hashlib\nz=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));i=json.loads(z.read('order-dossier.json'))\nfor f in m['files']+m.get('attachments',[]): assert hashlib.sha256(z.read(f['file'])).hexdigest()==f['sha256']\nprint(json.dumps({'complete':m['complete'],'missing':i['missing'],'files':len(m['files'])}))",
            dossierPath,
          ],
          { encoding: "utf8" },
        ),
      );
      assert.equal(checked.complete, false);
      assert.ok(
        checked.missing.some((m: { id: string }) => m.id === missing.id),
      );
      const foreign = { ...c, tenantId: randomUUID() };
      await step("dossier.deny-other-tenant", () =>
        assert.rejects(
          value.exportOrderDossier(foreign, order.id),
          code("NOT_FOUND"),
        ),
      );
      await step("evidence.deny-other-tenant-file", () =>
        assert.rejects(
          value.readValueAttachment(foreign, attachment.id),
          code("NOT_FOUND"),
        ),
      );
      const employer = await step("settings.create-scoped-employer-user", () =>
        saveUser(c, {
          email: `daily-employer-${randomUUID()}@example.test`,
          displayName: "V12 customer A",
          role: "EMPLOYER",
          password: "Synthetic-Employer-Password!",
        }),
      );
      const employerContext: Context = {
        ...c,
        userId: employer.id,
        role: "EMPLOYER",
      };
      await step("portal.create-customer-A-membership", () =>
        value.createEmployerMembership(c, {
          customerId: customerA,
          userId: employer.id,
          permissions: ["READ", "DOWNLOAD"],
        }),
      );
      await step("portal.allow-owned-historical-artifact", () =>
        value.employerArtifactAccess(employerContext, originalPdf.id),
      );
      const unscopedArtifact = await db.artifact.findFirstOrThrow({
        where: { requestId: simpleRequest, format: "PDF" },
      });
      await step("portal.deny-unrelated-person-artifact", () =>
        assert.rejects(
          value.employerArtifactAccess(employerContext, unscopedArtifact.id),
        ),
      );
      await step("dossier.deny-employer-full-center-endpoint", () =>
        assert.rejects(
          value.exportOrderDossier(employerContext, order.id),
          code("ROLE_DENIED"),
        ),
      );
      const backupRestore = await businessBackupEvidence(
        process.env.DEMO_BUSINESS_BACKUP_EVIDENCE,
      );
      active.evidence = {
        orderId: order.id,
        missingMilestoneId: missing.id,
        attachmentId: attachment.id,
        dossierPath,
        dossierSha256: sha(exported.buffer),
        inspection: checked,
        backupRestore,
        boundaries: {
          engineeringApiAndBytes: "PASS",
          browser: "NOT_RUN_HERE",
          pilot: "NOT_RUN",
          commercialValidation: "NOT_RUN",
          physicalPrint: "NOT_RUN",
        },
        relatedHandoverOrder: handoverOrder,
      };
      active.assertions.push(
        "Dossier includes saved available bytes and explicitly missing signed copy without inventing it",
        "Export independently hash-verified and marked incomplete",
        "Foreign tenant and employer full-center endpoint denied; customer membership allows only owned document",
        backupRestore.status === "PASS"
          ? "Explicitly supplied separate restore report validated and hashed; not restoration of this newly created tenant"
          : "External backup/restore evidence NOT_PROVIDED; actual restore acceptance remains a separate requirement",
      );
    });
    report.status = "PASS";
    await persist();
    return report;
  } catch (error) {
    report.status = "FAIL";
    await persist();
    throw error;
  }
}

if (require.main === module) {
  runBusinessScenarios(process.argv[2])
    .then((r) =>
      console.log(
        JSON.stringify({
          status: r.status,
          tenantId: r.tenantId,
          scenarios: r.scenarios.map((s) => ({
            id: s.id,
            status: s.status,
            apiActionCount: s.apiActionCount,
            automationActiveMs: s.automationActiveMs,
            renderWorkerMs: s.renderWorkerMs,
          })),
          wallMs: r.wallMs,
        }),
      ),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
