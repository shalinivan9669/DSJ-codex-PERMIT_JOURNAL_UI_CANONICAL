import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertTestDatabase } from "./test-database";
import { bootstrap } from "../../apps/api/src/main";
import { db, hash, json, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { createRequest, validateRequest } from "../../apps/api/src/requests";
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

test("neutral and explicit special upgrade appends 19 unapproved versions and preserves historical records, renderer and authenticated downloads", async () => {
  assertTestDatabase();
  assert.ok(process.env.DEMO_ARTIFACT_ROOT, "Use an isolated artifact store");
  const previousPort = process.env.PORT;
  const previousOrigin = process.env.DEMO_ORIGIN;
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
    assert.equal(afterRows.length, 35);
    const oldIds = new Set(oldRows.map((row) => row.id));
    assert.deepEqual(
      afterRows.filter((row) => oldIds.has(row.id)),
      oldRows,
    );
    const appended = afterRows.filter((row) => !oldIds.has(row.id));
    assert.equal(appended.length, 19);
    assert.ok(
      appended.every(
        (row) =>
          !row.approved &&
          ((row.contract as Record<string, unknown>).renderPolicy ===
            "NEUTRAL_FORMS_V1" ||
            (row.contract as Record<string, unknown>).program === "SPECIAL"),
      ),
    );
    for (const row of oldRows) {
      assert.equal(
        sha256(await store.read(row.storageKey, row.checksum)),
        row.checksum,
      );
    }
    const current = (await templateManifest()) as Awaited<
      ReturnType<typeof templateManifest>
    > & { groupTemplates: Record<string, unknown>[] };
    for (const template of [
      ...current.templates,
      ...current.groupTemplates,
      ...(current.specialTemplates || []),
    ]) {
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
    const afterValidation = await validateRequest(c, draft.id, {
      expectedRevision: draft.revision,
    });
    assert.ok(
      afterValidation.issues.some(
        (issue) => issue.code === "TEMPLATE_NOT_APPROVED",
      ),
      "New unapproved version must not fall back to an old approved form",
    );
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
    // Re-running the supported provisioner is idempotent and keeps approvals.
    await provision({
      email: data.email,
      password,
      name: data.ownNameRu,
      sample: false,
    });
    assert.equal(await db.templateVersion.count({ where: { tenantId } }), 35);
    const evidence =
      process.env.DEMO_REGISTRATION_EVIDENCE_ROOT ||
      join(PRODUCT_ROOT, "docs/evidence/autofill-cycle-20261005");
    await mkdir(evidence, { recursive: true });
    await writeFile(
      join(evidence, "registration-history-upgrade.json"),
      JSON.stringify(
        {
          status: "PASS",
          syntheticOnly: true,
          tenantId,
          artifactId: artifact.id,
          oldTemplateCount: 16,
          appendedTemplateCount: 19,
          newApprovedCount: 0,
          oldRowsAndStoredTemplateBytesUnchanged: true,
          historicalSnapshotAndArtifactUnchanged: true,
          authenticatedHttpBeforeAfterSha256: beforeDownload,
          historicalRendererPolicy: reproduced.metadata.renderPolicy,
          historicalReproductionByteIdentical: true,
          currentSelectionRejectsUnapprovedVersion: true,
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
