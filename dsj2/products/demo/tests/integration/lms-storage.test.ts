import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "../../apps/api/src/core";
import { ArtifactStore } from "../../packages/printing/src";
import { collectOrphanObjects } from "../../scripts/maintenance/gc";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { prepareClaimedEvent } from "../../apps/api/src/regulatory-results/preparation";
import { lmsCourse, lmsTenant, lmsLearner } from "./lms-fixture";

test("GC retains old template and every new LMS material/evidence reference beyond orphan age", async () => {
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("GC protected evidence");
  const learner = await lmsLearner(center.tenant.id, "gc");
  const course = await createCourse(
    center.context,
    lmsCourse({ sanitary: true, required: false }),
  );
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const store = new ArtifactStore(
    await mkdtemp(join(tmpdir(), "demo-lms-gc-")),
  );
  try {
    const attempt = await startAttempt(learner.context, enrollment.id);
    await saveAnswers(learner.context, attempt.id, {
      sequence: 1,
      answers: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`q-${i}`, ["a"]]),
      ),
    });
    const completed = await submitAttempt(learner.context, attempt.id);
    assert.equal(completed.result?.eligible, true);
    const event = await db.regulatoryOutbox.findFirstOrThrow({
      where: { tenantId: center.tenant.id, resultId: completed.result!.id },
    });
    await db.regulatoryOutbox.update({
      where: { id: event.id },
      data: {
        status: "PROCESSING",
        leaseToken: 1,
        lockedUntil: new Date(Date.now() + 30000),
      },
    });
    await prepareClaimedEvent(event.id, 1);
    const delivery = await db.integrationDelivery.findFirstOrThrow({
      where: { tenantId: center.tenant.id, resultId: completed.result!.id },
    });
    const template = await store.put(
      Buffer.from("synthetic historical template"),
      "docx",
    );
    const material = await store.put(
      Buffer.from("synthetic course material"),
      "pdf",
    );
    const external = await store.put(
      Buffer.from("synthetic external evidence"),
      "pdf",
    );
    const manual = await store.put(
      Buffer.from("synthetic operator-attested evidence"),
      "pdf",
    );
    const orphan = await store.put(
      Buffer.from("synthetic unreferenced upload"),
      "pdf",
    );
    await db.templateVersion.create({
      data: {
        tenantId: center.tenant.id,
        templateId: "synthetic-gc-old",
        version: "1",
        checksum: template.sha256,
        storageKey: template.storageKey,
        contract: {},
      },
    });
    await db.lmsMaterial.create({
      data: {
        tenantId: center.tenant.id,
        courseId: course.course.id,
        ...material,
        mimeType: "application/pdf",
        originalName: "synthetic-material.pdf",
        createdBy: center.user.id,
      },
    });
    await db.lmsExternalEvidence.create({
      data: {
        tenantId: center.tenant.id,
        enrollmentId: enrollment.id,
        issuer: "SYNTHETIC",
        sourceSystem: "SYNTHETIC GC FIXTURE",
        documentNumber: "SYNTHETIC-GC-1",
        documentDate: "2026-10-15",
        storageKey: external.storageKey,
        sha256: external.sha256,
        mimeType: "application/pdf",
        originalName: "synthetic-external.pdf",
        createdBy: center.user.id,
      },
    });
    await db.regulatoryManualEvidence.create({
      data: {
        tenantId: center.tenant.id,
        deliveryId: delivery.id,
        actorId: center.user.id,
        source: "SYNTHETIC LOCAL TEST",
        reference: "SYNTHETIC-GC-1",
        storageKey: manual.storageKey,
        sha256: manual.sha256,
      },
    });
    const result = await collectOrphanObjects(db, store, {
      now: new Date(Date.now() + 8 * 86400000),
    });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.protectedObjects, 4);
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.storageKey),
      [orphan.storageKey],
    );
    assert.equal(result.deleted, 0);
    for (const file of [template, material, external, manual, orphan])
      assert.ok(await store.read(file.storageKey, file.sha256));
  } finally {
    await db.$disconnect();
  }
});
