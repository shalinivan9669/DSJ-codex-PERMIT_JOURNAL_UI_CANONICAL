import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "../../packages/database/src";
import { assertTestDatabase } from "../../tests/integration/test-database";

const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function inside(parent: string, target: string) {
  const relative = path.relative(parent, target);
  assert.ok(relative && !path.isAbsolute(relative));
  assert.ok(!relative.match(/^\.\.(?:[\\/]|$)/));
}
async function json(file: string) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  assertTestDatabase();
  assert.equal(process.env.DEMO_E2E_ISOLATED_TENANT, "1");
  assert.ok(process.env.DEMO_ARTIFACT_ROOT);
  const root = await realpath(process.cwd());
  const folder = await realpath(path.resolve(process.argv[2] || ""));
  inside(
    path.resolve(root, "docs/evidence/operator-flow-full-fix-20261003"),
    folder,
  );
  const context = await json(path.join(folder, "full-run-context.json"));
  assert.match(context.runId || "", /^[a-zA-Z0-9_-]{8,100}$/);
  assert.equal(context.runtime, "http://127.0.0.1:3134");
  assert.equal(context.producersFresh, true);
  assert.equal(context.checkpointDependencies, true);
  const evidence = await realpath(path.join(folder, "common-prepared"));
  inside(folder, evidence);
  const checkpoint = await json(path.join(evidence, "checkpoint.json"));
  const result = await json(path.join(evidence, "common-history-result.json"));
  const session = await json(
    path.join(evidence, "common-session-readback.json"),
  );
  const publicGuard = await json(
    path.join(evidence, "common-public-aggregate-guard.json"),
  );
  const rendered = await json(
    path.join(evidence, "rendered-document-readback.json"),
  );
  for (const record of [checkpoint, result, session, publicGuard])
    assert.equal(record.suiteRunId, context.runId);
  assert.equal(checkpoint.status, "FILES_AND_HISTORY_VERIFIED");
  assert.equal(result.status, "PASS");
  assert.equal(result.sameFreshCheckpointContinuation, null);
  assert.equal(checkpoint.requestId, result.requestId);
  assert.equal(publicGuard.requestId, checkpoint.requestId);
  assert.equal(session.actualAuthenticatedSessionVerified, true);
  assert.equal(session.tenantDemoOnly, true);
  assert.equal(session.origin, context.runtime);
  assert.equal(session.role, "OPERATOR");
  assert.ok(session.userId && session.tenantId);
  assert.equal(session.tenantId, context.isolatedTenant);
  if (process.env.DEMO_E2E_TENANT_ID)
    assert.equal(session.tenantId, process.env.DEMO_E2E_TENANT_ID);
  if (process.env.DEMO_TENANT_ID)
    assert.equal(session.tenantId, process.env.DEMO_TENANT_ID);
  assert.equal(checkpoint.issued.tenantId, session.tenantId);
  assert.equal(publicGuard.tenantId, session.tenantId);
  assert.equal(publicGuard.files.length, 2);
  assert.ok(
    publicGuard.files.every(
      (record: { publicStatus: number; publicCode: string }) =>
        record.publicStatus === 409 &&
        record.publicCode === "ISSUANCE_NOT_COMPLETE",
    ),
  );
  assert.equal(checkpoint.issued.issuances.length, 1);
  const issuanceId = checkpoint.issued.issuances[0].id as string;
  assert.equal(publicGuard.issuanceId, issuanceId);
  assert.equal(rendered.files.length, 210);
  assert.equal(rendered.jobs.length, 212);
  const storageRoot = await realpath(process.env.DEMO_ARTIFACT_ROOT!);
  const db = new PrismaClient({ log: [] });
  try {
    await db.$transaction(
      async (tx) => {
        // This connection cannot write business data, including by accident.
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const mode = await tx.$queryRaw<Array<{ readOnly: string }>>`
          SELECT current_setting('transaction_read_only') AS "readOnly"
        `;
        assert.equal(mode[0].readOnly, "on");
        const tenantId = session.tenantId as string;
        const requestId = checkpoint.requestId as string;
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
        });
        assert.equal(tenant.demoOnly, true);
        const actor = await tx.user.findFirstOrThrow({
          where: { id: session.userId, tenantId },
        });
        assert.equal(actor.role, session.role);
        const request = await tx.printRequest.findFirstOrThrow({
          where: { id: requestId, tenantId },
        });
        assert.equal(request.status, "FINALIZED");
        const issuance = await tx.issuance.findFirstOrThrow({
          where: { id: issuanceId, requestId, tenantId },
        });
        assert.deepEqual(
          issuance.snapshot,
          checkpoint.issued.issuances[0].snapshot,
        );
        const snapshotHash = digest(JSON.stringify(issuance.snapshot));
        const workflow = await tx.issuanceWorkflow.findFirstOrThrow({
          where: { issuanceId, requestId, tenantId },
        });
        assert.equal(workflow.status, "AWAITING_SIGNATURE");
        const signingPolicy = workflow.requiredSigners as {
          version?: number;
          signers?: { kind?: string }[];
          commission?: { kind?: string }[];
          head?: { kind?: string };
          eventHead?: Record<string, { kind?: string }>;
          eventCommission?: Record<string, { kind?: string }[]>;
          assignmentEvents?: Record<string, string>;
        };
        assert.equal(signingPolicy.version, 2);
        assert.ok(Array.isArray(signingPolicy.signers));
        assert.equal(signingPolicy.signers!.length, 1);
        assert.equal(signingPolicy.signers![0].kind, "DIRECTOR");
        assert.ok(Array.isArray(signingPolicy.commission));
        assert.deepEqual(
          signingPolicy.commission!.map((signer) => signer.kind),
          ["CHAIR", "MEMBER", "MEMBER"],
        );
        assert.ok(
          signingPolicy.head &&
            ["DIRECTOR", "CHAIR", "MEMBER"].includes(
              signingPolicy.head.kind || "",
            ),
        );
        assert.ok(
          signingPolicy.eventHead &&
            typeof signingPolicy.eventHead === "object" &&
            !Array.isArray(signingPolicy.eventHead),
        );
        assert.ok(
          signingPolicy.eventCommission &&
            typeof signingPolicy.eventCommission === "object" &&
            !Array.isArray(signingPolicy.eventCommission),
        );
        for (const commission of Object.values(
          signingPolicy.eventCommission!,
        )) {
          assert.ok(Array.isArray(commission));
          assert.deepEqual(
            commission.map((signer) => signer.kind),
            ["CHAIR", "MEMBER", "MEMBER"],
          );
        }
        assert.ok(
          signingPolicy.assignmentEvents &&
            typeof signingPolicy.assignmentEvents === "object" &&
            !Array.isArray(signingPolicy.assignmentEvents),
        );
        const signatures = await tx.documentSignature.findMany({
          where: { issuanceId, tenantId },
          orderBy: { id: "asc" },
        });
        assert.equal(signatures.length, 0);
        const documents = await tx.issuedDocument.findMany({
          where: { issuanceId, requestId, tenantId },
          orderBy: { id: "asc" },
        });
        assert.equal(documents.length, 105);
        assert.deepEqual(
          documents.map((record) => [record.id, record.number]),
          [...checkpoint.issued.documents]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((record) => [record.id, record.number]),
        );
        const jobs = await tx.generationJob.findMany({
          where: { requestId, issuanceId, tenantId },
          orderBy: { id: "asc" },
        });
        assert.equal(jobs.length, 212);
        assert.ok(
          jobs.every((job) => job.status === "SUCCEEDED" && !!job.artifactId),
        );
        assert.equal(new Set(jobs.map((job) => job.artifactId)).size, 212);
        const aggregates = jobs.filter((job) =>
          ["XLSX", "ZIP"].includes(job.kind),
        );
        assert.equal(aggregates.length, 2);
        assert.equal(aggregates[0].snapshotId, aggregates[1].snapshotId);
        const frozen = await tx.renderInputSnapshot.findFirstOrThrow({
          where: {
            id: aggregates[0].snapshotId,
            issuanceId,
            requestId,
            tenantId,
          },
        });
        const aggregateInput = frozen.input as { items: unknown[] };
        assert.equal(aggregateInput.items.length, 105);
        const stored = await tx.artifact.findMany({
          where: {
            requestId,
            issuanceId,
            tenantId,
            provenance: "ORIGINAL",
          },
          orderBy: { id: "asc" },
        });
        assert.equal(stored.length, 212);
        const allFiles = [];
        for (const artifact of stored) {
          assert.equal(
            jobs.find((job) => job.id === artifact.jobId)?.artifactId,
            artifact.id,
          );
          assert.equal(path.isAbsolute(artifact.storageKey), false);
          assert.ok(!artifact.storageKey.includes(".."));
          const source = await realpath(
            path.resolve(storageRoot, artifact.storageKey),
          );
          inside(storageRoot, source);
          const bytes = await readFile(source);
          assert.equal(digest(bytes), artifact.sha256);
          assert.equal(bytes.length, artifact.size);
          const file = `files/${artifact.id}.${artifact.format.toLowerCase()}`;
          const saved = path.resolve(evidence, file);
          inside(evidence, saved);
          const derivative = ["XLSX", "ZIP"].includes(artifact.format);
          if (derivative) {
            const guard = publicGuard.files.find(
              (record: { id: string }) => record.id === artifact.id,
            );
            assert.ok(guard);
            assert.equal(guard.sha256, artifact.sha256);
            assert.equal(guard.size, artifact.size);
            assert.equal(artifact.inputHash, frozen.inputHash);
            assert.equal(bytes.subarray(0, 2).toString(), "PK");
            await writeFile(saved, bytes);
          } else {
            const publicFile = rendered.files.find(
              (record: { id: string }) => record.id === artifact.id,
            );
            assert.ok(publicFile);
            assert.equal(publicFile.sha256, artifact.sha256);
            assert.equal(publicFile.path, file);
            const copied = await readFile(saved);
            assert.equal(digest(copied), artifact.sha256);
            assert.deepEqual(copied, bytes);
          }
          allFiles.push({
            id: artifact.id,
            documentId: artifact.documentId,
            issuanceId,
            jobId: artifact.jobId,
            format: artifact.format,
            sha256: artifact.sha256,
            bytes: bytes.length,
            path: file,
            inputHash: artifact.inputHash,
            rootContainmentVerified: true,
            scope: derivative
              ? "INTERNAL_SAVED_DERIVATIVE_READONLY"
              : "ACTUAL_PUBLIC_COPY_MATCHES_SAVED_ARTIFACT_BYTES",
          });
        }
        const issuanceAfter = await tx.issuance.findUniqueOrThrow({
          where: { id: issuanceId },
        });
        const workflowAfter = await tx.issuanceWorkflow.findUniqueOrThrow({
          where: { id: workflow.id },
        });
        const signaturesAfter = await tx.documentSignature.findMany({
          where: { issuanceId, tenantId },
          orderBy: { id: "asc" },
        });
        assert.equal(
          digest(JSON.stringify(issuanceAfter.snapshot)),
          snapshotHash,
        );
        assert.deepEqual(workflowAfter, workflow);
        assert.deepEqual(signaturesAfter, signatures);
        await writeFile(
          path.join(evidence, "common-frozen-aggregate-input.json"),
          JSON.stringify(
            {
              suiteRunId: context.runId,
              requestId,
              tenantId,
              issuanceId,
              snapshotId: frozen.id,
              inputHash: frozen.inputHash,
              input: frozen.input,
              sourceDraft: (issuance.snapshot as { draft: unknown }).draft,
            },
            null,
            2,
          ),
        );
        const output = {
          status: "PASS_ALL212_SAVED_BYTES_HASH_READONLY",
          suiteRunId: context.runId,
          requestId,
          tenantId,
          issuanceId,
          actualSessionSource: "common-session-readback.json",
          postgresTransactionReadOnly: true,
          businessWrites: 0,
          noDatabaseWrites: true,
          noPublicSignatureBypass: true,
          noReassemblyOrReissue: true,
          immutableSourceSnapshotSha256: snapshotHash,
          workflowBefore: workflow.status,
          workflowAfter: workflowAfter.status,
          signingPolicyGuard: {
            version: signingPolicy.version,
            directorSlots: signingPolicy.signers!.length,
            commissionSlots: signingPolicy.commission!.length,
            eventCommissionGroups: Object.keys(signingPolicy.eventCommission!)
              .length,
            structuralPolicyVerified: true,
          },
          signaturesBefore: signatures.length,
          signaturesAfter: signaturesAfter.length,
          sourceAndWorkflowAndSignaturesUnchanged: true,
          publicUnsignedGuard: "common-public-aggregate-guard.json",
          publicDocxPdf: 210,
          internalSavedDerivatives: 2,
          allSavedFiles: 212,
          files: allFiles,
          semanticDerivativeQa: "PENDING_PYTHON_CURRENT_FROZEN_INPUT_CHECK",
        };
        await writeFile(
          path.join(evidence, "common-all-saved-file-readback.json"),
          JSON.stringify(output, null, 2),
        );
        console.log(
          JSON.stringify({
            status: output.status,
            suiteRunId: context.runId,
            requestId,
            verifiedFiles: 212,
            businessWrites: 0,
          }),
        );
      },
      { timeout: 120000 },
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
