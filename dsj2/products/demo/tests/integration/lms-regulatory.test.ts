import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { db, hash } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import { changeResult } from "../../apps/api/src/lms/document-bridge";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import {
  claimPreparation,
  prepareClaimedEvent,
} from "../../apps/api/src/regulatory-results/preparation";
import {
  claimDelivery,
  heartbeatDelivery,
  applyDeliveryResponse,
  deliverOne,
  receiveTestCallback,
  assertTestAdapterRuntime,
} from "../../apps/api/src/regulatory-results/delivery";
import { preparationDeadline } from "../../apps/api/src/regulatory-results/calendar";
import {
  createCalendar,
  sanitaryBatch,
  sanitaryExport,
  addManualEvidence,
} from "../../apps/api/src/regulatory-results/controller";
import type {
  ProviderReceipt,
  RegulatoryAdapter,
} from "../../packages/contracts/src/regulatory-results";
import { lmsTenant, lmsLearner, lmsCourse } from "./lms-fixture";

const access = {
  legalBasis: "SYNTHETIC",
  consentEvidence: "SYNTHETIC",
  accessControl: "NOT_APPLICABLE",
  accessControlEvidence: "SYNTHETIC",
  operatorAuthorization: "SYNTHETIC",
  storageCountry: "KZ",
  storageInventoryEvidence: "SYNTHETIC",
};
const fixed = new Date("2001-01-01T00:00:00Z");
const adapter: RegulatoryAdapter = {
  environment: "TEST",
  contractVersion: "internal-v1",
  capabilities: {
    idempotentSubmit: false,
    lookup: false,
    correction: false,
    revocation: false,
    lmkConfirmation: false,
  },
  async submit() {
    return { transportStatus: 200 };
  },
};

async function preparedFixture(name: string, fullNameRu?: string) {
  const owner = await lmsTenant(name);
  const learner = await lmsLearner(owner.tenant.id, name);
  if (fullNameRu)
    await db.recipient.update({
      where: { id: learner.recipient.id },
      data: {
        data: {
          fullNameRu,
          fullNameKz: "Әбдірахманов Нұрсұлтан Мұхамеджанұлы",
          positionRu: "Работник",
          positionKz: "Қызметкер",
        },
      },
    });
  const calendar = await createCalendar(owner.context, {
    name: "Synthetic work calendar",
    timezone: "Asia/Qyzylorda",
    coverageFrom: "2020-01-01",
    coverageUntil: "2030-12-31",
    definition: { sources: ["SYNTHETIC-NOT-OFFICIAL"], synthetic: true },
  });
  const definition = lmsCourse({ sanitary: true });
  definition.profile.calendarVersionId = calendar.id;
  definition.profile.destination = `test-${owner.tenant.id}`;
  const course = await createCourse(owner.context, definition);
  await publishVersion(owner.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(owner.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  await saveLessonProgress(learner.context, enrollment.id, "lesson-1", {
    sequence: 1,
    acknowledge: true,
  });
  const attempt = await startAttempt(learner.context, enrollment.id);
  await saveAnswers(learner.context, attempt.id, {
    sequence: 1,
    answers: Object.fromEntries(
      attempt.questions.map((q) => [q.id, ["a"]]),
    ),
  });
  await submitAttempt(learner.context, attempt.id);
  const result = await db.verifiedExamResult.findFirstOrThrow({
    where: { attemptId: attempt.id },
  });
  assert.equal(result.eligible, true);
  const event = await db.regulatoryOutbox.findFirstOrThrow({
    where: { resultId: result.id },
  });
  await db.regulatoryOutbox.update({
    where: { id: event.id },
    data: { availableAt: fixed },
  });
  return {
    owner,
    learner,
    result,
    event,
    destination: definition.profile.destination,
    calendar,
  };
}

async function prepare(fixture: Awaited<ReturnType<typeof preparedFixture>>) {
  const claim = await claimPreparation(fixed);
  assert.equal(claim?.id, fixture.event.id);
  const result = await prepareClaimedEvent(claim!.id, claim!.leaseToken, fixed);
  assert.ok("batchId" in result && result.batchId);
  const delivery = await db.integrationDelivery.findFirstOrThrow({
    where: { resultId: fixture.result.id },
  });
  await db.integrationDelivery.update({
    where: { id: delivery.id },
    data: { availableAt: fixed },
  });
  return { batchId: result.batchId as string, delivery };
}

test("S01-S10: real persisted sanitary preparation, fencing, receipt semantics and safe disconnected mode", async (t) => {
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  try {
    await t.test(
      "atomic outbox survives closed UI and expired worker lease without duplicates",
      async () => {
        const fixture = await preparedFixture("preparation crash");
        const claims = await Promise.all([
          claimPreparation(fixed, 1000),
          claimPreparation(fixed, 1000),
        ]);
        assert.equal(claims.filter(Boolean).length, 1);
        const old = claims.find(Boolean)!;
        assert.equal(old.id, fixture.event.id);
        await db.$disconnect();
        const later = new Date(fixed.getTime() + 1001);
        const replacement = await claimPreparation(later, 1000);
        assert.equal(replacement?.id, old.id);
        assert.equal(replacement!.leaseToken, old.leaseToken + 1);
        assert.deepEqual(
          await prepareClaimedEvent(old.id, old.leaseToken, later),
          { stale: true },
        );
        const result = await prepareClaimedEvent(
          replacement!.id,
          replacement!.leaseToken,
          later,
        );
        assert.ok("batchId" in result);
        assert.deepEqual(
          await prepareClaimedEvent(
            replacement!.id,
            replacement!.leaseToken,
            later,
          ),
          { stale: true },
        );
        assert.equal(
          await db.regulatoryBatchItem.count({
            where: { resultId: fixture.result.id },
          }),
          1,
        );
        assert.equal(
          await db.integrationDelivery.count({
            where: { resultId: fixture.result.id },
          }),
          1,
        );
        const batch = await sanitaryBatch(
          fixture.owner.context,
          result.batchId!,
        );
        assert.equal(batch.snapshotHash, hash(batch.snapshot));
        assert.equal(batch.slaBasis, "INTERNAL_SLA");
        assert.equal(batch.connectionState, "NOT_CONNECTED");
        assert.equal(batch.items[0].signatureState, "NOT_REQUIRED");
        const snapshot = JSON.stringify(batch.snapshot);
        await db.recipient.update({
          where: { id: fixture.learner.recipient.id },
          data: { data: { fullNameRu: "CHANGED AFTER PREPARATION" } },
        });
        assert.equal(
          JSON.stringify(
            (await sanitaryBatch(fixture.owner.context, batch.id)).snapshot,
          ),
          snapshot,
        );
        await assert.rejects(
          db.regulatoryBatch.update({
            where: { id: batch.id },
            data: { snapshot: { overwritten: true } },
          }),
        );
        const foreign = await lmsTenant("foreign sanitary reader");
        await assert.rejects(sanitaryBatch(foreign.context, batch.id));
        assert.equal(
          await claimDelivery(
            fixture.owner.tenant.id,
            fixture.destination,
            new Date(),
          ),
          null,
        );
        const file = await sanitaryExport(fixture.owner.context, batch.id, {
          format: "CSV",
        });
        assert.match(file.buffer.toString("utf8"), /Синтетический/);
        assert.equal(
          file.buffer.toString("utf8").includes("CHANGED AFTER PREPARATION"),
          false,
        );
      },
    );
    await t.test(
      "calendar handles Friday, holiday chain, working Saturday, local midnight and unknown coverage",
      () => {
        const calendar = {
          id: "synthetic",
          timezone: "Asia/Qyzylorda",
          coverageFrom: "2026-01-01",
          coverageUntil: "2026-12-31",
          definition: {
            sources: ["SYNTHETIC"],
            weekendDays: [0, 6],
            nonWorkingDates: ["2026-10-19", "2026-10-20"],
            workingDates: ["2026-10-17"],
            synthetic: true,
          },
        };
        assert.equal(
          preparationDeadline(
            new Date("2026-10-16T12:00:00Z"),
            calendar,
            "18:00",
          ).dueDate,
          "2026-10-17",
        );
        assert.equal(
          preparationDeadline(
            new Date("2026-10-17T12:00:00Z"),
            calendar,
            "18:00",
          ).dueDate,
          "2026-10-21",
        );
        assert.equal(
          preparationDeadline(
            new Date("2026-10-16T19:00:00Z"),
            calendar,
            "18:00",
          ).dueDate,
          "2026-10-21",
        );
        assert.equal(
          preparationDeadline(
            new Date("2026-12-31T01:00:00Z"),
            calendar,
            "18:00",
          ).state,
          "NEEDS_REVIEW",
        );
        assert.equal(preparationDeadline(null, calendar, "18:00").dueAt, null);
        assert.equal(
          preparationDeadline(
            new Date("2026-10-16T12:00:00Z"),
            calendar,
            "18:00",
          ).dueAt?.toISOString(),
          "2026-10-17T13:00:00.000Z",
        );
      },
    );
    await t.test(
      "connection and data-access gates deny every missing prerequisite; adapter fails closed outside test runtime",
      async () => {
        const fixture = await preparedFixture("policy gates");
        await prepare(fixture);
        const connection = await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        for (const field of Object.keys(access)) {
          const policy = {
            ...access,
            [field]: field === "accessControl" ? "UNKNOWN" : "",
          };
          await db.integrationConnection.update({
            where: { id: connection.id },
            data: { dataAccessPolicy: policy },
          });
          assert.equal(
            await claimDelivery(
              fixture.owner.tenant.id,
              fixture.destination,
              fixed,
            ),
            null,
            field,
          );
        }
        delete process.env.DEMO_LMS_TEST_RUNTIME;
        assert.throws(assertTestAdapterRuntime, /TEST_ADAPTER_FORBIDDEN/);
        process.env.DEMO_LMS_TEST_RUNTIME = "1";
      },
    );
    await t.test(
      "HTTP 200 does not equal accepted; stale fencing and callbacks cannot overwrite confirmed receipt",
      async () => {
        const fixture = await preparedFixture("receipt semantics");
        const { delivery } = await prepare(fixture);
        await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        const claim = await claimDelivery(
          fixture.owner.tenant.id,
          fixture.destination,
          fixed,
        );
        assert.equal(claim?.id, delivery.id);
        assert.equal(
          await heartbeatDelivery(delivery.id, claim!.leaseToken, fixed),
          true,
        );
        assert.deepEqual(
          await applyDeliveryResponse(
            delivery.id,
            claim!.leaseToken - 1,
            "SUBMIT",
            { transportStatus: 200 },
            adapter,
            fixed,
          ),
          { stale: true },
        );
        await applyDeliveryResponse(
          delivery.id,
          claim!.leaseToken,
          "SUBMIT",
          { transportStatus: 200 },
          adapter,
          fixed,
        );
        assert.equal(
          (
            await db.integrationDelivery.findUniqueOrThrow({
              where: { id: delivery.id },
            })
          ).state,
          "AWAITING_RECEIPT",
        );
        const receipt: ProviderReceipt = {
          receiptId: "synthetic-receipt-1",
          externalId: "synthetic-external-1",
          correlationId: delivery.correlationId,
          payloadHash: delivery.payloadHash,
          outcome: "ACCEPTED",
          lmkConfirmed: true,
          evidence: { synthetic: true },
        };
        const secret = "synthetic-test-callback-secret-only-123456";
        const callback = (body = JSON.stringify(receipt)) => {
          const timestamp = Date.now();
          return {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            deliveryId: delivery.id,
            body,
            secret,
            timestamp,
            signature: createHmac("sha256", secret)
              .update(`${timestamp}.${body}`)
              .digest("hex"),
          };
        };
        await assert.rejects(
          receiveTestCallback({ ...callback(), signature: "00" }, adapter),
        );
        await assert.rejects(
          receiveTestCallback(
            { ...callback(), tenantId: "wrong-tenant" },
            adapter,
          ),
        );
        await assert.rejects(
          receiveTestCallback(
            { ...callback(), destination: "wrong-destination" },
            adapter,
          ),
        );
        await assert.rejects(
          receiveTestCallback(
            callback(JSON.stringify({ ...receipt, payloadHash: "wrong" })),
            adapter,
          ),
        );
        await assert.rejects(
          receiveTestCallback(callback(), {
            ...adapter,
            environment: "PRODUCTION",
          } as unknown as RegulatoryAdapter),
        );
        assert.deepEqual(await receiveTestCallback(callback(), adapter), {
          replay: false,
        });
        await assert.rejects(
          receiveTestCallback(callback(), {
            ...adapter,
            environment: "PRODUCTION",
          } as unknown as RegulatoryAdapter),
        );
        assert.deepEqual(await receiveTestCallback(callback(), adapter), {
          replay: true,
        });
        await assert.rejects(
          receiveTestCallback(
            callback(JSON.stringify({ ...receipt, outcome: "REJECTED" })),
            adapter,
          ),
        );
        const stored = await db.integrationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        });
        assert.equal(stored.state, "ACCEPTED");
        assert.equal(stored.lmkState, "NOT_CONFIRMED");
        assert.equal(
          await db.integrationReceipt.count({
            where: { deliveryId: delivery.id },
          }),
          1,
        );
        const attested = await addManualEvidence(
          fixture.owner.context,
          delivery.id,
          {
            source: "Synthetic operator observation",
            reference: "SYNTHETIC-1",
          },
        );
        assert.equal(attested.category, "OPERATOR_ATTESTED");
        assert.equal(
          (
            await db.integrationDelivery.findUniqueOrThrow({
              where: { id: delivery.id },
            })
          ).lmkState,
          "NOT_CONFIRMED",
        );
      },
    );
    await t.test(
      "crash after send becomes UNKNOWN; unsafe blind resubmit is blocked",
      async () => {
        const fixture = await preparedFixture("unknown outcome");
        const { delivery } = await prepare(fixture);
        await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        const crashed = await claimDelivery(
          fixture.owner.tenant.id,
          fixture.destination,
          new Date(Date.now() - 60_000),
          1000,
        );
        assert.ok(crashed);
        let networkCalls = 0;
        await deliverOne(fixture.owner.tenant.id, fixture.destination, {
          ...adapter,
          async submit() {
            networkCalls++;
            return { transportStatus: 200 };
          },
        });
        assert.equal(networkCalls, 0);
        const stored = await db.integrationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        });
        assert.equal(stored.state, "NEEDS_REVIEW");
        assert.equal(stored.lastError, "RECONCILIATION_REQUIRED");
        assert.equal(
          await heartbeatDelivery(delivery.id, crashed!.leaseToken, new Date()),
          false,
        );
      },
    );
    await t.test(
      "timeout is reconciled with lookup and bounded throttling avoids immediate retry",
      async () => {
        const fixture = await preparedFixture("lookup outcome");
        const { delivery } = await prepare(fixture);
        await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        let submits = 0;
        let lookups = 0;
        const lookupAdapter: RegulatoryAdapter = {
          ...adapter,
          capabilities: { ...adapter.capabilities, lookup: true },
          async submit() {
            submits++;
            throw new Error(
              "synthetic network timeout after possible provider receipt",
            );
          },
          async lookup(input) {
            lookups++;
            return {
              transportStatus: 200,
              receipt: {
                receiptId: "lookup-receipt",
                externalId: "lookup-external",
                correlationId: input.correlationId,
                payloadHash: input.payloadHash,
                outcome: "ACCEPTED",
                evidence: { synthetic: true },
              },
            };
          },
        };
        await deliverOne(
          fixture.owner.tenant.id,
          fixture.destination,
          lookupAdapter,
        );
        assert.equal(
          (
            await db.integrationDelivery.findUniqueOrThrow({
              where: { id: delivery.id },
            })
          ).state,
          "UNKNOWN",
        );
        await db.integrationDelivery.update({
          where: { id: delivery.id },
          data: { availableAt: fixed },
        });
        await deliverOne(
          fixture.owner.tenant.id,
          fixture.destination,
          lookupAdapter,
        );
        assert.equal(submits, 1);
        assert.equal(lookups, 1);
        assert.equal(
          (
            await db.integrationDelivery.findUniqueOrThrow({
              where: { id: delivery.id },
            })
          ).state,
          "ACCEPTED",
        );
      },
    );
    await t.test(
      "throttle retries are delayed and bounded; two delivery workers claim only once",
      async () => {
        const fixture = await preparedFixture("throttle bounded");
        const { delivery } = await prepare(fixture);
        await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        const claims = await Promise.all([
          claimDelivery(fixture.owner.tenant.id, fixture.destination, fixed),
          claimDelivery(fixture.owner.tenant.id, fixture.destination, fixed),
        ]);
        assert.equal(claims.filter(Boolean).length, 1);
        const claim = claims.find(Boolean)!;
        await applyDeliveryResponse(
          claim.id,
          claim.leaseToken,
          "SUBMIT",
          { transportStatus: 429, retryAfterMs: 45_000 },
          adapter,
          fixed,
        );
        let stored = await db.integrationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        });
        assert.equal(stored.state, "RETRY_WAIT");
        assert.ok(stored.availableAt.getTime() >= fixed.getTime() + 45_000);
        assert.equal(
          await claimDelivery(
            fixture.owner.tenant.id,
            fixture.destination,
            fixed,
          ),
          null,
        );
        await db.integrationDelivery.update({
          where: { id: delivery.id },
          data: { attempts: 7, availableAt: fixed },
        });
        const final = await claimDelivery(
          fixture.owner.tenant.id,
          fixture.destination,
          fixed,
        );
        await applyDeliveryResponse(
          final!.id,
          final!.leaseToken,
          "SUBMIT",
          { transportStatus: 429 },
          adapter,
          fixed,
        );
        stored = await db.integrationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        });
        assert.equal(stored.state, "NEEDS_REVIEW");
        assert.equal(
          await claimDelivery(
            fixture.owner.tenant.id,
            fixture.destination,
            new Date(),
          ),
          null,
        );
      },
    );
    await t.test(
      "S06 three pending results seal one immutable batch; partial receipts never accept the whole batch",
      async () => {
        const fixture = await preparedFixture("partial three rows");
        for (const name of ["second row", "third row"]) {
          const learner = await lmsLearner(fixture.owner.tenant.id, name);
          const enrollment = (
            await assignEnrollments(fixture.owner.context, {
              courseVersionId: fixture.result.courseVersionId,
              recipientIds: [learner.recipient.id],
            })
          ).items[0];
          await saveLessonProgress(learner.context, enrollment.id, "lesson-1", {
            sequence: 1,
            acknowledge: true,
          });
          const attempt = await startAttempt(learner.context, enrollment.id);
          await saveAnswers(learner.context, attempt.id, {
            sequence: 1,
            answers: Object.fromEntries(
              attempt.questions.map((question) => [
                question.id,
                ["a"],
              ]),
            ),
          });
          await submitAttempt(learner.context, attempt.id);
        }
        await db.regulatoryOutbox.updateMany({
          where: { tenantId: fixture.owner.tenant.id },
          data: { availableAt: fixed },
        });
        const { batchId } = await prepare(fixture);
        const batch = await sanitaryBatch(fixture.owner.context, batchId);
        assert.equal(batch.items.length, 3);
        assert.equal((batch.snapshot as { items: unknown[] }).items.length, 3);
        assert.equal(batch.snapshotHash, hash(batch.snapshot));
        const originalSnapshot = JSON.stringify(batch.snapshot);
        assert.equal(
          await db.regulatoryOutbox.count({
            where: { tenantId: fixture.owner.tenant.id, status: "DONE" },
          }),
          3,
        );
        assert.equal(
          await db.regulatoryBatch.count({
            where: { tenantId: fixture.owner.tenant.id },
          }),
          1,
        );
        await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        await db.integrationDelivery.updateMany({
          where: { tenantId: fixture.owner.tenant.id },
          data: { availableAt: fixed },
        });
        for (const outcome of ["ACCEPTED", "REJECTED", "PENDING"] as const) {
          const delivery = await claimDelivery(
            fixture.owner.tenant.id,
            fixture.destination,
            fixed,
          );
          assert.ok(delivery);
          await applyDeliveryResponse(
            delivery.id,
            delivery.leaseToken,
            "SUBMIT",
            {
              transportStatus: 202,
              receipt: {
                receiptId: `partial-${outcome}`,
                externalId: `external-${delivery.id}`,
                correlationId: delivery.correlationId,
                payloadHash: delivery.payloadHash,
                outcome,
                evidence: { synthetic: true },
              },
            },
            adapter,
            fixed,
          );
        }
        const partial = await sanitaryBatch(fixture.owner.context, batchId);
        assert.equal(partial.deliveryState, "PARTIAL");
        assert.deepEqual(partial.deliveryCounts, {
          total: 3,
          accepted: 1,
          rejected: 1,
          unknown: 0,
          pending: 1,
        });
        assert.deepEqual(
          partial.items.map((item) => item.delivery?.state).sort(),
          ["ACCEPTED", "AWAITING_RECEIPT", "REJECTED"],
        );
        assert.equal(JSON.stringify(partial.snapshot), originalSnapshot);
        assert.equal(
          partial.items.every(
            (item) => item.delivery?.lmkState === "NOT_CONFIRMED",
          ),
          true,
        );
      },
    );
    await t.test(
      "S08 correction is immutable, idempotent under race, uses provider correction and fences late receipts",
      async () => {
        const fixture = await preparedFixture("correction positive race");
        const { delivery } = await prepare(fixture);
        await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        const claimed = await claimDelivery(
          fixture.owner.tenant.id,
          fixture.destination,
          fixed,
        );
        const receipt: ProviderReceipt = {
          receiptId: "original-receipt",
          externalId: "original-external",
          correlationId: delivery.correlationId,
          payloadHash: delivery.payloadHash,
          outcome: "ACCEPTED",
          evidence: { synthetic: true },
        };
        await applyDeliveryResponse(
          delivery.id,
          claimed!.leaseToken,
          "SUBMIT",
          { transportStatus: 200, receipt },
          adapter,
          fixed,
        );
        const oldSnapshot = JSON.stringify(fixture.result.snapshot);
        await db.recipient.update({
          where: { id: fixture.learner.recipient.id },
          data: {
            data: {
              fullNameRu: "Исправленное Синтетическое Имя",
              fullNameKz: "Түзетілген синтетикалық есім",
            },
          },
        });
        const corrections = await Promise.all([
          changeResult(
            fixture.owner.context,
            fixture.result.id,
            { reason: "Synthetic corrected name" },
            true,
          ),
          changeResult(
            fixture.owner.context,
            fixture.result.id,
            { reason: "Synthetic corrected name" },
            true,
          ),
        ]);
        assert.equal(
          corrections[0].replacementResultId,
          corrections[1].replacementResultId,
        );
        assert.ok(corrections[0].replacementResultId);
        await assert.rejects(
          changeResult(
            fixture.owner.context,
            fixture.result.id,
            { reason: "Different correction reason" },
            true,
          ),
        );
        await assert.rejects(
          changeResult(
            fixture.learner.context,
            fixture.result.id,
            { reason: "Learner cannot correct" },
            true,
          ),
        );
        const replacement = await db.verifiedExamResult.findUniqueOrThrow({
          where: { id: corrections[0].replacementResultId! },
        });
        assert.equal(replacement.attemptId, fixture.result.attemptId);
        assert.equal(replacement.supersedesResultId, fixture.result.id);
        assert.equal(replacement.revision, fixture.result.revision + 1);
        assert.notEqual(replacement.snapshotHash, fixture.result.snapshotHash);
        assert.equal(
          JSON.stringify(
            (
              await db.verifiedExamResult.findUniqueOrThrow({
                where: { id: fixture.result.id },
              })
            ).snapshot,
          ),
          oldSnapshot,
        );
        assert.equal(
          await db.verifiedExamResult.count({
            where: { supersedesResultId: fixture.result.id },
          }),
          1,
        );
        assert.equal(
          await db.lmsResultEvent.count({
            where: { resultId: fixture.result.id, kind: "SUPERSEDED" },
          }),
          1,
        );
        assert.deepEqual(
          await applyDeliveryResponse(
            delivery.id,
            claimed!.leaseToken,
            "SUBMIT",
            { transportStatus: 200, receipt },
            adapter,
            fixed,
          ),
          { stale: true },
        );
        const event = await db.regulatoryOutbox.findFirstOrThrow({
          where: { resultId: replacement.id },
        });
        await db.regulatoryOutbox.update({
          where: { id: event.id },
          data: { availableAt: fixed },
        });
        const correctionPrepared = await prepare({
          ...fixture,
          result: replacement,
          event,
        });
        let corrected = 0,
          submitted = 0;
        const correctionAdapter: RegulatoryAdapter = {
          ...adapter,
          capabilities: { ...adapter.capabilities, correction: true },
          async submit() {
            submitted++;
            throw new Error("Correction must not submit a new source");
          },
          async correct(input) {
            corrected++;
            assert.equal(input.previousExternalId, "original-external");
            assert.equal(
              (input.payload as { correction: { supersedesResultId: string } })
                .correction.supersedesResultId,
              fixture.result.id,
            );
            return {
              receipt: {
                receiptId: "corrected-receipt",
                externalId: "corrected-external",
                correlationId: input.correlationId,
                payloadHash: input.payloadHash,
                outcome: "ACCEPTED",
                evidence: { synthetic: true },
              },
            };
          },
        };
        await Promise.all([
          deliverOne(
            fixture.owner.tenant.id,
            fixture.destination,
            correctionAdapter,
          ),
          deliverOne(
            fixture.owner.tenant.id,
            fixture.destination,
            correctionAdapter,
          ),
        ]);
        assert.equal(corrected, 1);
        assert.equal(submitted, 0);
        assert.equal(
          (
            await db.integrationDelivery.findUniqueOrThrow({
              where: { id: correctionPrepared.delivery.id },
            })
          ).state,
          "ACCEPTED",
        );
        const body = JSON.stringify({
          ...receipt,
          receiptId: "late-original-receipt",
        });
        const timestamp = Date.now(),
          secret = "synthetic-correction-callback-secret-123456";
        await receiveTestCallback(
          {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            deliveryId: delivery.id,
            body,
            timestamp,
            secret,
            signature: createHmac("sha256", secret)
              .update(`${timestamp}.${body}`)
              .digest("hex"),
          },
          adapter,
        );
        assert.equal(
          (
            await db.integrationDelivery.findUniqueOrThrow({
              where: { id: delivery.id },
            })
          ).state,
          "SUPERSEDED",
        );
      },
    );
    await t.test(
      "S08 unsupported correction and voided source never become automatic resubmissions",
      async () => {
        const fixture = await preparedFixture("correction unsupported");
        const { delivery } = await prepare(fixture);
        await db.integrationConnection.create({
          data: {
            tenantId: fixture.owner.tenant.id,
            destination: fixture.destination,
            state: "SANDBOX",
            contractVersion: "internal-v1",
            dataAccessPolicy: access,
          },
        });
        const claimed = await claimDelivery(
          fixture.owner.tenant.id,
          fixture.destination,
          fixed,
        );
        await applyDeliveryResponse(
          delivery.id,
          claimed!.leaseToken,
          "SUBMIT",
          { transportStatus: 200, externalId: "external-original" },
          adapter,
          fixed,
        );
        const changed = await changeResult(
          fixture.owner.context,
          fixture.result.id,
          { reason: "Synthetic unsupported correction" },
          true,
        );
        const replacement = await db.verifiedExamResult.findUniqueOrThrow({
          where: { id: changed.replacementResultId! },
        });
        const event = await db.regulatoryOutbox.findFirstOrThrow({
          where: { resultId: replacement.id },
        });
        await db.regulatoryOutbox.update({
          where: { id: event.id },
          data: { availableAt: fixed },
        });
        const prepared = await prepare({
          ...fixture,
          result: replacement,
          event,
        });
        let submissions = 0;
        await deliverOne(fixture.owner.tenant.id, fixture.destination, {
          ...adapter,
          async submit() {
            submissions++;
            return { transportStatus: 200 };
          },
        });
        assert.equal(submissions, 0);
        assert.equal(
          (
            await db.integrationDelivery.findUniqueOrThrow({
              where: { id: prepared.delivery.id },
            })
          ).state,
          "NEEDS_REVIEW",
        );
        const voided = await changeResult(
          fixture.owner.context,
          replacement.id,
          { reason: "Synthetic revocation" },
          false,
        );
        assert.equal(voided.state, "VOIDED");
        assert.equal(
          await claimDelivery(fixture.owner.tenant.id, fixture.destination),
          null,
        );
        assert.equal(
          await db.verifiedExamResult.count({
            where: { supersedesResultId: replacement.id },
          }),
          0,
        );
      },
    );
    await t.test(
      "real CSV/XLSX/PDF internal exports preserve rows, neutralize formulas and retain honest meaning",
      async () => {
        const fixture = await preparedFixture("export formats", "=1+1");
        const { batchId } = await prepare(fixture);
        const directory = resolve(
          `docs/evidence/lms-one-run-20261015/agent-c/sanitary-files-${Date.now()}`,
        );
        await mkdir(directory, { recursive: true });
        const csv = await sanitaryExport(fixture.owner.context, batchId, {
          format: "CSV",
          language: "ru",
        });
        assert.ok(csv.buffer.toString("utf8").includes("'=1+1"));
        assert.equal(csv.buffer.toString("utf8").split("\r\n").length, 2);
        await writeFile(resolve(directory, "internal-list.csv"), csv.buffer);
        const xlsx = await sanitaryExport(fixture.owner.context, batchId, {
          format: "XLSX",
          language: "ru",
        });
        await writeFile(resolve(directory, "internal-list.xlsx"), xlsx.buffer);
        for (const language of ["ru", "kz"]) {
          const pdf = await sanitaryExport(fixture.owner.context, batchId, {
            format: "PDF",
            language,
          });
          assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
          await writeFile(
            resolve(directory, `internal-list-${language}.pdf`),
            pdf.buffer,
          );
        }
        assert.ok(
          process.env.DEMO_PYTHON,
          "Real pinned render Python required",
        );
        const validation = spawnSync(
          process.env.DEMO_PYTHON!,
          [
            "-X",
            "utf8",
            "-c",
            "import sys,json,pathlib,openpyxl,pypdf,pypdfium2; p=pathlib.Path(sys.argv[1]); w=openpyxl.load_workbook(p/'internal-list.xlsx'); s=w.active; assert s.max_row==2; assert not any(c.data_type=='f' for row in s for c in row); results={};\nfor language in ['ru','kz']:\n f=p/('internal-list-'+language+'.pdf'); r=pypdf.PdfReader(f); text=' '.join(x.extract_text() for x in r.pages); assert len(r.pages)>=1; assert ('Внутренний список' in text if language=='ru' else 'ішкі тізімі' in text); d=pypdfium2.PdfDocument(f); d[0].render(scale=1.5).to_pil().save(p/('internal-list-'+language+'.png')); results[language]={'pages':len(r.pages),'textCharacters':len(text)}\nprint(json.dumps({'xlsxRows':s.max_row,'pdf':results}))",
            directory,
          ],
          { encoding: "utf8", windowsHide: true },
        );
        assert.equal(validation.status, 0, validation.stderr);
        await writeFile(
          resolve(directory, "validation.json"),
          validation.stdout,
        );
      },
    );
  } finally {
    delete process.env.DEMO_LMS_TEST_RUNTIME;
    await db.$disconnect();
  }
});
