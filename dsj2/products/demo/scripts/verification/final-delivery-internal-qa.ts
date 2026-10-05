import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import {
  buildSavedRegistryDelivery,
  registryExport,
} from "../../apps/api/src/files";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "../../tests/integration/test-database";

function isInside(parent: string, target: string) {
  const child = relative(parent, target);
  return Boolean(
    child && !isAbsolute(child) && !/^\.\.(?:[\\/]|$)/.test(child),
  );
}

function inside(parent: string, target: string) {
  assert.ok(isInside(parent, target));
}

function evidenceDirectory(folder: string) {
  assert.ok(folder, "EXPLICIT_INTERNAL_QA_DIRECTORY_REQUIRED");
  const implementation = resolve(
    "docs/evidence/operator-flow-full-fix-20261003",
  );
  const configured = process.env.DEMO_E2E_EVIDENCE;
  const allowed = configured
    ? resolve(configured)
    : resolve(implementation, "domain");
  const taskRoots = [
    implementation,
    resolve("docs/evidence/operator-details-ux-20261005"),
  ];
  assert.ok(
    taskRoots.some((root) => isInside(root, allowed)),
    "INTERNAL_QA_EVIDENCE_MUST_BELONG_TO_AN_ALLOWED_TASK",
  );
  const target = resolve(folder);
  inside(allowed, target);
  return target;
}

async function main() {
  assertTestDatabase();
  const [tenantId, requestId, profileId, folder] = process.argv.slice(2);
  const target = evidenceDirectory(folder);
  for (const id of [tenantId, requestId, profileId])
    assert.match(id || "", /^[a-f0-9-]{36}$/);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  assert.equal(tenant.demoOnly, true);
  assert.equal(tenant.name, "Синтетический центр финальной проверки услуг");
  const user = await db.user.findFirstOrThrow({
    where: { tenantId, role: { in: ["ADMIN", "DIRECTOR"] } },
  });
  const c: Context = {
    tenantId,
    userId: user.id,
    role: user.role,
    sessionId: "synthetic-internal-qa",
    csrfHash: "synthetic-internal-qa",
    correlationId: randomUUID(),
  };
  const record = await db.printRequest.findFirstOrThrow({
    where: { id: requestId, tenantId },
  });
  const issuance = await db.issuance.findFirstOrThrow({
    where: { requestId, tenantId },
  });
  const workflowBefore = await db.issuanceWorkflow.findFirstOrThrow({
    where: { issuanceId: issuance.id, tenantId },
  });
  assert.equal(workflowBefore.status, "AWAITING_SIGNATURE");
  for (const format of ["XLSX", "ZIP"])
    await assert.rejects(
      registryExport(c, { format, profileId }, requestId),
      (error: unknown) => {
        assert.equal(
          (error as { getResponse(): { code: string } }).getResponse().code,
          "ISSUANCE_NOT_COMPLETE",
        );
        return true;
      },
    );
  const documents = await db.issuedDocument.findMany({
    where: { tenantId, requestId },
  });
  const draft = draftSchema.parse(
    (issuance.snapshot as { draft: unknown }).draft,
  );
  const rows = draft.items.flatMap((item) =>
    item.assignments.map((assignment) => {
      const document = documents.find(
        (doc) => doc.rowId === item.id && doc.assignmentId === assignment.id,
      );
      assert.ok(
        document,
        "Only actual individually saved historical forms are routed",
      );
      return {
        ...item,
        employerId: item.employerId || draft.customerId || undefined,
        assignment,
        number: document.number,
        registrationNumber: document.registrationNumber || "",
        documentId: document.id,
        protocolNumber: assignment.externalBasisNumber,
        requestId,
        status: record.status,
        revision: record.revision,
        createdAt: record.createdAt.toISOString(),
      };
    }),
  );
  const source = { records: [record], rows };
  const firstPdf = await db.artifact.findFirstOrThrow({
    where: {
      requestId,
      tenantId,
      documentId: { not: null },
      provenance: "ORIGINAL",
      format: "PDF",
    },
    orderBy: { createdAt: "asc" },
  });
  await mkdir(target, { recursive: true });
  const outputs = [];
  for (const [filename, query] of [
    ["internal-unsigned-registry.xlsx", { format: "XLSX", profileId }],
    ["internal-unsigned-customer.zip", { format: "ZIP", profileId }],
    [
      "internal-unsigned-selected.zip",
      { format: "ZIP", artifactIds: [firstPdf.id] },
    ],
  ] as const) {
    const out = await buildSavedRegistryDelivery(c, query, source, requestId);
    await writeFile(resolve(target, filename), out.buffer);
    outputs.push({
      filename,
      sha256: createHash("sha256").update(out.buffer).digest("hex"),
      bytes: out.buffer.length,
    });
  }
  const workflowAfter = await db.issuanceWorkflow.findUniqueOrThrow({
    where: { id: workflowBefore.id },
  });
  assert.deepEqual(workflowAfter, workflowBefore);
  assert.equal(
    await db.documentSignature.count({
      where: { tenantId, issuanceId: issuance.id },
    }),
    0,
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      provenance: "INTERNAL_UNSIGNED_SAVED_BYTES_QA",
      legalApproval: false,
      publicExport: "ISSUANCE_NOT_COMPLETE409",
      workflowBefore: workflowBefore.status,
      workflowAfter: workflowAfter.status,
      selectedArtifactId: firstPdf.id,
      sourceOrder: draft.items.map((item) => item.personnelNumber),
      outputs,
    }),
  );
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
