import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import {
  draftSchema,
  positiveAssignmentDefaults,
} from "../../packages/contracts/src";
import {
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../tests/integration/test-database";
import {
  createCourse,
  publishVersion,
  cloneVersion,
} from "../../apps/api/src/lms/courses";
import { saveQuestion } from "../../apps/api/src/lms/questions";
import {
  createRequest,
  finalize,
  patchRequest,
} from "../../apps/api/src/requests";
import { createServiceOrder } from "../../apps/api/src/operator-value";
import { runAssignmentChunk } from "../../apps/api/src/lms/assignment-operations";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
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
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { store } from "../../apps/api/src/files";

const output = resolve(".runtime/lms-scaling/browser-fixture.json");
async function main() {
  assertTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55449");
  assert.equal(url.pathname, "/demo_test_lms_scaling_20261015");
  assert.equal(process.env.DEMO_LMS_TEST_RUNTIME, "1");
  if (process.argv.includes("--render-ordinary")) {
    const fixture = JSON.parse(await readFile(output, "utf8"));
    const context: Context = {
      tenantId: fixture.tenantId,
      userId: fixture.director.userId,
      role: "DIRECTOR",
      sessionId: "synthetic-ordinary-render",
      csrfHash: "",
      correlationId: randomUUID(),
    };
    let current = await workingRequest(context, fixture.ordinaryRequestId);
    let assignment = current.draft.items[0].assignments[0];
    if (!assignment.outcome) {
      assert.equal(current.status, "DRAFT");
      await patchRequest(context, fixture.ordinaryRequestId, {
        expectedRevision: current.revision,
        draft: {
          ...current.draft,
          items: current.draft.items.map((item, index) =>
            index === 0
              ? {
                  ...item,
                  assignments: item.assignments.map((value, position) =>
                    position === 0
                      ? { ...value, ...positiveAssignmentDefaults("pb-card") }
                      : value,
                  ),
                }
              : item,
          ),
        },
      });
      current = await workingRequest(context, fixture.ordinaryRequestId);
      assignment = current.draft.items[0].assignments[0];
    }
    assert.equal(assignment.outcome?.status, "PASSED");
    assert.equal(assignment.fieldOrigins?.outcome, "AUTO");
    const existing = await db.issuance.findFirst({
      where: {
        tenantId: fixture.tenantId,
        requestId: fixture.ordinaryRequestId,
      },
    });
    if (!existing) {
      await submitApproval(context, fixture.ordinaryRequestId, {
        expectedRevision: current.revision,
      });
      const proposal = await db.requestProposal.findFirstOrThrow({
        where: {
          tenantId: fixture.tenantId,
          requestId: fixture.ordinaryRequestId,
          status: "PENDING",
        },
        orderBy: { revision: "desc" },
      });
      await decideProposal(context, proposal.id, {
        decision: "APPROVE",
        reason: "Synthetic ordinary print regression only",
        expectedProposalHash: proposal.proposalHash,
      });
      current = await workingRequest(context, fixture.ordinaryRequestId);
      await finalize(
        context,
        fixture.ordinaryRequestId,
        { expectedRevision: current.revision },
        `scaling-ordinary-${fixture.ordinaryRequestId}`,
      );
    }
    const owner = `lms-scaling-ordinary-${randomUUID()}`;
    for (let n = 0; n < 8; n++) {
      if (
        !(await db.generationJob.count({
          where: {
            tenantId: fixture.tenantId,
            requestId: fixture.ordinaryRequestId,
            status: { not: "SUCCEEDED" },
          },
        }))
      )
        break;
      const job = await claimJob(db, owner, fixture.tenantId);
      if (!job) break;
      const beat = setInterval(() => void heartbeat(db, job, owner), 5000);
      try {
        await executeJob(db, store, job, owner, AbortSignal.timeout(120000));
      } catch (caught) {
        await settleFailure(db, job, owner, caught);
        if (!(caught instanceof DeferredJob)) throw caught;
      } finally {
        clearInterval(beat);
      }
    }
    const artifacts = await db.artifact.findMany({
      where: {
        tenantId: fixture.tenantId,
        requestId: fixture.ordinaryRequestId,
      },
      select: { id: true, format: true, fileName: true, size: true },
    });
    const issuance = await db.issuance.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        requestId: fixture.ordinaryRequestId,
      },
    });
    fixture.ordinaryPrint = {
      issuanceId: issuance.id,
      artifacts,
      outcome: "PASSED",
      outcomeOrigin: "AUTO",
    };
    await writeFile(output, JSON.stringify(fixture, null, 2) + "\n");
    console.log(
      JSON.stringify({
        fixture: output,
        requestId: fixture.ordinaryRequestId,
        artifacts: artifacts.length,
        outcome: "PASSED",
        outcomeOrigin: "AUTO",
      }),
    );
    return;
  }
  if (process.argv.includes("--render")) {
    const fixture = JSON.parse(await readFile(output, "utf8"));
    const context: Context = {
      tenantId: fixture.tenantId,
      userId: fixture.director.userId,
      role: "DIRECTOR",
      sessionId: "synthetic-render",
      csrfHash: "",
      correlationId: randomUUID(),
    };
    const prepared = await prepareResultDocuments(context, {
      resultIds: [fixture.resultId],
    });
    assert.equal(prepared.errors.length, 0, JSON.stringify(prepared.errors));
    fixture.documentId = prepared.items[0].id;
    fixture.documentRequestId = prepared.items[0].requestId;
    const proposal = await db.requestProposal.findFirst({
      where: {
        tenantId: fixture.tenantId,
        requestId: fixture.documentRequestId,
        status: "PENDING",
      },
      orderBy: { revision: "desc" },
    });
    if (proposal)
      await decideProposal(context, proposal.id, {
        decision: "APPROVE",
        reason: "Synthetic local browser fixture, no real qualification",
        expectedProposalHash: proposal.proposalHash,
      });
    await advanceLmsDocuments(100);
    const owner = `lms-scaling-fixture-${randomUUID()}`;
    for (let n = 0; n < 12; n++) {
      const job = await claimJob(db, owner, fixture.tenantId);
      if (!job) break;
      const beat = setInterval(() => void heartbeat(db, job, owner), 5000);
      try {
        await executeJob(db, store, job, owner, AbortSignal.timeout(120000));
      } catch (caught) {
        await settleFailure(db, job, owner, caught);
        if (!(caught instanceof DeferredJob)) throw caught;
      } finally {
        clearInterval(beat);
      }
    }
    await advanceLmsDocuments(100);
    const document = await documentView(context, fixture.documentId);
    fixture.documentStatus = document.status;
    fixture.artifacts = document.artifacts;
    await writeFile(output, JSON.stringify(fixture, null, 2) + "\n");
    console.log(
      JSON.stringify({
        fixture: output,
        documentStatus: document.status,
        artifacts: document.artifacts.length,
      }),
    );
    return;
  }
  await assert.rejects(
    readFile(output),
    "Fixture file must be new; do not overwrite a prepared browser session",
  );
  const email = "lms-scaling-director@example.test";
  assert.equal(
    await db.user.count({ where: { email } }),
    0,
    "Never overwrite an existing account",
  );
  const center = await provision({
    email,
    password: LMS_PASSWORD,
    name: "Синтетический центр LMS scaling",
    sample: true,
  });
  const context: Context = {
    tenantId: center.tenantId,
    userId: center.userId,
    role: "DIRECTOR",
    sessionId: "synthetic-fixture",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const customer = await db.customerOrganization.create({
    data: {
      tenantId: center.tenantId,
      nameRu: "Синтетическая организация LMS",
      nameKz: "Синтетикалық LMS ұйымы",
      addressRu: "Синтетический адрес",
      addressKz: "Синтетикалық мекенжай",
    },
  });
  const people = await Promise.all(
    ["Первый", "Екінші", "Без связи с организацией"].map((name) =>
      lmsLearner(center.tenantId, name),
    ),
  );
  await db.recipientEmployment.createMany({
    data: people.slice(0, 2).map((person) => ({
      tenantId: center.tenantId,
      recipientId: person.recipient.id,
      employerId: customer.id,
      createdBy: center.userId,
    })),
  });
  const definition = lmsCourse({ questions: 1, required: false });
  definition.content.titleRu =
    "Синтетическая программа — проверка масштабирования";
  definition.content.titleKz = "Синтетикалық бағдарлама — масштабтау тексеруі";
  definition.profile.documentTypes = ["CERTIFICATE"];
  const library = await saveQuestion(context, {
    question: definition.content.exam.questions[0],
  });
  definition.content.exam.questions = [library.question];
  const course = await createCourse(context, definition);
  await publishVersion(context, course.version.id, { revision: 0 });
  const draftVersion = await cloneVersion(context, course.course.id);
  const sourceDraft = draftSchema.parse({
    schemaVersion: 2,
    kind: "COMPANY",
    customerId: customer.id,
    title: "Синтетическая заявка → обучение",
    demoMode: true,
    items: people.map((person) => ({
      id: randomUUID(),
      recipientId: person.recipient.id,
      employerId: customer.id,
      fullNameRu: (person.recipient.data as { fullNameRu: string }).fullNameRu,
      fullNameKz: (person.recipient.data as { fullNameKz: string }).fullNameKz,
      positionRu: "Работник",
      positionKz: "Қызметкер",
      assignments: [],
    })),
  });
  const request = await createRequest(context, sourceDraft);
  const order = await createServiceOrder(context, {
    title: "Синтетический заказ → LMS",
    customerId: customer.id,
    employerId: customer.id,
    requestIds: [request.id],
    ownerId: center.userId,
  });
  const readyEnrollment = (
    await runAssignmentChunk(context, {
      operationId: randomUUID(),
      courseVersionId: course.version.id,
      recipientIds: [people[0].recipient.id],
      customerId: customer.id,
    })
  ).items[0];
  const attempt = await startAttempt(people[0].context, readyEnrollment.id);
  await saveAnswers(people[0].context, attempt.id, {
    sequence: 1,
    answers: { [attempt.questions[0].id]: ["a"] },
  });
  const finished = await submitAttempt(people[0].context, attempt.id);
  assert.equal(finished.result?.eligible, true);
  const expired = await lmsLearner(center.tenantId, "Истёкший доступ");
  const expiredEnrollment = await db.enrollment.create({
    data: {
      tenantId: center.tenantId,
      courseVersionId: course.version.id,
      recipientId: expired.recipient.id,
      learnerUserId: expired.user.id,
      dueAt: new Date(Date.now() - 86400000),
      assignedBy: center.userId,
    },
  });
  const ordinaryDraft = draftSchema.parse({
    schemaVersion: 2,
    kind: "COMPANY",
    customerId: customer.id,
    title: "Синтетическая обычная печать PASSED AUTO",
    demoMode: true,
    items: [
      {
        id: randomUUID(),
        recipientId: people[1].recipient.id,
        employerId: customer.id,
        fullNameRu: "Синтетический Второй Слушатель",
        fullNameKz: "Синтетикалық Екінші Тыңдаушы",
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
  });
  const ordinary = await createRequest(context, ordinaryDraft);
  const fixture = {
    fixtureVersion: "lms-tz-scaling-browser-v1",
    tenantId: center.tenantId,
    customerId: customer.id,
    director: { userId: center.userId, email, password: LMS_PASSWORD },
    people: people.map((person, index) => ({
      userId: person.user.id,
      recipientId: person.recipient.id,
      email: person.user.email,
      password: LMS_PASSWORD,
      employmentPresent: index < 2,
    })),
    requestId: request.id,
    orderId: order.id,
    courseId: course.course.id,
    courseVersionId: course.version.id,
    draftVersionId: draftVersion.id,
    libraryQuestionId: library.question.id,
    readyEnrollmentId: readyEnrollment.id,
    resultId: finished.result!.id,
    expired: {
      userId: expired.user.id,
      recipientId: expired.recipient.id,
      email: expired.user.email,
      password: LMS_PASSWORD,
      enrollmentId: expiredEnrollment.id,
    },
    ordinaryRequestId: ordinary.id,
    links: {
      order: `/orders/${order.id}`,
      assignment: `/lms/assign?orderId=${order.id}&requestId=${request.id}&versionId=${course.version.id}`,
      course: `/lms/courses/${course.course.id}`,
      expired: `/learn/${expiredEnrollment.id}`,
      results: "/lms/results",
      ordinaryPrint: `/requests/${ordinary.id}`,
    },
    preparedCosts:
      "Synthetic prerequisites prepared via actual product domain functions. First entry is excluded only from explicitly prepared scenarios, never represented as measured first-entry UX. Third person intentionally lacks employment for one repairable row error. No real qualification, signature or external delivery.",
  };
  await mkdir(resolve(".runtime/lms-scaling"), { recursive: true });
  await writeFile(output, JSON.stringify(fixture, null, 2) + "\n");
  console.log(
    JSON.stringify({
      fixture: output,
      tenantId: center.tenantId,
      preparedPeople: 3,
      courseId: course.course.id,
      requestId: request.id,
      orderId: order.id,
    }),
  );
}
main().finally(() => db.$disconnect());
