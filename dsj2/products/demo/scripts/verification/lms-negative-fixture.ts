import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest } from "../../apps/api/src/requests";
import { decideProposal } from "../../apps/api/src/approvals";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { addExternalEvidence } from "../../apps/api/src/lms/external";
import { uploadDestination } from "../../apps/api/src/lms/materials";
import {
  prepareResultDocuments,
  advanceLmsDocuments,
  documentView,
} from "../../apps/api/src/lms/document-bridge";
import { createCalendar } from "../../apps/api/src/regulatory-results/controller";
import {
  claimPreparation,
  prepareClaimedEvent,
} from "../../apps/api/src/regulatory-results/preparation";
import { deliverOne } from "../../apps/api/src/regulatory-results/delivery";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { store } from "../../apps/api/src/files";
import { draftSchema } from "../../packages/contracts/src";
import type { RegulatoryAdapter } from "../../packages/contracts/src/regulatory-results";
import { assertTestDatabase } from "../../tests/integration/test-database";
import {
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";
import { syntheticPdf } from "../../tests/fixtures/pdf";

async function main() {
  assertTestDatabase();
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/demo_test_lms_browser_20261015");
  assert.equal(process.env.DEMO_LMS_TEST_RUNTIME, "1");
  const started = performance.now();
  const center = await provision({
    email: `negative-${randomUUID()}@example.test`,
    password: LMS_PASSWORD,
    name: "Синтетический центр проверки ограничений",
    sample: true,
  });
  const context: Context = {
    tenantId: center.tenantId,
    userId: center.userId,
    role: "DIRECTOR",
    sessionId: "synthetic-negative",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const cases = [];
  let unknown = { batchId: "", deliveryId: "", submits: 0 };
  let signature = { documentId: "", status: "" };
  for (const kind of [
    "PRACTICE",
    "FAILED",
    "AUTO",
    "UNVERIFIED",
    "NEEDS_LEGAL_REVIEW",
    "SIGNATURE",
    "UNKNOWN",
  ] as const) {
    const labels = {
      PRACTICE: "Учебный тест",
      FAILED: "Экзамен не сдан",
      AUTO: "Обычная печать",
      UNVERIFIED: "Непроверенное основание",
      NEEDS_LEGAL_REVIEW: "Проверка маршрута",
      SIGNATURE: "Ожидание подписи",
      UNKNOWN: "Неизвестный исход передачи",
    };
    const learner = await lmsLearner(center.tenantId, labels[kind]);
    const definition = lmsCourse({
      kind:
        kind === "PRACTICE"
          ? "PRACTICE"
          : kind === "UNVERIFIED"
            ? "EXTERNAL_AUTHORIZED"
            : "CENTER_EXAM",
      required: false,
      sanitary: kind === "UNKNOWN",
    });
    definition.content.titleRu = `Синтетическая программа ${labels[kind]}`;
    definition.content.titleKz = `Синтетикалық бағдарлама ${labels[kind]}`;
    definition.profile.documentTypes = ["CERTIFICATE"];
    if (kind === "NEEDS_LEGAL_REVIEW")
      definition.profile.status = "NEEDS_LEGAL_REVIEW";
    if (kind === "SIGNATURE") {
      definition.profile.legalForm = "ELECTRONIC_ORIGINAL";
      definition.profile.requiredSignatures = ["DIRECTOR"];
    }
    if (kind === "UNKNOWN") {
      const calendar = await createCalendar(context, {
        name: "Synthetic negative calendar",
        timezone: "Asia/Qyzylorda",
        coverageFrom: "2020-01-01",
        coverageUntil: "2030-12-31",
        definition: { sources: ["SYNTHETIC-NOT-OFFICIAL"], synthetic: true },
      });
      definition.profile.calendarVersionId = calendar.id;
      definition.profile.destination = `test-${center.tenantId}`;
    }
    const course = await createCourse(context, definition);
    await publishVersion(context, course.version.id, { revision: 0 });
    const enrollment = (
      await assignEnrollments(context, {
        courseVersionId: course.version.id,
        recipientIds: [learner.recipient.id],
      })
    ).items[0];
    let resultId: string | null = null;
    if (["PRACTICE", "FAILED", "SIGNATURE", "UNKNOWN"].includes(kind)) {
      const attempt = await startAttempt(learner.context, enrollment.id);
      await saveAnswers(learner.context, attempt.id, {
        sequence: 1,
        answers: Object.fromEntries(
          definition.content.exam.questions.map((q) => [
            q.id,
            [kind === "FAILED" ? "b" : "a"],
          ]),
        ),
      });
      const outcome = await submitAttempt(learner.context, attempt.id);
      resultId = outcome.result!.id;
      if (kind === "PRACTICE" || kind === "FAILED")
        assert.equal(outcome.result!.eligible, false);
    }
    if (kind === "AUTO") {
      const draft = draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        demoMode: true,
        items: [
          {
            id: randomUUID(),
            recipientId: learner.recipient.id,
            fullNameRu: `Синтетический слушатель ${labels[kind]}`,
            positionRu: "Работник",
            assignments: [
              {
                id: randomUUID(),
                templateId: "ptm-card",
                outcome: { status: "PASSED", source: "AUTO" },
              },
            ],
          },
        ],
      });
      await createRequest(context, draft);
      assert.equal(
        await db.verifiedExamResult.count({
          where: { enrollmentId: enrollment.id },
        }),
        0,
      );
    }
    if (kind === "UNVERIFIED") {
      const buffer = syntheticPdf(
        "Synthetic unverified source; not an official exam result.",
      );
      const destination = await uploadDestination();
      const filename = `negative-${randomUUID()}.pdf`;
      const uploadPath = join(destination, filename);
      await writeFile(uploadPath, buffer);
      await addExternalEvidence(
        context,
        enrollment.id,
        {
          issuer: "Synthetic training center",
          sourceSystem: "Synthetic local source",
          documentNumber: "UNVERIFIED-001",
          documentDate: "2026-01-14",
          examDate: "2026-01-12",
        },
        {
          fieldname: "file",
          originalname: "synthetic-unverified.pdf",
          encoding: "7bit",
          mimetype: "application/pdf",
          size: buffer.length,
          buffer,
          stream: Readable.from(buffer),
          destination,
          filename,
          path: uploadPath,
        },
      );
      assert.equal(
        await db.verifiedExamResult.count({
          where: { enrollmentId: enrollment.id },
        }),
        0,
      );
    }
    if (kind === "SIGNATURE") {
      const prepared = await prepareResultDocuments(context, {
        resultIds: [resultId],
      });
      assert.equal(prepared.errors.length, 0);
      const link = prepared.items[0];
      const proposal = await db.requestProposal.findFirstOrThrow({
        where: {
          tenantId: center.tenantId,
          requestId: link.requestId,
          status: "PENDING",
        },
        orderBy: { revision: "desc" },
      });
      await decideProposal(context, proposal.id, {
        decision: "APPROVE",
        reason: "Synthetic prepared negative signature scenario",
        expectedProposalHash: proposal.proposalHash,
      });
      await advanceLmsDocuments();
      const owner = `negative-render-${randomUUID()}`;
      const deadline = performance.now() + 210000;
      while (performance.now() < deadline) {
        await advanceLmsDocuments();
        const current = await documentView(context, link.id);
        if (current.status === "AWAITING_SIGNATURE" && current.artifacts.length)
          break;
        assert.notEqual(current.status, "FAILED");
        const job = await claimJob(db, owner, center.tenantId);
        if (!job) {
          await new Promise((done) => setTimeout(done, 500));
          continue;
        }
        const beat = setInterval(() => {
          void heartbeat(db, job, owner);
        }, 5000);
        try {
          await executeJob(db, store, job, owner, AbortSignal.timeout(210000));
        } catch (error) {
          await settleFailure(db, job, owner, error);
          if (!(error instanceof DeferredJob)) throw error;
        } finally {
          clearInterval(beat);
        }
      }
      await advanceLmsDocuments();
      const view = await documentView(context, link.id);
      assert.equal(view.status, "AWAITING_SIGNATURE");
      assert.ok(view.artifacts.length);
      signature = { documentId: link.id, status: view.status };
    }
    if (kind === "UNKNOWN") {
      assert.ok(resultId);
      const event = await db.regulatoryOutbox.findFirstOrThrow({
        where: { tenantId: center.tenantId, resultId },
      });
      const fixed = new Date("2001-01-01T00:00:00Z");
      await db.regulatoryOutbox.update({
        where: { id: event.id },
        data: { availableAt: fixed },
      });
      const claim = await claimPreparation(fixed);
      if (claim) {
        assert.equal(claim.id, event.id);
        await prepareClaimedEvent(claim.id, claim.leaseToken, fixed);
      }
      // A real preparation worker may have atomically claimed this same event.
      // Wait for its committed result; never manufacture a delivery state.
      for (let i = 0; i < 100; i++) {
        if (
          await db.integrationDelivery.count({
            where: { tenantId: center.tenantId, resultId },
          })
        )
          break;
        await new Promise((done) => setTimeout(done, 100));
      }
      const delivery = await db.integrationDelivery.findFirstOrThrow({
        where: { tenantId: center.tenantId, resultId },
      });
      await db.integrationConnection.create({
        data: {
          tenantId: center.tenantId,
          destination: definition.profile.destination,
          state: "SANDBOX",
          contractVersion: "internal-v1",
          dataAccessPolicy: {
            legalBasis: "SYNTHETIC",
            consentEvidence: "SYNTHETIC",
            accessControl: "NOT_APPLICABLE",
            accessControlEvidence: "SYNTHETIC",
            operatorAuthorization: "SYNTHETIC",
            storageCountry: "KZ",
            storageInventoryEvidence: "SYNTHETIC",
          },
        },
      });
      let submits = 0;
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
          submits++;
          throw new Error(
            "Synthetic timeout after possible receipt; private diagnostic must not be displayed",
          );
        },
      };
      await deliverOne(
        center.tenantId,
        definition.profile.destination,
        adapter,
      );
      const saved = await db.integrationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      assert.equal(saved.state, "UNKNOWN");
      assert.equal(saved.lastError, "OUTCOME_UNKNOWN");
      assert.equal(submits, 1);
      unknown = {
        batchId: (
          await db.regulatoryBatchItem.findUniqueOrThrow({
            where: { id: delivery.batchItemId },
          })
        ).batchId,
        deliveryId: delivery.id,
        submits,
      };
    }
    cases.push({
      kind,
      enrollmentId: enrollment.id,
      courseId: course.course.id,
      name: `Синтетический слушатель ${labels[kind]}`,
      email: learner.user.email,
      resultId,
    });
  }
  await mkdir(resolve(".runtime/lms-one-run"), { recursive: true });
  await writeFile(
    resolve(".runtime/lms-one-run/negative-fixture.json"),
    JSON.stringify(
      {
        fixtureVersion: "lms-negative-real-domain-v1",
        tenantId: center.tenantId,
        director: center.email,
        cases,
        unknown,
        signature,
        setupMilliseconds: performance.now() - started,
        boundary:
          "Fresh isolated synthetic tenant, existing DEMO provisioning/templates, actual course/assignment/attempt/result, AUTO print draft, scanned private external input, explicit director approval and real render queue, persisted test-adapter timeout. All preparation precedes measured browser paths. No live provider, real signature, legal approval or physical print.",
      },
      null,
      2,
    ),
  );
  console.log("LMS_NEGATIVE_FIXTURE_READY");
}
void main().finally(() => db.$disconnect());
