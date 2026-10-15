import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  lmsCourse,
  lmsLearner,
  LMS_FIXTURE_VERSION,
} from "../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../tests/integration/test-database";
import { draftSchema } from "../../packages/contracts/src";

async function main() {
  assertTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !url.pathname.startsWith("/demo_test_lms_browser_") ||
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("OWN_BROWSER_DATABASE_REQUIRED");
  const director = await db.user.findUniqueOrThrow({
    where: {
      email:
        process.env.DEMO_ADMIN_EMAIL || "lms-director-20261015@example.test",
    },
  });
  const context: Context = {
    tenantId: director.tenantId,
    userId: director.id,
    role: director.role,
    sessionId: "synthetic-setup",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const learners = await Promise.all([
    lmsLearner(director.tenantId, "Әбдірахманов Нұрсұлтан Мұхамеджанұлы"),
    lmsLearner(director.tenantId, "Browser B"),
  ]);
  const definition = lmsCourse();
  const course = await createCourse(context, definition);
  await publishVersion(context, course.version.id, { revision: 0 });
  let enrollmentId: string | undefined;
  if (process.env.DEMO_LMS_FIXTURE_READY_EXAM === "1") {
    enrollmentId = (
      await assignEnrollments(context, {
        courseVersionId: course.version.id,
        recipientIds: [learners[0].recipient.id],
      })
    ).items[0].id;
    await saveLessonProgress(learners[0].context, enrollmentId, "lesson-1", {
      sequence: 1,
      acknowledge: true,
    });
  }
  const draft = draftSchema.parse({
    kind: "COMPANY",
    title: "Синтетическая подготовленная группа LMS",
    demoMode: true,
    items: learners.map((learner) => ({
      id: randomUUID(),
      recipientId: learner.recipient.id,
      fullNameRu: `Синтетический ${learner.user.displayName}`,
      fullNameKz: "Әбдірахманов Нұрсұлтан Мұхамеджанұлы",
      assignments: [],
    })),
  });
  const request = await db.printRequest.create({
    data: {
      tenantId: director.tenantId,
      kind: "COMPANY",
      title: draft.title,
      draft: JSON.parse(JSON.stringify(draft)),
      itemCount: 2,
      demoMode: true,
      createdBy: director.id,
    },
  });
  const directory = resolve(".runtime/lms-one-run");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "browser-fixture.json"),
    JSON.stringify(
      {
        fixtureVersion: LMS_FIXTURE_VERSION,
        tenantId: director.tenantId,
        requestId: request.id,
        courseId: course.course.id,
        courseVersionId: course.version.id,
        enrollmentId,
        learner: {
          userId: learners[0].user.id,
          recipientId: learners[0].recipient.id,
          email: learners[0].user.email,
        },
        preparedCosts:
          "Synthetic prerequisite data entered by fixture API/domain calls. These are excluded only from the explicitly prepared-repeat scenario, never represented as measured first-entry UX.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      fixtureVersion: LMS_FIXTURE_VERSION,
      preparedRecipients: 2,
      courseVersion: 1,
    }),
  );
}
main().finally(() => db.$disconnect());
