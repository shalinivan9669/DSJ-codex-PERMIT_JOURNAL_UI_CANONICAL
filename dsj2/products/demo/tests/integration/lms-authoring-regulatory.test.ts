import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, hash, type Context } from "../../apps/api/src/core";
import {
  createCourse,
  updateVersion,
  cloneVersion,
  publishVersion,
  setRegulatoryReview,
  getCourse,
  listRegulatorySources,
} from "../../apps/api/src/lms/courses";
import { reviewCourseVersion } from "../../apps/api/src/lms/course-review";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { availableVersion } from "../../apps/api/src/lms/applications";
import {
  listLearningNotifications,
  readLearningNotification,
  readAllLearningNotifications,
} from "../../apps/api/src/lms/notifications";
import { deliverLearningNotification } from "../../apps/api/src/lms/notification-worker";
import { lmsTenant, lmsCourse, lmsLearner } from "./lms-fixture";

after(() => db.$disconnect());

test("MVP publication blocks a missing effective date before learners can enter a document dead end", async () => {
  const center = await lmsTenant("mvp-effective-date");
  const input = lmsCourse({ kind: "CENTER_EXAM", questions: 1 });
  input.profile.effectiveFrom = null;
  const created = await createCourse(center.context, input);
  assert.ok(created.version.publicationIssues.some(issue => issue.code === "POLICY_EFFECTIVE_FROM_REQUIRED"));
  await assert.rejects(publishVersion(center.context, created.version.id, { revision: created.version.revision }), code("POLICY_EFFECTIVE_FROM_REQUIRED"));
  assert.equal((await db.courseVersion.findUniqueOrThrow({ where: { id: created.version.id } })).status, "DRAFT");
  const corrected = await updateVersion(center.context, created.version.id, { ...input, profile: { ...input.profile, effectiveFrom: "2026-10-01" }, revision: created.version.revision });
  const published = await publishVersion(center.context, corrected.id, { revision: corrected.revision });
  assert.equal(published.status, "PUBLISHED");
  assert.equal((published.profile as { effectiveFrom: string }).effectiveFrom, "2026-10-01");
});

test("MVP regulatory catalogue: scoped immutable versions, source search, sanitary filter and revoked bindings", async () => {
  const center = await lmsTenant("mvp-regulatory-catalogue");
  const methodist = await user(center.context, "METHODIST");
  const stranger = await user(center.context, "METHODIST");
  const input = lmsCourse({ questions: 1 });
  input.profile.sources = [{ title: "Синтетическое основание", url: "", revision: "1", number: "SYN-2026", authority: "Учебный орган", status: "CURRENT" }];
  const created = await createCourse(methodist, input);
  const published = await publishVersion(center.context, created.version.id, { revision: created.version.revision });
  const old = await listRegulatorySources(methodist, {});
  assert.equal(old.total, 1);
  assert.equal(old.items[0].courseVersionId, published.id);
  const clone = await cloneVersion(methodist, created.course.id);
  const profile = { ...input.profile, sources: [{ ...input.profile.sources[0], revision: "2" }] };
  await updateVersion(methodist, clone.id, { revision: clone.revision, content: clone.content, profile });
  const all = await listRegulatorySources(methodist, { search: "SYN-2026", pageSize: 1 });
  assert.equal(all.total, 2); assert.equal(all.items.length, 1);
  assert.equal(all.items[0].profile.sources[0].revision, "2");
  const prior = await listRegulatorySources(methodist, { status: "PUBLISHED" });
  assert.deepEqual(prior.items, old.items);
  assert.equal((await listRegulatorySources(methodist, { sanitary: "ONLY" })).total, 0);
  assert.equal((await listRegulatorySources(methodist, { search: "absent-normative-source" })).total, 0);
  assert.equal((await listRegulatorySources(stranger, { search: "SYN-2026" })).total, 0);
  assert.equal((await listRegulatorySources((await lmsTenant("foreign-regulatory")).context, {})).total, 0);
  const safe = JSON.stringify(all);
  for (const key of ["correctOptionIds", "answerSpec", "exam", "reviewedBy", "snapshotHash", "tenantId"]) assert.equal(safe.includes(`"${key}"`), false);
  for (const role of ["SUPER_ADMIN", "ADMIN", "DIRECTOR"]) assert.equal((await listRegulatorySources({ ...center.context, role }, {})).total, 2);
  for (const role of ["LEARNER", "EMPLOYER", "VIEWER", "OPERATOR", "TEACHER", "EXPERT"]) await assert.rejects(listRegulatorySources({ ...center.context, role }, {}), code("LEARNING_PERMISSION_DENIED"));
  await assert.rejects(listRegulatorySources({ ...center.context, learningMode: true }, {}), code("LEARNING_PERMISSION_DENIED"));
  const binding = await db.lmsTeachingBinding.findFirstOrThrow({ where: { userId: methodist.userId, courseId: created.course.id } });
  await db.lmsTeachingBinding.update({ where: { id: binding.id }, data: { permissions: ["READ"] } });
  assert.equal((await listRegulatorySources(methodist, {})).total, 0);
  await db.lmsTeachingBinding.update({ where: { id: binding.id }, data: { permissions: ["READ", "EDIT"], revokedAt: new Date() } });
  assert.equal((await listRegulatorySources(methodist, {})).total, 0);
});

const code = (expected: string) => (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
  expected;
async function user(c: Context, role: string, active = true) {
  const row = await db.user.create({
    data: {
      tenantId: c.tenantId,
      role,
      active,
      email: `${randomUUID()}@example.test`,
      displayName: `Synthetic ${role}`,
      passwordHash: "synthetic-not-for-login",
    },
  });
  return { ...c, userId: row.id, role };
}
async function drain() {
  while (await deliverLearningNotification()) {
    /* Isolated synthetic test queue only. */
  }
}

test("MVP author: empty methodist creates a programme, review returns/approves it and published snapshots stay immutable", async () => {
  const center = await lmsTenant("mvp-authoring"),
    admin = await user(center.context, "ADMIN"),
    methodist = await user(center.context, "METHODIST");
  assert.equal(
    await db.lmsTeachingBinding.count({ where: { userId: methodist.userId } }),
    0,
  );
  const input = lmsCourse({ questions: 1 });
  const created = await createCourse(methodist, input);
  const binding = await db.lmsTeachingBinding.findFirstOrThrow({
    where: { userId: methodist.userId, courseId: created.course.id },
  });
  assert.deepEqual(binding.permissions, ["READ", "EDIT", "MATERIAL"]);
  await assert.rejects(
    publishVersion(methodist, created.version.id, {
      revision: created.version.revision,
    }),
    code("LEARNING_PERMISSION_DENIED"),
  );
  const submitted = await reviewCourseVersion(methodist, created.version.id, {
    revision: created.version.revision,
    action: "SUBMIT",
  });
  assert.equal(submitted.review?.state, "PENDING");
  const returned = await reviewCourseVersion(admin, created.version.id, {
    revision: submitted.revision,
    action: "RETURN",
    feedback: "Уточните заголовок / Атауды нақтылаңыз",
  });
  assert.equal(returned.review?.state, "RETURNED");
  const revised = await updateVersion(methodist, returned.id, {
    revision: returned.revision,
    content: {
      ...returned.content,
      titleRu: "Исправленная программа",
      titleKz: "Түзетілген бағдарлама",
    },
    profile: returned.profile,
  });
  const next = await reviewCourseVersion(methodist, revised.id, {
    revision: revised.revision,
    action: "SUBMIT",
  });
  await reviewCourseVersion(admin, next.id, {
    revision: next.revision,
    action: "APPROVE",
  });
  const published = await publishVersion(admin, next.id, {
    revision: next.revision,
  });
  assert.equal(published.status, "PUBLISHED");
  await assert.rejects(
    updateVersion(methodist, published.id, {
      revision: published.revision,
      content: input.content,
      profile: input.profile,
    }),
    code("VERSION_IMMUTABLE"),
  );
  const clone = await cloneVersion(methodist, created.course.id);
  assert.equal(clone.version, 2);
  assert.equal(clone.status, "DRAFT");
  assert.equal(
    (clone.profile as { status: string }).status,
    "NEEDS_LEGAL_REVIEW",
  );
  assert.equal(clone.review, null);
  const unchanged = await db.courseVersion.findUniqueOrThrow({
    where: { id: published.id },
  });
  assert.deepEqual(unchanged.content, published.content);
  assert.equal(unchanged.snapshotHash, published.snapshotHash);
  const stranger = await user(center.context, "METHODIST");
  await assert.rejects(
    getCourse(stranger, created.course.id),
    code("NOT_FOUND"),
  );
});

test("MVP regulatory changes notify current responsible authors/admins once and recheck access on delivery/list/read", async () => {
  const center = await lmsTenant("mvp-regulatory-inbox"),
    admin = await user(center.context, "ADMIN"),
    methodist = await user(center.context, "METHODIST"),
    superAdmin = await user(center.context, "SUPER_ADMIN");
  const outsider = await user(center.context, "METHODIST"),
    teacher = await user(center.context, "TEACHER"),
    inactive = await user(center.context, "ADMIN", false);
  const foreign = await lmsTenant("mvp-regulatory-foreign"),
    foreignAdmin = await user(foreign.context, "ADMIN");
  const created = await createCourse(methodist, lmsCourse({ questions: 1 }));
  await db.lmsTeachingBinding.create({
    data: {
      tenantId: center.tenant.id,
      courseId: created.course.id,
      userId: teacher.userId,
      role: "TEACHER",
      permissions: ["READ", "EDIT"],
      createdBy: admin.userId,
    },
  });
  await db.lmsTeachingBinding.create({
    data: {
      tenantId: center.tenant.id,
      courseId: created.course.id,
      userId: outsider.userId,
      role: "METHODIST",
      permissions: ["READ"],
      createdBy: admin.userId,
    },
  });
  await Promise.all(
    Array.from({ length: 3 }, () =>
      setRegulatoryReview(admin, created.course.id, {
        status: "CHANGED",
        note: "Synthetic regulatory change",
      }),
    ),
  );
  const queued = await db.lmsNotificationEvent.findMany({
    where: { tenantId: center.tenant.id, sourceType: "REGULATORY" },
  });
  assert.deepEqual(
    queued.map((row) => row.userId).sort(),
    [admin.userId, methodist.userId, superAdmin.userId].sort(),
  );
  await drain();
  const inbox = await listLearningNotifications(methodist, {});
  assert.equal(inbox.total, 1);
  assert.match(
    String((inbox.items[0] as unknown as { titleKz: string }).titleKz),
    /жаңарту/,
  );
  assert.equal(
    inbox.items[0].href,
    `/lms/courses/${created.course.id}?section=overview`,
  );
  for (const denied of [outsider, teacher, inactive, foreignAdmin])
    assert.equal((await listLearningNotifications(denied, {})).total, 0);
  assert.equal(
    (await listLearningNotifications({ ...methodist, learningMode: true }, {}))
      .total,
    0,
  );
  assert.equal(
    (await listLearningNotifications({ ...admin, role: "OPERATOR" }, {})).total,
    0,
  );
  const read = await readLearningNotification(methodist, inbox.items[0].id);
  assert.ok(read.readAt);
  assert.equal((await listLearningNotifications(methodist, {})).unread, 0);
  const binding = await db.lmsTeachingBinding.findFirstOrThrow({
    where: { userId: methodist.userId, courseId: created.course.id },
  });
  await db.lmsTeachingBinding.update({
    where: { id: binding.id },
    data: { revokedAt: new Date() },
  });
  assert.equal((await listLearningNotifications(methodist, {})).total, 0);
  await assert.rejects(
    readLearningNotification(methodist, inbox.items[0].id),
    code("NOT_FOUND"),
  );
  assert.equal((await readAllLearningNotifications(methodist)).read, 0);
  await db.lmsTeachingBinding.update({
    where: { id: binding.id },
    data: { revokedAt: null },
  });
  await setRegulatoryReview(admin, created.course.id, {
    status: "REVIEW_REQUIRED",
    note: "Next revision",
  });
  await db.lmsTeachingBinding.update({
    where: { id: binding.id },
    data: { revokedAt: new Date() },
  });
  await drain();
  const suppressed = await db.lmsNotificationEvent.findFirstOrThrow({
    where: {
      userId: methodist.userId,
      sourceType: "REGULATORY",
      state: "SUPPRESSED",
    },
  });
  assert.equal(suppressed.deliveredAt, null);
  assert.equal((await listLearningNotifications(admin, {})).total, 1);
  await setRegulatoryReview(admin, created.course.id, {
    status: "CURRENT",
    note: "Reviewed",
  });
  assert.equal((await listLearningNotifications(admin, {})).total, 0);
  assert.equal((await listLearningNotifications(superAdmin, {})).total, 0);
});

test("MVP assignment rejects unsupported legacy published profiles before creating a learner assignment or accepting an application", async () => {
  const center = await lmsTenant("mvp-legacy-route"),
    learner = await lmsLearner(center.tenant.id, "legacy-route");
  const input = lmsCourse({ questions: 1 });
  input.profile.requiresProctoring = true;
  const created = await createCourse(center.context, input);
  await assert.rejects(
    publishVersion(center.context, created.version.id, {
      revision: created.version.revision,
    }),
    code("LOCAL_PROCTORING_UNAVAILABLE"),
  );
  // Seed a historical publication in the isolated fixture. Never mutate an immutable published profile.
  const version = await db.courseVersion.update({
    where: { id: created.version.id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      snapshotHash: hash(input),
    },
  });
  await assert.rejects(
    assignEnrollments(center.context, {
      courseVersionId: version.id,
      recipientIds: [learner.recipient.id],
    }),
    code("LOCAL_PROCTORING_UNAVAILABLE"),
  );
  await assert.rejects(
    availableVersion(center.tenant.id, version.id, db, false, false),
    code("LOCAL_PROCTORING_UNAVAILABLE"),
  );
  assert.equal(
    await db.enrollment.count({ where: { courseVersionId: version.id } }),
    0,
  );
  assert.equal(
    await db.lmsAssignmentOperation.count({
      where: { tenantId: center.tenant.id },
    }),
    0,
  );
});
