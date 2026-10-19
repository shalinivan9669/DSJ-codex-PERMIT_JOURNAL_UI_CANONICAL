import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../../scripts/setup";
import { db, hash, type Context } from "../../apps/api/src/core";
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
  artifactAccess,
} from "../../apps/api/src/lms/document-bridge";
import { checkReferences } from "../../apps/api/src/requests";
import { decideProposal, workingRequest } from "../../apps/api/src/approvals";
import { signingState } from "../../apps/api/src/signing";
import {
  createVerificationLink,
  publicVerificationRecord,
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
  "E08/E10: single-language frozen identity prepares all three forms without reentry and still rejects changed recipient fields",
  { timeout: 120_000 },
  async (t) => {
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    const center = await provision({
      email: `document-spelling-${randomUUID()}@example.test`,
      password: LMS_PASSWORD,
      name: "СИНТЕТИЧЕСКАЯ проверка сохранённого имени",
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
    try {
      const definition = lmsCourse();
      definition.profile.documentTypes = [
        "PROTOCOL",
        "CERTIFICATE",
        "CREDENTIAL",
      ];
      const created = await createCourse(c, definition);
      await publishVersion(c, created.version.id, { revision: 0 });
      for (const variant of [
        {
          label: "B2C Russian name without employer or position",
          fullNameRu: "Синтетический новый слушатель",
          fullNameKz: "",
          positionRu: "",
          positionKz: "",
          expectedName: "Синтетический новый слушатель",
          expectedPosition: "",
        },
        {
          label: "Kazakh-only directory spelling with whitespace counterpart",
          fullNameRu: " \t",
          fullNameKz: "Синтетикалық тыңдаушы",
          positionRu: "",
          positionKz: "Маман",
          expectedName: "Синтетикалық тыңдаушы",
          expectedPosition: "Маман",
        },
      ]) {
        await t.test(variant.label, async () => {
          const learner = await lmsLearner(c.tenantId, "один язык");
          const originalData = {
            fullNameRu: variant.fullNameRu,
            fullNameKz: variant.fullNameKz,
            positionRu: variant.positionRu,
            positionKz: variant.positionKz,
          };
          await db.recipient.update({
            where: { id: learner.recipient.id },
            data: { data: originalData },
          });
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
          assert.equal(completed.result?.eligible, true);
          const resultId = completed.result!.id;
          const original = await db.verifiedExamResult.findUniqueOrThrow({
            where: { id: resultId },
          });
          // Later directory edits cannot supply the identity of this result.
          await db.recipient.update({
            where: { id: learner.recipient.id },
            data: {
              data: {
                ...originalData,
                fullNameRu: "Позднее имя из справочника",
                fullNameKz: "Кейінгі атау",
              },
            },
          });
          if (!variant.fullNameKz) {
            await db.templateVersion.updateMany({
              where: {
                tenantId: c.tenantId,
                templateId: { startsWith: "lms-" },
              },
              data: { approved: false },
            });
            const blocked = await prepareResultDocuments(c, {
              resultIds: [resultId],
            });
            assert.deepEqual(blocked.items, []);
            assert.deepEqual(blocked.errors, [
              {
                resultId,
                code: "TEMPLATE_NOT_APPROVED",
                params: {},
                correlationId: c.correlationId,
                message: "Подтвердите формы документов в настройках центра",
              },
            ]);
            assert.equal(
              await db.numberReservation.count({
                where: { tenantId: c.tenantId },
              }),
              0,
            );
            await db.templateVersion.updateMany({
              where: {
                tenantId: c.tenantId,
                templateId: { startsWith: "lms-" },
              },
              data: { approved: true },
            });
          }
          const prepared = await prepareResultDocuments(c, {
            resultIds: [resultId],
          });
          assert.deepEqual(prepared.errors, []);
          assert.equal(prepared.items.length, 3);
          assert.ok(
            prepared.items.every((item) => item.status === "AWAITING_APPROVAL"),
          );
          const requestId = prepared.items[0].requestId;
          const saved = draftSchema.parse(
            (await workingRequest(c, requestId)).draft,
          );
          const row = saved.items[0];
          assert.equal(row.fullNameRu, variant.expectedName);
          assert.equal(row.fullNameKz, variant.expectedName);
          assert.equal(row.positionRu, variant.expectedPosition);
          assert.equal(row.positionKz, variant.expectedPosition);
          assert.equal(row.workplaceRu, "");
          assert.equal(row.workplaceKz, "");
          assert.equal(row.employerId, undefined);
          await checkReferences(db, c, saved, requestId);
          for (const field of [
            "fullNameRu",
            "fullNameKz",
            "positionRu",
            "positionKz",
            "workplaceRu",
            "workplaceKz",
          ] as const) {
            const forged = structuredClone(saved);
            forged.items[0][field] = "Подмена сохранённого источника";
            await assert.rejects(
              checkReferences(db, c, forged, requestId),
              (error: unknown) =>
                (error as { getResponse(): { code: string } }).getResponse()
                  .code === "LMS_SNAPSHOT_MISMATCH",
            );
          }
          const forgedEmployer = structuredClone(saved);
          forgedEmployer.items[0].employerId = randomUUID();
          await assert.rejects(
            checkReferences(db, c, forgedEmployer, requestId),
            (error: unknown) =>
              (error as { getResponse(): { code: string } }).getResponse()
                .code === "LMS_SNAPSHOT_MISMATCH",
          );
          const after = await db.verifiedExamResult.findUniqueOrThrow({
            where: { id: resultId },
          });
          assert.equal(after.snapshotHash, original.snapshotHash);
          assert.deepEqual(after.snapshot, original.snapshot);
          assert.equal(
            await db.numberReservation.count({
              where: { tenantId: c.tenantId },
            }),
            0,
          );
        });
      }
    } finally {
      await db.$disconnect();
    }
  },
);

test(
  "E08–E12: verified result reuses real DEMO approval, numbers, rendering, guarded documents and immutable correction",
  { timeout: 300_000 },
  async (t) => {
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    const center = await provision({
      email: `documents-${randomUUID()}@example.test`,
      password: LMS_PASSWORD,
      name: "СИНТЕТИЧЕСКАЯ приёмка LMS",
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
    const learner = await lmsLearner(c.tenantId, "документы");
    const other = await lmsLearner(c.tenantId, "чужой");
    const definition = lmsCourse({ sanitary: true });
    definition.profile.documentTypes = [
      "PROTOCOL",
      "CERTIFICATE",
      "CREDENTIAL",
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
    assert.equal(completed.result!.eligible, true);
    const resultId = completed.result!.id;
    let requestId = "",
      linkId = "",
      artifactHash = "";
    try {
      await t.test(
        "one preparation command copies saved facts and concurrent replay cannot duplicate request or numbers",
        async () => {
          const prepared = await prepareResultDocuments(c, {
            resultIds: [resultId],
          });
          assert.deepEqual(prepared.errors, []);
          assert.equal(prepared.items.length, 3);
          assert.ok(
            prepared.items.every((item) => item.status === "AWAITING_APPROVAL"),
          );
          requestId = prepared.items[0].requestId;
          linkId = prepared.items[0].id;
          const repeat = await Promise.all([
            prepareResultDocuments(c, { resultIds: [resultId] }),
            prepareResultDocuments(c, { resultIds: [resultId] }),
          ]);
          assert.ok(
            repeat.every((value) =>
              value.items.every((item) => item.requestId === requestId),
            ),
          );
          assert.equal(
            await db.numberReservation.count({
              where: { tenantId: c.tenantId },
            }),
            0,
          );
          const saved = draftSchema.parse(
            (await workingRequest(c, requestId)).draft,
          );
          assert.equal(saved.items[0].recipientId, learner.recipient.id);
          assert.equal(saved.items[0].assignments.length, 3);
          assert.ok(
            saved.items[0].assignments.every((a) =>
              a.templateId.startsWith("lms-"),
            ),
          );
          await checkReferences(db, c, saved, requestId);
          await assert.rejects(checkReferences(db, c, saved, randomUUID()));
          const forged = structuredClone(saved);
          forged.items[0].assignments[0].lms!.score = 999;
          await assert.rejects(checkReferences(db, c, forged));
          const forgedName = structuredClone(saved);
          forgedName.items[0].fullNameRu = "Подмена";
          await assert.rejects(checkReferences(db, c, forgedName));
          const forgedEmployer = structuredClone(saved);
          forgedEmployer.items[0].workplaceRu = "Другой работодатель";
          await assert.rejects(checkReferences(db, c, forgedEmployer));
          await assert.rejects(documentView(other.context, linkId));
          assert.equal(
            (await documentView(learner.context, linkId)).status,
            "AWAITING_APPROVAL",
          );
        },
      );
      await t.test(
        "explicit director approval precedes automatic numbering and existing render queue",
        async () => {
          assert.equal(await advanceLmsDocuments(), 0);
          const proposal = await db.requestProposal.findFirstOrThrow({
            where: { tenantId: c.tenantId, requestId, status: "PENDING" },
            orderBy: { revision: "desc" },
          });
          await decideProposal(c, proposal.id, {
            decision: "APPROVE",
            reason: "Синтетическая приёмка",
            expectedProposalHash: proposal.proposalHash,
          });
          await advanceLmsDocuments(30, c.tenantId);
          const link = await db.lmsDocumentLink.findUniqueOrThrow({
            where: { id: linkId },
          });
          if (!link.issuanceId) {
            const { finalize } = await import("../../apps/api/src/requests");
            await finalize(
              c,
              requestId,
              {
                expectedRevision: (await workingRequest(c, requestId)).revision,
              },
              randomUUID(),
            );
            assert.fail("Automatic release must link the issuance");
          }
          assert.equal(
            await db.numberReservation.count({
              where: { tenantId: c.tenantId },
            }),
            3,
          );
          const owner = `lms-documents-${randomUUID()}`;
          for (let n = 0; n < 40; n++) {
            const remaining = await db.generationJob.count({
              where: {
                tenantId: c.tenantId,
                requestId,
                status: { not: "SUCCEEDED" },
              },
            });
            if (!remaining) break;
            const job = await claimJob(db, owner, c.tenantId);
            if (!job) {
              await new Promise((done) => setTimeout(done, 250));
              continue;
            }
            const beat = setInterval(() => {
              void heartbeat(db, job, owner);
            }, 5000);
            try {
              await executeJob(
                db,
                store,
                job,
                owner,
                AbortSignal.timeout(210000),
              );
            } catch (error) {
              await settleFailure(db, job, owner, error);
              if (!(error instanceof DeferredJob)) throw error;
            } finally {
              clearInterval(beat);
            }
          }
          assert.equal(
            await db.generationJob.count({
              where: {
                tenantId: c.tenantId,
                requestId,
                status: { not: "SUCCEEDED" },
              },
            }),
            0,
          );
          const state = await signingState(c, requestId);
          assert.equal(state.documents.length, 3);
          assert.ok(
            state.documents.every((doc) => doc.requiredSigners.length === 0),
          );
          const view = await documentView(learner.context, linkId);
          assert.equal(view.status, "ISSUED");
          assert.equal(view.artifacts.length, 2);
          assert.equal(
            (await artifactAccess(learner.context, view.artifacts[0].id)).id,
            view.artifacts[0].id,
          );
          await assert.rejects(
            artifactAccess(other.context, view.artifacts[0].id),
          );
          const artifacts = await db.artifact.findMany({
            where: {
              tenantId: c.tenantId,
              requestId,
              format: { in: ["PDF", "DOCX"] },
            },
          });
          const directory = resolve(
            "docs/evidence/lms-one-run-20261015/root-documents",
          );
          await mkdir(directory, { recursive: true });
          for (const artifact of artifacts) {
            const bytes = await store.read(
              artifact.storageKey,
              artifact.sha256,
            );
            await writeFile(
              resolve(
                directory,
                `${artifact.documentId}.${artifact.format.toLowerCase()}`,
              ),
              bytes,
            );
            artifactHash += createHash("sha256").update(bytes).digest("hex");
          }
        },
      );
      await t.test(
        "correction creates a new fact revision, preserves original artifact bytes and revokes former QR state",
        async () => {
          const document = await db.issuedDocument.findFirstOrThrow({
            where: { tenantId: c.tenantId, requestId },
          });
          const published = await createVerificationLink(c, {
            documentId: document.id,
            publicationConfirmed: true,
          });
          const token = published.token;
          assert.equal(
            (await publicVerificationRecord(token)).status,
            "ACTIVE_RECORD",
          );
          const old = await db.verifiedExamResult.findUniqueOrThrow({
            where: { id: resultId },
          });
          const revised = await changeResult(
            c,
            resultId,
            { reason: "Синтетическое уточнение ФИО в справочнике" },
            true,
          );
          assert.ok(revised.replacementResultId);
          const next = await db.verifiedExamResult.findUniqueOrThrow({
            where: { id: revised.replacementResultId! },
          });
          assert.equal(next.revision, old.revision + 1);
          assert.equal(next.attemptId, old.attemptId);
          assert.equal(next.supersedesResultId, old.id);
          assert.equal(
            hash(
              (
                await db.verifiedExamResult.findUniqueOrThrow({
                  where: { id: old.id },
                })
              ).snapshot,
            ),
            old.snapshotHash,
          );
          assert.equal(
            (await documentView(learner.context, linkId)).status,
            "SUPERSEDED",
          );
          assert.equal(
            (await publicVerificationRecord(token)).status,
            "REPLACED",
          );
          assert.equal(
            (await prepareResultDocuments(c, { resultIds: [old.id] })).errors
              .length,
            1,
          );
          await changeResult(
            c,
            next.id,
            { reason: "Синтетическая отмена результата" },
            false,
          );
          assert.equal(
            (await prepareResultDocuments(c, { resultIds: [next.id] })).errors
              .length,
            1,
          );
          const artifacts = await db.artifact.findMany({
            where: {
              tenantId: c.tenantId,
              requestId,
              format: { in: ["PDF", "DOCX"] },
            },
          });
          let after = "";
          for (const artifact of artifacts)
            after += createHash("sha256")
              .update(await store.read(artifact.storageKey, artifact.sha256))
              .digest("hex");
          assert.equal(after, artifactHash);
          assert.equal(
            await db.numberReservation.count({
              where: { tenantId: c.tenantId },
            }),
            3,
          );
        },
      );
      await t.test(
        "same issuance and template cannot authorize another recipient's artifact",
        async () => {
          const source = await db.issuedDocument.findFirstOrThrow({
            where: { tenantId: c.tenantId, requestId },
          });
          const originalArtifact = await db.artifact.findFirstOrThrow({
            where: {
              tenantId: c.tenantId,
              documentId: source.id,
              format: "PDF",
            },
          });
          const foreignDocument = await db.issuedDocument.create({
            data: {
              ...source,
              id: randomUUID(),
              rowId: other.recipient.id,
              number: "SYNTHETIC-PRIVATE-BOUNDARY",
              assignmentId: randomUUID(),
            },
          });
          const privateBytes = await store.put(
            await store.read(
              originalArtifact.storageKey,
              originalArtifact.sha256,
            ),
            "pdf",
          );
          const privateArtifact = await db.artifact.create({
            data: {
              ...originalArtifact,
              id: randomUUID(),
              documentId: foreignDocument.id,
              ...privateBytes,
            },
          });
          await assert.rejects(
            artifactAccess(learner.context, privateArtifact.id),
            (error: unknown) =>
              (error as { getStatus(): number }).getStatus() === 404,
          );
          const publication = await createVerificationLink(c, {
            documentId: foreignDocument.id,
            publicationConfirmed: true,
          });
          assert.equal(
            (await publicVerificationRecord(publication.token))
              .learningDocument,
            undefined,
          );
          // Immutable records and their real bytes remain in this disposable
          // test tenant; no cleanup bypasses the production history trigger.
        },
      );
    } finally {
      await db.$disconnect();
    }
  },
);
