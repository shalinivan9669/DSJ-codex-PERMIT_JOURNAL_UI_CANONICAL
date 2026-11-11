import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import { db, json } from "../../apps/api/src/core";
import { store } from "../../apps/api/src/files";
import {
  completeSigning,
  signingState,
  startSigning,
} from "../../apps/api/src/signing";
import {
  completeSigningBatch,
  startSigningBatch,
} from "../../apps/api/src/signing-batch";
import { assertTestDatabase } from "./test-database";
import { mockCms, signingFixture as fixture } from "./signing-fixture";

const rejectedCode = (expected: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};

test("NCALayer batches preserve exact issuance, owned capacities, retries and authorization", async (t) => {
  assertTestDatabase();
  const overrides = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    DEMO_LOCAL_SIGNATURE_MOCK: "1",
    DEMO_ORIGIN: "http://localhost:3119",
    DEMO_API_ORIGIN: "http://127.0.0.1:4119",
    DEMO_SIGNATURE_VERIFIER_URL: "",
    DEMO_SIGNATURE_VERIFIER_TOKEN: "",
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.$disconnect();
  });

  await t.test(
    "one batch retains three independent own roles, exact original bytes and idempotency",
    async () => {
      const f = await fixture();
      const selected = await f.issuance();
      const neighbor = await f.issuance(1);
      const input = { issuanceId: selected.id, operationKey: randomUUID() };
      const batch = await startSigningBatch(f.c, f.request.id, input);
      assert.equal(batch.localMock, true);
      assert.equal(batch.issuanceId, selected.id);
      assert.equal(batch.entries.length, 6);
      assert.deepEqual(
        [...new Set(batch.entries.map((entry) => entry.role))].sort(),
        ["CHAIR", "DIRECTOR", "TEACHER"],
      );
      for (const entry of batch.entries) {
        const original = selected.artifacts.find(
          (file) => file.id === entry.artifactId,
        )!;
        assert.ok(original, "the neighboring issuance never joins the batch");
        assert.equal(entry.documentId, original.documentId);
        assert.equal(entry.documentSha256, original.sha256);
        assert.deepEqual(
          Buffer.from(entry.dataBase64, "base64"),
          original.bytes,
        );
        assert.equal(
          f.bindings.find((binding) => binding.id === entry.bindingId)?.kind,
          entry.role,
        );
      }
      const repeated = await startSigningBatch(f.c, f.request.id, input);
      assert.equal(repeated.batchId, batch.batchId);
      assert.deepEqual(
        repeated.entries.map((entry) => entry.sessionId),
        batch.entries.map((entry) => entry.sessionId),
      );
      assert.equal(
        await db.signingSession.count({ where: { tenantId: f.c.tenantId } }),
        6,
      );
      await assert.rejects(
        startSigningBatch(f.c, f.request.id, {
          ...input,
          issuanceId: neighbor.id,
        }),
        rejectedCode("IDEMPOTENCY_CONFLICT"),
      );
      const payload = {
        entries: batch.entries.map((entry) => ({
          sessionId: entry.sessionId,
          signatureBase64: mockCms(),
        })),
      };
      const completed = await completeSigningBatch(f.c, batch.batchId, payload);
      assert.equal(completed.completedCount, 6);
      assert.equal(completed.failedCount, 0);
      assert.equal(completed.remainingCount, 0);
      assert.ok(
        completed.results.every((entry) => entry.status === "COMPLETED"),
      );
      const replay = await completeSigningBatch(f.c, batch.batchId, payload);
      assert.deepEqual(
        replay.results.map((entry) => entry.signatureId),
        completed.results.map((entry) => entry.signatureId),
      );
      const signatures = await db.documentSignature.findMany({
        where: { tenantId: f.c.tenantId },
      });
      assert.equal(signatures.length, 6);
      assert.ok(
        signatures.every((signature) => signature.issuanceId === selected.id),
      );
      for (const original of selected.artifacts)
        assert.deepEqual(
          await store.read(original.storageKey, original.sha256),
          original.bytes,
        );
      assert.equal(
        await db.auditEvent.count({
          where: {
            tenantId: f.c.tenantId,
            action: "LOCAL_TEST_SIGNATURE_ACCEPTED",
          },
        }),
        6,
      );
      assert.equal(
        (await signingState(f.c, f.request.id, db, selected.id)).status,
        "ISSUED",
      );
      assert.equal(
        (await signingState(f.c, f.request.id, db, neighbor.id)).status,
        "AWAITING_SIGNATURE",
      );
      assert.equal(
        (
          await db.printRequest.findUniqueOrThrow({
            where: { id: f.request.id },
          })
        ).archivedAt,
        null,
      );
    },
  );

  await t.test(
    "partial failure keeps successful receipts and retries only failed sessions",
    async () => {
      const f = await fixture();
      const selected = await f.issuance(1);
      const batch = await startSigningBatch(f.c, f.request.id, {
        issuanceId: selected.id,
        operationKey: randomUUID(),
      });
      const [failed, ...succeeded] = batch.entries;
      const partial = await completeSigningBatch(f.c, batch.batchId, {
        entries: [
          {
            sessionId: failed.sessionId,
            signatureBase64: Buffer.alloc(150, 65).toString("base64"),
          },
          ...succeeded.map((entry) => ({
            sessionId: entry.sessionId,
            signatureBase64: mockCms(),
          })),
        ],
      });
      assert.equal(partial.completedCount, 2);
      assert.equal(partial.failedCount, 1);
      assert.equal(partial.remainingCount, 1);
      assert.equal(
        partial.results.find((entry) => entry.sessionId === failed.sessionId)
          ?.code,
        "SIGNATURE_INVALID",
      );
      assert.equal(
        partial.results.find((entry) => entry.sessionId === failed.sessionId)
          ?.retryable,
        false,
      );
      const retry = await completeSigningBatch(f.c, batch.batchId, {
        entries: [{ sessionId: failed.sessionId, signatureBase64: mockCms() }],
      });
      assert.equal(retry.completedCount, 3);
      assert.equal(retry.remainingCount, 0);
      assert.equal(
        await db.documentSignature.count({ where: { tenantId: f.c.tenantId } }),
        3,
      );
      assert.equal(
        await db.auditEvent.count({
          where: {
            tenantId: f.c.tenantId,
            action: "LOCAL_TEST_SIGNATURE_ACCEPTED",
          },
        }),
        3,
      );
    },
  );

  await t.test(
    "foreign sessions and duplicate entries fail before any signature is committed",
    async () => {
      const f = await fixture();
      const selected = await f.issuance(1);
      const neighbor = await f.issuance(1);
      const batch = await startSigningBatch(f.c, f.request.id, {
        issuanceId: selected.id,
        operationKey: randomUUID(),
      });
      const foreign = await startSigning(f.c, f.request.id, {
        artifactId: neighbor.artifacts[0].id,
        bindingId: f.bindings[0].id,
        provider: "NCALAYER",
      });
      const own = {
        sessionId: batch.entries[0].sessionId,
        signatureBase64: mockCms(),
      };
      for (const entries of [
        [own, { sessionId: foreign.id, signatureBase64: mockCms() }],
        [own, own],
      ])
        await assert.rejects(
          completeSigningBatch(f.c, batch.batchId, { entries }),
          rejectedCode("SIGNING_BATCH_SESSION_MISMATCH"),
        );
      assert.equal(
        await db.documentSignature.count({ where: { tenantId: f.c.tenantId } }),
        0,
      );
      for (const c of [
        { ...f.c, userId: f.other.id },
        { ...f.c, tenantId: randomUUID() },
      ])
        await assert.rejects(
          completeSigningBatch(c, batch.batchId, { entries: [own] }),
          rejectedCode("NOT_FOUND"),
        );
      await assert.rejects(
        startSigningBatch({ ...f.c, role: "OPERATOR" }, f.request.id, {
          issuanceId: selected.id,
          operationKey: randomUUID(),
        }),
        rejectedCode("DIRECTOR_REQUIRED"),
      );
      assert.equal(
        await db.documentSignature.count({ where: { tenantId: f.c.tenantId } }),
        0,
      );
    },
  );

  await t.test(
    "another person's required role stays unsigned and a revoked own role is refused",
    async () => {
      const f = await fixture({ foreignTeacher: true });
      const selected = await f.issuance(1);
      const batch = await startSigningBatch(f.c, f.request.id, {
        issuanceId: selected.id,
        operationKey: randomUUID(),
      });
      assert.deepEqual(batch.entries.map((entry) => entry.role).sort(), [
        "CHAIR",
        "DIRECTOR",
      ]);
      const revoked = batch.entries.find((entry) => entry.role === "CHAIR")!;
      await db.signatoryBinding.update({
        where: { id: revoked.bindingId },
        data: { active: false },
      });
      const completed = await completeSigningBatch(f.c, batch.batchId, {
        entries: batch.entries.map((entry) => ({
          sessionId: entry.sessionId,
          signatureBase64: mockCms(),
        })),
      });
      assert.equal(completed.completedCount, 1);
      assert.equal(completed.failedCount, 1);
      assert.equal(
        completed.results.find((entry) => entry.sessionId === revoked.sessionId)
          ?.code,
        "SIGNING_TARGET_CHANGED",
      );
      assert.equal(
        completed.results.find((entry) => entry.sessionId === revoked.sessionId)
          ?.retryable,
        false,
      );
      const signatures = await db.documentSignature.findMany({
        where: { tenantId: f.c.tenantId },
      });
      assert.equal(signatures.length, 1);
      assert.equal(signatures[0].bindingId, f.bindings[0].id);
      assert.equal(
        (await signingState(f.c, f.request.id, db, selected.id)).status,
        "AWAITING_SIGNATURE",
      );
    },
  );

  await t.test(
    "one expired session does not discard the other valid signatures",
    async () => {
      const f = await fixture();
      const selected = await f.issuance(1);
      const batch = await startSigningBatch(f.c, f.request.id, {
        issuanceId: selected.id,
        operationKey: randomUUID(),
      });
      const session = await db.signingSession.findUniqueOrThrow({
        where: { id: batch.entries[0].sessionId },
      });
      // Create an expired historical fixture; never rewrite immutable session fields.
      const expired = await db.signingSession.create({
        data: {
          ...session,
          id: randomUUID(),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      const originalOperation = await db.idempotencyOperation.findUniqueOrThrow(
        {
          where: { id: batch.batchId },
        },
      );
      const manifest = JSON.parse(JSON.stringify(originalOperation.result)) as {
        entries: { sessionId: string }[];
      };
      manifest.entries[0].sessionId = expired.id;
      const historical = await db.idempotencyOperation.create({
        data: {
          tenantId: f.c.tenantId,
          command: originalOperation.command,
          idempotencyKey: randomUUID(),
          payloadHash: originalOperation.payloadHash,
          result: json(manifest),
        },
      });
      const result = await completeSigningBatch(f.c, historical.id, {
        entries: manifest.entries.map((entry) => ({
          sessionId: entry.sessionId,
          signatureBase64: mockCms(),
        })),
      });
      assert.equal(result.completedCount, 2);
      assert.equal(result.failedCount, 1);
      const expiredResult = result.results.find(
        (entry) => entry.sessionId === expired.id,
      )!;
      assert.equal(expiredResult.code, "SIGNING_SESSION_EXPIRED");
      assert.equal(expiredResult.retryable, false);
      assert.equal(
        await db.documentSignature.count({ where: { tenantId: f.c.tenantId } }),
        2,
      );
    },
  );

  await t.test(
    "temporary original-file failure retries the same CMS without duplicating receipts",
    async () => {
      const f = await fixture();
      const selected = await f.issuance();
      const batch = await startSigningBatch(f.c, f.request.id, {
        issuanceId: selected.id,
        operationKey: randomUUID(),
      });
      const entries = batch.entries.map((entry) => ({
        sessionId: entry.sessionId,
        signatureBase64: mockCms(),
      }));
      const unavailable = selected.artifacts[0];
      const file = store.path(unavailable.storageKey);
      const held = `${file}.synthetic-unavailable-${randomUUID()}`;
      await rename(file, held);
      let partial: Awaited<ReturnType<typeof completeSigningBatch>>;
      try {
        partial = await completeSigningBatch(f.c, batch.batchId, { entries });
      } finally {
        await rename(held, file);
      }
      assert.equal(partial.completedCount, 3);
      assert.equal(partial.failedCount, 3);
      const failed = partial.results.filter(
        (entry) => entry.status === "FAILED",
      );
      assert.ok(
        failed.every(
          (entry) =>
            entry.artifactId === unavailable.id &&
            entry.code === "ARTIFACT_UNAVAILABLE" &&
            entry.retryable === true,
        ),
      );
      const result = await completeSigningBatch(f.c, batch.batchId, {
        entries: entries.filter((entry) =>
          failed.some((item) => item.sessionId === entry.sessionId),
        ),
      });
      assert.equal(result.completedCount, 6);
      assert.equal(result.failedCount, 0);
      assert.equal(
        await db.documentSignature.count({ where: { tenantId: f.c.tenantId } }),
        6,
      );
      assert.equal(
        await db.auditEvent.count({
          where: {
            tenantId: f.c.tenantId,
            action: "LOCAL_TEST_SIGNATURE_ACCEPTED",
          },
        }),
        6,
      );
      assert.deepEqual(
        await store.read(unavailable.storageKey, unavailable.sha256),
        unavailable.bytes,
      );
    },
  );

  await t.test(
    "the native batch entry limit is checked before sessions are created",
    async () => {
      const f = await fixture();
      const selected = await f.issuance(34);
      await assert.rejects(
        startSigningBatch(f.c, f.request.id, {
          issuanceId: selected.id,
          operationKey: randomUUID(),
        }),
        rejectedCode("SIGNING_BATCH_TOO_LARGE"),
      );
      assert.equal(
        await db.signingSession.count({ where: { tenantId: f.c.tenantId } }),
        0,
      );
      assert.equal(
        await db.idempotencyOperation.count({
          where: { tenantId: f.c.tenantId },
        }),
        0,
      );
    },
  );

  await t.test(
    "previous electronic signatures and paper-completed documents are excluded",
    async () => {
      const f = await fixture();
      const selected = await f.issuance();
      const first = selected.artifacts[0];
      const signed = await startSigning(f.c, f.request.id, {
        artifactId: first.id,
        bindingId: f.bindings[0].id,
        provider: "NCALAYER",
      });
      await completeSigning(f.c, signed.id, { signatureBase64: mockCms() });
      const paper = selected.artifacts[1];
      await db.auditEvent.create({
        data: {
          tenantId: f.c.tenantId,
          actorId: f.c.userId,
          action: "PRINT_PAPER_SIGNATURE_ATTESTED",
          entityId: paper.documentId!,
          correlationId: randomUUID(),
          metadata: {
            documentId: paper.documentId!,
            issuanceId: selected.id,
            artifactSha256: paper.sha256,
            signedAt: "2026-11-10",
            signerNames: [
              "Synthetic Director",
              "Synthetic Chair",
              "Synthetic Teacher",
            ],
            reason: "Synthetic paper fixture",
            category: "OPERATOR_ATTESTED",
            allRequiredSignaturesPresent: true,
          },
        },
      });
      const batch = await startSigningBatch(f.c, f.request.id, {
        issuanceId: selected.id,
        operationKey: randomUUID(),
      });
      assert.equal(batch.entries.length, 2);
      assert.ok(batch.entries.every((entry) => entry.artifactId === first.id));
      assert.deepEqual(batch.entries.map((entry) => entry.role).sort(), [
        "CHAIR",
        "TEACHER",
      ]);
      await completeSigningBatch(f.c, batch.batchId, {
        entries: batch.entries.map((entry) => ({
          sessionId: entry.sessionId,
          signatureBase64: mockCms(),
        })),
      });
      assert.equal(
        await db.documentSignature.count({
          where: { tenantId: f.c.tenantId, artifactId: paper.id },
        }),
        0,
      );
      assert.equal(
        (await signingState(f.c, f.request.id, db, selected.id)).status,
        "ISSUED",
      );
      await assert.rejects(
        startSigningBatch(f.c, f.request.id, {
          issuanceId: selected.id,
          operationKey: randomUUID(),
        }),
        rejectedCode("SIGNING_BATCH_EMPTY"),
      );
    },
  );
});
