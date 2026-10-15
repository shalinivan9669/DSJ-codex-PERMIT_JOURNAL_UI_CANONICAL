import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { lmsTenant, lmsCourse } from "./lms-fixture";
import {
  createCourse,
  publishVersion,
  setCoursePause,
} from "../../apps/api/src/lms/courses";
import {
  runAssignmentChunk,
  ASSIGNMENT_CHUNK_SIZE,
} from "../../apps/api/src/lms/assignment-operations";
import {
  groupDetail,
  excludeGroupMember,
  updateGroup,
  addGroupMembers,
  orderTraining,
} from "../../apps/api/src/lms/groups";
import { extendEnrollment } from "../../apps/api/src/lms/enrollments";
import { assignmentContext } from "../../apps/api/src/lms/enrollments";
import { createRequest } from "../../apps/api/src/requests";
import { draftSchema } from "../../packages/contracts/src";

test("V2 A3/A4/A5/S1: prepared origin survives chunk pause/resume, replay, roster and scoped access", async (t) => {
  t.after(() => db.$disconnect());
  const center = await lmsTenant("scaling assignments");
  const foreign = await lmsTenant("scaling assignments foreign");
  const customer = await db.customerOrganization.create({
    data: { tenantId: center.tenant.id, nameRu: "Synthetic employer" },
  });
  const ids = Array.from({ length: ASSIGNMENT_CHUNK_SIZE + 3 }, () =>
    randomUUID(),
  );
  await db.recipient.createMany({
    data: ids.map((id, index) => ({
      id,
      tenantId: center.tenant.id,
      data: {
        fullNameRu: `Synthetic member ${index}`,
        fullNameKz: `Synthetic member ${index}`,
      },
    })),
  });
  await db.recipientEmployment.createMany({
    data: ids.map((recipientId) => ({
      tenantId: center.tenant.id,
      recipientId,
      employerId: customer.id,
      createdBy: center.user.id,
    })),
  });
  const request = await createRequest(
    center.context,
    draftSchema.parse({
      schemaVersion: 2,
      kind: "COMPANY",
      customerId: customer.id,
      title: "Synthetic prepared request",
      demoMode: true,
      items: ids.slice(0, 101).map((recipientId, index) => ({
        id: randomUUID(),
        recipientId,
        employerId: customer.id,
        fullNameRu: `Synthetic member ${index}`,
        assignments: [],
      })),
    }),
  );
  const order = await db.serviceOrder.create({
    data: {
      tenantId: center.tenant.id,
      title: "Synthetic source order",
      customerId: customer.id,
      employerId: customer.id,
      createdBy: center.user.id,
    },
  });
  const otherOrder = await db.serviceOrder.create({
    data: {
      tenantId: center.tenant.id,
      title: "Synthetic additional order",
      customerId: customer.id,
      employerId: customer.id,
      createdBy: center.user.id,
    },
  });
  await db.serviceOrderRequest.createMany({
    data: [order.id, otherOrder.id].map((orderId) => ({
      tenantId: center.tenant.id,
      orderId,
      requestId: request.id,
    })),
  });
  const created = await createCourse(
    center.context,
    lmsCourse({ questions: 1, required: false }),
  );
  const version = await publishVersion(center.context, created.version.id, {
    revision: 0,
  });
  assert.equal(
    (
      await assignmentContext(center.context, {
        requestId: request.id,
        orderId: order.id,
      })
    ).total,
    101,
  );
  const input = {
    operationId: randomUUID(),
    courseVersionId: version.id,
    recipientIds: ids.slice(0, 102),
    sourceRequestId: request.id,
    sourceOrderId: order.id,
    customerId: customer.id,
    groupName: "Synthetic prepared group",
  };
  const first = await runAssignmentChunk(center.context, input);
  assert.equal(first.state, "PENDING");
  assert.equal(first.cursor, 100);
  assert.equal(first.created, 100);
  const groupId = first.groupId!;
  await setCoursePause(center.context, created.course.id, {
    paused: true,
    reason: "Manual synthetic pause",
  });
  const paused = await runAssignmentChunk(center.context, input);
  assert.equal(paused.state, "PAUSED");
  assert.equal(paused.created, 100);
  assert.equal(paused.cursor, 100);
  assert.equal(paused.pauseError?.code, "COURSE_ASSIGNMENT_PAUSED");
  assert.equal(
    await db.enrollment.count({
      where: { tenantId: center.tenant.id, courseVersionId: version.id },
    }),
    100,
  );
  const single = await runAssignmentChunk(center.context, {
    operationId: randomUUID(),
    courseVersionId: version.id,
    recipientIds: [ids[102]],
    customerId: customer.id,
  });
  assert.equal(single.state, "PAUSED");
  assert.equal(single.created, 0);
  await setCoursePause(center.context, created.course.id, { paused: false });
  const completed = await runAssignmentChunk(center.context, input);
  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.created, 101);
  assert.equal(completed.errors.length, 1);
  assert.equal(completed.errors[0].code, "ORIGIN_RECIPIENT_MISMATCH");
  const replay = await runAssignmentChunk(center.context, input);
  assert.equal(replay.created, 101);
  assert.equal(replay.errors.length, 1);
  assert.equal(replay.groupId, groupId);
  const existingOnlyInput = {
    ...input,
    operationId: randomUUID(),
    recipientIds: ids.slice(0, 101),
  };
  let existingOnly = await runAssignmentChunk(
    center.context,
    existingOnlyInput,
  );
  if (existingOnly.state === "PENDING")
    existingOnly = await runAssignmentChunk(center.context, existingOnlyInput);
  assert.equal(existingOnly.created, 0);
  assert.equal(existingOnly.duplicates, 101);
  assert.equal(existingOnly.conflicts, 0);
  assert.equal(existingOnly.groupId, null);
  assert.ok(
    existingOnly.items.every(
      (item) => item.outcome === "REUSED" && item.groupId === groupId,
    ),
  );
  assert.equal(
    await db.lmsGroup.count({ where: { tenantId: center.tenant.id } }),
    1,
  );
  assert.equal(
    await db.enrollment.count({
      where: { tenantId: center.tenant.id, courseVersionId: version.id },
    }),
    101,
  );
  await assert.rejects(
    runAssignmentChunk(center.context, {
      ...input,
      recipientIds: [...input.recipientIds].reverse(),
    }),
  );
  const firstEnrollment = await db.enrollment.findUniqueOrThrow({
    where: {
      tenantId_courseVersionId_recipientId: {
        tenantId: center.tenant.id,
        courseVersionId: version.id,
        recipientId: ids[0],
      },
    },
  });
  assert.equal(firstEnrollment.sourceRequestId, request.id);
  assert.equal(firstEnrollment.sourceOrderId, order.id);
  const secondEnrollment = await db.enrollment.findUniqueOrThrow({
    where: {
      tenantId_courseVersionId_recipientId: {
        tenantId: center.tenant.id,
        courseVersionId: version.id,
        recipientId: ids[1],
      },
    },
  });
  const oldDate = secondEnrollment.dueAt.toISOString();
  const overrideDate = new Date(Date.now() + 120 * 86400000).toISOString();
  await extendEnrollment(center.context, firstEnrollment.id, {
    dueAt: overrideDate,
  });
  await excludeGroupMember(center.context, groupId, secondEnrollment.id);
  assert.equal((await groupDetail(center.context, groupId)).total, 100);
  assert.equal(
    (await groupDetail(center.context, groupId)).excluded[0].id,
    secondEnrollment.id,
  );
  const groupDate = new Date(Date.now() + 100 * 86400000).toISOString();
  await updateGroup(center.context, groupId, { dueAt: groupDate });
  assert.equal(
    (
      await db.enrollment.findUniqueOrThrow({
        where: { id: firstEnrollment.id },
      })
    ).dueAt.toISOString(),
    overrideDate,
  );
  assert.equal(
    (
      await db.enrollment.findUniqueOrThrow({
        where: { id: secondEnrollment.id },
      })
    ).dueAt.toISOString(),
    oldDate,
  );
  const readded = await addGroupMembers(center.context, groupId, {
    operationId: randomUUID(),
    recipientIds: [ids[1]],
  });
  assert.equal(readded.duplicates, 1);
  assert.equal((await groupDetail(center.context, groupId)).total, 101);
  const conflicting = await runAssignmentChunk(center.context, {
    ...input,
    operationId: randomUUID(),
    recipientIds: [ids[0]],
    sourceOrderId: otherOrder.id,
  });
  assert.equal(conflicting.conflicts, 1);
  assert.equal(
    (
      await db.enrollment.findUniqueOrThrow({
        where: { id: firstEnrollment.id },
      })
    ).sourceOrderId,
    order.id,
  );
  const employerUser = await db.user.create({
    data: {
      tenantId: center.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Synthetic employer",
      role: "EMPLOYER",
      passwordHash: "unused",
    },
  });
  await db.employerMembership.create({
    data: {
      tenantId: center.tenant.id,
      customerId: customer.id,
      userId: employerUser.id,
      permissions: ["READ", "ASSIGN_TRAINING"],
      recipientIds: [ids[0]],
      createdBy: center.user.id,
    },
  });
  const employer: Context = {
    ...center.context,
    userId: employerUser.id,
    role: "EMPLOYER",
  };
  const employerGroup = await groupDetail(employer, groupId);
  assert.equal(employerGroup.total, 1);
  assert.equal(employerGroup.group.sourceOrderId, null);
  assert.equal(employerGroup.excluded.length, 0);
  await assert.rejects(orderTraining(employer, order.id));
  await assert.rejects(groupDetail(foreign.context, groupId));
  await assert.rejects(runAssignmentChunk(foreign.context, input));
  const requestOnly = await runAssignmentChunk(center.context, {
    operationId: randomUUID(),
    courseVersionId: version.id,
    recipientIds: [ids[0]],
    sourceRequestId: request.id,
    customerId: customer.id,
  });
  assert.equal(requestOnly.items[0].sourceOrderId, order.id); // existing historical origin is retained, never guessed/replaced.
  assert.equal((await orderTraining(center.context, order.id)).total, 101);
  const concurrentInput = {
    operationId: randomUUID(),
    courseVersionId: version.id,
    recipientIds: [ids[102]],
    customerId: customer.id,
  };
  const [pauseRace, racingAssignment] = await Promise.all([
    setCoursePause(center.context, created.course.id, {
      paused: true,
      reason: "Synthetic concurrent pause",
    }),
    runAssignmentChunk(center.context, concurrentInput),
  ]);
  assert.equal(pauseRace.assignmentPaused, true);
  assert.ok(["PAUSED", "COMPLETED"].includes(racingAssignment.state));
  const beforeReplay = await db.enrollment.count({
    where: { tenantId: center.tenant.id },
  });
  const raceReplay = await runAssignmentChunk(center.context, concurrentInput);
  assert.equal(
    await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
    beforeReplay,
  );
  assert.equal(raceReplay.created, racingAssignment.created);
  const employerOperation = {
    operationId: randomUUID(),
    courseVersionId: version.id,
    recipientIds: [ids[0]],
    customerId: customer.id,
  };
  const ownReplay = await runAssignmentChunk(employer, employerOperation);
  assert.equal(ownReplay.state, "COMPLETED");
  assert.equal(ownReplay.duplicates, 1);
  await db.employerMembership.update({
    where: {
      tenantId_customerId_userId: {
        tenantId: center.tenant.id,
        customerId: customer.id,
        userId: employer.userId,
      },
    },
    data: { recipientIds: [ids[2]] },
  });
  await assert.rejects(
    runAssignmentChunk(employer, employerOperation),
    (caught: unknown) =>
      (caught as { getStatus(): number }).getStatus() === 403,
  );
  await db.employerMembership.update({
    where: {
      tenantId_customerId_userId: {
        tenantId: center.tenant.id,
        customerId: customer.id,
        userId: employer.userId,
      },
    },
    data: { recipientIds: [ids[0]], active: false },
  });
  await assert.rejects(
    runAssignmentChunk(employer, employerOperation),
    (caught: unknown) =>
      (caught as { getStatus(): number }).getStatus() === 403,
  );
  assert.equal(
    await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
    beforeReplay,
  );
});
