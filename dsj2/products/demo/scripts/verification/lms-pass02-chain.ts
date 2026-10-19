import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { provision } from "../setup";
import { db, type Context, type DemoRequest } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import {
  draftSchema,
  positiveAssignmentDefaults,
} from "../../packages/contracts/src";
import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "../../packages/contracts/src/lms";
import {
  lmsCourse,
  lmsLearner,
  lmsSession,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  coursePublicity,
  submitApplication,
  actOnApplication,
} from "../../apps/api/src/lms/applications";
import { applicationOrderSummary } from "../../apps/api/src/lms/application-workflow";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import {
  saveSubmission,
  submitSubmission,
} from "../../apps/api/src/lms/submissions";
import {
  reviewDetail,
  decideReview,
} from "../../apps/api/src/lms/manual-review";
import {
  claimPreparation,
  prepareClaimedEvent,
} from "../../apps/api/src/regulatory-results/preparation";
import {
  prepareResultDocuments,
  advanceLmsDocuments,
  documentView,
} from "../../apps/api/src/lms/document-bridge";
import {
  decideProposal,
  submitApproval,
  workingRequest,
} from "../../apps/api/src/approvals";
import { createRequest, finalize } from "../../apps/api/src/requests";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { store } from "../../apps/api/src/files";
import { signingState } from "../../apps/api/src/signing";
import { queryReport } from "../../apps/api/src/lms/report-query";
import { prepareDocumentBundle } from "../../apps/api/src/lms/document-bundles";

const root = resolve(".runtime/lms-pass02-operations-20261018");
const fixturePath = resolve(root, "chain-fixture.json");
const evidencePath = resolve(
  "docs/evidence/lms-full-tz-pass-02-operations-20261018/CHAIN_AC32_33.json",
);
function ownedDatabase() {
  const u = new URL(process.env.DATABASE_URL!);
  assert.equal(u.hostname, "127.0.0.1");
  assert.equal(u.port, "55479");
  assert.equal(u.pathname, "/demo_test_lms_pass02_chain");
  assert.equal(process.env.DEMO_LMS_TEST_RUNTIME, "1");
}
export async function renderAll(tenantId: string) {
  const owner = `pass02-chain:${randomUUID()}`;
  for (let n = 0; n < 40; n++) {
    const job = await claimJob(db, owner, tenantId);
    if (!job) break;
    const beat = setInterval(() => void heartbeat(db, job, owner), 5000);
    try {
      await executeJob(db, store, job, owner, AbortSignal.timeout(240_000));
    } catch (error) {
      await settleFailure(db, job, owner, error);
      if (!(error instanceof DeferredJob)) throw error;
    } finally {
      clearInterval(beat);
    }
  }
  const jobs = await db.generationJob.findMany({
    where: { tenantId },
    select: { id: true, status: true, attempts: true, errorCode: true },
  });
  assert.ok(
    jobs.length > 0 && jobs.every((j) => j.status === "SUCCEEDED"),
    JSON.stringify(jobs),
  );
  return jobs;
}
export async function approve(c: Context, requestId: string) {
  const proposal = await db.requestProposal.findFirstOrThrow({
    where: { tenantId: c.tenantId, requestId, status: "PENDING" },
    orderBy: { revision: "desc" },
  });
  await decideProposal(c, proposal.id, {
    decision: "APPROVE",
    reason:
      "SYNTHETIC AC32/33 local engineering approval; no real qualification",
    expectedProposalHash: proposal.proposalHash,
  });
  return proposal.id;
}
const decision = (
  detail: { revision: number; contentHash: string },
  value: string,
  extra = {},
) => ({
  decisionKey: randomUUID(),
  revision: detail.revision,
  contentHash: detail.contentHash,
  decision: value,
  feedback: "Синтетическая проверка по двум критериям",
  ...extra,
});
async function main() {
  ownedDatabase();
  if (process.argv.includes("--resume")) {
    const tenant = await db.tenant.findFirstOrThrow({
      where: { name: "SYNTHETIC AC32/33 center" },
    });
    const user = await db.user.findFirstOrThrow({
      where: { tenantId: tenant.id, role: "DIRECTOR" },
    });
    const c: Context = {
      tenantId: tenant.id,
      userId: user.id,
      role: user.role,
      sessionId: "resume",
      csrfHash: "",
      correlationId: randomUUID(),
    };
    const application = await db.lmsApplication.findFirstOrThrow({
      where: { tenantId: tenant.id, state: "ACCEPTED" },
    });
    const enrollment = await db.enrollment.findUniqueOrThrow({
      where: { id: application.enrollmentId! },
    });
    const learnerUser = await db.user.findUniqueOrThrow({
      where: { id: enrollment.learnerUserId! },
    });
    const recipient = await db.recipient.findUniqueOrThrow({
      where: { id: enrollment.recipientId },
    });
    const version = await db.courseVersion.findUniqueOrThrow({
      where: { id: enrollment.courseVersionId },
    });
    const course = await db.course.findUniqueOrThrow({
      where: { id: version.courseId },
    });
    const result = await db.verifiedExamResult.findFirstOrThrow({
      where: { enrollmentId: enrollment.id, eligible: true },
    });
    const outbox = await db.regulatoryOutbox.findFirstOrThrow({
      where: { resultId: result.id, status: "DONE" },
    });
    const learner = {
      user: learnerUser,
      recipient,
      context: { ...c, userId: learnerUser.id, role: "LEARNER" },
    };
    return finishChain(
      c,
      learner,
      { course, version },
      application,
      result,
      outbox.id,
      tenant.createdAt,
    );
  }
  await assert.rejects(
    access(fixturePath),
    "Refuse overwriting an existing chain fixture",
  );
  assert.equal(await db.tenant.count(), 0, "Use a NEW disposable database");
  const startedAt = new Date();
  const email = `${randomUUID()}@example.test`;
  const center = await provision({
    email,
    password: LMS_PASSWORD,
    name: "SYNTHETIC AC32/33 center",
    sample: true,
  });
  await db.tenant.update({
    where: { id: center.tenantId },
    data: { timezone: "Asia/Qyzylorda" },
  });
  const c: Context = {
    tenantId: center.tenantId,
    userId: center.userId,
    role: "DIRECTOR",
    sessionId: "synthetic-domain-harness",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const learner = await lmsLearner(c.tenantId, "AC32 Ә Ғ Қ Ө Ұ Ү Һ І");
  const d = lmsCourse({ sanitary: true, questions: 1 });
  const content = courseContentSchema.parse({
    ...d.content,
    titleRu: "SYNTHETIC AC32 полный учебный путь",
    titleKz: "SYNTHETIC AC32 толық оқу жолы",
    modules: [
      {
        ...d.content.modules[0],
        lessons: [
          d.content.modules[0].lessons[0],
          {
            id: "check",
            kind: "ASSESSMENT",
            titleRu: "Промежуточная проверка",
            titleKz: "Аралық тексеру",
            required: true,
            prerequisiteLessonIds: ["lesson-1"],
            assessment: d.content.exam,
          },
          {
            id: "work",
            kind: "ASSIGNMENT",
            titleRu: "Практическая работа",
            titleKz: "Тәжірибелік жұмыс",
            required: true,
            prerequisiteLessonIds: ["check"],
            assignment: {
              instructionsRu: "Объясните безопасные действия",
              instructionsKz: "Қауіпсіз әрекеттерді түсіндіріңіз",
              criteriaRu: "Два действия с обоснованием",
              criteriaKz: "Негізделген екі әрекет",
              allowText: true,
              allowFiles: false,
              maxSubmissions: 3,
            },
          },
        ],
      },
    ],
    exam: {
      ...d.content.exam,
      questions: [
        {
          ...d.content.exam.questions[0],
          id: "final-case",
          correctOptionIds: [],
          answerSpec: {
            kind: "CASE",
            contextRu: "Обнаружена опасность",
            contextKz: "Қауіп анықталды",
            response: {
              kind: "TEXT",
              mode: "MANUAL",
              criteriaRu: "Остановить работу и устранить опасность",
              criteriaKz: "Жұмысты тоқтату және қауіпті жою",
            },
          },
        },
      ],
    },
  });
  const profile = regulatoryProfileSchema.parse({
    ...d.profile,
    documentTypes: ["CERTIFICATE"],
    requiresPractice: true,
    practiceEvidenceMode: "REVIEWED_ASSIGNMENTS",
    legalForm: "INFORMATION_CARD",
    requiredSignatures: [],
  });
  const course = await createCourse(c, { content, profile });
  await publishVersion(c, course.version.id, { revision: 0 });
  await coursePublicity(c, course.course.id, {
    enabled: true,
    summaryRu: "Только синтетическая инженерная проверка",
    summaryKz: "Тек синтетикалық инженерлік тексеру",
  });
  const application = await submitApplication(
    { ip: "127.0.0.1" } as DemoRequest,
    {
      kind: "B2C",
      courseVersionId: course.version.id,
      idempotencyKey: randomUUID(),
    },
    learner.context,
  );
  const accepted = await actOnApplication(c, application.id, {
    action: "ACCEPT",
    revision: 0,
  });
  assert.ok(accepted.enrollmentId && accepted.orderId);
  const enrollmentId = accepted.enrollmentId;
  await assert.rejects(
    startAttempt(learner.context, enrollmentId),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "LESSONS_REQUIRED",
  );
  await saveLessonProgress(learner.context, enrollmentId, "lesson-1", {
    sequence: 1,
    acknowledge: true,
  });
  const intermediate = await startAttempt(
    learner.context,
    enrollmentId,
    "check",
  );
  await saveAnswers(learner.context, intermediate.id, {
    sequence: 1,
    answers: { [intermediate.questions[0].id]: ["a"] },
  });
  assert.equal(
    (await submitAttempt(learner.context, intermediate.id)).verdict,
    "PASSED",
  );
  await saveSubmission(learner.context, enrollmentId, "work", {
    sequence: 1,
    text: "Остановить работу",
    attachmentIds: [],
  });
  const first = await submitSubmission(learner.context, enrollmentId, "work", {
    sequence: 1,
  });
  const firstDetail = await reviewDetail(c, "SUBMISSION", first.id!);
  await decideReview(
    c,
    "SUBMISSION",
    first.id!,
    decision(firstDetail, "RETURNED"),
  );
  await assert.rejects(
    startAttempt(learner.context, enrollmentId),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "LESSONS_REQUIRED",
  );
  await saveSubmission(learner.context, enrollmentId, "work", {
    sequence: 2,
    text: "Остановить работу. Устранить опасность до возобновления",
    attachmentIds: [],
  });
  const second = await submitSubmission(learner.context, enrollmentId, "work", {
    sequence: 2,
  });
  const secondDetail = await reviewDetail(c, "SUBMISSION", second.id!);
  assert.notEqual(firstDetail.contentHash, secondDetail.contentHash);
  await decideReview(
    c,
    "SUBMISSION",
    second.id!,
    decision(secondDetail, "ACCEPTED"),
  );
  const attempt = await startAttempt(learner.context, enrollmentId);
  assert.equal(attempt.purpose, "FINAL");
  await saveAnswers(learner.context, attempt.id, {
    sequence: 1,
    answers: {
      [attempt.questions[0].id]: {
        kind: "TEXT",
        text: "Остановить работу, устранить опасность",
      },
    },
  });
  assert.equal(
    (await submitAttempt(learner.context, attempt.id)).state,
    "AWAITING_REVIEW",
  );
  assert.equal(
    await db.verifiedExamResult.count({ where: { attemptId: attempt.id } }),
    0,
  );
  const review = await reviewDetail(c, "ATTEMPT", attempt.id);
  await decideReview(
    c,
    "ATTEMPT",
    attempt.id,
    decision(review, "GRADE", {
      questionScores: { [attempt.questions[0].id]: 1 },
    }),
  );
  const result = await db.verifiedExamResult.findFirstOrThrow({
    where: { attemptId: attempt.id },
  });
  assert.equal(result.eligible, true);
  assert.equal(result.verdict, "PASSED");
  const practice = (
    result.snapshot as {
      practiceRequirement?: {
        satisfied: boolean;
        evidence: { contentHash: string; decisionId: string }[];
      };
    }
  ).practiceRequirement!;
  assert.equal(practice.satisfied, true);
  assert.equal(practice.evidence[0].contentHash, secondDetail.contentHash);
  const outbox = await db.regulatoryOutbox.findFirstOrThrow({
    where: { resultId: result.id },
  });
  assert.equal(outbox.status, "PENDING");
  const claimed = await claimPreparation();
  assert.equal(claimed!.id, outbox.id);
  await prepareClaimedEvent(claimed!.id, claimed!.leaseToken);
  assert.equal(
    (await db.regulatoryOutbox.findUniqueOrThrow({ where: { id: outbox.id } }))
      .status,
    "DONE",
  );
  assert.equal(
    await db.regulatoryBatchItem.count({ where: { resultId: result.id } }),
    1,
  );
  assert.equal(
    await db.sanitaryJournalEntry.count({ where: { resultId: result.id } }),
    1,
  );
  await finishChain(
    c,
    learner,
    course,
    { ...application, ...accepted },
    result,
    outbox.id,
    startedAt,
  );
}
async function finishChain(
  c: Context,
  learner: Awaited<ReturnType<typeof lmsLearner>>,
  course: { course: { id: string }; version: { id: string } },
  application: {
    id: string;
    orderId: string | null;
    enrollmentId: string | null;
  },
  result: Awaited<ReturnType<typeof db.verifiedExamResult.findFirstOrThrow>>,
  outboxId: string,
  startedAt: Date,
) {
  const email = (await db.user.findUniqueOrThrow({ where: { id: c.userId } }))
    .email;
  const practice = (result.snapshot as { practiceRequirement: unknown })
    .practiceRequirement;
  const prepared = await prepareResultDocuments(c, { resultIds: [result.id] });
  assert.deepEqual(prepared.errors, []);
  const link = prepared.items[0];
  assert.ok(link);
  if (
    await db.requestProposal.count({
      where: { requestId: link.requestId, status: "PENDING" },
    })
  )
    await approve(c, link.requestId);
  await advanceLmsDocuments();
  await renderAll(c.tenantId);
  await advanceLmsDocuments();
  assert.equal((await documentView(learner.context, link.id)).status, "ISSUED");
  const state = await signingState(c, link.requestId);
  assert.equal(state.status, "ISSUED");
  assert.equal(state.signatures.length, 0);
  const order = await applicationOrderSummary(c, application.id);
  assert.equal(order.assigned, 1);
  assert.equal(order.completed, 1);
  assert.equal(order.documentsReady, 1);
  const report = await queryReport(c, {
    kind: "DOCUMENTS",
    filters: { courseVersionId: course.version.id },
  });
  assert.equal(report.summary.issuedDocuments, 1);
  assert.equal(report.summary.completedAssignments, 1);
  assert.equal(report.summary.activeAssignments, 0);
  assert.equal(
    (
      await queryReport(c, {
        kind: "TRAINING",
        metric: "completedAssignments",
        filters: { courseVersionId: course.version.id, status: "COMPLETED" },
      })
    ).total,
    1,
  );
  const existingOrdinary = await db.printRequest.findFirst({
    where: {
      tenantId: c.tenantId,
      draft: { path: ["title"], equals: "SYNTHETIC AC33 ordinary PASSED AUTO" },
    },
  });
  const ordinary =
    existingOrdinary ||
    (await (async () => {
      const ordinaryPerson = await lmsLearner(c.tenantId, "AC33 ordinary");
      return createRequest(
        c,
        draftSchema.parse({
          schemaVersion: 2,
          kind: "PERSON",
          title: "SYNTHETIC AC33 ordinary PASSED AUTO",
          demoMode: true,
          items: [
            {
              id: randomUUID(),
              recipientId: ordinaryPerson.recipient.id,
              fullNameRu: "Синтетический Слушатель Обычный",
              fullNameKz: "Синтетикалық Әдеттегі Тыңдаушы",
              positionRu: "Работник",
              positionKz: "Қызметкер",
              assignments: [
                {
                  id: randomUUID(),
                  templateId: "pb-card",
                  protocolMode: "INDIVIDUAL",
                  ...positiveAssignmentDefaults("pb-card"),
                },
              ],
            },
          ],
        }),
      );
    })());
  let work = await workingRequest(c, ordinary.id);
  const ordinaryDraft = draftSchema.parse(work.draft);
  assert.equal(ordinaryDraft.items[0].assignments[0].outcome?.status, "PASSED");
  assert.equal(
    ordinaryDraft.items[0].assignments[0].fieldOrigins?.outcome,
    "AUTO",
  );
  if (
    !(await db.issuance.count({
      where: { tenantId: c.tenantId, requestId: ordinary.id },
    }))
  ) {
    await submitApproval(c, ordinary.id, { expectedRevision: work.revision });
    await approve(c, ordinary.id);
    work = await workingRequest(c, ordinary.id);
    await finalize(
      c,
      ordinary.id,
      { expectedRevision: work.revision },
      randomUUID(),
    );
  }
  const jobs = await renderAll(c.tenantId);
  const ordinaryState = await signingState(c, ordinary.id);
  assert.equal(ordinaryState.status, "AWAITING_SIGNATURE");
  const learnerBundle = await prepareDocumentBundle(learner.context, {
    documentIds: [link.id],
    format: "PDF",
  });
  await renderAll(c.tenantId);
  process.env.PORT = "0";
  const app = await bootstrap();
  const downloads: object[] = [];
  try {
    const base = await app.getUrl(),
      staff = await lmsSession(base, email),
      own = await lmsSession(base, learner.user.email);
    const permittedBundle = await fetch(
      `${base}/learn/documents/bundles/${learnerBundle.id}/parts/0`,
      { headers: own },
    );
    assert.equal(permittedBundle.status, 200);
    const bundleBytes = Buffer.from(await permittedBundle.arrayBuffer());
    assert.equal(bundleBytes.subarray(0, 2).toString(), "PK");
    downloads.push({
      format: "LMS_BUNDLE",
      learnerHttpStatus: 200,
      size: bundleBytes.length,
      sha256: createHash("sha256").update(bundleBytes).digest("hex"),
    });
    for (const requestId of [link.requestId, ordinary.id]) {
      const artifacts = await db.artifact.findMany({
        where: { tenantId: c.tenantId, requestId },
      });
      assert.ok(
        artifacts.some((a) => a.format === "PDF") &&
          artifacts.some((a) => a.format === "DOCX"),
      );
      for (const a of artifacts) {
        const ordinaryBundle =
          requestId === ordinary.id && ["ZIP", "XLSX"].includes(a.format);
        const blockedBundle =
          ordinaryBundle ||
          (a.format === "ZIP" &&
            a.issuanceId !== null &&
            a.provenance !== "PRINT_SET_DERIVATIVE");
        const response = await fetch(`${base}/artifacts/${a.id}`, {
          headers: staff,
        });
        if (response.status !== (blockedBundle ? 409 : 200))
          throw new Error(
            `DOWNLOAD ${requestId} ${a.format} ${response.status} ${await response.text()}`,
          );
        if (!blockedBundle) {
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(bytes.length, a.size);
          assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            a.sha256,
          );
        }
        let learnerHttpStatus: number | null = null;
        if (
          requestId === link.requestId &&
          ["PDF", "DOCX"].includes(a.format)
        ) {
          const r = await fetch(`${base}/learn/artifacts/${a.id}`, {
            headers: own,
          });
          learnerHttpStatus = r.status;
          assert.equal(r.status, 200);
          assert.equal(
            createHash("sha256")
              .update(Buffer.from(await r.arrayBuffer()))
              .digest("hex"),
            a.sha256,
          );
        }
        downloads.push({
          id: a.id,
          requestId,
          format: a.format,
          size: a.size,
          sha256: a.sha256,
          staffHttpStatus: response.status,
          learnerHttpStatus,
        });
      }
    }
  } finally {
    await app.close();
  }
  const fixture = {
    version: 1,
    tenantId: c.tenantId,
    director: { userId: c.userId, email, password: LMS_PASSWORD },
    learner: {
      userId: learner.user.id,
      recipientId: learner.recipient.id,
      email: learner.user.email,
      password: LMS_PASSWORD,
    },
    courseId: course.course.id,
    courseVersionId: course.version.id,
    applicationId: application.id,
    orderId: application.orderId,
    enrollmentId: application.enrollmentId,
    resultId: result.id,
    documentId: link.id,
    documentRequestId: link.requestId,
    ordinaryRequestId: ordinary.id,
  };
  await mkdir(root, { recursive: true });
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2), {
    mode: 0o600,
  });
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        status: "PASS",
        acceptanceScope: {
          executedScenario: "PASS",
          AC30: "NOT_RUN",
          AC31: "NOT_RUN",
          AC32: "PARTIAL_INBOX_NOT_RUN",
          AC33: "PARTIAL_INVALIDATION_NOT_RUN",
          reason:
            "Additional checks deferred by explicit user instruction to finish and leave testing to the user",
        },
        startedAt,
        finishedAt: new Date(),
        fixture: fixturePath,
        steps: [
          "B2C application",
          "accepted order assignment",
          "required text",
          "intermediate assessment",
          "practice returned/revised/accepted",
          "manual final awaiting review",
          "authorized review",
          "eligible immutable result",
          "actual regulatory outbox consumption",
          "document prepare",
          "director proposal approval",
          "actual renderer queue",
          "issued workflow",
          "allowed learner download",
          "order and report",
        ],
        practice,
        result: {
          id: result.id,
          hash: result.snapshotHash,
          eligible: result.eligible,
        },
        outbox: { id: outboxId, status: "DONE" },
        order,
        summary: report.summary,
        jobs,
        downloads,
        ordinary: {
          outcome: "PASSED",
          origin: "AUTO",
          workflow: ordinaryState.status,
          bundle: "DENIED_UNTIL_REQUIRED_SIGNATURES",
        },
        syntheticRule: {
          sanitary: true,
          legalForm: "INFORMATION_CARD",
          requiredSignatures: [],
          synthetic: true,
          productionAuthorization: false,
        },
        limits: [
          "Internal API/domain path, not browser acceptance",
          "No physical printing or real qualification",
          "Sanitary provider NOT_CONNECTED; no network delivery",
          "Ordinary bundle remains correctly denied without required signatures",
          "Inbox and restore continuation: NOT_RUN; prepared recovery harness only",
          "Replacement, voiding and previously saved bundle invalidation: NOT_RUN; prepared invalidation harness only",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      evidencePath,
      artifacts: downloads.length,
    }),
  );
}
if (require.main === module)
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
