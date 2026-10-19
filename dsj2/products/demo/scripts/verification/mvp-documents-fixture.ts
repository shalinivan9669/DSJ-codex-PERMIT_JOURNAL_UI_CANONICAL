/** Isolated synthetic prerequisites and real renderer for the J09 browser check. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { provision } from "../setup";
import { db, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { advanceLmsDocuments } from "../../apps/api/src/lms/document-bridge";
import { signingState } from "../../apps/api/src/signing";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { store } from "../../apps/api/src/files";
import {
  lmsCourse,
  lmsLearner,
  LMS_PASSWORD,
} from "../../tests/integration/lms-fixture";

async function main() {
  const target = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55489");
  assert.equal(target.pathname, "/demo_test_mvp_roles_20261019_run01_browser");
  const file = resolve(
    ".runtime/mvp-all-roles-20261019/run-01/document-ui-fixture.json",
  );
  const renderAt = process.argv.indexOf("--render");
  try {
    if (renderAt >= 0) {
      const fixture = JSON.parse(await readFile(file, "utf8"));
      const requestId = process.argv[renderAt + 1];
      await db.printRequest.findFirstOrThrow({
        where: { id: requestId, tenantId: fixture.tenantId },
      });
      const c: Context = {
        tenantId: fixture.tenantId,
        userId: fixture.director.id,
        role: "DIRECTOR",
        sessionId: "synthetic",
        csrfHash: "synthetic",
        correlationId: randomUUID(),
      };
      await advanceLmsDocuments(100, c.tenantId);
      const owner = `document-browser-${randomUUID()}`;
      for (let index = 0; index < 60; index++) {
        if (
          !(await db.generationJob.count({
            where: {
              tenantId: c.tenantId,
              requestId,
              status: { not: "SUCCEEDED" },
            },
          }))
        )
          break;
        const job = await claimJob(db, owner, c.tenantId);
        if (!job) {
          await new Promise((done) => setTimeout(done, 500));
          continue;
        }
        const timer = setInterval(() => {
          void heartbeat(db, job, owner);
        }, 5000);
        try {
          await executeJob(db, store, job, owner, AbortSignal.timeout(210000));
        } catch (error) {
          await settleFailure(db, job, owner, error);
          if (!(error instanceof DeferredJob)) throw error;
        } finally {
          clearInterval(timer);
        }
      }
      assert.equal((await signingState(c, requestId)).status, "ISSUED");
      await advanceLmsDocuments(100, c.tenantId);
      console.log(
        JSON.stringify({ synthetic: true, rendered: true, requestId }),
      );
    } else {
      const email = `document-ui-${randomUUID()}@example.test`;
      const center = await provision({
        email,
        password: LMS_PASSWORD,
        name: "Синтетическая проверка исправления документа",
        sample: true,
      });
      const c: Context = {
        tenantId: center.tenantId,
        userId: center.userId,
        role: "DIRECTOR",
        sessionId: "synthetic",
        csrfHash: "synthetic",
        correlationId: randomUUID(),
      };
      const operator = await db.user.create({
        data: {
          tenantId: c.tenantId,
          email: `document-operator-${randomUUID()}@example.test`,
          displayName: "Синтетический оператор документов",
          role: "OPERATOR",
          passwordHash: await passwordHash(LMS_PASSWORD),
        },
      });
      const learner = await lmsLearner(c.tenantId, "Исправление документа");
      const definition = lmsCourse();
      definition.profile.documentTypes = [
        "PROTOCOL",
        "CERTIFICATE",
        "CREDENTIAL",
      ];
      definition.profile.commission = [
        { name: "Синтетический экзаменатор", role: "Председатель" },
      ];
      const course = await createCourse(c, definition);
      await publishVersion(c, course.version.id, { revision: 0 });
      const enrollment = (
        await assignEnrollments(c, {
          courseVersionId: course.version.id,
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
          attempt.questions.map((question) => [question.id, ["a"]]),
        ),
      });
      const finished = await submitAttempt(learner.context, attempt.id);
      const fixture = {
        synthetic: true,
        tenantId: c.tenantId,
        enrollmentId: enrollment.id,
        resultId: finished.result!.id,
        fullName: (learner.recipient.data as { fullNameRu: string }).fullNameRu,
        director: { id: c.userId, email, password: LMS_PASSWORD },
        operator: {
          id: operator.id,
          email: operator.email,
          password: LMS_PASSWORD,
        },
        learner: {
          id: learner.user.id,
          email: learner.user.email,
          password: LMS_PASSWORD,
        },
      };
      await writeFile(file, JSON.stringify(fixture, null, 2));
      console.log(
        JSON.stringify({ synthetic: true, tenantId: c.tenantId, ready: true }),
      );
    }
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
