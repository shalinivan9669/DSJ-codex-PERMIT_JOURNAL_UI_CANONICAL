import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { draftSchema } from "../../packages/contracts/src";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { assertTestDatabase } from "../../tests/integration/test-database";
import {
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";

async function main() {
  assertTestDatabase();
  const target = new URL(process.env.DATABASE_URL!);
  if (
    target.hostname !== "127.0.0.1" ||
    target.pathname !== "/demo_test_lms_browser_20261015"
  )
    throw new Error("OWN_BROWSER_DATABASE_REQUIRED");
  if (process.argv.includes("--pagination")) {
    const file = resolve(".runtime/lms-one-run/selection-fixture.json");
    const fixture = JSON.parse(await readFile(file, "utf8"));
    const user = await db.user.findUniqueOrThrow({
      where: { email: fixture.director },
    });
    if (user.tenantId !== fixture.tenantId)
      throw new Error("FIXTURE_TENANT_REQUIRED");
    const context: Context = {
      tenantId: user.tenantId,
      userId: user.id,
      role: "DIRECTOR",
      sessionId: "synthetic-pagination",
      csrfHash: "",
      correlationId: randomUUID(),
    };
    const recipients = Array.from({ length: 252 }, (_, index) => ({
      id: randomUUID(),
      tenantId: user.tenantId,
      data: {
        fullNameRu: `Синтетическая страница ${index + 1}`,
        positionRu: "Работник",
      },
    }));
    await db.recipient.createMany({ data: recipients });
    for (let offset = 0; offset < recipients.length; offset += 250)
      await assignEnrollments(context, {
        courseVersionId: fixture.courses[0].versionId,
        recipientIds: recipients
          .slice(offset, offset + 250)
          .map((row) => row.id),
      });
    const learner = await lmsLearner(user.tenantId, "Первая страница");
    const enrollment = (
      await assignEnrollments(context, {
        courseVersionId: fixture.courses[0].versionId,
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
        Array.from({ length: 10 }, (_, index) => [`q-${index}`, ["a"]]),
      ),
    });
    const completed = await submitAttempt(learner.context, attempt.id);
    await writeFile(
      file,
      JSON.stringify(
        {
          ...fixture,
          pagination: {
            addedEnrollments: 253,
            enrollmentId: enrollment.id,
            resultId: completed.result!.id,
            name: "Синтетический слушатель Первая страница",
          },
        },
        null,
        2,
      ),
    );
    console.log("LMS_SELECTION_PAGINATION_READY");
    return;
  }
  const center = await provision({
    email: `selection-${randomUUID()}@example.test`,
    password: LMS_PASSWORD,
    name: "Синтетический центр сохранения выбора",
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
  const courses = [];
  for (const name of [
    "Готовые документы",
    "Без маршрута документов",
    "Внешний экзамен",
  ]) {
    const definition = lmsCourse({
      kind: name === "Внешний экзамен" ? "EXTERNAL_AUTHORIZED" : "CENTER_EXAM",
      required: name !== "Внешний экзамен",
    });
    definition.content.titleRu = `Синтетическая ${name}`;
    definition.content.titleKz = `Синтетикалық ${name}`;
    definition.profile.documentTypes =
      name === "Без маршрута документов" ? [] : ["CERTIFICATE"];
    definition.profile.externalEvidenceLevel = "DOCUMENT_REVIEWED";
    const course = await createCourse(context, definition);
    await publishVersion(context, course.version.id, { revision: 0 });
    courses.push(course);
  }
  const results = [];
  for (const [index, name] of [
    "Выбран готовый",
    "Выбран с ошибкой",
    "Не выбран",
  ].entries()) {
    const learner = await lmsLearner(center.tenantId, name);
    const enrollment = (
      await assignEnrollments(context, {
        courseVersionId: courses[index === 1 ? 1 : 0].version.id,
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
        Array.from({ length: 10 }, (_, i) => [`q-${i}`, ["a"]]),
      ),
    });
    const completed = await submitAttempt(learner.context, attempt.id);
    results.push({
      name: `Синтетический слушатель ${name}`,
      enrollmentId: enrollment.id,
      resultId: completed.result!.id,
    });
  }
  const external = [];
  for (const name of ["Дата неизвестна", "Дата известна"]) {
    const learner = await lmsLearner(center.tenantId, name);
    const enrollment = (
      await assignEnrollments(context, {
        courseVersionId: courses[2].version.id,
        recipientIds: [learner.recipient.id],
      })
    ).items[0];
    external.push({
      name: `Синтетический слушатель ${name}`,
      enrollmentId: enrollment.id,
    });
  }
  const organization = await db.customerOrganization.create({
    data: {
      tenantId: center.tenantId,
      nameRu: "Синтетическая организация выбора",
    },
  });
  const people = [];
  for (let index = 0; index < 3; index++) {
    const name = `Синтетическая группа выбора ${index + 1}`;
    const recipient = await db.recipient.create({
      data: {
        tenantId: center.tenantId,
        data: { fullNameRu: name, positionRu: "Работник" },
      },
    });
    people.push({ id: recipient.id, name });
    if (index !== 1)
      await db.recipientEmployment.create({
        data: {
          tenantId: center.tenantId,
          recipientId: recipient.id,
          employerId: organization.id,
          createdBy: center.userId,
        },
      });
  }
  const draft = draftSchema.parse({
    kind: "COMPANY",
    customerId: organization.id,
    title: "Синтетическая сохранённая группа",
    demoMode: true,
    items: people.map((person) => ({
      id: randomUUID(),
      recipientId: person.id,
      fullNameRu: person.name,
      positionRu: "Работник",
      assignments: [],
    })),
  });
  const request = await db.printRequest.create({
    data: {
      tenantId: center.tenantId,
      kind: "COMPANY",
      customerId: organization.id,
      title: draft.title,
      draft: JSON.parse(JSON.stringify(draft)),
      itemCount: people.length,
      demoMode: true,
      createdBy: center.userId,
    },
  });
  await mkdir(resolve(".runtime/lms-one-run"), { recursive: true });
  await writeFile(
    resolve(".runtime/lms-one-run/selection-fixture.json"),
    JSON.stringify(
      {
        fixtureVersion: "lms-selection-regression-v1",
        tenantId: center.tenantId,
        director: center.email,
        courses: courses.map((course) => ({
          id: course.course.id,
          versionId: course.version.id,
        })),
        results,
        external,
        requestId: request.id,
        people,
        boundary:
          "Fresh synthetic prerequisite records prepared through actual domain functions; no UI/API mocks or application-output substitution.",
      },
      null,
      2,
    ),
  );
  console.log("LMS_SELECTION_FIXTURE_READY");
}
main().finally(() => db.$disconnect());
