import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";
import { draftSchema } from "@demo/contracts";
import { ArtifactStore, runRender } from "@demo/printing";
import {
  createRequest,
  finalize,
  patchRequest,
  requestDetail,
} from "../../apps/api/src/requests";
import {
  claimJob,
  executeJob,
  heartbeat,
  DeferredJob,
  settleFailure,
} from "../../apps/render-worker/src/queue";
import { printSetPlan, buildPrintSet } from "../../apps/api/src/print-sets";
import { registryExport, restoreArtifact } from "../../apps/api/src/files";

test("print sets use saved batch originals, preserve prior files, deny foreign and incomplete selection", async (t) => {
  assertTestDatabase();
  const seed = await provision({
    email: `print-set-${randomUUID()}@example.test`,
    password: "Synthetic-print-set-Only!",
    name: "Синтетический центр печатного комплекта",
    sample: true,
  });
  const c: Context = {
    tenantId: seed.tenantId,
    userId: seed.userId,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const approvals = await createApprovalFixture(c);
  t.after(async () => {
    await approvals.close();
    await db.$disconnect();
  });
  const event = randomUUID();
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    demoMode: true,
    events: [
      {
        id: event,
        title: "ПТМ",
        protocolTemplateId: "ptm-protocol",
        protocolMode: "GROUP",
        commonFields: {
          documentDate: "2026-10-04",
          protocolDate: "2026-10-04",
          trainingStart: "2026-10-01",
          trainingEnd: "2026-10-03",
        },
      },
    ],
    items: [0, 1, 2].map((index) => ({
      id: `person-${index}`,
      fullNameRu: `Синтетический Печатный Получатель ${index}`,
      fullNameKz: `Сынақ Алушы ${index}`,
      positionRu: "Оператор",
      positionKz: "Маман",
      assignments: [
        {
          id: `course-${index}`,
          templateId: "ptm-card",
          eventId: event,
          protocolMode: "GROUP",
          outcome: {
            status: index < 2 ? "PASSED" : "UNKNOWN",
            source: index < 2 ? "Синтетическая ведомость от 04.10.2026" : "",
          },
        },
      ],
    })),
  });
  const request = await createRequest(c, draft);
  await assert.rejects(printSetPlan(c, request.id, {}), /ещё не готовы/);
  const selected = draft.items
    .slice(0, 2)
    .map((row) => ({ rowId: row.id, assignmentId: row.assignments[0].id }));
  const { submitApproval } = await import("../../apps/api/src/approvals");
  await submitApproval(c, request.id, {
    expectedRevision: request.revision,
    assignments: selected,
  });
  await approvals.approve(request.id);
  const issued = await finalize(
    c,
    request.id,
    { expectedRevision: request.revision, assignments: selected },
    randomUUID(),
  );
  const store = new ArtifactStore(),
    owner = randomUUID();
  let handled = 0;
  while (
    await db.generationJob.count({
      where: {
        tenantId: c.tenantId,
        requestId: request.id,
        status: { not: "SUCCEEDED" },
      },
    })
  ) {
    assert.ok(handled < 40, "finite queued documents required");
    const job = await claimJob(db, owner, c.tenantId);
    assert.ok(job, "ready synthetic generation job required");
    const timer = setInterval(() => void heartbeat(db, job, owner), 5000);
    try {
      await executeJob(db, store, job, owner, new AbortController().signal);
      handled++;
    } catch (error) {
      await settleFailure(db, job, owner, error);
      if (!(error instanceof DeferredJob)) throw error;
    } finally {
      clearInterval(timer);
    }
  }
  const originals = await db.artifact.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: request.id,
      format: "PDF",
      documentId: { not: null },
    },
  });
  assert.equal(
    originals.length,
    3,
    "two cards and exactly selected two-person group protocol",
  );
  // A transport selection can exceed the document count because each document
  // has multiple formats. It must reach ownership/signature guards, never be
  // truncated or rejected by an unrelated artifact count cap. This assertion
  // verifies the command boundary; the three originals above are real renders.
  const foreignSelection = Array.from({ length: 1001 }, () => randomUUID());
  await assert.rejects(
    registryExport(
      c,
      {
        format: "ZIP",
        artifactIds: [
          ...originals.map((file) => file.id),
          ...foreignSelection.slice(originals.length),
        ],
      },
      request.id,
    ),
    (error: unknown) => {
      assert.equal(
        (error as { getResponse(): { code: string } }).getResponse().code,
        "ISSUANCE_NOT_COMPLETE",
      );
      return true;
    },
  );
  await assert.rejects(
    registryExport(
      c,
      { format: "ZIP", artifactIds: foreignSelection },
      request.id,
    ),
    (error: unknown) => {
      assert.equal(
        (error as { getResponse(): { code: string } }).getResponse().code,
        "ARTIFACT_NOT_FOUND",
      );
      return true;
    },
  );
  const before = originals.map((file) => ({
    id: file.id,
    sha256: file.sha256,
  }));
  const originalJobs = await db.generationJob.findMany({
    where: { tenantId: c.tenantId, issuanceId: issued.issuanceId },
    orderBy: { id: "asc" },
    select: { id: true, artifactId: true, snapshotId: true },
  });
  const plan = await printSetPlan(c, request.id, { format: "PDF" });
  assert.equal(plan.files.length, 3);
  const groupFile = plan.files.find(
    (file) => file.document?.groupEventId === event,
  );
  assert.ok(groupFile, "selected group protocol is part of the pack");
  assert.deepEqual(
    groupFile.personIds,
    ["person-0", "person-1"],
    "group-only print composition counts actual frozen people and excludes waiting person",
  );
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.issuanceId, issued.issuanceId);
  const merged = await buildPrintSet(c, request.id, { format: "PDF" });
  assert.ok(Number(merged.pages) >= 3);
  assert.equal(merged.artifact.provenance, "PRINT_SET_DERIVATIVE");
  const derivativeJob = await db.generationJob.findUniqueOrThrow({
    where: { id: merged.artifact.jobId },
  });
  assert.equal(derivativeJob.artifactId, merged.artifact.id);
  assert.equal(derivativeJob.status, "SUCCEEDED");
  assert.equal(derivativeJob.issuanceId, null);
  const derivativeSnapshot = await db.renderInputSnapshot.findUniqueOrThrow({
    where: { id: derivativeJob.snapshotId },
  });
  assert.equal(derivativeSnapshot.issuanceId, null);
  const derivativeInput = derivativeSnapshot.input as {
    provenance: string;
    sourceArtifactIds: string[];
  };
  assert.equal(derivativeInput.provenance, "PRINT_SET_DERIVATIVE");
  assert.deepEqual(
    [...derivativeInput.sourceArtifactIds].sort(),
    originals.map((file) => file.id).sort(),
  );
  await assert.rejects(
    restoreArtifact(c, merged.artifact.id, {
      reason: "Явная синтетическая проверка восстановления производной копии",
    }),
    (error: unknown) => {
      assert.equal(
        (error as { getResponse(): { code: string } }).getResponse().code,
        "PRINT_SET_REBUILD_REQUIRED",
      );
      return true;
    },
  );
  const current = await requestDetail(c, request.id);
  const working = draftSchema.parse(current.draft);
  const waiting = working.items.find((row) => row.id === "person-2")!;
  waiting.fullNameRu = "Синтетический Исправленный Ожидающий";
  await patchRequest(c, request.id, {
    expectedRevision: current.revision,
    draft: working,
  });
  const repeated = await buildPrintSet(c, request.id, {
    format: "PDF",
    artifactIds: originals.map((file) => file.id),
  });
  assert.equal(
    repeated.artifact.sha256,
    merged.artifact.sha256,
    "repeat derivatives use exact frozen originals",
  );
  for (const file of originals)
    assert.equal(
      createHash("sha256")
        .update(await store.read(file.storageKey))
        .digest("hex"),
      before.find((value) => value.id === file.id)!.sha256,
    );
  assert.deepEqual(
    await db.generationJob.findMany({
      where: { tenantId: c.tenantId, issuanceId: issued.issuanceId },
      orderBy: { id: "asc" },
      select: { id: true, artifactId: true, snapshotId: true },
    }),
    originalJobs,
    "printing derivatives never replace original generation pointers",
  );
  await assert.rejects(
    printSetPlan({ ...c, tenantId: randomUUID() }, request.id, {}),
    /Заявка не найдена/,
  );
  await assert.rejects(
    printSetPlan(c, request.id, { artifactIds: [randomUUID()] }),
    /не найден/,
  );
  await assert.rejects(
    printSetPlan({ ...c, role: "EMPLOYER" }, request.id, {}),
  );
  const docx = await db.artifact.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: request.id,
      format: "DOCX",
      documentId: { not: null },
    },
  });
  await assert.rejects(
    printSetPlan(c, request.id, {
      format: "DOCX",
      artifactIds: docx.map((file) => file.id),
    }),
    /одной формы/,
  );
  const documents = await db.issuedDocument.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: request.id,
      templateId: "ptm-card",
    },
  });
  const cards = docx.filter((file) =>
    documents.some((document) => document.id === file.documentId),
  );
  const word = await buildPrintSet(c, request.id, {
    format: "DOCX",
    artifactIds: cards.map((file) => file.id),
  });
  assert.ok(word.artifact.size > 0);
  const wordBytes = await store.read(
    word.artifact.storageKey,
    word.artifact.sha256,
  );
  const convertedWord = await runRender(
    "pdf",
    {},
    { inputBytes: wordBytes, inputExtension: "docx" },
  );
  const inspection = JSON.parse(
    execFileSync(
      process.env.DEMO_PYTHON || "python",
      [
        "-I",
        "-c",
        "import sys,io,json; from pypdf import PdfReader; r=PdfReader(io.BytesIO(sys.stdin.buffer.read()), strict=True); print(json.dumps({'pages':len(r.pages),'text':' '.join(p.extract_text() or '' for p in r.pages)}))",
      ],
      { input: convertedWord.buffer, windowsHide: true, encoding: "utf8" },
    ),
  ) as { pages: number; text: string };
  if (process.env.DEMO_PRINT_SET_EVIDENCE) {
    const evidence = resolve(process.env.DEMO_PRINT_SET_EVIDENCE);
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "merged-two-ptm-cards.docx"), wordBytes);
    await writeFile(
      join(evidence, "merged-two-ptm-cards-converted.pdf"),
      convertedWord.buffer,
    );
    await writeFile(
      join(evidence, "merged-selected-originals.pdf"),
      await store.read(merged.artifact.storageKey, merged.artifact.sha256),
    );
    for (const original of [...originals, ...cards])
      await writeFile(
        join(
          evidence,
          `original-${original.id}.${original.format.toLowerCase()}`,
        ),
        await store.read(original.storageKey, original.sha256),
      );
    await writeFile(
      join(evidence, "print-set-plan.json"),
      JSON.stringify(
        {
          synthetic: true,
          provenance: "PRINT_SET_DERIVATIVE",
          signatureScope: "Signatures belong to original individual files",
          requestId: request.id,
          plan,
          mergedArtifact: merged.artifact,
          wordArtifact: word.artifact,
          wordConversion: inspection,
          originalHashes: originals.map((file) => ({
            id: file.id,
            sha256: file.sha256,
          })),
        },
        null,
        2,
      ),
    );
  }
  assert.ok(inspection.pages >= cards.length);
  const text = inspection.text.replace(/\s+/g, " ");
  for (const item of draft.items.slice(0, 2))
    assert.ok(
      text.includes(item.fullNameRu),
      "converted DOCX retains both names",
    );
  // PDF text extraction inserts a line break after the number's hyphen when
  // the unchanged source card wraps it (for example PTM-\nCARD-00001).
  // Preserve every number character, ignoring only this layout whitespace.
  const numberText = inspection.text.replace(/-\s+/g, "-");
  for (const document of documents)
    assert.ok(
      numberText.includes(document.number),
      "converted DOCX retains saved numbers",
    );
  for (const file of cards)
    assert.equal(
      createHash("sha256")
        .update(await store.read(file.storageKey, file.sha256))
        .digest("hex"),
      file.sha256,
    );
});
