import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import { saveCustomer } from "../../apps/api/src/settings";
import { createRequest, finalize } from "../../apps/api/src/requests";
import {
  registryExport,
  buildSavedRegistryDelivery,
  store,
} from "../../apps/api/src/files";
import { saveExportProfile } from "../../apps/api/src/delivery";
import { draftSchema, protocolTemplateFor } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";

/** Internal routing fixture starts with actual immutable prepared inputs; it
 * never claims those unsigned bytes form an officially issued/signature-valid bundle. */
async function delivery(c: Context, input: unknown, requestId: string) {
  const record = await db.printRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  const issuance = await db.issuance.findFirstOrThrow({ where: { requestId } });
  const frozen = draftSchema.parse(
    (issuance.snapshot as { draft: unknown }).draft,
  );
  const documents = await db.issuedDocument.findMany({ where: { requestId } });
  const rows = frozen.items.flatMap((item) =>
    item.assignments.map((assignment) => {
      const document = documents.find(
        (entry) =>
          entry.rowId === item.id && entry.assignmentId === assignment.id,
      );
      const protocol = documents.find(
        (entry) =>
          entry.groupEventId === assignment.eventId &&
          entry.templateId === protocolTemplateFor(assignment.templateId),
      );
      return {
        ...item,
        assignment,
        requestId,
        employerId: item.employerId || frozen.customerId || undefined,
        number: document?.number || "",
        registrationNumber: document?.registrationNumber || "",
        protocolNumber: protocol?.number || "",
        status: record.status,
        revision: record.revision,
      };
    }),
  );
  return buildSavedRegistryDelivery(
    c,
    input,
    { records: [record], rows },
    requestId,
  );
}

const errorCode = (expected: string) => (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "getResponse" in error &&
  (error as { getResponse(): { code: string } }).getResponse().code ===
    expected;

test("staff company output scopes frozen mixed-employer rows, individual bytes, shared group omissions and registry derivatives", async () => {
  assertTestDatabase();
  const seed = await provision({
    email: `customer-export-${randomUUID()}@example.test`,
    password: "Synthetic-Export-Password!",
    name: "Scoped delivery test",
    sample: true,
  });
  const c: Context = {
    ...seed,
    role: "ADMIN",
    correlationId: randomUUID(),
    sessionId: "test",
    csrfHash: "test",
  };
  const approvals = await createApprovalFixture(c);
  try {
    const a = await saveCustomer(c, { nameRu: "OWN_CUSTOMER_A" });
    const b = await saveCustomer(c, { nameRu: "FOREIGN_CUSTOMER_B" });
    const eventId = randomUUID();
    const draft = draftSchema.parse({
      kind: "COMPANY",
      customerId: a.id,
      demoMode: true,
      events: [
        {
          id: eventId,
          title: "Shared synthetic event",
          protocolTemplateId: "pb-protocol",
          commonFields: {
            documentDate: "2026-09-22",
            protocolDate: "2026-09-22",
            trainingStart: "2026-09-20",
            trainingEnd: "2026-09-22",
            trainingSubject: "Синтетическая программа",
          },
        },
      ],
      items: [
        {
          id: "a",
          employerId: a.id,
          fullNameRu: "OWN_PERSON_A",
          personnelNumber: "000001",
          positionRu: "Мастер",
          assignments: [
            {
              id: "card",
              templateId: "pb-card",
              protocolMode: "GROUP",
              eventId,
              result: "Сдал",
              outcome: {
                status: "PASSED",
                source: "Synthetic explicit result A",
              },
            },
          ],
        },
        {
          id: "b",
          employerId: b.id,
          fullNameRu: "FOREIGN_PERSON_B",
          personnelNumber: "000002",
          positionRu: "Мастер",
          assignments: [
            {
              id: "card",
              templateId: "pb-card",
              protocolMode: "GROUP",
              eventId,
              result: "Сдал",
              outcome: {
                status: "PASSED",
                source: "Synthetic explicit result B",
              },
            },
          ],
        },
      ],
    });
    const request = await createRequest(c, draft);
    await approvals.approve(request.id);
    await finalize(
      c,
      request.id,
      { expectedRevision: request.revision },
      randomUUID(),
    );
    for (const format of ["TSV", "XLSX", "ZIP"]) {
      await assert.rejects(
        registryExport(c, { format }, request.id),
        errorCode("ISSUANCE_NOT_COMPLETE"),
      );
    }
    const documents = await db.issuedDocument.findMany({
      where: { requestId: request.id },
    });
    assert.equal(documents.length, 3);
    assert.equal(
      await db.groupDocumentMember.count({ where: { tenantId: c.tenantId } }),
      2,
    );
    // This test verifies routing and immutable bytes, not print layout: use explicit
    // persisted file fixtures under real issued document/job/snapshot identities.
    const jobs = await db.generationJob.findMany({
      where: { requestId: request.id, kind: { not: "ZIP" } },
    });
    const original = new Map<string, Buffer>();
    for (const job of jobs) {
      const doc = documents.find((d) => d.id === job.documentId);
      const bytes = Buffer.from(
        doc?.rowId === "a"
          ? `OWN_PERSON_A saved ${job.kind}`
          : `FOREIGN_PERSON_B saved ${job.kind}`,
      );
      const asset = await store.put(bytes, job.kind.toLowerCase());
      const artifact = await db.artifact.create({
        data: {
          tenantId: c.tenantId,
          requestId: request.id,
          issuanceId: job.issuanceId,
          documentId: job.documentId,
          jobId: job.id,
          ...asset,
          format: job.kind,
          mimeType: "application/octet-stream",
          fileName:
            doc?.rowId === "a"
              ? `own.${job.kind.toLowerCase()}`
              : `FOREIGN_PERSON_B.${job.kind.toLowerCase()}`,
          provenance: "ORIGINAL",
          rendererVersion: "synthetic-routing-fixture",
          inputHash: job.snapshotId,
        },
      });
      original.set(artifact.id, bytes);
      await db.generationJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", artifactId: artifact.id },
      });
    }
    const profileA = await saveExportProfile(c, {
      name: "Company A",
      customerId: a.id,
      columns: [
        { field: "fullNameRu", title: "ФИО" },
        { field: "personnelNumber", title: "Табельный" },
        { field: "protocolNumber", title: "Протокол" },
      ],
    });
    const profileB = await saveExportProfile(c, {
      name: "Company B",
      customerId: b.id,
      columns: [{ field: "fullNameRu", title: "ФИО" }],
    });
    const before = await db.numberReservation.count({
      where: { tenantId: c.tenantId },
    });
    const onlyA = await delivery(
      c,
      { format: "TSV", profileId: profileA.id },
      request.id,
    );
    assert.match(onlyA.buffer.toString(), /OWN_PERSON_A/);
    assert.doesNotMatch(onlyA.buffer.toString(), /FOREIGN_PERSON_B/);
    const onlyB = await delivery(
      c,
      { format: "TSV", profileId: profileB.id },
      request.id,
    );
    assert.match(onlyB.buffer.toString(), /FOREIGN_PERSON_B/);
    assert.doesNotMatch(onlyB.buffer.toString(), /OWN_PERSON_A/);
    const queryOnly = await delivery(
      c,
      { format: "TSV", customerId: b.id },
      request.id,
    );
    assert.match(queryOnly.buffer.toString(), /FOREIGN_PERSON_B/);
    assert.doesNotMatch(queryOnly.buffer.toString(), /OWN_PERSON_A/);
    const internal = await delivery(c, { format: "TSV" }, request.id);
    assert.match(internal.buffer.toString(), /OWN_PERSON_A/);
    assert.match(internal.buffer.toString(), /FOREIGN_PERSON_B/);
    await assert.rejects(
      delivery(c, { format: "ZIP", profileId: profileA.id }, request.id),
      errorCode("PARTIAL_BUNDLE"),
    );
    const directory = await mkdtemp(join(tmpdir(), "demo-customer-scope-"));
    for (const mode of [
      "PROFILE_A",
      "QUERY_A",
      "PROFILE_B",
      "QUERY_B",
    ] as const) {
      const secondCompany = mode.endsWith("_B");
      const forbiddenName = secondCompany ? "OWN_PERSON_A" : "FOREIGN_PERSON_B";
      const bundle = await delivery(
        c,
        {
          format: "ZIP",
          allowPartial: true,
          ...(mode.startsWith("PROFILE")
            ? { profileId: secondCompany ? profileB.id : profileA.id }
            : { customerId: secondCompany ? b.id : a.id }),
        },
        request.id,
      );
      assert.match(bundle.fileName, /НЕПОЛНЫЙ/);
      const path = join(directory, mode + ".zip");
      await writeFile(path, bundle.buffer);
      const inspected = JSON.parse(
        execFileSync(
          process.env.DEMO_PYTHON!,
          [
            "-c",
            "import sys,json,zipfile,hashlib,io,openpyxl\nz=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));forbidden=sys.argv[2]\nassert not m['complete'] and len(m['files'])==2 and len(m['missing'])==2\nfor f in m['files']+m['attachments']: assert hashlib.sha256(z.read(f['file'])).hexdigest()==f['sha256']\nfor n in z.namelist():\n assert forbidden not in n\n if n.endswith('.xlsx'):\n  w=openpyxl.load_workbook(io.BytesIO(z.read(n)));assert len(list(w.active.values))==2;assert forbidden not in str(list(w.active.values))\n else: assert forbidden.encode() not in z.read(n)\nprint(json.dumps(m))",
            path,
            forbiddenName,
          ],
          { encoding: "utf8" },
        ),
      );
      assert.equal(inspected.expectedCount, 4);
      assert.ok(
        inspected.files.every((f: { id: string }) => original.has(f.id)),
      );
      assert.ok(
        inspected.missing.every(
          (m: Record<string, unknown>) => !m.documentId && !m.jobId && !m.id,
        ),
      );
    }
    const foreignArtifact = await db.artifact.findFirstOrThrow({
      where: {
        requestId: request.id,
        documentId: documents.find((d) => d.rowId === "b")!.id,
        format: "PDF",
      },
    });
    await assert.rejects(
      delivery(
        c,
        {
          format: "ZIP",
          customerId: a.id,
          artifactIds: [foreignArtifact.id],
          allowPartial: true,
        },
        request.id,
      ),
      errorCode("EMPTY_BUNDLE"),
    );
    assert.equal(
      await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
      before,
    );
    for (const artifact of await db.artifact.findMany({
      where: { requestId: request.id },
    }))
      assert.deepEqual(
        await store.read(artifact.storageKey, artifact.sha256),
        original.get(artifact.id),
      );
    const ownEventId = randomUUID();
    const whollyOwned = await createRequest(c, {
      ...draft,
      events: draft.events!.map((event) => ({ ...event, id: ownEventId })),
      items: [
        {
          ...draft.items[0],
          assignments: draft.items[0].assignments.map((assignment) => ({
            ...assignment,
            eventId: ownEventId,
          })),
        },
      ],
    });
    await approvals.approve(whollyOwned.id);
    await finalize(
      c,
      whollyOwned.id,
      { expectedRevision: whollyOwned.revision },
      randomUUID(),
    );
    await assert.rejects(
      registryExport(c, { format: "ZIP", customerId: a.id }, whollyOwned.id),
      errorCode("ISSUANCE_NOT_COMPLETE"),
    );
    for (const job of await db.generationJob.findMany({
      where: { requestId: whollyOwned.id, documentId: { not: null } },
    })) {
      const saved = await store.put(
        Buffer.from("OWN_COMPANY_ONLY " + job.kind),
        job.kind.toLowerCase(),
      );
      const artifact = await db.artifact.create({
        data: {
          ...saved,
          tenantId: c.tenantId,
          requestId: whollyOwned.id,
          issuanceId: job.issuanceId,
          documentId: job.documentId,
          jobId: job.id,
          format: job.kind,
          fileName: job.id + "." + job.kind.toLowerCase(),
          mimeType: "application/octet-stream",
          rendererVersion: "synthetic-routing-fixture",
          inputHash: job.snapshotId,
        },
      });
      await db.generationJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", artifactId: artifact.id },
      });
    }
    const complete = await delivery(
      c,
      { format: "ZIP", customerId: a.id },
      whollyOwned.id,
    );
    assert.doesNotMatch(complete.fileName, /НЕПОЛНЫЙ/);
    const completePath = join(directory, "wholly-owned.zip");
    await writeFile(completePath, complete.buffer);
    const completeManifest = JSON.parse(
      execFileSync(
        process.env.DEMO_PYTHON!,
        [
          "-c",
          "import sys,json,zipfile\nz=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));assert m['complete'] and len(m['files'])==4 and not m['missing'];print(json.dumps(m))",
          completePath,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(completeManifest.readyCount, 4);
    assert.equal(
      await db.documentSignature.count({ where: { tenantId: c.tenantId } }),
      0,
    );
    assert.equal(
      await db.issuanceWorkflow.count({
        where: { tenantId: c.tenantId, status: "ISSUED" },
      }),
      0,
    );
  } finally {
    await approvals.close();
    await db.$disconnect();
  }
});
