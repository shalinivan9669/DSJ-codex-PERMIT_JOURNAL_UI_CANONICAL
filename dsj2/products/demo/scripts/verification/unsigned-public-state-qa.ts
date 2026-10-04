import assert from "node:assert/strict";
import { db } from "../../apps/api/src/core";
import { assertTestDatabase } from "../../tests/integration/test-database";

async function main() {
  assertTestDatabase();
  const [tenantId, requestId] = process.argv.slice(2);
  assert.match(tenantId || "", /^[a-f0-9-]{36}$/);
  assert.match(requestId || "", /^[a-f0-9-]{36}$/);
  const proof = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    assert.equal(tenant.demoOnly, true);
    const request = await tx.printRequest.findFirstOrThrow({
      where: { tenantId, id: requestId },
    });
    assert.equal(request.status, "FINALIZED");
    const workflow = await tx.issuanceWorkflow.findFirstOrThrow({
      where: { tenantId, requestId }, orderBy: { createdAt: "desc" },
    });
    assert.equal(workflow.status, "AWAITING_SIGNATURE");
    assert.equal(workflow.completedAt, null);
    const signatures = await tx.documentSignature.count({
      where: { tenantId, issuanceId: workflow.issuanceId },
    });
    assert.equal(signatures, 0);
    const documents = await tx.issuedDocument.findMany({
      where: { tenantId, requestId }, select: { id: true },
    });
    const publicLinks = await tx.publicDocumentVerification.count({
      where: { tenantId, documentId: { in: documents.map((document) => document.id) } },
    });
    assert.equal(publicLinks, 0);
    return {
      status: "PASS_UNSIGNED_PUBLIC_NEGATIVE_GUARD_STATE", tenantId, requestId,
      readOnly: true, readOnlyDatabaseTransaction: true, businessWrites: 0,
      workflowStatus: workflow.status, completedAt: workflow.completedAt,
      signatureCount: signatures, createdPublicLinks: publicLinks,
      positiveOfficialNcaSignedScope: "NOT_VERIFIED", legalApproval: false,
    };
  });
  console.log(JSON.stringify(proof));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
