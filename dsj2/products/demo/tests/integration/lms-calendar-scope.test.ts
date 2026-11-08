import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "../../packages/contracts/src";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { learningCalendar } from "../../apps/api/src/lms/calendar";
import { createTeachingEvent } from "../../apps/api/src/lms/teaching-events";
import {
  listLearningNotifications,
  readLearningNotification,
} from "../../apps/api/src/lms/notifications";
import { lmsCourse, lmsLearner, lmsTenant } from "./lms-fixture";

const entries = z.array(
  z.object({ id: z.string(), kind: z.string(), startsAt: z.date() }),
);
const notifications = z.array(
  z.object({
    id: z.string(),
    sourceType: z.string(),
    eventId: z.string().nullable(),
    href: z.string().nullable(),
  }),
);

test("teacher calendar uses half-open periods, scoped counts and current bindings; mixed notifications retain their distinct destinations", async () => {
  const center = await lmsTenant("teacher-calendar-boundaries");
  const foreign = await lmsTenant("teacher-calendar-foreign");
  const from = new Date("2030-01-01T19:00:00.000Z"),
    to = new Date("2030-02-01T19:00:00.000Z");
  const query = {
    from: from.toISOString(),
    to: to.toISOString(),
    pageSize: 250,
  };
  async function teacher(): Promise<Context> {
    const user = await db.user.create({
      data: {
        tenantId: center.tenant.id,
        role: "TEACHER",
        email: `${randomUUID()}@example.test`,
        displayName: "Synthetic teacher",
        passwordHash: "fixture-no-login",
      },
    });
    return { ...center.context, userId: user.id, role: user.role };
  }
  try {
    const actor = await teacher(),
      outsider = await teacher();
    assert.equal((await learningCalendar(actor, query)).total, 0);
    const input = lmsCourse({ kind: "PRACTICE", questions: 1 });
    input.content.exam.dueAt = from.toISOString();
    const course = await createCourse(center.context, input);
    const published = await publishVersion(center.context, course.version.id, {
      revision: 0,
    });
    const group = await db.lmsGroup.create({
      data: {
        tenantId: center.tenant.id,
        name: "Synthetic own group",
        courseVersionId: published.id,
        createdBy: center.user.id,
      },
    });
    const otherGroup = await db.lmsGroup.create({
      data: {
        tenantId: center.tenant.id,
        name: "Synthetic other group",
        courseVersionId: published.id,
        createdBy: center.user.id,
      },
    });
    const binding = await db.lmsTeachingBinding.create({
      data: {
        tenantId: center.tenant.id,
        userId: actor.userId,
        role: "TEACHER",
        courseId: course.course.id,
        groupId: group.id,
        permissions: ["READ", "REVIEW", "SCHEDULE", "ATTENDANCE"],
        createdBy: center.user.id,
      },
    });
    const learner = await lmsLearner(center.tenant.id, "calendar");
    const enrollment = await db.enrollment.create({
      data: {
        tenantId: center.tenant.id,
        courseVersionId: published.id,
        recipientId: learner.recipient.id,
        learnerUserId: learner.user.id,
        groupId: group.id,
        startsAt: from,
        dueAt: to,
        assignedBy: center.user.id,
      },
    });
    await db.lmsGroupMember.create({
      data: {
        tenantId: center.tenant.id,
        groupId: group.id,
        enrollmentId: enrollment.id,
      },
    });
    async function event(
      name: string,
      startsAt: Date,
      endsAt: Date,
      groupId = group.id,
      context = actor,
      teacherUserId = actor.userId,
    ) {
      return createTeachingEvent(context, {
        groupId,
        titleRu: name,
        titleKz: name,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timezone: "Asia/Qyzylorda",
        teacherUserId,
        operationId: randomUUID(),
      });
    }
    const before = await event(
      "Ends exactly at range start",
      new Date(from.getTime() - 3600000),
      from,
    );
    const crossingStart = await event(
      "Crosses range start",
      new Date(from.getTime() - 1800000),
      new Date(from.getTime() + 1800000),
    );
    const starting = await event(
      "Starts exactly at range start",
      from,
      new Date(from.getTime() + 3600000),
    );
    const crossingEnd = await event(
      "Crosses range end",
      new Date(to.getTime() - 1800000),
      new Date(to.getTime() + 1800000),
    );
    const after = await event(
      "Starts exactly at range end",
      to,
      new Date(to.getTime() + 3600000),
    );
    const otherEvent = await event(
      "Other group event",
      from,
      new Date(from.getTime() + 3600000),
      otherGroup.id,
      center.context,
      center.user.id,
    );
    const foreignCourse = await createCourse(
      foreign.context,
      lmsCourse({ kind: "PRACTICE", questions: 1 }),
    );
    const foreignVersion = await publishVersion(
      foreign.context,
      foreignCourse.version.id,
      { revision: 0 },
    );
    const foreignGroup = await db.lmsGroup.create({
      data: {
        tenantId: foreign.tenant.id,
        name: "Synthetic foreign group",
        courseVersionId: foreignVersion.id,
        createdBy: foreign.user.id,
      },
    });
    const foreignEvent = await event(
      "Foreign event",
      from,
      new Date(from.getTime() + 3600000),
      foreignGroup.id,
      foreign.context,
      foreign.user.id,
    );
    const calendar = await learningCalendar(actor, query);
    const listed = entries.parse(calendar.items);
    assert.equal(
      listed.some((item) => item.id === `event:${before.id}`),
      false,
      "A positive-duration session ending at from has no overlap with [from,to)",
    );
    assert.equal(
      listed.some((item) => item.id === `event:${after.id}`),
      false,
    );
    assert.deepEqual(
      new Set(listed.map((item) => item.id)),
      new Set([
        `event:${crossingStart.id}`,
        `event:${starting.id}`,
        `event:${crossingEnd.id}`,
        `start:${enrollment.id}`,
        `exam:${enrollment.id}`,
      ]),
    );
    assert.equal(calendar.total, 5);
    const page = await learningCalendar(actor, {
      ...query,
      page: 2,
      pageSize: 2,
    });
    assert.equal(page.total, 5);
    assert.deepEqual(
      entries.parse(page.items).map((item) => item.id),
      listed.slice(2, 4).map((item) => item.id),
    );
    assert.equal((await learningCalendar(outsider, query)).total, 0);
    assert.equal((await learningCalendar(learner.context, query)).total, 5);
    assert.ok(
      entries
        .parse((await learningCalendar(center.context, query)).items)
        .some((item) => item.id === `event:${otherEvent.id}`),
    );
    assert.deepEqual(
      entries
        .parse((await learningCalendar(foreign.context, query)).items)
        .map((item) => item.id),
      [`event:${foreignEvent.id}`],
    );
    for (const range of [
      { ...query, to: query.from },
      { ...query, to: new Date(from.getTime() + 367 * 86400000).toISOString() },
    ]) {
      await assert.rejects(
        learningCalendar(actor, range),
        (error: unknown) =>
          !!error &&
          typeof error === "object" &&
          "getResponse" in error &&
          typeof error.getResponse === "function" &&
          error.getResponse().code === "CALENDAR_RANGE",
      );
    }
    // Stored inbox fixture: delivery itself is covered separately; do not claim other tenants' outbox jobs.
    const submission = await db.lmsSubmission.create({
      data: {
        tenantId: center.tenant.id,
        enrollmentId: enrollment.id,
        elementId: "synthetic-review",
        currentRevision: 1,
        state: "SUBMITTED",
      },
    });
    const href = `/lms/teaching?type=SUBMISSION&reviewId=${submission.id}`;
    const review = await db.lmsLearningNotification.create({
      data: {
        tenantId: center.tenant.id,
        userId: actor.userId,
        sourceType: "REVIEW_SUBMISSION",
        sourceId: submission.id,
        enrollmentId: enrollment.id,
        kind: "REVIEW_REQUESTED",
        titleRu: "Synthetic submitted work",
        titleKz: "Синтетикалық тапсырма",
        href,
      },
    });
    const inbox = notifications.parse(
      (await listLearningNotifications(actor, {})).items,
    );
    assert.deepEqual(
      inbox.find((item) => item.id === review.id),
      { id: review.id, sourceType: "REVIEW_SUBMISSION", eventId: null, href },
    );
    assert.ok(
      inbox.some(
        (item) => item.sourceType === "SESSION" && item.eventId === starting.id,
      ),
    );
    assert.equal((await listLearningNotifications(outsider, {})).total, 0);
    assert.equal(
      (await listLearningNotifications(foreign.context, {})).items.some(
        (item) => item.id === review.id,
      ),
      false,
    );
    const read = await readLearningNotification(actor, review.id);
    assert.ok(read.readAt instanceof Date);
    assert.deepEqual(await readLearningNotification(actor, review.id), read);
    await db.lmsTeachingBinding.update({
      where: { id: binding.id },
      data: { revokedAt: new Date(), revokedBy: center.user.id },
    });
    assert.equal((await learningCalendar(actor, query)).total, 0);
    assert.equal((await listLearningNotifications(actor, {})).total, 0);
    await assert.rejects(
      readLearningNotification(actor, review.id),
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "getStatus" in error &&
        typeof error.getStatus === "function" &&
        error.getStatus() === 404,
    );
  } finally {
    await db.$disconnect();
  }
});
