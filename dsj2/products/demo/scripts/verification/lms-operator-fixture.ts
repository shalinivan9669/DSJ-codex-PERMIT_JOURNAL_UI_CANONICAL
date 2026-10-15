import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { advanceLmsDocuments } from "../../apps/api/src/lms/document-bridge";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { store } from "../../apps/api/src/files";
import { assertTestDatabase } from "../../tests/integration/test-database";
import {
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";

const paper = process.argv.includes("--paper");
const geometry = process.argv.includes("--geometry");
const file = resolve(
  `.runtime/lms-one-run/${paper ? "paper" : geometry ? "geometry" : "operator"}-fixture.json`,
);
async function main() {
  assertTestDatabase();
  const target = new URL(process.env.DATABASE_URL!);
  if (
    target.hostname !== "127.0.0.1" ||
    !target.pathname.startsWith("/demo_test_lms_browser_")
  )
    throw new Error("OWN_BROWSER_DATABASE_REQUIRED");
  if (process.argv.includes("--negative-binding")) {
    if (!paper) throw new Error("PAPER_FIXTURE_REQUIRED");
    const fixture = JSON.parse(await readFile(file, "utf8"));
    const link = await db.lmsDocumentLink.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        resultId: fixture.resultId,
        documentType: "CERTIFICATE",
      },
    });
    const original = await db.issuedDocument.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        issuanceId: link.issuanceId!,
        assignmentId: `${fixture.resultId}-CERTIFICATE`,
      },
    });
    const workflow = await db.issuanceWorkflow.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, issuanceId: original.issuanceId },
    });
    if (workflow.status !== "ISSUED" || !workflow.completedAt)
      throw new Error(
        "POSITIVE_PAPER_ACCEPTANCE_MUST_PRECEDE_ADVERSARIAL_FIXTURE",
      );
    const artifact = await db.artifact.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        documentId: original.id,
        format: "PDF",
      },
    });
    const bytes = await store.read(artifact.storageKey, artifact.sha256);
    const ids: Record<string, string> = {};
    for (const variant of ["wrongRow", "wrongAssignment"] as const) {
      const document = await db.issuedDocument.create({
        data: {
          ...original,
          id: randomUUID(),
          number: `${original.number}-NEG-${variant}`,
          ...(variant === "wrongRow"
            ? { rowId: fixture.foreignRecipientId }
            : { assignmentId: `${randomUUID()}-CERTIFICATE` }),
        },
      });
      const saved = await store.put(bytes, "pdf");
      await db.artifact.create({
        data: {
          ...artifact,
          id: randomUUID(),
          documentId: document.id,
          storageKey: saved.storageKey,
          sha256: saved.sha256,
          size: saved.size,
          fileName: `synthetic-negative-${variant}.pdf`,
        },
      });
      ids[variant] = document.id;
    }
    await writeFile(
      file,
      JSON.stringify({ ...fixture, negativeBindingDocuments: ids }, null, 2),
    );
    console.log("PAPER_ADVERSARIAL_BINDING_FIXTURE_READY");
    return;
  }
  if (process.argv.includes("--render")) {
    const fixture = JSON.parse(await readFile(file, "utf8"));
    await advanceLmsDocuments();
    const owner = `lms-ui-${randomUUID()}`;
    const renderDeadline = performance.now() + 180000;
    while (performance.now() < renderDeadline) {
      const remaining = await db.generationJob.count({
        where: { tenantId: fixture.tenantId, status: { not: "SUCCEEDED" } },
      });
      if (!remaining) break;
      const job = await claimJob(db, owner, fixture.tenantId);
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
    if (
      await db.generationJob.count({
        where: { tenantId: fixture.tenantId, status: { not: "SUCCEEDED" } },
      })
    )
      throw new Error("LMS_FIXTURE_RENDER_NOT_COMPLETE");
    return;
  }
  const center = await provision({
    email: `operator-${randomUUID()}@example.test`,
    password: LMS_PASSWORD,
    name: "Синтетический UI центр",
    sample: true,
  });
  const context: Context = {
    tenantId: center.tenantId,
    userId: center.userId,
    role: "DIRECTOR",
    sessionId: "test-fixture",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const own = await lmsLearner(center.tenantId, "UI Свой"),
    foreign = await lmsLearner(center.tenantId, "UI Чужой");
  const organization = await db.customerOrganization.create({
    data: {
      tenantId: center.tenantId,
      nameRu: "Синтетический работодатель UI",
      nameKz: "Синтетикалық жұмыс беруші UI",
    },
  });
  const another = await db.customerOrganization.create({
    data: {
      tenantId: center.tenantId,
      nameRu: "Другой синтетический работодатель UI",
    },
  });
  await db.recipientEmployment.createMany({
    data: [
      {
        tenantId: center.tenantId,
        recipientId: own.recipient.id,
        employerId: organization.id,
        createdBy: center.userId,
      },
      {
        tenantId: center.tenantId,
        recipientId: foreign.recipient.id,
        employerId: another.id,
        createdBy: center.userId,
      },
    ],
  });
  const employer = await db.user.create({
    data: {
      tenantId: center.tenantId,
      email: `employer-${randomUUID()}@example.test`,
      displayName: "Синтетический работодатель UI",
      role: "EMPLOYER",
      passwordHash: await passwordHash(LMS_PASSWORD),
    },
  });
  await db.employerMembership.create({
    data: {
      tenantId: center.tenantId,
      customerId: organization.id,
      userId: employer.id,
      createdBy: center.userId,
      permissions: ["READ", "DOWNLOAD", "ASSIGN_TRAINING"],
    },
  });
  const definition = lmsCourse();
  definition.profile.documentTypes = ["PROTOCOL", "CERTIFICATE", "CREDENTIAL"];
  if (paper) {
    definition.profile.legalForm = "PAPER_ORIGINAL";
    definition.profile.documentTypes = ["CERTIFICATE"];
  }
  const course = await createCourse(context, definition);
  await publishVersion(context, course.version.id, { revision: 0 });
  const draftCourse = geometry
    ? await createCourse(context, lmsCourse())
    : null;
  const enrollment = (
    await assignEnrollments(context, {
      courseVersionId: course.version.id,
      recipientIds: [own.recipient.id],
      customerId: organization.id,
    })
  ).items[0];
  const otherEnrollment = (
    await assignEnrollments(context, {
      courseVersionId: course.version.id,
      recipientIds: [foreign.recipient.id],
      customerId: another.id,
    })
  ).items[0];
  await saveLessonProgress(own.context, enrollment.id, "lesson-1", {
    sequence: 1,
    acknowledge: true,
  });
  const attempt = await startAttempt(own.context, enrollment.id);
  await saveAnswers(own.context, attempt.id, {
    sequence: 1,
    answers: Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`q-${index}`, ["a"]]),
    ),
  });
  const completed = await submitAttempt(own.context, attempt.id);
  await mkdir(resolve(".runtime/lms-one-run"), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        fixtureVersion: "lms-operator-ui-v1",
        tenantId: center.tenantId,
        director: center.email,
        employer: employer.email,
        learner: own.user.email,
        learnerUserId: own.user.id,
        fullName: `Синтетический слушатель UI Свой`,
        foreignName: "Синтетический слушатель UI Чужой",
        enrollmentId: enrollment.id,
        foreignEnrollmentId: otherEnrollment.id,
        foreignRecipientId: foreign.recipient.id,
        resultId: completed.result!.id,
        courseId: course.course.id,
        draftCourseId: draftCourse?.course.id,
        setup:
          "Synthetic prerequisite accounts, employer memberships, published course and server-confirmed result were prepared through DB/domain functions. Initial course creation and learning are separate acceptance scenarios.",
      },
      null,
      2,
    ),
  );
  console.log("LMS_OPERATOR_FIXTURE_READY");
}
main().finally(() => db.$disconnect());
