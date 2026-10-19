import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import {
  prepareResultDocuments,
  advanceLmsDocuments,
  documentView,
  changeResult,
} from "../../apps/api/src/lms/document-bridge";
import { decideProposal, workingRequest } from "../../apps/api/src/approvals";
import { signingState } from "../../apps/api/src/signing";
import {
  publicVerificationRecord,
  setLmsVerificationPublication,
} from "../../apps/api/src/public-verification";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { store } from "../../apps/api/src/files";
import { draftSchema } from "../../packages/contracts/src";
import { lmsCourse, lmsLearner, LMS_PASSWORD } from "./lms-fixture";

test(
  "MVP §21/23: frozen complete protocol, stable embedded QR, issuance/privacy/download gates, revocation and expiry",
  { timeout: 300_000 },
  async () => {
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    const center = await provision({
      email: `qr-${randomUUID()}@example.test`,
      password: LMS_PASSWORD,
      name: "СИНТЕТИЧЕСКИЙ QR центр",
      sample: true,
    });
    const c: Context = {
      tenantId: center.tenantId,
      userId: center.userId,
      role: "DIRECTOR",
      sessionId: "test",
      csrfHash: "test",
      correlationId: randomUUID(),
    };
    const learner = await lmsLearner(c.tenantId, "QR владелец");
    const other = await lmsLearner(c.tenantId, "QR чужой");
    const definition = lmsCourse();
    definition.profile.documentTypes = [
      "PROTOCOL",
      "CERTIFICATE",
      "CREDENTIAL",
    ];
    definition.profile.commission = [
      { name: "Синтетический экзаменатор", role: "Председатель" },
    ];
    const created = await createCourse(c, definition);
    await publishVersion(c, created.version.id, { revision: 0 });
    const enrollment = (
      await assignEnrollments(c, {
        courseVersionId: created.version.id,
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
        attempt.questions.map((question) => [question.id, ["a"]]),
      ),
    });
    const completed = await submitAttempt(learner.context, attempt.id);
    const resultId = completed.result!.id;
    const prepared = await prepareResultDocuments(c, { resultIds: [resultId] });
    assert.deepEqual(prepared.errors, []);
    assert.equal(prepared.items.length, 3);
    const requestId = prepared.items[0].requestId;
    const frozen = draftSchema.parse(
      (await workingRequest(c, requestId)).draft,
    );
    const metadata = frozen.items[0].assignments[0].lms!;
    assert.equal(metadata.protocol!.questions.length, 10);
    assert.equal(metadata.protocol!.ordinal, 1);
    assert.equal(metadata.protocol!.percent, 100);
    assert.equal(
      metadata.protocol!.commission[0].name,
      "Синтетический экзаменатор",
    );
    assert.ok(
      metadata.protocol!.questions.every(
        (q) => q.correctAnswerRu && q.responseRu && q.score === 1,
      ),
    );
    const links = await db.lmsDocumentLink.findMany({
      where: { tenantId: c.tenantId, resultId },
    });
    assert.equal(new Set(links.map((link) => link.verificationUrl)).size, 3);
    const token = (url: string) => new URL(url).pathname.split("/").pop()!;
    for (const link of links) {
      assert.match(token(link.verificationUrl!), /^[a-f0-9]{64}$/);
      assert.equal(
        (await documentView(learner.context, link.id)).verification,
        null,
      );
      await assert.rejects(
        publicVerificationRecord(token(link.verificationUrl!)),
      );
    }
    const repeat = await prepareResultDocuments(c, { resultIds: [resultId] });
    assert.deepEqual(repeat.errors, []);
    assert.deepEqual(
      (
        await db.lmsDocumentLink.findMany({
          where: { tenantId: c.tenantId, resultId },
          orderBy: { id: "asc" },
        })
      ).map((link) => link.verificationUrl),
      [...links]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((link) => link.verificationUrl),
    );
    const proposal = await db.requestProposal.findFirstOrThrow({
      where: { tenantId: c.tenantId, requestId, status: "PENDING" },
      orderBy: { revision: "desc" },
    });
    await decideProposal(c, proposal.id, {
      decision: "APPROVE",
      reason: "Синтетическая проверка QR",
      expectedProposalHash: proposal.proposalHash,
    });
    await advanceLmsDocuments(30, c.tenantId);
    // Model a pre-transactional worker interrupted after binding an issuance.
    // Recovery must rebuild the missing publication without replacing its token.
    await db.publicDocumentVerification.delete({ where: { id: links[0].id } });
    await advanceLmsDocuments(30, c.tenantId);
    assert.equal(
      (
        await db.publicDocumentVerification.findUniqueOrThrow({
          where: { id: links[0].id },
        })
      ).tokenHash,
      links[0].verificationTokenHash,
    );
    for (const link of links)
      await assert.rejects(
        publicVerificationRecord(token(link.verificationUrl!)),
      );
    const owner = `qr-${randomUUID()}`;
    for (let n = 0; n < 50; n++) {
      if (
        !(await db.generationJob.count({
          where: {
            tenantId: c.tenantId,
            requestId,
            status: { not: "SUCCEEDED" },
          },
        }))
      )
        break;
      const job = await claimJob(db, owner, c.tenantId);
      if (!job) {
        await new Promise((done) => setTimeout(done, 250));
        continue;
      }
      const timer = setInterval(() => {
        void heartbeat(db, job, owner);
      }, 5000);
      try {
        await executeJob(db, store, job, owner, AbortSignal.timeout(210000));
      } catch (error) {
        await settleFailure(db, job, owner, error);
        if (!(error instanceof DeferredJob)) throw error;
      } finally {
        clearInterval(timer);
      }
    }
    assert.equal((await signingState(c, requestId)).status, "ISSUED");
    await advanceLmsDocuments(30, c.tenantId);
    const issuedLink = await db.lmsDocumentLink.findUniqueOrThrow({
      where: { id: links[0].id },
    });
    assert.equal(issuedLink.status, "ISSUED");
    await db.publicDocumentVerification.delete({
      where: { id: issuedLink.id },
    });
    await advanceLmsDocuments(30, c.tenantId);
    assert.equal(
      (
        await db.publicDocumentVerification.findUniqueOrThrow({
          where: { id: issuedLink.id },
        })
      ).tokenHash,
      issuedLink.verificationTokenHash,
      "already issued missing publications are repaired with the original token",
    );
    const directory = resolve(
      "docs/evidence/mvp-all-roles-20261019/run-01/documents/integration",
      c.tenantId,
    );
    await mkdir(directory, { recursive: true });
    for (const link of links) {
      const view = await documentView(learner.context, link.id);
      assert.equal(view.status, "ISSUED");
      assert.equal(view.verification!.url, link.verificationUrl);
      assert.match(view.verification!.qrDataUrl, /^data:image\/png;base64,/);
      assert.equal(
        JSON.stringify(view).includes("verificationTokenHash"),
        false,
      );
      await assert.rejects(documentView(other.context, link.id));
      await assert.rejects(
        setLmsVerificationPublication(learner.context, link.id, {
          action: "REVOKE",
        }),
      );
      const record = await publicVerificationRecord(
        token(link.verificationUrl!),
      );
      assert.equal(record.status, "ACTIVE_RECORD");
      assert.equal(
        record.learningDocument!.course!.titleRu,
        definition.content.titleRu,
      );
      const publicJson = JSON.stringify(record);
      for (const secret of [
        '"protocol":',
        "correctAnswerRu",
        "fullNameRu",
        "recipientId",
        "password",
        "answers",
        "verificationTokenHash",
        learner.user.email,
      ])
        assert.equal(publicJson.includes(secret), false, secret);
      for (const artifact of view.artifacts) {
        const file = await db.artifact.findUniqueOrThrow({
          where: { id: artifact.id },
        });
        await writeFile(
          resolve(
            directory,
            `${link.documentType.toLowerCase()}.${file.format.toLowerCase()}`,
          ),
          await store.read(file.storageKey, file.sha256),
        );
      }
    }
    const certificate = links.find(
      (link) => link.documentType === "CERTIFICATE",
    )!;
    await setLmsVerificationPublication(c, certificate.id, {
      action: "REVOKE",
    });
    await assert.rejects(
      publicVerificationRecord(token(certificate.verificationUrl!)),
    );
    assert.equal(
      (await documentView(learner.context, certificate.id)).verification,
      null,
    );
    const credential = links.find(
      (link) => link.documentType === "CREDENTIAL",
    )!;
    await setLmsVerificationPublication(c, credential.id, {
      action: "SET_EXPIRY",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await db.publicDocumentVerification.update({
      where: { id: credential.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await assert.rejects(
      publicVerificationRecord(token(credential.verificationUrl!)),
    );
    const protocol = links.find((link) => link.documentType === "PROTOCOL")!;
    const before = await db.verifiedExamResult.findUniqueOrThrow({
      where: { id: resultId },
    });
    await changeResult(
      c,
      resultId,
      { reason: "Синтетическая проверка аннулирования" },
      false,
    );
    assert.equal(
      (await publicVerificationRecord(token(protocol.verificationUrl!))).status,
      "REVOKED",
    );
    assert.deepEqual(
      (
        await db.verifiedExamResult.findUniqueOrThrow({
          where: { id: resultId },
        })
      ).snapshot,
      before.snapshot,
    );
    await writeFile(
      resolve(directory, "EVIDENCE.json"),
      JSON.stringify(
        {
          passed: true,
          synthetic: true,
          tenantId: c.tenantId,
          resultId,
          requestId,
          checks: [
            "real-finished-exam",
            "immutable-protocol-questions-answers-grading-commission",
            "three-distinct-stable-qr-links",
            "interrupted-publication-recovered-with-same-token",
            "hidden-before-issued",
            "real-docx-pdf",
            "learner-owner-only",
            "no-hash-leak",
            "public-minimization",
            "publication-revoke",
            "publication-expiry",
            "result-revocation-preserves-history",
          ],
        },
        null,
        2,
      ),
    );
  },
);

test.after(async () => {
  await db.$disconnect();
});
