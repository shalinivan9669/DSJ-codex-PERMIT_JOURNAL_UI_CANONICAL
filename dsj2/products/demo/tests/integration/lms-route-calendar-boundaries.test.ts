import assert from "node:assert/strict";
import test from "node:test";
import { db, hash } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import {
  createCourse,
  publishVersion,
  updateVersion,
} from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { reviewExternalEvidence } from "../../apps/api/src/lms/external";
import { lmsStore } from "../../apps/api/src/lms/materials";
import { assertEligibleResult } from "../../apps/api/src/lms/result-finalization";
import {
  createCalendar,
  sanitaryBatch,
} from "../../apps/api/src/regulatory-results/controller";
import { prepareClaimedEvent } from "../../apps/api/src/regulatory-results/preparation";
import {
  lmsCourse,
  lmsTenant,
  lmsLearner,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";
import { syntheticPdf } from "../fixtures/pdf";

test("E02/E04/E09/S03: route requirements, private projections and frozen late deadlines", async (t) => {
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.DEMO_ORIGIN = "http://127.0.0.1:31995";
  const center = await lmsTenant("route and calendar boundaries");
  const learner = await lmsLearner(center.tenant.id, "route and calendar");
  const app = await bootstrap();
  const base = await app.getUrl();
  const staff = lmsHttp(base, await lmsSession(base, center.user.email));
  const studentHeaders = await lmsSession(base, learner.user.email);
  const student = lmsHttp(base, studentHeaders);
  const enroll = async (versionId: string) =>
    (
      await assignEnrollments(center.context, {
        courseVersionId: versionId,
        recipientIds: [learner.recipient.id],
      })
    ).items[0];
  const externalSource = async (enrollmentId: string, issuer: string) => {
    const stored = await lmsStore.put(
      syntheticPdf("Synthetic retained external assessment source"),
      "pdf",
    );
    return db.lmsExternalEvidence.create({
      data: {
        tenantId: center.tenant.id,
        enrollmentId,
        issuer,
        sourceSystem: "SYNTHETIC SOURCE",
        documentNumber: `SYNTHETIC-${enrollmentId}`,
        documentDate: "2026-10-03",
        examAt: new Date("2026-10-02T07:00:00Z"),
        storageKey: stored.storageKey,
        sha256: stored.sha256,
        mimeType: "application/pdf",
        originalName: "synthetic-source.pdf",
        createdBy: center.user.id,
      },
    });
  };
  try {
    for (const requirement of [
      "requiresPractice",
      "requiresProctoring",
    ] as const) {
      await t.test(
        `E02/E09: ${requirement} denies real HTTP exam start and external official eligibility`,
        async () => {
          const definition = lmsCourse({ required: false, sanitary: true });
          definition.profile[requirement] = true;
          const course = await createCourse(center.context, definition);
          await publishVersion(center.context, course.version.id, {
            revision: 0,
          });
          const enrollment = await enroll(course.version.id);
          const denied = await lmsJson(
            await student(
              `/learn/enrollments/${enrollment.id}/attempts`,
              "POST",
              {},
            ),
            409,
          );
          assert.equal(denied.code, "ASSESSMENT_REQUIREMENT");
          assert.equal(
            await db.examAttempt.count({
              where: { enrollmentId: enrollment.id },
            }),
            0,
          );

          const external = lmsCourse({
            kind: "EXTERNAL_AUTHORIZED",
            required: false,
            sanitary: true,
          });
          external.profile[requirement] = true;
          external.profile.externalEvidenceLevel = "DOCUMENT_REVIEWED";
          const outsideCourse = await createCourse(center.context, external);
          await publishVersion(center.context, outsideCourse.version.id, {
            revision: 0,
          });
          const outsideEnrollment = await enroll(outsideCourse.version.id);
          const evidence = await externalSource(
            outsideEnrollment.id,
            external.profile.issuer,
          );
          await lmsJson(
            await staff(
              `/lms/external-evidence/${evidence.id}/review`,
              "POST",
              {
                status: "DOCUMENT_REVIEWED",
                reviewMethod: "Synthetic source independently reviewed",
                verdict: "PASSED",
              },
            ),
            201,
          );
          const result = await db.verifiedExamResult.findFirstOrThrow({
            where: { externalEvidenceId: evidence.id },
          });
          assert.equal(result.verdict, "PASSED");
          assert.equal(result.eligible, false);
          await assert.rejects(
            assertEligibleResult(db, center.context, result.id),
            (error: any) => error.getStatus() === 409,
          );
          assert.equal(
            await db.regulatoryOutbox.count({ where: { resultId: result.id } }),
            0,
          );
          assert.equal(
            await db.lmsDocumentLink.count({ where: { resultId: result.id } }),
            0,
          );
        },
      );
    }
    await t.test(
      "E09: missing required commission blocks publication and cannot become an official result even after a malformed stored publication",
      async () => {
        const definition = lmsCourse({ required: false, sanitary: true });
        definition.profile.commissionKind = "CENTER";
        definition.profile.commission = [];
        const course = await createCourse(center.context, definition);
        const denied = await lmsJson(
          await staff(
            `/lms/course-versions/${course.version.id}/publish`,
            "POST",
            { revision: 0 },
          ),
          400,
        );
        assert.equal(denied.code, "COMMISSION_REQUIRED");
        assert.equal(
          (
            await db.courseVersion.findUniqueOrThrow({
              where: { id: course.version.id },
            })
          ).status,
          "DRAFT",
        );
        // Corrupt-import fixture only: bypass the rejected publication in this
        // unique synthetic tenant to verify the independent result gate.
        await db.courseVersion.update({
          where: { id: course.version.id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
        const enrollment = await enroll(course.version.id);
        const attempt = await lmsJson(
          await student(
            `/learn/enrollments/${enrollment.id}/attempts`,
            "POST",
            {},
          ),
          201,
        );
        await lmsJson(
          await student(`/learn/attempts/${attempt.id}/answers`, "PUT", {
            sequence: 1,
            answers: Object.fromEntries(
              attempt.questions.map((q: { id: string }) => [q.id, ["a"]]),
            ),
          }),
        );
        const finished = await lmsJson(
          await student(`/learn/attempts/${attempt.id}/submit`, "POST", {}),
          201,
        );
        assert.equal(finished.result.verdict, "PASSED");
        assert.equal(finished.result.eligible, false);
        await assert.rejects(
          assertEligibleResult(db, center.context, finished.result.id),
          (error: any) => error.getStatus() === 409,
        );
        assert.equal(
          await db.regulatoryOutbox.count({
            where: { resultId: finished.result.id },
          }),
          0,
        );
      },
    );
    await t.test(
      "E04: every learner course, enrollment, attempt, autosave and material response omits grading keys before and after completion when disclosure is disabled",
      async () => {
        const definition = lmsCourse({ required: false });
        definition.content.exam.revealAnswers = false;
        const course = await createCourse(center.context, definition);
        const bytes = syntheticPdf(
          "Synthetic learner lesson; no question bank embedded",
        );
        const stored = await lmsStore.put(bytes, "pdf");
        const material = await db.lmsMaterial.create({
          data: {
            tenantId: center.tenant.id,
            courseId: course.course.id,
            ...stored,
            mimeType: "application/pdf",
            originalName: "synthetic-lesson.pdf",
            createdBy: center.user.id,
          },
        });
        definition.content.modules[0].lessons[0] = {
          ...definition.content.modules[0].lessons[0],
          kind: "PDF",
          materialId: material.id,
        };
        await updateVersion(center.context, course.version.id, {
          revision: 0,
          ...definition,
        });
        await publishVersion(center.context, course.version.id, {
          revision: 1,
        });
        const enrollment = await enroll(course.version.id);
        const safe = (value: unknown) => {
          assert.doesNotMatch(
            JSON.stringify(value),
            /"(?:correctOptionIds|correctAnswers|answerKey|examSnapshot)"/,
          );
          return value as any;
        };
        const scan = async () => {
          for (const route of [
            "/lms/courses",
            `/lms/courses/${course.course.id}`,
            "/learn/enrollments",
            `/learn/enrollments/${enrollment.id}`,
          ]) {
            safe(await lmsJson(await student(route)));
          }
          for (const route of [
            "/lms/enrollments",
            `/lms/enrollments/${enrollment.id}`,
            "/lms/assignment-context",
          ]) {
            safe(await lmsJson(await student(route), 403));
          }
          const full = await student(`/lms/materials/${material.id}`);
          assert.equal(full.status, 200);
          assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
          const partial = await fetch(base + `/lms/materials/${material.id}`, {
            headers: { ...studentHeaders, range: "bytes=0-19" },
          });
          assert.equal(partial.status, 206);
          assert.deepEqual(
            Buffer.from(await partial.arrayBuffer()),
            bytes.subarray(0, 20),
          );
        };
        await scan();
        safe(
          await lmsJson(
            await student(
              `/learn/enrollments/${enrollment.id}/lessons/lesson-1/progress`,
              "POST",
              { sequence: 1, acknowledge: true },
            ),
            201,
          ),
        );
        const attempt = safe(
          await lmsJson(
            await student(
              `/learn/enrollments/${enrollment.id}/attempts`,
              "POST",
              {},
            ),
            201,
          ),
        );
        assert.ok(
          (
            await db.examAttempt.findUniqueOrThrow({
              where: { id: attempt.id },
            })
          ).snapshot,
        );
        safe(await lmsJson(await student(`/learn/attempts/${attempt.id}`)));
        safe(
          await lmsJson(
            await student(`/learn/attempts/${attempt.id}/answers`, "PUT", {
              sequence: 1,
              answers: Object.fromEntries(
                attempt.questions.map((q: { id: string }) => [q.id, ["a"]]),
              ),
            }),
          ),
        );
        const finished = safe(
          await lmsJson(
            await student(`/learn/attempts/${attempt.id}/submit`, "POST", {}),
            201,
          ),
        );
        assert.equal(finished.state, "FINISHED");
        assert.equal(finished.result.verdict, "PASSED");
        safe(await lmsJson(await student(`/learn/attempts/${attempt.id}`)));
        safe(
          await lmsJson(
            await student(`/learn/attempts/${attempt.id}/submit`, "POST", {}),
            201,
          ),
        );
        await scan();
      },
    );
    await t.test(
      "S03: late external confirmation keeps the original exam-day deadline and a new calendar version cannot rewrite the sealed batch",
      async () => {
        const firstCalendar = await createCalendar(center.context, {
          name: "Synthetic late-confirmation calendar",
          timezone: "Asia/Qyzylorda",
          coverageFrom: "2026-01-01",
          coverageUntil: "2026-12-31",
          definition: {
            weekendDays: [0, 6],
            nonWorkingDates: [],
            workingDates: [],
            sources: ["SYNTHETIC ENGINEERING CALENDAR"],
            synthetic: true,
          },
        });
        const definition = lmsCourse({
          kind: "EXTERNAL_AUTHORIZED",
          sanitary: true,
          required: false,
        });
        definition.profile.externalEvidenceLevel = "DOCUMENT_REVIEWED";
        definition.profile.calendarVersionId = firstCalendar.id;
        definition.profile.cutoff = "18:00";
        const course = await createCourse(center.context, definition);
        await publishVersion(center.context, course.version.id, {
          revision: 0,
        });
        const enrollment = await enroll(course.version.id);
        const evidence = await externalSource(
          enrollment.id,
          definition.profile.issuer,
        );
        await reviewExternalEvidence(center.context, evidence.id, {
          status: "DOCUMENT_REVIEWED",
          reviewMethod: "Late synthetic confirmation on actual review date",
          verdict: "PASSED",
        });
        const result = await db.verifiedExamResult.findFirstOrThrow({
          where: { externalEvidenceId: evidence.id },
        });
        assert.equal(result.examAt!.toISOString(), "2026-10-02T07:00:00.000Z");
        assert.ok(result.confirmedAt > new Date("2026-10-05T13:00:00Z"));
        const event = await db.regulatoryOutbox.findFirstOrThrow({
          where: { resultId: result.id },
        });
        const now = new Date();
        await db.regulatoryOutbox.update({
          where: { id: event.id },
          data: {
            status: "PROCESSING",
            leaseToken: 1,
            lockedUntil: new Date(now.getTime() + 60_000),
          },
        });
        const prepared = await prepareClaimedEvent(event.id, 1, now);
        const batch = await sanitaryBatch(center.context, prepared.batchId!);
        assert.equal(batch.dueDate, "2026-10-05");
        assert.equal(batch.dueAt!.toISOString(), "2026-10-05T13:00:00.000Z");
        assert.equal(batch.calendarVersionId, firstCalendar.id);
        assert.equal(batch.overdue, true);
        assert.equal((batch.items[0].snapshot as any).examDate, "2026-10-02");
        const frozen = hash({
          batch: batch.snapshot,
          dueAt: batch.dueAt,
          dueDate: batch.dueDate,
          item: batch.items[0].snapshot,
        });
        const nextCalendar = await createCalendar(center.context, {
          name: firstCalendar.name,
          timezone: firstCalendar.timezone,
          coverageFrom: firstCalendar.coverageFrom,
          coverageUntil: firstCalendar.coverageUntil,
          definition: {
            weekendDays: [0, 6],
            nonWorkingDates: ["2026-10-05"],
            workingDates: [],
            sources: ["SYNTHETIC NEW CALENDAR REVISION"],
            synthetic: true,
          },
        });
        assert.equal(nextCalendar.version, firstCalendar.version + 1);
        assert.notEqual(nextCalendar.id, firstCalendar.id);
        await db.regulatoryOutbox.update({
          where: { id: event.id },
          data: {
            status: "PROCESSING",
            leaseToken: 2,
            lockedUntil: new Date(Date.now() + 60_000),
          },
        });
        const replay = await prepareClaimedEvent(event.id, 2);
        assert.equal(replay.batchId, batch.id);
        const after = await sanitaryBatch(center.context, batch.id);
        assert.equal(
          hash({
            batch: after.snapshot,
            dueAt: after.dueAt,
            dueDate: after.dueDate,
            item: after.items[0].snapshot,
          }),
          frozen,
        );
        assert.equal(after.snapshotHash, batch.snapshotHash);
        assert.equal(after.calendarVersionId, firstCalendar.id);
        assert.equal(
          await db.regulatoryBatchItem.count({
            where: { resultId: result.id },
          }),
          1,
        );
        assert.deepEqual(
          (
            await db.calendarVersion.findUniqueOrThrow({
              where: { id: firstCalendar.id },
            })
          ).definition,
          firstCalendar.definition,
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
