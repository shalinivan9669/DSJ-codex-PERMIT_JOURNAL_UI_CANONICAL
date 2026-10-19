import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { reviewCourseVersion } from "../../apps/api/src/lms/course-review";
import {
  createTeachingEvent,
  listTeachingEvents,
  teachingEventDetail,
  updateTeachingEvent,
  recordTeachingAttendance,
  teachingAttendance,
  safeTeachingUrl,
} from "../../apps/api/src/lms/teaching-events";
import { learningCalendar } from "../../apps/api/src/lms/calendar";
import { listEnrollmentPage } from "../../apps/api/src/lms/enrollment-list";
import {
  listLearningNotifications,
  readLearningNotification,
} from "../../apps/api/src/lms/notifications";
import { lmsTenant, lmsLearner, lmsCourse } from "./lms-fixture";
const status = (expected: number) => (error: unknown) =>
  (error as { getStatus: () => number }).getStatus() === expected;
test(
  "P06/P07 scoped scheduling, retry, attendance history and durable own calendar/notifications",
  { timeout: 120000 },
  async (t) => {
    t.after(() => db.$disconnect());
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    const center = await lmsTenant("full-teaching"),
      foreign = await lmsTenant("full-teaching-foreign");
    const learner = await lmsLearner(center.tenant.id, "own"),
      other = await lmsLearner(center.tenant.id, "other");
    const input = lmsCourse({ kind: "PRACTICE", questions: 1 });
    input.content.modules[0].lessons.push({
      ...input.content.modules[0].lessons[0],
      id: "required-session",
      kind: "SESSION",
      session: { attendanceRequired: true },
    });
    const created = await createCourse(center.context, input);
    const submitted = await reviewCourseVersion(
      center.context,
      created.version.id,
      { revision: created.version.revision, action: "SUBMIT" },
    );
    await reviewCourseVersion(center.context, created.version.id, {
      revision: submitted.revision,
      action: "APPROVE",
    });
    await publishVersion(center.context, created.version.id, {
      revision: submitted.revision,
    });
    const dueAt = new Date(Date.now() + 30 * 86400000);
    const group = await db.lmsGroup.create({
        data: {
          tenantId: center.tenant.id,
          name: "Synthetic own group",
          courseVersionId: created.version.id,
          dueAt,
          createdBy: center.user.id,
        },
      }),
      otherGroup = await db.lmsGroup.create({
        data: {
          tenantId: center.tenant.id,
          name: "Synthetic other group",
          courseVersionId: created.version.id,
          dueAt,
          createdBy: center.user.id,
        },
      });
    const enrollment = await db.enrollment.create({
        data: {
          tenantId: center.tenant.id,
          courseVersionId: created.version.id,
          recipientId: learner.recipient.id,
          learnerUserId: learner.user.id,
          groupId: group.id,
          dueAt,
          assignedBy: center.user.id,
        },
      }),
      otherEnrollment = await db.enrollment.create({
        data: {
          tenantId: center.tenant.id,
          courseVersionId: created.version.id,
          recipientId: other.recipient.id,
          learnerUserId: other.user.id,
          groupId: otherGroup.id,
          dueAt,
          assignedBy: center.user.id,
        },
      });
    await db.lmsGroupMember.createMany({
      data: [
        {
          tenantId: center.tenant.id,
          groupId: group.id,
          enrollmentId: enrollment.id,
        },
        {
          tenantId: center.tenant.id,
          groupId: otherGroup.id,
          enrollmentId: otherEnrollment.id,
        },
      ],
    });
    const teacher = await db.user.create({
        data: {
          tenantId: center.tenant.id,
          email: `${randomUUID()}@example.test`,
          displayName: "Synthetic teacher",
          passwordHash: "fixture-no-login",
          role: "TEACHER",
        },
      }),
      teacherContext: Context = {
        ...center.context,
        userId: teacher.id,
        role: "TEACHER",
      };
    const binding = await db.lmsTeachingBinding.create({
      data: {
        tenantId: center.tenant.id,
        userId: teacher.id,
        role: "TEACHER",
        courseId: created.course.id,
        groupId: group.id,
        permissions: ["READ", "SCHEDULE", "ATTENDANCE"],
        createdBy: center.user.id,
      },
    });
    const body = {
      groupId: group.id,
      requirementId: "required-session",
      titleRu: "Разбор практики",
      titleKz: "Практиканы талдау",
      startsAt: new Date(Date.now() - 7200000).toISOString(),
      endsAt: new Date(Date.now() - 3600000).toISOString(),
      timezone: "Asia/Qyzylorda",
      teacherUserId: teacher.id,
      joinUrl: "https://example.invalid/session",
      operationId: randomUUID(),
    };
    const event = await createTeachingEvent(teacherContext, body);
    assert.equal(
      (await createTeachingEvent(teacherContext, body)).id,
      event.id,
    );
    await assert.rejects(
      createTeachingEvent(teacherContext, { ...body, titleRu: "different" }),
      status(409),
    );
    assert.equal(
      await db.lmsTeachingEvent.count({
        where: { tenantId: center.tenant.id, groupId: group.id },
      }),
      1,
    );
    await assert.rejects(
      createTeachingEvent(teacherContext, {
        ...body,
        operationId: randomUUID(),
      }),
      status(409),
    );
    await assert.rejects(
      createTeachingEvent(teacherContext, {
        ...body,
        operationId: randomUUID(),
        groupId: otherGroup.id,
      }),
      status(403),
    );
    await assert.rejects(
      teachingEventDetail(other.context, event.id),
      status(404),
    );
    await assert.rejects(
      teachingEventDetail(foreign.context, event.id),
      status(404),
    );
    const {
      operationId: _operationId,
      groupId: _groupId,
      requirementId: _requirementId,
      ...fields
    } = body;
    const update = {
      ...fields,
      titleRu: "Уточнённое занятие",
      expectedRevision: 1,
      commandId: randomUUID(),
      reason: "Уточнение названия",
    };
    const revised = await updateTeachingEvent(teacherContext, event.id, update);
    assert.equal(revised.revision, 2);
    await updateTeachingEvent(teacherContext, event.id, update);
    const notifications = await listLearningNotifications(learner.context, {});
    assert.equal(notifications.total, 2);
    assert.equal((await listLearningNotifications(other.context, {})).total, 0);
    const note = (notifications.items as { id: string }[])[0];
    await readLearningNotification(learner.context, note.id);
    assert.ok((await listLearningNotifications(learner.context, {})).items);
    await assert.rejects(
      readLearningNotification(other.context, note.id),
      status(404),
    );
    const attendance = {
      commandId: randomUUID(),
      expectedRevision: 2,
      reason: "Ручная проверка присутствия",
      items: [
        { enrollmentId: enrollment.id, status: "PRESENT", expectedRevision: 0 },
      ],
    };
    assert.equal(
      (await listEnrollmentPage(center.context, { groupId: group.id })).items[0]
        .progressPercent,
      0,
    );
    await recordTeachingAttendance(teacherContext, event.id, attendance);
    assert.equal(
      (await listEnrollmentPage(center.context, { groupId: group.id })).items[0]
        .progressPercent,
      50,
      "confirmed SESSION contributes to mixed-element list progress",
    );
    await recordTeachingAttendance(teacherContext, event.id, attendance);
    assert.equal(
      await db.lmsAttendance.count({
        where: { tenantId: center.tenant.id, eventId: event.id },
      }),
      1,
    );
    await assert.rejects(
      recordTeachingAttendance(teacherContext, event.id, {
        ...attendance,
        commandId: randomUUID(),
        items: [
          {
            enrollmentId: otherEnrollment.id,
            status: "PRESENT",
            expectedRevision: 0,
          },
        ],
      }),
      status(404),
    );
    await assert.rejects(
      teachingAttendance(learner.context, event.id, {}),
      status(403),
    );
    const correction = {
      ...attendance,
      commandId: randomUUID(),
      reason: "Исправление по журналу",
      items: [
        { enrollmentId: enrollment.id, status: "ABSENT", expectedRevision: 1 },
      ],
    };
    await recordTeachingAttendance(teacherContext, event.id, correction);
    assert.equal(
      (await listEnrollmentPage(center.context, { groupId: group.id })).items[0]
        .progressPercent,
      0,
      "attendance correction immediately removes SESSION credit",
    );
    await recordTeachingAttendance(teacherContext, event.id, correction);
    const roster = await teachingAttendance(teacherContext, event.id, {});
    assert.equal(roster.total, 1);
    assert.deepEqual(
      roster.items[0].history.map((row) => row.status),
      ["ABSENT", "PRESENT"],
    );
    await assert.rejects(
      recordTeachingAttendance(teacherContext, event.id, {
        ...attendance,
        commandId: randomUUID(),
      }),
      status(409),
    );
    await assert.rejects(
      updateTeachingEvent(teacherContext, event.id, {
        ...update,
        commandId: randomUUID(),
        expectedRevision: 2,
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
      }),
      status(409),
    );
    const range = {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
      pageSize: 1,
    };
    const calendar = await learningCalendar(learner.context, range);
    assert.equal(calendar.total, 1);
    assert.equal((calendar.items as { kind: string }[])[0].kind, "SESSION");
    assert.equal((await learningCalendar(other.context, range)).total, 0);
    const cancel = {
      expectedRevision: 2,
      commandId: randomUUID(),
      reason: "Перенос в другую группу отдельным назначением",
    };
    await updateTeachingEvent(teacherContext, event.id, cancel, true);
    await updateTeachingEvent(teacherContext, event.id, cancel, true);
    assert.equal(
      await db.lmsTeachingEventChange.count({
        where: { tenantId: center.tenant.id, eventId: event.id },
      }),
      3,
    );
    await assert.rejects(
      recordTeachingAttendance(teacherContext, event.id, {
        ...correction,
        commandId: randomUUID(),
        expectedRevision: 3,
      }),
      status(409),
    );
    const future = await createTeachingEvent(teacherContext, {
      ...body,
      operationId: randomUUID(),
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
    });
    await db.lmsGroupMember.update({
      where: {
        tenantId_groupId_enrollmentId: {
          tenantId: center.tenant.id,
          groupId: group.id,
          enrollmentId: enrollment.id,
        },
      },
      data: { excludedAt: new Date(), excludedBy: center.user.id },
    });
    assert.equal((await listTeachingEvents(learner.context, {})).total, 1);
    assert.equal(
      (await teachingEventDetail(learner.context, event.id)).event.id,
      event.id,
    );
    await assert.rejects(
      teachingEventDetail(learner.context, future.id),
      status(404),
    );
    await db.lmsTeachingBinding.update({
      where: { id: binding.id },
      data: { revokedAt: new Date(), revokedBy: center.user.id },
    });
    assert.equal((await listTeachingEvents(teacherContext, {})).total, 0);
    await assert.rejects(
      updateTeachingEvent(
        teacherContext,
        future.id,
        { ...cancel, commandId: randomUUID(), expectedRevision: 1 },
        true,
      ),
      status(404),
    );
    assert.equal(safeTeachingUrl("javascript:alert(1)"), false);
    assert.equal(
      safeTeachingUrl("https://name:password@example.invalid/"),
      false,
    );
  },
);
