import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import {
  createCourse,
  publishVersion,
  updateVersion,
} from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { lmsStore, openPrivateStream } from "../../apps/api/src/lms/materials";
import { createLearnerRecovery } from "../../apps/api/src/lms/identity";
import { lmsCourse, lmsTenant, lmsLearner, lmsSession } from "./lms-fixture";
import { syntheticPdf } from "../fixtures/pdf";

test("L05: traversal, public storage paths and a valid token for another purpose never authorize a private PDF", async () => {
  const center = await lmsTenant("material token boundaries");
  const learner = await lmsLearner(center.tenant.id, "assigned");
  const stranger = await lmsLearner(center.tenant.id, "unassigned");
  const definition = lmsCourse({ required: false });
  const course = await createCourse(center.context, definition);
  const bytes = syntheticPdf("Synthetic protected PDF boundary");
  const stored = await lmsStore.put(bytes, "pdf");
  const material = await db.lmsMaterial.create({
    data: {
      tenantId: center.tenant.id,
      courseId: course.course.id,
      ...stored,
      mimeType: "application/pdf",
      originalName: "synthetic.pdf",
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
  await publishVersion(center.context, course.version.id, { revision: 1 });
  await assignEnrollments(center.context, {
    courseVersionId: course.version.id,
    recipientIds: [learner.recipient.id],
  });
  const recovery = await createLearnerRecovery(center.context, {
    userId: learner.user.id,
  });
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.DEMO_ORIGIN = "http://127.0.0.1:31994";
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const assigned = await lmsSession(base, learner.user.email);
    const unassigned = await lmsSession(base, stranger.user.email);
    const allowed = await fetch(`${base}/lms/materials/${material.id}`, {
      headers: assigned,
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), bytes);
    const wrongPurpose = await fetch(
      `${base}/lms/materials/${material.id}?token=${recovery.token}`,
      {
        headers: {
          cookie: `demo_session=${recovery.token}`,
          authorization: `Bearer ${recovery.token}`,
          range: "bytes=0-9",
        },
      },
    );
    assert.equal(wrongPurpose.status, 401);
    const unassignedWithToken = await fetch(
      `${base}/lms/materials/${material.id}?token=${recovery.token}`,
      { headers: { ...unassigned, range: "bytes=0-9" } },
    );
    assert.equal(unassignedWithToken.status, 404);
    for (const route of [
      `/lms/materials/%2e%2e%2f%2e%2e%2f.env`,
      `/lms/materials/%252e%252e%252f${material.id}`,
      `/storage/${stored.storageKey}`,
      `/${stored.storageKey}`,
    ]) {
      const response = await fetch(base + route, { headers: assigned });
      assert.equal(response.status, 404, route);
      assert.equal(
        Buffer.from(await response.arrayBuffer()).equals(bytes),
        false,
      );
    }
    await assert.rejects(
      openPrivateStream({
        storageKey: "../../package.json",
        sha256: stored.sha256,
      }),
      (error: any) => error.getStatus() === 503,
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
