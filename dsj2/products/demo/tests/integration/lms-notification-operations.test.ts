import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, transaction, hash, json } from "../../apps/api/src/core";
import { draftSchema } from "../../packages/contracts/src";
import { cancelRequest } from "../../apps/api/src/requests";
import { decideProposal } from "../../apps/api/src/approvals";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { reviewCourseVersion } from "../../apps/api/src/lms/course-review";
import { enqueueEnrollmentNotification } from "../../apps/api/src/lms/notification-events";
import {
  scanLearningNotifications,
  scanRenewalNotifications,
  deliverLearningNotification,
  reminderThreshold,
} from "../../apps/api/src/lms/notification-worker";
import {
  listLearningNotifications,
  readLearningNotification,
  readAllLearningNotifications,
  notifyTeachingEvent,
} from "../../apps/api/src/lms/notifications";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import { lmsTenant, lmsLearner, lmsCourse } from "./lms-fixture";

test(
  "N05: bounded durable delivery, legacy SESSION/read preservation, admission trigger and revocation",
  { timeout: 180_000 },
  async (t) => {
    t.after(() => db.$disconnect());
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    const center = await lmsTenant("notifications"),
      foreign = await lmsTenant("notifications foreign"),
      learner = await lmsLearner(center.tenant.id, "inbox");
    const created = await createCourse(
      center.context,
      lmsCourse({ kind: "PRACTICE", questions: 1 }),
    );
    const submitted = await reviewCourseVersion(
      center.context,
      created.version.id,
      { revision: 0, action: "SUBMIT" },
    );
    await reviewCourseVersion(center.context, created.version.id, {
      revision: submitted.revision,
      action: "APPROVE",
    });
    await publishVersion(center.context, created.version.id, {
      revision: submitted.revision,
    });
    const group = await db.lmsGroup.create({
      data: {
        tenantId: center.tenant.id,
        courseVersionId: created.version.id,
        name: "Synthetic notifications group",
        createdBy: center.user.id,
      },
    });
    const customer = await db.customerOrganization.create({
      data: { tenantId: center.tenant.id, nameRu: "Synthetic inbox employer" },
    });
    const employer = await db.user.create({
      data: {
        tenantId: center.tenant.id,
        displayName: "Synthetic inbox employer",
        email: `${randomUUID()}@example.test`,
        role: "EMPLOYER",
        passwordHash: "not-for-login",
      },
    });
    const membership = await db.employerMembership.create({
      data: {
        tenantId: center.tenant.id,
        userId: employer.id,
        customerId: customer.id,
        permissions: ["READ"],
        createdBy: center.user.id,
      },
    });
    const employerContext = {
      ...center.context,
      role: "EMPLOYER",
      userId: employer.id,
    };
    const e = await db.enrollment.create({
      data: {
        tenantId: center.tenant.id,
        courseVersionId: created.version.id,
        recipientId: learner.recipient.id,
        learnerUserId: learner.user.id,
        customerId: customer.id,
        groupId: group.id,
        assignedBy: center.user.id,
        dueAt: new Date(Date.now() + 5 * 86400000),
      },
    });
    await db.lmsGroupMember.create({
      data: {
        tenantId: center.tenant.id,
        groupId: group.id,
        enrollmentId: e.id,
      },
    });
    const event = await db.lmsTeachingEvent.create({
      data: {
        tenantId: center.tenant.id,
        courseVersionId: created.version.id,
        groupId: group.id,
        titleRu: "Сохранённое занятие",
        titleKz: "Сақталған сабақ",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600000),
        timezone: center.tenant.timezone,
        teacherUserId: center.user.id,
        createdBy: center.user.id,
        operationId: randomUUID(),
      },
    });
    await transaction((tx) =>
      notifyTeachingEvent(tx, event, "SESSION_CREATED"),
    );
    const legacy = await db.lmsLearningNotification.findFirstOrThrow({
      where: { userId: learner.user.id, eventId: event.id },
    });
    const read = await readLearningNotification(learner.context, legacy.id);
    await transaction((tx) =>
      enqueueEnrollmentNotification(tx, e, "ASSIGNED", {
        key: `ASSIGNMENT:${e.id}`,
      }),
    );
    await transaction((tx) =>
      enqueueEnrollmentNotification(tx, e, "ASSIGNED", {
        key: `ASSIGNMENT:${e.id}`,
      }),
    );
    // A real stale lease is recovered by competing worker instances.
    const pending = await db.lmsNotificationEvent.findFirstOrThrow({
      where: { userId: learner.user.id, enrollmentId: e.id },
    });
    await db.lmsNotificationEvent.update({
      where: { id: pending.id },
      data: {
        state: "RUNNING",
        leaseOwner: "stopped-worker",
        leaseUntil: new Date(0),
        attempts: 1,
      },
    });
    await Promise.all([
      deliverLearningNotification("worker-a"),
      deliverLearningNotification("worker-b"),
    ]);
    while (await deliverLearningNotification()) {
      /* Drain the isolated queue. */
    }
    assert.equal(
      await db.lmsLearningNotification.count({
        where: { userId: learner.user.id, deliveryKey: `ASSIGNMENT:${e.id}` },
      }),
      1,
    );
    assert.equal(
      (
        await db.lmsLearningNotification.findUniqueOrThrow({
          where: { id: legacy.id },
        })
      ).readAt?.toISOString(),
      read.readAt.toISOString(),
    );
    const scanRound = async () => {
      for (let i = 0; i < (await db.tenant.count()) + 1; i++)
        await scanLearningNotifications();
      while (await deliverLearningNotification()) {
        /* bounded fixture */
      }
    };
    await scanRound();
    assert.equal(
      await db.lmsNotificationEvent.count({
        where: { enrollmentId: e.id, kind: "TEST_AVAILABLE" },
      }),
      0,
    );
    await saveLessonProgress(learner.context, e.id, "lesson-1", {
      sequence: 1,
      acknowledge: true,
    });
    await scanRound();
    for (const kind of [
      "REGISTERED",
      "ASSIGNED",
      "STARTED",
      "TEST_AVAILABLE",
      "ACCESS_EXPIRING",
    ])
      assert.equal(
        await db.lmsLearningNotification.count({
          where: { userId: learner.user.id, kind },
        }),
        1,
        kind,
      );
    const first = await listLearningNotifications(learner.context, {
      pageSize: 2,
    });
    assert.equal((first.items as unknown[]).length, 2);
    assert.ok(first.total > 2);
    assert.equal(first.unread, first.total - 1);
    const second = await listLearningNotifications(learner.context, {
      pageSize: 2,
      page: 2,
    });
    assert.ok(
      (first.items as { id: string }[]).every(
        (a) => !(second.items as { id: string }[]).some((b) => a.id === b.id),
      ),
    );
    await readAllLearningNotifications(learner.context);
    assert.equal(
      (await listLearningNotifications(learner.context, {})).unread,
      0,
    );
    await scanRound();
    assert.equal(
      (await listLearningNotifications(learner.context, {})).unread,
      0,
    );
    await assert.rejects(
      () => readLearningNotification(foreign.context, legacy.id),
      (err: unknown) => (err as { getStatus(): number }).getStatus() === 404,
    );
    assert.ok((await listLearningNotifications(employerContext, {})).total > 0);
    await db.employerMembership.update({
      where: { id: membership.id },
      data: { active: false },
    });
    assert.equal(
      (await listLearningNotifications(employerContext, {})).items instanceof
        Array,
      true,
    );
    const employerRows = (await listLearningNotifications(employerContext, {}))
      .items as { sourceType: string }[];
    assert.ok(employerRows.every((n) => n.sourceType === "ACCOUNT"));
    await db.enrollment.update({
      where: { id: e.id },
      data: { status: "CANCELLED" },
    });
    const after = (await listLearningNotifications(learner.context, {}))
      .items as { sourceType: string }[];
    assert.ok(
      after.every((n) => ["ACCOUNT", "SESSION"].includes(n.sourceType)),
    );
  },
);

test(
  "N05: confirmed date reminders, timezone, catch-up, changed date, cancellation and persisted cursor",
  { timeout: 180_000 },
  async (t) => {
    t.after(() => db.$disconnect());
    const center = await lmsTenant("reminder calendar"),
      learner = await lmsLearner(center.tenant.id, "reminder");
    const now = new Date("2030-01-01T20:30:00Z"); // Jan 2 in Kazakhstan, Jan 1 in UTC.
    assert.equal(reminderThreshold("2030-01-09", now, "Asia/Qyzylorda"), 7);
    assert.equal(reminderThreshold("2030-01-09", now, "UTC"), 30);
    assert.equal(reminderThreshold("2030-02-30", now, "UTC"), null);
    assert.equal(reminderThreshold(null, now, "UTC"), null);
    for (const [date, expected] of [
      ["2030-04-02", 90],
      ["2030-03-02", 60],
      ["2030-02-01", 30],
      ["2030-01-09", 7],
      ["2030-01-01", 0],
    ] as const)
      assert.equal(reminderThreshold(date, now, "Asia/Qyzylorda"), expected);
    const request = await db.printRequest.create({
      data: {
        tenantId: center.tenant.id,
        kind: "PERSON",
        draft: json(draftSchema.parse({ kind: "PERSON", title: "Synthetic renewal", demoMode: true, items: [] })),
        createdBy: center.user.id,
        status: "FINALIZED",
      },
    });
    const profile = await db.issuerProfileVersion.create({
      data: { tenantId: center.tenant.id, version: 1, profile: {}, createdBy: center.user.id },
    });
    await db.issuance.create({
      data: { tenantId: center.tenant.id, requestId: request.id, sourceRevision: request.revision, snapshot: {}, inputHash: hash({}), profileVersionId: profile.id, createdBy: center.user.id },
    });
    const row = await db.renewalNeed.create({
      data: {
        tenantId: center.tenant.id,
        recipientId: learner.recipient.id,
        sourceRequestId: request.id,
        sourceRowId: "synthetic-row",
        assignmentId: "synthetic-assignment",
        sourceKey: randomUUID(),
        policySource: "SYNTHETIC",
        policyVersion: "1",
        basisDate: "2029-01-01",
        documentValidUntil: "2030-02-01",
        confirmed: true,
      },
    });
    const unknown = await db.renewalNeed.create({
      data: {
        ...row,
        id: randomUUID(),
        sourceKey: randomUUID(),
        documentValidUntil: null,
        nextCheckDate: null,
      },
    });
    await db.lmsNotificationCheckpoint.create({
      data: {
        tenantId: center.tenant.id,
        activatedAt: new Date("2029-01-01T00:00:00Z"),
      },
    });
    let scanClock = now.getTime();
    const scanRound = async () => {
      for (let i = 0; i < (await db.lmsNotificationCheckpoint.count()) + 1; i++)
        await scanRenewalNotifications(new Date(scanClock++));
      while (await deliverLearningNotification()) {
        /* isolated queue */
      }
    };
    await scanRound();
    await scanRound();
    const delivered = await db.lmsLearningNotification.findMany({
      where: { userId: learner.user.id, sourceType: "RENEWAL" },
    });
    assert.equal(delivered.length, 1);
    assert.ok(delivered[0].deliveryKey?.startsWith("RENEWAL:30:"));
    assert.equal(
      await db.lmsNotificationEvent.count({ where: { sourceId: unknown.id } }),
      0,
    );
    await db.renewalNeed.update({
      where: { id: row.id },
      data: { documentValidUntil: "2030-03-02" },
    });
    await scanRound();
    assert.equal(
      (await listLearningNotifications(learner.context, {})).total,
      1,
    );
    assert.equal(
      await db.lmsLearningNotification.count({
        where: { userId: learner.user.id, sourceType: "RENEWAL" },
      }),
      2,
    ); // Historical fact retained, old date hidden.
    await cancelRequest(center.context, request.id, {
      expectedRevision: request.revision,
      reason: "Synthetic cancelled source",
    });
    const proposal = await db.requestProposal.findFirstOrThrow({
      where: { tenantId: center.tenant.id, requestId: request.id, operation: "CANCEL" },
      orderBy: { revision: "desc" },
    });
    await decideProposal(center.context, proposal.id, {
      decision: "APPROVE",
      reason: "Synthetic director approval",
      expectedProposalHash: proposal.proposalHash,
    });
    assert.equal(
      (await listLearningNotifications(learner.context, {})).total,
      0,
    );
    // More than one page: the next scan must progress beyond the first 100 records.
    await db.renewalNeed.createMany({
      data: Array.from({ length: 103 }, () => ({
        ...row,
        id: randomUUID(),
        sourceKey: randomUUID(),
      })),
    });
    await scanRound();
    await scanRound();
    assert.equal(
      await db.lmsNotificationEvent.count({
        where: {
          tenantId: center.tenant.id,
          userId: learner.user.id,
          sourceType: "RENEWAL",
        },
      }),
      105,
    );
  },
);
