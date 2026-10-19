import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/core";
import {
  createCourse,
  publishVersion,
  updateVersion,
  cloneVersion,
  getCourse,
} from "../../apps/api/src/lms/courses";
import {
  assignEnrollments,
  listEnrollments,
  assignmentContext,
  extendEnrollment,
} from "../../apps/api/src/lms/enrollments";
import { scopedEnrollment } from "../../apps/api/src/lms/scope";
import { lmsCourse, lmsLearner, lmsTenant } from "./lms-fixture";

const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { getStatus(): number }).getStatus(), expected);
  return true;
};

test("L03 L04 L08 L10: real PostgreSQL immutable course, scoped bulk enrollment and preserved history", async (t) => {
  const first = await lmsTenant("LMS integration A");
  const second = await lmsTenant("LMS integration B");
  const [learnerA, learnerB, foreign] = await Promise.all([
    lmsLearner(first.tenant.id, "A"),
    lmsLearner(first.tenant.id, "B"),
    lmsLearner(second.tenant.id, "foreign"),
  ]);
  const definition = lmsCourse();
  const course = await createCourse(first.context, definition);
  let enrollmentId = "";
  try {
    await t.test(
      "draft hidden; tenant injection and learner mutation denied",
      async () => {
        await assert.rejects(
          getCourse(learnerA.context, course.course.id),
          status(404),
        );
        await assert.rejects(
          getCourse(second.context, course.course.id),
          status(404),
        );
        await assert.rejects(
          createCourse(learnerA.context, definition),
          status(403),
        );
        await assert.rejects(
          createCourse(first.context, {
            ...definition,
            tenantId: second.tenant.id,
          }),
          status(400),
        );
        await assert.rejects(
          assignEnrollments(first.context, {
            courseVersionId: course.version.id,
            recipientIds: [learnerA.recipient.id],
          }),
          status(404),
        );
      },
    );
    await t.test(
      "published version and profile immutable, learner never receives question keys",
      async () => {
        await publishVersion(first.context, course.version.id, { revision: 0 });
        const view = await getCourse(learnerA.context, course.course.id);
        assert.equal(JSON.stringify(view).includes("correctOptionIds"), false);
        assert.equal(JSON.stringify(view).includes('"questions"'), false);
        await assert.rejects(
          updateVersion(first.context, course.version.id, {
            revision: 0,
            ...definition,
          }),
          status(409),
        );
        await assert.rejects(
          db.courseVersion.update({
            where: { id: course.version.id },
            data: { content: { tampered: true } },
          }),
        );
        await assert.rejects(
          db.regulatoryProfileVersion.update({
            where: { id: course.version.regulatoryProfileVersionId },
            data: { definition: { tampered: true } },
          }),
        );
      },
    );
    await t.test(
      "mixed batch preserves ready rows and identical replay has no duplicate",
      async () => {
        const input = {
          operationId: randomUUID(),
          courseVersionId: course.version.id,
          recipientIds: [
            learnerA.recipient.id,
            learnerB.recipient.id,
            foreign.recipient.id,
            learnerA.recipient.id,
          ],
          groupName: "Synthetic mixed",
        };
        const result = await assignEnrollments(first.context, input);
        assert.equal(result.created, 2);
        assert.equal(
          result.total,
          3,
          "duplicate input IDs are normalized before assignment",
        );
        assert.equal(result.duplicates, 0);
        assert.deepEqual(
          result.errors.map((e) => e.code),
          ["RECIPIENT_UNAVAILABLE"],
        );
        enrollmentId = result.items.find(
          (e) => e.recipientId === learnerA.recipient.id,
        )!.id;
        const replay = await assignEnrollments(first.context, input);
        assert.equal(replay.operationId, result.operationId);
        assert.equal(
          replay.created,
          2,
          "a replay returns the persisted operation totals",
        );
        assert.equal(
          await db.lmsAssignmentRow.count({
            where: { operationId: result.operationId },
          }),
          3,
        );
        const retry = await assignEnrollments(first.context, {
          courseVersionId: course.version.id,
          recipientIds: [learnerA.recipient.id, learnerB.recipient.id],
        });
        assert.equal(retry.created, 0);
        assert.equal(retry.duplicates, 2);
        assert.equal(
          await db.enrollment.count({
            where: {
              tenantId: first.tenant.id,
              courseVersionId: course.version.id,
            },
          }),
          2,
        );
      },
    );
    await t.test(
      "self and tenant read boundaries also cover direct IDs and aggregates",
      async () => {
        const own = await listEnrollments(learnerA.context, {});
        assert.equal(own.total, 1);
        assert.equal(own.items[0].id, enrollmentId);
        assert.equal((await listEnrollments(foreign.context, {})).total, 0);
        await assert.rejects(
          scopedEnrollment(learnerB.context, enrollmentId),
          status(404),
        );
        await assert.rejects(
          scopedEnrollment(second.context, enrollmentId),
          status(404),
        );
        await assert.rejects(
          assignmentContext(learnerA.context, {}),
          status(403),
        );
        await assert.rejects(
          extendEnrollment(learnerA.context, enrollmentId, {
            dueAt: new Date(Date.now() + 86400000).toISOString(),
          }),
          status(403),
        );
      },
    );
    await t.test(
      "new draft cannot alter the version already assigned",
      async () => {
        const publishedBefore = await db.courseVersion.findUniqueOrThrow({
          where: { id: course.version.id },
        });
        const next = await cloneVersion(first.context, course.course.id);
        assert.equal(next.version, 2);
        assert.equal(
          next.profile && (next.profile as { status: string }).status,
          "NEEDS_LEGAL_REVIEW",
        );
        assert.equal(
          (await scopedEnrollment(first.context, enrollmentId)).courseVersionId,
          course.version.id,
        );
        const old = await db.courseVersion.findUniqueOrThrow({
          where: { id: course.version.id },
        });
        assert.equal(old.status, "PUBLISHED");
        assert.deepEqual(old.content, publishedBefore.content);
        assert.equal(old.snapshotHash, publishedBefore.snapshotHash);
      },
    );
    await t.test(
      "1/10/100/250 recipients and concurrent retry retain exact counts",
      async () => {
        for (const count of [1, 10, 100, 250]) {
          const ids = Array.from({ length: count }, () => randomUUID());
          await db.recipient.createMany({
            data: ids.map((id, i) => ({
              id,
              tenantId: first.tenant.id,
              data: {
                fullNameRu: `Synthetic ${count} ${i}`,
                fullNameKz: `Синтетикалық ${count} ${i}`,
              },
            })),
          });
          const input = {
            operationId: randomUUID(),
            courseVersionId: course.version.id,
            recipientIds: ids,
            groupName: `scale-${count}`,
          };
          const results = await Promise.all([
            assignEnrollments(first.context, input),
            assignEnrollments(first.context, input),
          ]);
          assert.ok(
            results.every((result) => result.operationId === input.operationId),
          );
          assert.equal(results[0].errors.length + results[1].errors.length, 0);
          let completed = await assignEnrollments(first.context, input);
          while (completed.state === "PENDING")
            completed = await assignEnrollments(first.context, input);
          assert.equal(completed.state, "COMPLETED");
          assert.equal(completed.created, count);
          assert.equal(completed.duplicates, 0);
          assert.equal(
            await db.lmsAssignmentRow.count({
              where: { operationId: input.operationId },
            }),
            count,
          );
          assert.equal(
            await db.enrollment.count({
              where: {
                tenantId: first.tenant.id,
                courseVersionId: course.version.id,
                recipientId: { in: ids },
              },
            }),
            count,
          );
        }
      },
    );
    await t.test(
      "same-tenant employer scope excludes the other organization",
      async () => {
        const [orgA, orgB] = await Promise.all(
          ["A", "B"].map((name) =>
            db.customerOrganization.create({
              data: {
                tenantId: first.tenant.id,
                nameRu: `Synthetic employer ${name}`,
              },
            }),
          ),
        );
        await db.recipientEmployment.createMany({
          data: [
            {
              tenantId: first.tenant.id,
              recipientId: learnerA.recipient.id,
              employerId: orgA.id,
              createdBy: first.user.id,
            },
            {
              tenantId: first.tenant.id,
              recipientId: learnerB.recipient.id,
              employerId: orgB.id,
              createdBy: first.user.id,
            },
          ],
        });
        const employer = await db.user.create({
          data: {
            tenantId: first.tenant.id,
            email: `${randomUUID()}@example.test`,
            displayName: "Synthetic employer",
            passwordHash: "unusable",
            role: "EMPLOYER",
          },
        });
        await db.employerMembership.create({
          data: {
            tenantId: first.tenant.id,
            customerId: orgA.id,
            userId: employer.id,
            permissions: ["READ", "ASSIGN_TRAINING"],
            createdBy: first.user.id,
          },
        });
        const context = {
          ...first.context,
          userId: employer.id,
          role: "EMPLOYER",
        };
        const visible = await assignmentContext(context, {});
        assert.deepEqual(
          visible.recipients.map((r) => r.id),
          [learnerA.recipient.id],
        );
        const denied = await assignEnrollments(context, {
          courseVersionId: course.version.id,
          recipientIds: [learnerB.recipient.id],
          customerId: orgB.id,
        });
        assert.equal(denied.created, 0);
        assert.equal(denied.errors[0].code, "RECIPIENT_UNAVAILABLE");
        await assert.rejects(
          scopedEnrollment(context, enrollmentId),
          status(404),
        );
      },
    );
    await t.test(
      "database reconnect retains persisted enrollment and immutable snapshot",
      async () => {
        await db.$disconnect();
        assert.equal(
          (await scopedEnrollment(learnerA.context, enrollmentId)).recipientId,
          learnerA.recipient.id,
        );
        assert.ok(
          await db.auditEvent.count({
            where: {
              tenantId: first.tenant.id,
              action: "LMS_ASSIGNMENT_CHUNK",
            },
          }),
        );
      },
    );
  } finally {
    await db.$disconnect();
  }
});
