import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db,
  hash,
  json,
  transaction,
  type Context,
} from "../../apps/api/src/core";
import { integrationTick } from "../../apps/integration-worker/src/main";
import { bootstrap } from "../../apps/api/src/main";
import {
  courseContentSchema,
  type CourseContent,
} from "../../packages/contracts/src/lms";
import {
  lmsTenant,
  lmsLearner,
  lmsCourse,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";
import {
  createCourse,
  publishVersion,
  updateVersion,
  cloneVersion,
  setCoursePause,
} from "../../apps/api/src/lms/courses";
import {
  createTeachingBinding,
  revokeTeachingBinding,
  teachingContext,
} from "../../apps/api/src/lms/teaching-bindings";
import { archiveLearningCourse } from "../../apps/api/src/lms/course-review";
import {
  validateLearningStructure,
  validatePublishedDependencies,
} from "../../apps/api/src/lms/publication-validation";
import { assertPublishable } from "../../apps/api/src/lms/validation";
import {
  evaluateLearningEligibility,
  accessOpen,
} from "../../apps/api/src/lms/learning-eligibility";
import { resolveAccessPolicy } from "../../apps/api/src/lms/access-policy";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { runAssignmentChunk } from "../../apps/api/src/lms/assignment-operations";
import { extendEnrollment } from "../../apps/api/src/lms/enrollments";
import { updateGroup } from "../../apps/api/src/lms/groups";
import { enrollmentDetail } from "../../apps/api/src/lms/learning";
import { documentViews } from "../../apps/api/src/lms/document-views";
import { listEnrollmentPage } from "../../apps/api/src/lms/enrollment-list";

const code = (expected: string) => (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
  expected;

test("AC08 shipping integration tick finishes expired persisted attempts without a browser and retains manual review", async () => {
  const center = await lmsTenant("learning-worker-timeout");
  const automatic = await lmsLearner(center.tenant.id, "automatic-timeout");
  const manual = await lmsLearner(center.tenant.id, "manual-timeout");
  const cancelled = await lmsLearner(center.tenant.id, "cancelled-timeout");
  const input = lmsCourse({ questions: 1, required: false });
  input.content.learningOutcome = "LEARNING";
  const autoCourse = await published(center.context, input);
  const manualInput = structuredClone(input);
  manualInput.content.exam.questions[0].answerSpec = {
    kind: "TEXT",
    mode: "MANUAL",
    criteriaRu: "Объяснено решение",
    criteriaKz: "Шешім түсіндірілген",
  };
  const manualCourse = await published(center.context, manualInput);
  const autoEnrollment = await enroll(
    center.context,
    autoCourse.version.id,
    automatic,
  );
  const manualEnrollment = await enroll(
    center.context,
    manualCourse.version.id,
    manual,
  );
  const cancelledEnrollment = await enroll(
    center.context,
    autoCourse.version.id,
    cancelled,
    { status: "CANCELLED" },
  );
  const startedAt = new Date(Date.now() - 31 * 60000);
  const deadlineAt = new Date(startedAt.getTime() + 30 * 60000);
  const seedExpired = async (
    enrollmentId: string,
    course: Awaited<ReturnType<typeof published>>,
    isManual = false,
  ) => {
    const content = courseContentSchema.parse(course.version.content);
    return db.examAttempt.create({
      data: {
        tenantId: center.tenant.id,
        enrollmentId,
        courseVersionId: course.version.id,
        regulatoryProfileVersionId: course.version.regulatoryProfileVersionId,
        assessmentKind: "CENTER_EXAM",
        assessmentId: "FINAL",
        purpose: "LEARNING_FINAL",
        ordinal: 1,
        activeKey: `${center.tenant.id}:${enrollmentId}:FINAL`,
        startedAt,
        deadlineAt,
        sequence: 4,
        snapshot: json({
          questions: content.exam.questions,
          policy: { ...content.exam, questions: [] },
          profile: input.profile,
        }),
        answers: json({
          [content.exam.questions[0].id]: isManual
            ? { kind: "TEXT", text: "Сохранённый ответ до закрытия браузера" }
            : ["a"],
        }),
      },
    });
  };
  const autoAttempt = await seedExpired(autoEnrollment.id, autoCourse);
  const manualAttempt = await seedExpired(
    manualEnrollment.id,
    manualCourse,
    true,
  );
  const cancelledAttempt = await seedExpired(
    cancelledEnrollment.id,
    autoCourse,
  );
  // No learner request, getAttempt, or direct finish call runs between persisted fixtures and the shipping worker tick.
  const tick = await integrationTick();
  assert.equal(tick.connection, "NOT_CONNECTED");
  const autoAfter = await db.examAttempt.findUniqueOrThrow({
    where: { id: autoAttempt.id },
  });
  assert.equal(autoAfter.state, "FINISHED");
  assert.equal(autoAfter.verdict, "PASSED");
  assert.equal(autoAfter.finishedAt?.toISOString(), deadlineAt.toISOString());
  assert.equal(hash(autoAfter.snapshot), hash(autoAttempt.snapshot));
  const manualAfter = await db.examAttempt.findUniqueOrThrow({
    where: { id: manualAttempt.id },
  });
  assert.equal(manualAfter.state, "AWAITING_REVIEW");
  assert.equal(manualAfter.verdict, "AWAITING_REVIEW");
  assert.equal(manualAfter.score, null);
  assert.equal(
    manualAfter.submittedAt?.toISOString(),
    deadlineAt.toISOString(),
  );
  assert.equal(manualAfter.activeKey, manualAttempt.activeKey);
  assert.equal(hash(manualAfter.answers), hash(manualAttempt.answers));
  assert.equal(
    (
      await db.examAttempt.findUniqueOrThrow({
        where: { id: cancelledAttempt.id },
      })
    ).state,
    "IN_PROGRESS",
  );
  assert.equal(
    await db.verifiedExamResult.count({
      where: { tenantId: center.tenant.id },
    }),
    0,
  );
  assert.equal(
    await db.regulatoryOutbox.count({ where: { tenantId: center.tenant.id } }),
    0,
  );
  assert.equal(
    await db.lmsLearningCompletion.count({
      where: { tenantId: center.tenant.id },
    }),
    1,
  );
  await integrationTick();
  assert.equal(
    (
      await db.examAttempt.findUniqueOrThrow({
        where: { id: manualAttempt.id },
      })
    ).state,
    "AWAITING_REVIEW",
  );
  assert.equal(
    await db.lmsLearningCompletion.count({
      where: { tenantId: center.tenant.id },
    }),
    1,
  );
});
const prerequisite = (
  courseId: string,
  basis:
    | "ELEMENTS"
    | "LEARNING_COMPLETION"
    | "OFFICIAL_RESULT" = "LEARNING_COMPLETION",
) => ({ courseId, basis, versionPolicy: "ANY" as const });
async function published(
  c: Context,
  input = lmsCourse({ questions: 1, required: false }),
) {
  const created = await createCourse(c, input);
  const version = await publishVersion(c, created.version.id, {
    revision: created.version.revision,
  });
  return { course: created.course, version };
}
async function enroll(
  c: Context,
  courseVersionId: string,
  learner: Awaited<ReturnType<typeof lmsLearner>>,
  extra = {},
) {
  return db.enrollment.create({
    data: {
      tenantId: c.tenantId,
      courseVersionId,
      recipientId: learner.recipient.id,
      learnerUserId: learner.user.id,
      assignedBy: c.userId,
      dueAt: new Date(Date.now() + 86400000),
      ...extra,
    },
  });
}
async function pass(c: Context, enrollmentId: string) {
  const attempt = await startAttempt(c, enrollmentId);
  await saveAnswers(c, attempt.id, {
    sequence: 1,
    answers: Object.fromEntries(
      attempt.questions.map((question) => [question.id, ["a"]]),
    ),
  });
  return submitAttempt(c, attempt.id);
}

test("P05 concurrent publication serializes course prerequisite graph", async (t) => {
  t.after(() => db.$disconnect());
  const center = await lmsTenant("learning-publication-graph-race");
  const input = lmsCourse({ questions: 1, required: false });
  const a = await published(center.context, input);
  const b = await published(center.context, input);
  const draftA = await cloneVersion(center.context, a.course.id);
  const draftB = await cloneVersion(center.context, b.course.id);
  const savedA = await updateVersion(center.context, draftA.id, {
    revision: draftA.revision,
    content: {
      ...input.content,
      coursePrerequisites: [prerequisite(b.course.id)],
    },
    profile: input.profile,
  });
  const savedB = await updateVersion(center.context, draftB.id, {
    revision: draftB.revision,
    content: {
      ...input.content,
      coursePrerequisites: [prerequisite(a.course.id)],
    },
    profile: input.profile,
  });
  const attempts = await Promise.allSettled([
    publishVersion(center.context, savedA.id, { revision: savedA.revision }),
    publishVersion(center.context, savedB.id, { revision: savedB.revision }),
  ]);
  assert.equal(attempts.filter((row) => row.status === "fulfilled").length, 1);
  const refused = attempts.find((row) => row.status === "rejected");
  assert.ok(
    refused &&
      refused.status === "rejected" &&
      code("COURSE_PREREQUISITE_CYCLE")(refused.reason),
  );
  const versions = await db.courseVersion.findMany({
    where: { tenantId: center.tenant.id },
  });
  assert.equal(versions.filter((row) => row.status === "PUBLISHED").length, 3);
  assert.equal(versions.filter((row) => row.status === "DRAFT").length, 1);
  assert.equal(
    versions.find((row) => row.id === a.version.id)?.snapshotHash,
    a.version.snapshotHash,
  );
  assert.equal(
    versions.find((row) => row.id === b.version.id)?.snapshotHash,
    b.version.snapshotHash,
  );
});

test("P01 paged teaching selectors search beyond 100 and apply identical tenant/binding scope to rows and totals", async (t) => {
  t.after(() => db.$disconnect());
  const center = await lmsTenant("learning-selector-pages");
  const foreign = await lmsTenant("learning-selector-foreign");
  const teacher = await lmsLearner(center.tenant.id, "selector-teacher");
  const now = Date.now();
  const rows = Array.from({ length: 101 }, (_, i) => ({
    id: randomUUID(),
    versionId: randomUUID(),
    profileId: randomUUID(),
    groupId: randomUUID(),
    label: `Selector ${String(i).padStart(3, "0")}`,
    createdAt: new Date(now - i * 1000),
  }));
  // Directory-only fixtures: no learning attempt or document is represented as completed/published.
  await db.course.createMany({
    data: rows.map((row) => ({
      id: row.id,
      tenantId: center.tenant.id,
      titleRu: row.label,
      titleKz: `Таңдау ${row.label}`,
      createdBy: center.user.id,
      createdAt: row.createdAt,
    })),
  });
  await db.regulatoryProfileVersion.createMany({
    data: rows.map((row) => ({
      id: row.profileId,
      tenantId: center.tenant.id,
      courseId: row.id,
      version: 1,
      definition: {},
      snapshotHash: hash({ directoryFixture: true }),
    })),
  });
  await db.courseVersion.createMany({
    data: rows.map((row) => ({
      id: row.versionId,
      tenantId: center.tenant.id,
      courseId: row.id,
      version: 1,
      content: { directoryFixture: true },
      regulatoryProfileVersionId: row.profileId,
      createdBy: center.user.id,
    })),
  });
  await db.lmsGroup.createMany({
    data: rows.map((row) => ({
      id: row.groupId,
      tenantId: center.tenant.id,
      name: row.label,
      courseVersionId: row.versionId,
      createdBy: center.user.id,
      createdAt: row.createdAt,
    })),
  });
  await db.user.createMany({
    data: rows.map((row) => ({
      tenantId: center.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: `Directory ${row.label}`,
      role: "TEACHER",
      passwordHash: teacher.user.passwordHash,
    })),
  });
  const foreignCourse = await createCourse(
    foreign.context,
    lmsCourse({ questions: 1, required: false }),
  );
  await db.course.update({
    where: { id: foreignCourse.course.id },
    data: { titleRu: "Selector 100", titleKz: "Таңдау Selector 100" },
  });
  await db.lmsGroup.create({
    data: {
      tenantId: foreign.tenant.id,
      courseVersionId: foreignCourse.version.id,
      name: "Selector 100",
      createdBy: foreign.user.id,
    },
  });
  await db.user.create({
    data: {
      tenantId: foreign.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Directory Selector 100",
      role: "TEACHER",
      passwordHash: teacher.user.passwordHash,
    },
  });
  const second = await teachingContext(center.context, {
    coursePage: 2,
    groupPage: 2,
    userPage: 2,
    pageSize: 100,
    search: "Directory Selector",
  });
  assert.equal(second.coursesTotal, 101);
  assert.equal(second.groupsTotal, 101);
  assert.equal(second.usersTotal, 101);
  assert.deepEqual(
    second.courses.map((row) => row.id),
    [rows[100].id],
  );
  assert.deepEqual(
    second.groups.map((row) => row.id),
    [rows[100].groupId],
  );
  assert.equal(second.users.length, 1);
  const searched = await teachingContext(center.context, {
    courseSearch: "Selector 100",
    groupSearch: "Selector 100",
    search: "Directory Selector 100",
    pageSize: 100,
  });
  assert.equal(searched.coursesTotal, 1);
  assert.equal(searched.groupsTotal, 1);
  assert.equal(searched.usersTotal, 1);
  assert.equal(searched.courses[0].id, rows[100].id);
  assert.equal(searched.groups[0].id, rows[100].groupId);
  await createTeachingBinding(center.context, {
    userId: teacher.user.id,
    role: "TEACHER",
    courseId: rows[100].id,
    groupId: rows[100].groupId,
  });
  const reviewer = { ...teacher.context, teachingMode: true };
  const scoped = await teachingContext(reviewer, { pageSize: 100 });
  assert.equal(scoped.canManage, false);
  assert.equal(scoped.usersTotal, 0);
  assert.deepEqual(scoped.users, []);
  assert.equal(scoped.coursesTotal, 1);
  assert.equal(scoped.groupsTotal, 1);
  assert.equal(scoped.courses[0].id, rows[100].id);
  assert.equal(scoped.groups[0].id, rows[100].groupId);
  const inaccessible = await teachingContext(reviewer, {
    courseSearch: "Selector 000",
    groupSearch: "Selector 000",
  });
  assert.equal(inaccessible.coursesTotal, 0);
  assert.equal(inaccessible.groupsTotal, 0);
  assert.deepEqual(inaccessible.courses, []);
  assert.deepEqual(inaccessible.groups, []);
  const scopedSecond = await teachingContext(reviewer, {
    coursePage: 2,
    groupPage: 2,
    pageSize: 1,
  });
  assert.equal(scopedSecond.coursesTotal, 1);
  assert.equal(scopedSecond.groupsTotal, 1);
  assert.deepEqual(scopedSecond.courses, []);
  assert.deepEqual(scopedSecond.groups, []);
  const wrongCourse = await teachingContext(reviewer, {
    groupCourseId: rows[0].id,
    excludeCourseId: rows[100].id,
  });
  assert.equal(wrongCourse.coursesTotal, 0);
  assert.equal(wrongCourse.groupsTotal, 0);
});

test(
  "P01/P09 HTTP: same-session bindings, legacy denials, return/approve/edit invalidation and exact publication snapshot",
  { timeout: 60000 },
  async (t) => {
    process.env.PORT = "0";
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    const center = await lmsTenant("learning-governance-http");
    const author = await lmsLearner(center.tenant.id, "methodist-base-learner");
    const expert = await lmsLearner(center.tenant.id, "expert-base-learner");
    const foreign = await lmsTenant("learning-governance-http-foreign");
    const input = lmsCourse({ questions: 1, required: false });
    const created = await createCourse(center.context, input);
    const otherCourse = await createCourse(center.context, input);
    const foreignCourse = await createCourse(foreign.context, input);
    const app = await bootstrap();
    t.after(async () => {
      await app.close();
      await db.$disconnect();
    });
    const base = await app.getUrl();
    const authorHeaders = await lmsSession(base, author.user.email);
    const authorHttp = lmsHttp(base, authorHeaders);
    const adminHttp = lmsHttp(base, await lmsSession(base, center.user.email));
    const expertHttp = lmsHttp(base, await lmsSession(base, expert.user.email));
    assert.ok(
      [403, 404].includes(
        (await authorHttp(`/lms/courses/${created.course.id}`)).status,
      ),
    );
    const binding = await lmsJson(
      await adminHttp("/lms/learning-bindings", "POST", {
        userId: author.user.id,
        role: "METHODIST",
        courseId: created.course.id,
      }),
      201,
    );
    await lmsJson(
      await adminHttp("/lms/learning-bindings", "POST", {
        userId: expert.user.id,
        role: "EXPERT",
        courseId: created.course.id,
      }),
      201,
    );
    assert.equal(
      (await authorHttp(`/lms/courses/${created.course.id}`)).status,
      200,
      "the original session immediately gains only its course binding",
    );
    assert.equal(
      (await authorHttp(`/lms/courses/${foreignCourse.course.id}`)).status,
      404,
    );
    assert.equal(
      (await authorHttp(`/lms/courses/${otherCourse.course.id}`)).status,
      404,
      "a binding does not grant another course in the same tenant",
    );
    for (const path of ["/requests", "/recipients", "/templates", "/users"])
      assert.ok(
        [403, 404].includes((await authorHttp(path)).status),
        `legacy endpoint must be denied: ${path}`,
      );
    assert.equal(
      (
        await authorHttp(
          `/lms/course-versions/${created.version.id}/publish`,
          "POST",
          { revision: 0 },
        )
      ).status,
      403,
    );
    let version = await lmsJson(
      await authorHttp(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        { revision: 0, action: "SUBMIT" },
      ),
      201,
    );
    assert.equal(
      (
        await expertHttp(
          `/lms/course-versions/${created.version.id}/review`,
          "POST",
          {
            revision: version.revision,
            action: "RETURN",
            feedback: "No publication permission",
          },
        )
      ).status,
      403,
    );
    version = await lmsJson(
      await adminHttp(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        {
          revision: version.revision,
          action: "RETURN",
          feedback: "Уточните цель",
        },
      ),
      201,
    );
    assert.equal(version.review.state, "RETURNED");
    const changed = courseContentSchema.parse(version.content);
    changed.titleRu += " уточнение";
    version = await lmsJson(
      await authorHttp(`/lms/course-versions/${created.version.id}`, "PUT", {
        revision: version.revision,
        content: changed,
        profile: input.profile,
      }),
    );
    version = await lmsJson(
      await authorHttp(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        { revision: version.revision, action: "SUBMIT" },
      ),
      201,
    );
    version = await lmsJson(
      await adminHttp(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        { revision: version.revision, action: "APPROVE" },
      ),
      201,
    );
    assert.equal(version.review.state, "APPROVED");
    const next = courseContentSchema.parse(version.content);
    next.titleKz += " өзгеріс";
    version = await lmsJson(
      await authorHttp(`/lms/course-versions/${created.version.id}`, "PUT", {
        revision: version.revision,
        content: next,
        profile: input.profile,
      }),
    );
    const blocked = await expertHttp(
      `/lms/course-versions/${created.version.id}/publish`,
      "POST",
      { revision: version.revision },
    );
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, "LEARNING_PERMISSION_DENIED");
    assert.equal(
      version.review,
      null,
      "editing invalidates the prior approved snapshot",
    );
    version = await lmsJson(
      await authorHttp(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        { revision: version.revision, action: "SUBMIT" },
      ),
      201,
    );
    version = await lmsJson(
      await adminHttp(
        `/lms/course-versions/${created.version.id}/review`,
        "POST",
        { revision: version.revision, action: "APPROVE" },
      ),
      201,
    );
    const approved = await db.lmsCourseReview.findFirstOrThrow({
      where: {
        courseVersionId: version.id,
        state: "APPROVED",
        revision: version.revision,
      },
      orderBy: { createdAt: "desc" },
    });
    const frozenContent = hash(version.content);
    version = await lmsJson(
      await adminHttp(
        `/lms/course-versions/${created.version.id}/publish`,
        "POST",
        { revision: version.revision },
      ),
      201,
    );
    assert.equal(hash(version.content), frozenContent);
    assert.equal(version.snapshotHash, approved.contentHash);
    assert.equal(version.status, "PUBLISHED");
    const freshDraft = await cloneVersion(center.context, created.course.id);
    assert.equal(
      (await lmsJson(await authorHttp(`/lms/courses/${created.course.id}`)))
        .versions.length,
      2,
    );
    await lmsJson(
      await adminHttp(`/lms/learning-bindings/${binding.id}/revoke`, "POST", {
        reason: "Scoped acceptance revocation",
      }),
      201,
    );
    const publicAfterRevoke = await lmsJson(
      await authorHttp(`/lms/courses/${created.course.id}`),
    );
    assert.equal(
      publicAfterRevoke.versions.length,
      1,
      "same cookie immediately loses its draft access",
    );
    assert.equal(publicAfterRevoke.versions[0].status, "PUBLISHED");
    assert.deepEqual(publicAfterRevoke.course.allowedActions, []);
    assert.equal(
      publicAfterRevoke.versions[0].content.exam.questions,
      undefined,
      "published catalog remains available without answer keys",
    );
    assert.equal(
      (
        await authorHttp(`/lms/course-versions/${freshDraft.id}`, "PUT", {
          revision: freshDraft.revision,
          content: next,
          profile: input.profile,
        })
      ).status,
      403,
    );
    assert.equal(
      await db.session.count({
        where: { tenantId: center.tenant.id, userId: author.user.id },
      }),
      1,
      "revocation does not require replacing the session",
    );
    const direct = await published(center.context, input);
    assert.equal(
      direct.version.status,
      "PUBLISHED",
      "existing staff direct publication remains an explicit approval",
    );
    await assert.rejects(
      createTeachingBinding(center.context, {
        userId: foreign.user.id,
        role: "METHODIST",
        courseId: created.course.id,
      }),
      code("NOT_FOUND"),
    );
  },
);

test("P05: module/course unknown, foreign, self and cyclic dependencies plus exact 199/200 required completion", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-governance-dependencies");
  const foreign = await lmsTenant("learning-governance-dependencies-foreign");
  const learner = await lmsLearner(center.tenant.id, "199-of-200");
  const input = lmsCourse({ questions: 1 });
  const lesson = input.content.modules[0].lessons[0];
  const structural = (modules: CourseContent["modules"]) =>
    courseContentSchema.parse({ ...input.content, modules });
  assert.throws(
    () =>
      validateLearningStructure(
        structural([
          { ...input.content.modules[0], prerequisiteModuleIds: ["missing"] },
        ]),
      ),
    code("MODULE_PREREQUISITE_INVALID"),
  );
  assert.throws(
    () =>
      validateLearningStructure(
        structural([
          { ...input.content.modules[0], prerequisiteModuleIds: ["module-1"] },
        ]),
      ),
    code("MODULE_PREREQUISITE_CYCLE"),
  );
  assert.throws(
    () =>
      validateLearningStructure(
        structural([
          {
            id: "a",
            titleRu: "A",
            titleKz: "A",
            prerequisiteModuleIds: ["b"],
            lessons: [{ ...lesson, id: "la" }],
          },
          {
            id: "b",
            titleRu: "B",
            titleKz: "B",
            prerequisiteModuleIds: ["a"],
            lessons: [{ ...lesson, id: "lb" }],
          },
        ]),
      ),
    code("MODULE_PREREQUISITE_CYCLE"),
  );
  const combined = structural([
    {
      id: "a",
      titleRu: "A",
      titleKz: "A",
      prerequisiteModuleIds: ["b"],
      lessons: [{ ...lesson, id: "la" }],
    },
    {
      id: "b",
      titleRu: "B",
      titleKz: "B",
      lessons: [{ ...lesson, id: "lb", prerequisiteLessonIds: ["la"] }],
    },
  ]);
  assert.throws(
    () => validateLearningStructure(combined),
    "a module wait plus lesson wait must not form a hidden deadlock",
  );
  const unknownLesson = structural([
    {
      ...input.content.modules[0],
      lessons: [{ ...lesson, prerequisiteLessonIds: ["missing"] }],
    },
  ]);
  assert.throws(
    () => assertPublishable(unknownLesson, input.profile),
    code("PREREQUISITE_INVALID"),
  );
  const a = await published(
    center.context,
    lmsCourse({ questions: 1, required: false }),
  );
  const f = await published(
    foreign.context,
    lmsCourse({ questions: 1, required: false }),
  );
  for (const dependency of [randomUUID(), f.course.id])
    await assert.rejects(
      transaction((tx) =>
        validatePublishedDependencies(
          tx,
          center.context,
          a.course.id,
          courseContentSchema.parse({
            ...a.version.content,
            coursePrerequisites: [prerequisite(dependency)],
          }),
        ),
      ),
      code("COURSE_PREREQUISITE_UNAVAILABLE"),
    );
  await assert.rejects(
    transaction((tx) =>
      validatePublishedDependencies(
        tx,
        center.context,
        a.course.id,
        courseContentSchema.parse({
          ...a.version.content,
          coursePrerequisites: [prerequisite(a.course.id)],
        }),
      ),
    ),
    code("COURSE_PREREQUISITE_CYCLE"),
  );
  const bInput = lmsCourse({ questions: 1, required: false });
  bInput.content.coursePrerequisites = [prerequisite(a.course.id)];
  const b = await published(center.context, bInput);
  const a2 = await cloneVersion(center.context, a.course.id);
  await updateVersion(center.context, a2.id, {
    revision: a2.revision,
    content: {
      ...a2.content,
      coursePrerequisites: [prerequisite(b.course.id)],
    },
    profile: input.profile,
  });
  await assert.rejects(
    publishVersion(center.context, a2.id, { revision: a2.revision + 1 }),
    code("COURSE_PREREQUISITE_CYCLE"),
  );
  input.content.modules[0].lessons = Array.from(
    { length: 201 },
    (_, index) => ({ ...lesson, id: `l-${index}`, required: index < 200 }),
  );
  const exact = await published(center.context, input);
  const enrollment = await enroll(center.context, exact.version.id, learner);
  await db.lessonProgress.createMany({
    data: Array.from({ length: 199 }, (_, index) => ({
      tenantId: center.tenant.id,
      enrollmentId: enrollment.id,
      lessonId: `l-${index}`,
      completedAt: new Date(),
    })),
  });
  const before = await evaluateLearningEligibility(
    db,
    learner.context,
    enrollment,
    courseContentSchema.parse(exact.version.content),
  );
  assert.equal(before.completedCount, 199);
  assert.equal(before.requiredCount, 200);
  assert.equal(before.finalAllowed, false);
  assert.equal(
    Math.round((before.completedCount * 100) / before.requiredCount),
    100,
  );
  await assert.rejects(
    startAttempt(learner.context, enrollment.id),
    code("LESSONS_REQUIRED"),
  );
  await db.lessonProgress.create({
    data: {
      tenantId: center.tenant.id,
      enrollmentId: enrollment.id,
      lessonId: "l-199",
      completedAt: new Date(),
    },
  });
  const after = await evaluateLearningEligibility(
    db,
    learner.context,
    enrollment,
    courseContentSchema.parse(exact.version.content),
  );
  assert.equal(after.finalAllowed, true);
  assert.equal(
    after.lessons.find((item) => item.id === "l-200")?.complete,
    false,
    "optional material is not required for admission",
  );
});

test("P05: confirmed ordinary learning completion opens course B; PRACTICE, other people and missing versions do not", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-governance-chain");
  const learner = await lmsLearner(center.tenant.id, "chain");
  const other = await lmsLearner(center.tenant.id, "chain-other");
  const aInput = lmsCourse({ questions: 1, required: false });
  aInput.content.learningOutcome = "LEARNING";
  const a = await published(center.context, aInput);
  const ea = await enroll(center.context, a.version.id, learner);
  const bInput = lmsCourse({ questions: 1, required: false });
  bInput.content.learningOutcome = "LEARNING";
  bInput.content.coursePrerequisites = [prerequisite(a.course.id)];
  const b = await published(center.context, bInput);
  const eb = await enroll(center.context, b.version.id, learner);
  const otherB = await enroll(center.context, b.version.id, other);
  const detailBefore = await enrollmentDetail(learner.context, eb.id);
  assert.equal(detailBefore.prerequisites[0].enrollmentId, ea.id);
  assert.equal(detailBefore.prerequisites[0].titleRu, aInput.content.titleRu);
  assert.equal(detailBefore.prerequisites[0].titleKz, aInput.content.titleKz);
  assert.equal(
    (await enrollmentDetail(other.context, otherB.id)).prerequisites[0]
      .enrollmentId,
    null,
    "another recipient never receives the first learner's enrollment link",
  );
  await assert.rejects(
    startAttempt(learner.context, eb.id),
    code("LESSONS_REQUIRED"),
  );
  const result = await pass(learner.context, ea.id);
  assert.equal(result.purpose, "LEARNING_FINAL");
  const completed = await db.enrollment.findUniqueOrThrow({
    where: { id: ea.id },
  });
  assert.equal(completed.status, "COMPLETED");
  assert.ok(completed.completedAt);
  assert.equal(
    (
      await listEnrollmentPage(center.context, {
        courseId: a.course.id,
        view: "INCOMPLETE",
      })
    ).total,
    0,
    "verified ordinary learning no longer appears as incomplete",
  );
  assert.equal(
    (
      await listEnrollmentPage(center.context, {
        courseId: a.course.id,
        status: "COMPLETED",
      })
    ).total,
    1,
  );
  await submitAttempt(learner.context, result.id);
  assert.equal(
    (
      await db.enrollment.findUniqueOrThrow({ where: { id: ea.id } })
    ).completedAt?.toISOString(),
    completed.completedAt.toISOString(),
    "submit replay preserves the original completion time",
  );
  assert.equal(
    await db.verifiedExamResult.count({ where: { enrollmentId: ea.id } }),
    0,
  );
  assert.equal(
    await db.lmsDocumentLink.count({ where: { tenantId: center.tenant.id } }),
    0,
  );
  assert.equal(
    await db.issuance.count({ where: { tenantId: center.tenant.id } }),
    0,
  );
  assert.equal(
    (
      await evaluateLearningEligibility(
        db,
        learner.context,
        eb,
        courseContentSchema.parse(b.version.content),
      )
    ).finalAllowed,
    true,
  );
  assert.equal(
    (
      await evaluateLearningEligibility(
        db,
        other.context,
        otherB,
        courseContentSchema.parse(b.version.content),
      )
    ).finalAllowed,
    false,
  );
  const practice = await published(
    center.context,
    lmsCourse({ questions: 1, required: false, kind: "PRACTICE" }),
  );
  const ep = await enroll(center.context, practice.version.id, learner);
  await pass(learner.context, ep.id);
  assert.equal(
    await db.lmsLearningCompletion.count({ where: { enrollmentId: ep.id } }),
    0,
  );
  const practiceDependent = courseContentSchema.parse({
    ...b.version.content,
    coursePrerequisites: [prerequisite(practice.course.id)],
  });
  assert.equal(
    (
      await evaluateLearningEligibility(
        db,
        learner.context,
        eb,
        practiceDependent,
      )
    ).finalAllowed,
    false,
  );
  const minimum = courseContentSchema.parse({
    ...b.version.content,
    coursePrerequisites: [
      {
        ...prerequisite(a.course.id),
        versionPolicy: "AT_LEAST",
        minimumVersion: 2,
      },
    ],
  });
  assert.equal(
    (await evaluateLearningEligibility(db, learner.context, eb, minimum))
      .finalAllowed,
    false,
  );
  const minimumInput = structuredClone(bInput);
  minimumInput.content = minimum;
  const aV2Draft = await cloneVersion(center.context, a.course.id);
  await publishVersion(center.context, aV2Draft.id, {
    revision: aV2Draft.revision,
  });
  const minimumCourse = await published(center.context, minimumInput);
  const minimumEnrollment = await enroll(
    center.context,
    minimumCourse.version.id,
    learner,
  );
  assert.equal(
    (await enrollmentDetail(learner.context, minimumEnrollment.id))
      .prerequisites[0].enrollmentId,
    null,
    "an incompatible older version is not offered as the prerequisite link",
  );
});

test("AC28: ordinary issuance cancellation/replacement invalidates an official prerequisite without an LMS result event", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-governance-official");
  const learner = await lmsLearner(center.tenant.id, "official");
  const a = await published(center.context);
  const ea = await enroll(center.context, a.version.id, learner);
  const finished = await pass(learner.context, ea.id);
  const result = await db.verifiedExamResult.findFirstOrThrow({
    where: { attemptId: finished.id },
  });
  assert.equal(result.eligible, true);
  const bInput = lmsCourse({ questions: 1, required: false });
  bInput.content.coursePrerequisites = [
    prerequisite(a.course.id, "OFFICIAL_RESULT"),
  ];
  const b = await published(center.context, bInput);
  const eb = await enroll(center.context, b.version.id, learner);
  const content = courseContentSchema.parse(b.version.content);
  const issuer = await db.issuerProfileVersion.create({
    data: {
      tenantId: center.tenant.id,
      version: 1,
      profile: {},
      createdBy: center.user.id,
    },
  });
  const request = await db.printRequest.create({
    data: {
      tenantId: center.tenant.id,
      kind: "PERSON",
      status: "FINALIZED",
      draft: {},
      demoMode: true,
      createdBy: center.user.id,
    },
  });
  const issuance = await db.issuance.create({
    data: {
      tenantId: center.tenant.id,
      requestId: request.id,
      sourceRevision: 0,
      snapshot: {},
      inputHash: hash({ synthetic: true }),
      profileVersionId: issuer.id,
      createdBy: center.user.id,
    },
  });
  await db.lmsDocumentLink.create({
    data: {
      tenantId: center.tenant.id,
      resultId: result.id,
      documentType: "INFORMATION_CARD",
      legalForm: "INFORMATION_CARD",
      requestId: request.id,
      issuanceId: issuance.id,
      status: "ISSUED",
    },
  });
  assert.equal(
    (await evaluateLearningEligibility(db, learner.context, eb, content))
      .finalAllowed,
    true,
  );
  await db.issuanceEvent.create({
    data: {
      tenantId: center.tenant.id,
      issuanceId: issuance.id,
      kind: "REPLACED",
      reason: "Synthetic ordinary replacement",
      actorId: center.user.id,
    },
  });
  assert.equal(
    await db.lmsResultEvent.count({ where: { resultId: result.id } }),
    0,
  );
  assert.equal(
    (await evaluateLearningEligibility(db, learner.context, eb, content))
      .finalAllowed,
    false,
  );
  await assert.rejects(
    startAttempt(learner.context, eb.id),
    code("LESSONS_REQUIRED"),
  );
  const replacedDetail = await enrollmentDetail(learner.context, ea.id);
  assert.deepEqual(
    replacedDetail.documents,
    await documentViews(learner.context, [result.id]),
  );
  assert.equal(replacedDetail.documents[0].status, "SUPERSEDED");
  assert.deepEqual(replacedDetail.documents[0].artifacts, []);
  await db.issuanceEvent.create({
    data: {
      tenantId: center.tenant.id,
      issuanceId: issuance.id,
      kind: "CANCELLED",
      reason: "Synthetic ordinary cancellation",
      actorId: center.user.id,
    },
  });
  assert.equal(
    (await evaluateLearningEligibility(db, learner.context, eb, content))
      .prerequisitesSatisfied,
    false,
  );
  const secondLearner = await lmsLearner(
    center.tenant.id,
    "official-cancel-only",
  );
  const ea2 = await enroll(center.context, a.version.id, secondLearner);
  const eb2 = await enroll(center.context, b.version.id, secondLearner);
  const finished2 = await pass(secondLearner.context, ea2.id);
  const result2 = await db.verifiedExamResult.findFirstOrThrow({
    where: { attemptId: finished2.id },
  });
  const issuance2 = await db.issuance.create({
    data: {
      tenantId: center.tenant.id,
      requestId: request.id,
      sourceRevision: 0,
      snapshot: {},
      inputHash: hash({ synthetic: "second" }),
      profileVersionId: issuer.id,
      createdBy: center.user.id,
    },
  });
  await db.lmsDocumentLink.create({
    data: {
      tenantId: center.tenant.id,
      resultId: result2.id,
      documentType: "INFORMATION_CARD",
      legalForm: "INFORMATION_CARD",
      requestId: request.id,
      issuanceId: issuance2.id,
      status: "ISSUED",
    },
  });
  assert.equal(
    (await evaluateLearningEligibility(db, secondLearner.context, eb2, content))
      .finalAllowed,
    true,
    "another issuance event does not invalidate this learner",
  );
  await db.issuanceEvent.create({
    data: {
      tenantId: center.tenant.id,
      issuanceId: issuance2.id,
      kind: "CANCELLED",
      reason: "Synthetic cancellation without replacement",
      actorId: center.user.id,
    },
  });
  assert.equal(
    await db.lmsResultEvent.count({ where: { resultId: result2.id } }),
    0,
  );
  assert.equal(
    (await evaluateLearningEligibility(db, secondLearner.context, eb2, content))
      .finalAllowed,
    false,
    "CANCELLED alone is sufficient, without REPLACED or LMS result events",
  );
  const cancelledDetail = await enrollmentDetail(secondLearner.context, ea2.id);
  assert.deepEqual(
    cancelledDetail.documents,
    await documentViews(secondLearner.context, [result2.id]),
  );
  assert.equal(cancelledDetail.documents[0].status, "VOIDED");
  assert.deepEqual(cancelledDetail.documents[0].artifacts, []);
});

test("P07/P09: access timezone boundaries, group overrides, frozen deadline and pause/archive preserve existing facts", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-governance-access");
  const learner = await lmsLearner(center.tenant.id, "group");
  const individual = await lmsLearner(center.tenant.id, "override");
  const newcomer = await lmsLearner(center.tenant.id, "new");
  const input = lmsCourse({ questions: 1, required: false });
  input.content.learningOutcome = "LEARNING";
  input.content.accessPolicy = {
    mode: "UNLIMITED",
    timezone: "Asia/Qyzylorda",
  };
  const anchor = new Date("2026-03-07T17:00:00.000Z");
  assert.equal(resolveAccessPolicy(input.content, anchor).dueAt, null);
  const days = resolveAccessPolicy(input.content, anchor, {
    mode: "DAYS",
    days: 1,
    timezone: "America/New_York",
  });
  assert.equal(
    days.dueAt?.toISOString(),
    "2026-03-08T16:00:00.000Z",
    "calendar days preserve local time across DST",
  );
  const fixed = resolveAccessPolicy(input.content, anchor, {
    mode: "FIXED",
    startsAt: "2026-03-10T05:00:00.000Z",
    endsAt: "2026-03-11T05:00:00.000Z",
    timezone: "Asia/Qyzylorda",
  });
  const boundary = {
    status: "ACTIVE",
    startsAt: fixed.startsAt,
    dueAt: fixed.dueAt,
  };
  assert.equal(
    accessOpen(boundary, new Date(fixed.startsAt!.getTime() - 1)),
    false,
  );
  assert.equal(accessOpen(boundary, fixed.startsAt!), true);
  assert.equal(accessOpen(boundary, fixed.dueAt!), true);
  assert.equal(
    accessOpen(boundary, new Date(fixed.dueAt!.getTime() + 1)),
    false,
  );
  assert.equal(
    accessOpen({ ...boundary, status: "CANCELLED" }, fixed.startsAt!),
    false,
  );
  assert.throws(
    () =>
      resolveAccessPolicy(input.content, anchor, {
        mode: "DAYS",
        days: 1,
        timezone: "not/a_timezone",
      }),
    code("TIMEZONE_INVALID"),
  );
  const course = await published(center.context, input);
  const group = await db.lmsGroup.create({
    data: {
      tenantId: center.tenant.id,
      courseVersionId: course.version.id,
      name: "Governance group",
      dueAt: new Date(Date.now() + 86400000),
      createdBy: center.user.id,
    },
  });
  const e = await enroll(center.context, course.version.id, learner, {
    groupId: group.id,
  });
  const own = await enroll(center.context, course.version.id, individual, {
    groupId: group.id,
  });
  await db.lmsGroupMember.createMany({
    data: [e, own].map((row) => ({
      tenantId: center.tenant.id,
      groupId: group.id,
      enrollmentId: row.id,
    })),
  });
  const extension = await extendEnrollment(center.context, own.id, {
    accessPolicy: { mode: "DAYS", days: 20, timezone: "Asia/Qyzylorda" },
  });
  const attempt = await startAttempt(learner.context, e.id);
  await updateGroup(center.context, group.id, {
    accessPolicy: { mode: "UNLIMITED", timezone: "Asia/Qyzylorda" },
  });
  assert.equal(
    (await db.enrollment.findUniqueOrThrow({ where: { id: e.id } })).dueAt,
    null,
  );
  assert.equal(
    (
      await db.enrollment.findUniqueOrThrow({ where: { id: own.id } })
    ).dueAt?.getTime(),
    extension.dueAt?.getTime(),
  );
  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 172800000);
  await updateGroup(center.context, group.id, {
    accessPolicy: {
      mode: "FIXED",
      startsAt: futureStart.toISOString(),
      endsAt: futureEnd.toISOString(),
      timezone: "Asia/Qyzylorda",
    },
  });
  assert.equal(
    (
      await db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    ).deadlineAt.getTime(),
    new Date(attempt.deadlineAt).getTime(),
  );
  await saveAnswers(learner.context, attempt.id, {
    sequence: 1,
    answers: Object.fromEntries(
      attempt.questions.map((question) => [question.id, ["a"]]),
    ),
  });
  await submitAttempt(learner.context, attempt.id);
  const fact = await db.lmsLearningCompletion.findFirstOrThrow({
    where: { enrollmentId: e.id },
  });
  await setCoursePause(center.context, course.course.id, {
    paused: true,
    reason: "Governance pause",
  });
  let paused = await runAssignmentChunk(center.context, {
    operationId: randomUUID(),
    courseVersionId: course.version.id,
    recipientIds: [newcomer.recipient.id],
  });
  assert.equal(paused.pauseError?.code, "COURSE_ASSIGNMENT_PAUSED");
  assert.equal(paused.created, 0);
  await setCoursePause(center.context, course.course.id, { paused: false });
  await archiveLearningCourse(center.context, course.course.id, {
    archived: true,
    reason: "Governance archive",
  });
  paused = await runAssignmentChunk(center.context, {
    operationId: randomUUID(),
    courseVersionId: course.version.id,
    recipientIds: [newcomer.recipient.id],
  });
  assert.equal(paused.pauseError?.code, "COURSE_ASSIGNMENT_PAUSED");
  assert.equal(paused.created, 0);
  assert.equal(
    (
      await db.lmsLearningCompletion.findUniqueOrThrow({
        where: { id: fact.id },
      })
    ).snapshotHash,
    fact.snapshotHash,
  );
  assert.equal(
    await db.enrollment.count({
      where: { tenantId: center.tenant.id, courseVersionId: course.version.id },
    }),
    2,
  );
  await assert.rejects(
    revokeTeachingBinding(
      { ...individual.context, teachingMode: true },
      randomUUID(),
      { reason: "No manager permission" },
    ),
    code("LEARNING_PERMISSION_DENIED"),
  );
});
