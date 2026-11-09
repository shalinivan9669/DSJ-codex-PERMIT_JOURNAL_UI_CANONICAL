import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertTestDatabase } from "./test-database";
import { bootstrap } from "../../apps/api/src/main";
import { db, hash, json, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import {
  createRequest,
  preview,
  validateRequest,
} from "../../apps/api/src/requests";
import {
  provisionRegisteredCenter,
  type PreparedRegistrationTemplate,
} from "../../apps/api/src/tenant-provisioning";
import { registrationSchema } from "../../packages/contracts/src";
import {
  ArtifactStore,
  MIME,
  PRODUCT_ROOT,
  runRender,
  templateManifest,
} from "../../packages/printing/src";
import { provision } from "../../scripts/setup";

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

test("current archive, retained neutral, special and LMS upgrade appends 22 unapproved versions and preserves history, approvals and authenticated downloads", async () => {
  assertTestDatabase();
  assert.ok(process.env.DEMO_ARTIFACT_ROOT, "Use an isolated artifact store");
  const previousPort = process.env.PORT;
  const previousOrigin = process.env.DEMO_ORIGIN;
  const evidence =
    process.env.DEMO_REGISTRATION_EVIDENCE_ROOT ||
    join(PRODUCT_ROOT, "docs/evidence/autofill-cycle-20261005");
  await mkdir(evidence, { recursive: true });
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3119";
  const store = new ArtifactStore();
  const suffix = randomUUID();
  const password = `Synthetic-upgrade-${suffix}!`;
  const session = {
    token: randomBytes(32).toString("hex"),
    csrf: randomBytes(32).toString("hex"),
    correlationId: randomUUID(),
  };
  let app: Awaited<ReturnType<typeof bootstrap>> | undefined;
  try {
    const baseline = JSON.parse(
      await readFile(
        join(
          PRODUCT_ROOT,
          "docs/evidence/neutral-forms-20261005/manifest-before.json",
        ),
        "utf8",
      ),
    ) as {
      templates: Record<string, unknown>[];
      groupTemplates: Record<string, unknown>[];
    };
    const oldTemplates: PreparedRegistrationTemplate[] = [];
    for (const template of [
      ...baseline.templates,
      ...baseline.groupTemplates,
    ]) {
      const bytes = await readFile(
        join(PRODUCT_ROOT, "assets/templates", String(template.file)),
      );
      assert.equal(sha256(bytes), template.sha256);
      const saved = await store.put(bytes, "docx");
      oldTemplates.push({
        templateId: String(template.id),
        version: String(template.version),
        checksum: saved.sha256,
        storageKey: saved.storageKey,
        contract: template,
      });
    }
    assert.equal(oldTemplates.length, 16);
    const data = registrationSchema.parse({
      legalForm: "TOO",
      ownNameRu: `Синтетический центр истории ${suffix}`,
      ownNameKz: "",
      displayName: "Синтетический директор",
      email: `neutral-upgrade-${suffix}@example.test`,
      password,
    });
    const registered = await provisionRegisteredCenter(
      data,
      await passwordHash(password),
      oldTemplates,
      session,
    );
    const tenantId = registered.tenant.id;
    const c: Context = {
      tenantId,
      userId: registered.user.id,
      role: "DIRECTOR",
      sessionId: hash(session.token),
      csrfHash: hash(session.csrf),
      correlationId: session.correlationId,
    };
    // Synthetic baseline only: old versions had approval before this upgrade.
    await db.templateVersion.updateMany({
      where: { tenantId },
      data: { approved: true },
    });
    const oldRows = await db.templateVersion.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
    });
    const oldProfile = await db.issuerProfileVersion.findFirstOrThrow({
      where: { tenantId },
    });
    const oldCard = oldRows.find((row) => row.templateId === "pb-card")!;
    const draft = await createRequest(c, {
      kind: "PERSON",
      schemaVersion: 2,
      demoMode: true,
      title: "СИНТЕТИЧЕСКАЯ проверка сохранения истории",
      items: [
        {
          id: "synthetic-person",
          fullNameRu: "Тестовый Получатель Истории",
          fullNameKz: "Сынақ Тарих Алушы",
          positionRu: "Инженер",
          positionKz: "Инженер",
          workplaceRu: "Синтетический заказчик",
          workplaceKz: "Синтетикалық тапсырыс беруші",
          assignments: [
            {
              id: "synthetic-assignment",
              templateId: "pb-card",
              protocolMode: "EXTERNAL_REFERENCE",
              externalBasisNumber: "SYNTHETIC-HISTORY-001",
              documentDate: "2026-10-05",
              protocolDate: "2026-10-04",
              trainingStart: "2026-10-01",
              trainingEnd: "2026-10-03",
              trainingSubject: "Синтетическая программа",
              hours: "40",
              result: "Сдал",
              outcome: {
                status: "PASSED",
                source: "СИНТЕТИЧЕСКАЯ ведомость, не реальное обучение",
              },
            },
          ],
        },
      ],
    });
    const beforeValidation = await validateRequest(c, draft.id, {
      expectedRevision: draft.revision,
    });
    assert.ok(
      !beforeValidation.issues.some(
        (issue) => issue.code === "TEMPLATE_NOT_APPROVED",
      ),
    );
    const item = {
      id: "synthetic-person",
      fullNameRu: "Тестовый Получатель Истории",
      fullNameKz: "Сынақ Тарих Алушы",
      positionRu: "Инженер",
      positionKz: "Инженер",
      workplaceRu: "Синтетический заказчик",
      workplaceKz: "Синтетикалық тапсырыс беруші",
      number: "SYNTHETIC-HISTORY-001",
      protocolNumber: "SYNTHETIC-PROTOCOL-001",
      assignment: {
        id: "synthetic-assignment",
        templateId: "pb-card",
        documentDate: "2026-10-05",
        protocolDate: "2026-10-04",
        trainingStart: "2026-10-01",
        trainingEnd: "2026-10-03",
        validUntil: "2027-10-05",
        trainingSubject: "Синтетическая программа",
        hours: 40,
        result: "Сдал",
        reason: "Синтетическая проверка",
        education: "Синтетические данные",
      },
    };
    const frozen = {
      mode: "issued-document",
      demoMode: true,
      templateId: "pb-card",
      templateVersion: Number(oldCard.version),
      templateStorageKey: oldCard.storageKey,
      templateChecksum: oldCard.checksum,
      issuer: {
        nameRu: "Синтетический учебный центр",
        nameKz: "Синтетикалық оқу орталығы",
        cityRu: "Астана",
        cityKz: "Астана",
        commission: [
          { name: "Синтетический Председатель", position: "Председатель" },
        ],
        approvalBasis: "Синтетическое основание",
      },
      items: [item],
      photos: {},
    };
    const historical = await runRender("docx", frozen);
    assert.equal(historical.metadata.renderPolicy, "LEGACY_REFERENCE_90D5");
    const savedHistorical = await store.put(historical.buffer, "docx");
    const inputHash = sha256(Buffer.from(JSON.stringify(frozen)));
    // Persist a synthetic historical fixture through normal immutable tables.
    // This is not a claim that a director approved or signed a real issuance.
    const issuance = await db.issuance.create({
      data: {
        tenantId,
        requestId: draft.id,
        sourceRevision: draft.revision,
        snapshot: json(frozen),
        inputHash,
        profileVersionId: oldProfile.id,
        createdBy: c.userId,
      },
    });
    const document = await db.issuedDocument.create({
      data: {
        tenantId,
        issuanceId: issuance.id,
        requestId: draft.id,
        rowId: item.id,
        assignmentId: item.assignment.id,
        templateVersionId: oldCard.id,
        templateId: "pb-card",
        namespace: "PB:CARD",
        number: item.number,
        documentDate: item.assignment.documentDate,
      },
    });
    const snapshot = await db.renderInputSnapshot.create({
      data: {
        tenantId,
        requestId: draft.id,
        revision: draft.revision,
        issuanceId: issuance.id,
        templateVersionId: oldCard.id,
        profileVersionId: oldProfile.id,
        input: json(frozen),
        inputHash,
      },
    });
    const job = await db.generationJob.create({
      data: {
        tenantId,
        requestId: draft.id,
        issuanceId: issuance.id,
        documentId: document.id,
        snapshotId: snapshot.id,
        kind: "DOCX",
        status: "SUCCEEDED",
        logicalKey: `synthetic-history-${suffix}`,
      },
    });
    const artifact = await db.artifact.create({
      data: {
        tenantId,
        jobId: job.id,
        requestId: draft.id,
        issuanceId: issuance.id,
        documentId: document.id,
        format: "DOCX",
        ...savedHistorical,
        mimeType: MIME.DOCX,
        fileName: "synthetic-historical.docx",
        templateVersion: oldCard.version,
        rendererVersion: String(historical.metadata.rendererVersion),
        inputHash,
      },
    });
    app = await bootstrap();
    const base = await app.getUrl();
    const download = async () => {
      const response = await fetch(`${base}/artifacts/${artifact.id}`, {
        headers: { cookie: `demo_session=${session.token}` },
      });
      assert.equal(response.status, 200, await response.clone().text());
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(response.headers.get("x-content-sha256"), artifact.sha256);
      assert.equal(
        Number(response.headers.get("content-length")),
        artifact.size,
      );
      assert.deepEqual(bytes, historical.buffer);
      return sha256(bytes);
    };
    const beforeDownload = await download();
    const oldSequences = await db.numberSequence.findMany({
      where: { tenantId },
      orderBy: { namespace: "asc" },
    });
    await provision({
      email: data.email,
      password,
      name: data.ownNameRu,
      sample: false,
    });
    const afterRows = await db.templateVersion.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
    });
    const current = await templateManifest();
    const currentTemplates = [
      ...current.templates,
      ...(current.groupTemplates || []),
      ...(current.specialTemplates || []),
    ];
    assert.equal(currentTemplates.length, 22);
    assert.equal(afterRows.length, oldRows.length + currentTemplates.length);
    const oldIds = new Set(oldRows.map((row) => row.id));
    assert.deepEqual(
      afterRows.filter((row) => oldIds.has(row.id)),
      oldRows,
    );
    const appended = afterRows.filter((row) => !oldIds.has(row.id));
    assert.equal(appended.length, currentTemplates.length);
    assert.equal(
      appended.filter((row) => row.templateId.startsWith("lms-")).length,
      3,
    );
    assert.equal(
      appended.filter((row) => !row.templateId.startsWith("lms-")).length,
      19,
    );
    assert.ok(
      appended.every(
        (row) =>
          !row.approved &&
          ((row.contract as Record<string, unknown>).renderPolicy ===
            "NEUTRAL_FORMS_V1" ||
            (row.contract as Record<string, unknown>).renderPolicy ===
              "USER_ARCHIVE_20261109_V1" ||
            (row.contract as Record<string, unknown>).program === "SPECIAL" ||
            (row.templateId.startsWith("lms-") &&
              (row.contract as Record<string, unknown>).renderPolicy ===
                "LMS_CENTER_FORMS_V3")),
      ),
    );
    for (const row of appended) {
      const expected = currentTemplates.find(
        (template) =>
          template.id === row.templateId &&
          String(template.version) === row.version &&
          template.sha256 === row.checksum,
      );
      assert.ok(
        expected,
        "Every appended contract must be an exact current manifest version",
      );
      assert.deepEqual(row.contract, expected);
    }
    const afterValidation = await validateRequest(c, draft.id, {
      expectedRevision: draft.revision,
    });
    assert.ok(
      !afterValidation.issues.some(
        (issue) => issue.code === "TEMPLATE_NOT_APPROVED",
      ),
      "A new unapproved version must not disable the existing approved form",
    );
    const assertPreviewTemplate = async (expected: typeof oldCard) => {
      const result = await preview(c, draft.id, {
        expectedRevision: draft.revision,
      });
      const snapshotIds = [
        ...new Set(result.jobs.map((job) => job.snapshotId)),
      ];
      try {
        assert.equal(result.jobs.length, 4);
        assert.equal(snapshotIds.length, 2);
        const inputs = await db.renderInputSnapshot.findMany({
          where: { tenantId, id: { in: snapshotIds } },
        });
        assert.deepEqual(
          inputs
            .map((row) => (row.input as Record<string, unknown>).templateId)
            .sort(),
          ["pb-card", "pb-protocol"],
          "The PERSON card retains its companion protocol",
        );
        for (const row of inputs) {
          const input = row.input as Record<string, unknown>;
          const selected =
            input.templateId === "pb-card"
              ? expected
              : oldRows.find(
                  (form) =>
                    form.templateId === "pb-protocol" &&
                    (form.contract as Record<string, unknown>).ownerKind !==
                      "GROUP",
                )!;
          assert.equal(row.templateVersionId, selected.id);
          assert.equal(input.templateVersion, selected.version);
          assert.equal(input.templateChecksum, selected.checksum);
          assert.equal(input.templateStorageKey, selected.storageKey);
          assert.deepEqual(
            result.jobs
              .filter((job) => job.snapshotId === row.id)
              .map((job) => job.kind)
              .sort(),
            ["DOCX", "PDF"],
          );
        }
      } finally {
        // These isolated selection probes need no worker execution or artifacts.
        // Their immutable input snapshots remain in this disposable database.
        await db.generationJob.deleteMany({
          where: { tenantId, id: { in: result.jobs.map((job) => job.id) } },
        });
      }
    };
    await assertPreviewTemplate(oldCard);
    const archiveForms = appended.filter(
      (row) =>
        (row.contract as Record<string, unknown>).renderPolicy ===
        "USER_ARCHIVE_20261109_V1",
    );
    assert.equal(archiveForms.length, 14);
    const samples = [];
    const sampleFailures: string[] = [];
    const sampleDirectory = join(evidence, "server-template-samples");
    await mkdir(sampleDirectory, { recursive: true });
    for (const form of archiveForms) {
      const ownerKind =
        (form.contract as Record<string, unknown>).ownerKind === "GROUP"
          ? "group"
          : "individual";
      assert.equal(form.approved, false);
      for (const format of ["DOCX", "PDF"] as const) {
        const file = `${form.templateId}-${ownerKind}-v${form.version}.${format.toLowerCase()}`;
        try {
          const response = await fetch(
            `${base}/settings/templates/${form.id}/sample?format=${format}`,
            { headers: { cookie: `demo_session=${session.token}` } },
          );
          assert.equal(
            response.status,
            200,
            `${file}: ${response.status === 200 ? "OK" : (await response.text()).slice(0, 2000)}`,
          );
          assert.equal(response.headers.get("content-type"), MIME[format]);
          assert.equal(
            response.headers.get("cache-control"),
            "private, no-store",
          );
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.ok(bytes.length > 1000, `${file}: nonempty real document`);
          assert.equal(
            bytes.subarray(0, format === "PDF" ? 5 : 4).toString("latin1"),
            format === "PDF" ? "%PDF-" : "PK\x03\x04",
            `${file}: expected document signature`,
          );
          await writeFile(join(sampleDirectory, file), bytes);
          samples.push({
            templateId: form.templateId,
            version: form.version,
            ownerKind,
            format,
            file,
            size: bytes.length,
            sha256: sha256(bytes),
            beforeApproval: true,
            status: "PASS",
          });
        } catch (error) {
          const message = `${file}: ${error instanceof Error ? error.message : String(error)}`;
          sampleFailures.push(message);
          samples.push({
            templateId: form.templateId,
            version: form.version,
            ownerKind,
            format,
            file,
            status: "FAIL",
            message,
          });
        }
        await writeFile(
          join(evidence, "server-template-samples.json"),
          JSON.stringify({ syntheticOnly: true, samples }, null, 2) + "\n",
        );
      }
    }
    assert.deepEqual(
      sampleFailures,
      [],
      "Every real settings preview must render",
    );
    assert.equal(samples.length, 28);
    assert.equal(
      await db.templateVersion.count({
        where: {
          tenantId,
          id: { in: archiveForms.map((form) => form.id) },
          approved: true,
        },
      }),
      0,
      "Downloading samples must never approve templates",
    );
    for (const row of oldRows) {
      assert.equal(
        sha256(await store.read(row.storageKey, row.checksum)),
        row.checksum,
      );
    }
    for (const template of currentTemplates) {
      const latest = afterRows
        .filter(
          (row) =>
            row.templateId === template.id &&
            (row.contract as Record<string, unknown>).program ===
              template.program &&
            ((row.contract as Record<string, unknown>).ownerKind ===
              "GROUP") ===
              (template.ownerKind === "GROUP"),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      assert.equal(latest.version, String(template.version));
      assert.equal(latest.checksum, template.sha256);
      assert.equal(latest.approved, false);
    }
    assert.deepEqual(
      await db.issuance.findUniqueOrThrow({ where: { id: issuance.id } }),
      issuance,
    );
    assert.deepEqual(
      await db.renderInputSnapshot.findUniqueOrThrow({
        where: { id: snapshot.id },
      }),
      snapshot,
    );
    assert.deepEqual(
      await db.artifact.findUniqueOrThrow({ where: { id: artifact.id } }),
      artifact,
    );
    assert.equal(await download(), beforeDownload);
    const reproduced = await runRender("docx", frozen);
    assert.equal(reproduced.metadata.renderPolicy, "LEGACY_REFERENCE_90D5");
    assert.deepEqual(reproduced.buffer, historical.buffer);
    // A real HTTP approval of this isolated fixture must also survive repeat
    // provisioning. This never approves any production center's forms.
    const selectedNew = appended.find((row) => row.templateId === "pb-card")!;
    const approval = await fetch(
      `${base}/settings/templates/${selectedNew.id}/approve`,
      {
        method: "POST",
        headers: {
          cookie: `demo_session=${session.token}`,
          origin: process.env.DEMO_ORIGIN!,
          "content-type": "application/json",
          "x-csrf-token": session.csrf,
        },
        body: JSON.stringify({ approved: true }),
      },
    );
    assert.equal(approval.status, 201, await approval.clone().text());
    const approvedRows = await db.templateVersion.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
    });
    assert.equal(
      approvedRows.find((row) => row.id === selectedNew.id)?.approved,
      true,
    );
    await assertPreviewTemplate(selectedNew);
    // Re-running the supported provisioner is idempotent and keeps approvals.
    await provision({
      email: data.email,
      password,
      name: data.ownNameRu,
      sample: false,
    });
    assert.equal(
      await db.templateVersion.count({ where: { tenantId } }),
      oldRows.length + currentTemplates.length,
    );
    assert.deepEqual(
      await db.templateVersion.findMany({
        where: { tenantId },
        orderBy: { id: "asc" },
      }),
      approvedRows,
      "Repeated provisioning must preserve old and explicitly approved new versions",
    );
    assert.deepEqual(
      await db.numberSequence.findMany({
        where: { tenantId },
        orderBy: { namespace: "asc" },
      }),
      oldSequences,
    );
    await writeFile(
      join(evidence, "registration-history-upgrade.json"),
      JSON.stringify(
        {
          status: "PASS",
          syntheticOnly: true,
          tenantId,
          artifactId: artifact.id,
          oldTemplateCount: 16,
          appendedTemplateCount: currentTemplates.length,
          appendedLegacyTemplateCount: 19,
          appendedLmsTemplateCount: 3,
          existingNumberSequencesUnchanged: true,
          newApprovedCountAfterRegistration: 0,
          explicitSyntheticApprovalPreservedOnRepeat: true,
          archiveServerSamplesBeforeApproval: samples,
          oldRowsAndStoredTemplateBytesUnchanged: true,
          historicalSnapshotAndArtifactUnchanged: true,
          authenticatedHttpBeforeAfterSha256: beforeDownload,
          historicalRendererPolicy: reproduced.metadata.renderPolicy,
          historicalReproductionByteIdentical: true,
          existingApprovedVersionRemainsSelectedUntilApproval: true,
          exactNewVersionSelectedAfterExplicitApproval: true,
          provisioningRepeatDoesNotDuplicate: true,
          realIssuanceApprovalOrSignatureClaim: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await app?.close();
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    if (previousOrigin === undefined) delete process.env.DEMO_ORIGIN;
    else process.env.DEMO_ORIGIN = previousOrigin;
    await db.$disconnect();
  }
});
