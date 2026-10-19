import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../apps/api/src/core";
import {
  createCourse,
  updateVersion,
  publishVersion,
} from "../../apps/api/src/lms/courses";
import { reviewCourseVersion } from "../../apps/api/src/lms/course-review";
import {
  uploadMaterial,
  authorizedMaterial,
  openPrivateStream,
  lmsUploadDirectory,
} from "../../apps/api/src/lms/materials";
import {
  setMaterialState,
  deleteUnusedMaterial,
  bindMaterial,
} from "../../apps/api/src/lms/material-library";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import { lmsTenant, lmsLearner, lmsCourse } from "./lms-fixture";
const denied = (error: unknown) =>
  (error as { getStatus: () => number }).getStatus() === 404;
test(
  "P08 immutable revisions, hidden published references, prerequisite/private bytes and revoked material author",
  { timeout: 120000 },
  async (t) => {
    t.after(() => db.$disconnect());
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    assert.ok(process.env.DEMO_ARTIFACT_ROOT);
    const center = await lmsTenant("full-materials"),
      foreign = await lmsTenant("full-materials-other"),
      learner = await lmsLearner(center.tenant.id, "reader"),
      other = await lmsLearner(center.tenant.id, "unassigned");
    const input = lmsCourse({ kind: "PRACTICE", questions: 1 }),
      created = await createCourse(center.context, input);
    await mkdir(lmsUploadDirectory, { recursive: true });
    async function upload(
      content: string,
      name = "proof.pdf",
      mime = "application/pdf",
      prior?: string,
      targetCourseId = created.course.id,
    ) {
      const path = join(lmsUploadDirectory, randomUUID());
      const bytes = Buffer.from(content);
      await writeFile(path, bytes);
      return uploadMaterial(
        center.context,
        targetCourseId,
        {
          path,
          size: bytes.length,
          originalname: name,
          mimetype: mime,
        } as Express.Multer.File,
        prior ? { supersedesMaterialId: prior } : {},
      );
    }
    const original = await upload("%PDF-1.7\nSynthetic original\n%%EOF"),
      replacement = await upload(
        "%PDF-1.7\nSynthetic replacement\n%%EOF",
        "proof-new.pdf",
        "application/pdf",
        original.id,
      );
    assert.notEqual(original.id, replacement.id);
    assert.notEqual(original.sha256, replacement.sha256);
    const state = await db.lmsMaterialState.findUniqueOrThrow({
      where: {
        tenantId_materialId: {
          tenantId: center.tenant.id,
          materialId: replacement.id,
        },
      },
    });
    assert.equal(state.familyId, original.id);
    assert.equal(state.supersedesMaterialId, original.id);
    const reusedCourse = await createCourse(
      center.context,
      lmsCourse({ kind: "PRACTICE", questions: 1 }),
    );
    await assert.rejects(
      upload(
        "%PDF-1.7\nUnbound revision\n%%EOF",
        "unbound.pdf",
        "application/pdf",
        original.id,
        reusedCourse.course.id,
      ),
    );
    await bindMaterial(center.context, original.id, {
      courseId: reusedCourse.course.id,
    });
    const reusedRevision = await upload(
      "%PDF-1.7\nBound new revision in second course\n%%EOF",
      "reused-new.pdf",
      "application/pdf",
      original.id,
      reusedCourse.course.id,
    );
    assert.equal(reusedRevision.courseId, reusedCourse.course.id);
    assert.notEqual(reusedRevision.sha256, original.sha256);
    const sourceAfter = await db.lmsMaterial.findUniqueOrThrow({
      where: { id: original.id },
    });
    assert.equal(sourceAfter.courseId, created.course.id);
    assert.equal(sourceAfter.sha256, original.sha256);
    assert.equal(
      (
        await db.lmsMaterialState.findUniqueOrThrow({
          where: {
            tenantId_materialId: {
              tenantId: center.tenant.id,
              materialId: reusedRevision.id,
            },
          },
        })
      ).familyId,
      original.id,
    );
    input.content.modules[0].lessons.push({
      ...input.content.modules[0].lessons[0],
      id: "private-pdf",
      kind: "PDF",
      materialId: original.id,
      prerequisiteLessonIds: ["lesson-1"],
    });
    const saved = await updateVersion(center.context, created.version.id, {
      ...input,
      revision: created.version.revision,
    });
    const submitted = await reviewCourseVersion(
      center.context,
      created.version.id,
      { revision: saved.revision, action: "SUBMIT" },
    );
    await reviewCourseVersion(center.context, created.version.id, {
      revision: submitted.revision,
      action: "APPROVE",
    });
    await publishVersion(center.context, created.version.id, {
      revision: submitted.revision,
    });
    const enrollment = await db.enrollment.create({
      data: {
        tenantId: center.tenant.id,
        courseVersionId: created.version.id,
        recipientId: learner.recipient.id,
        learnerUserId: learner.user.id,
        dueAt: null,
        assignedBy: center.user.id,
      },
    });
    await assert.rejects(
      authorizedMaterial(learner.context, original.id),
      denied,
    );
    await assert.rejects(
      authorizedMaterial(other.context, original.id),
      denied,
    );
    await assert.rejects(
      authorizedMaterial(foreign.context, original.id),
      denied,
    );
    await saveLessonProgress(learner.context, enrollment.id, "lesson-1", {
      sequence: 1,
      acknowledge: true,
    });
    const record = await authorizedMaterial(learner.context, original.id);
    const range = await openPrivateStream(record, "bytes=0-4");
    assert.equal(range.invalid, false);
    if (range.invalid) throw new Error("range");
    const chunks: Buffer[] = [];
    for await (const chunk of range.stream) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "%PDF-");
    await setMaterialState(center.context, original.id, {
      revision: 0,
      state: "HIDDEN",
    });
    assert.equal(
      (await authorizedMaterial(learner.context, original.id)).sha256,
      original.sha256,
    );
    await assert.rejects(deleteUnusedMaterial(center.context, original.id));
    await assert.rejects(
      authorizedMaterial(learner.context, replacement.id),
      denied,
    );
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { startsAt: new Date(Date.now() + 86400000) },
    });
    await assert.rejects(
      authorizedMaterial(learner.context, original.id),
      denied,
    );
    await assert.rejects(
      upload("WEBVTT\n\nwrong --> bad", "bad.vtt", "text/vtt"),
    );
    const methodist = await db.user.create({
        data: {
          tenantId: center.tenant.id,
          email: `${randomUUID()}@example.test`,
          displayName: "Synthetic material author",
          passwordHash: "fixture-no-login",
          role: "METHODIST",
        },
      }),
      author = { ...center.context, userId: methodist.id, role: "METHODIST" };
    const binding = await db.lmsTeachingBinding.create({
      data: {
        tenantId: center.tenant.id,
        userId: methodist.id,
        courseId: created.course.id,
        role: "METHODIST",
        permissions: ["READ", "EDIT", "MATERIAL"],
        createdBy: center.user.id,
      },
    });
    assert.equal(
      (await authorizedMaterial(author, replacement.id)).id,
      replacement.id,
    );
    await db.lmsTeachingBinding.update({
      where: { id: binding.id },
      data: { revokedAt: new Date(), revokedBy: center.user.id },
    });
    await assert.rejects(authorizedMaterial(author, replacement.id), denied);
    await assert.rejects(
      uploadMaterial(author, created.course.id, undefined),
      (error: unknown) =>
        (error as { getStatus: () => number }).getStatus() === 403,
    );
  },
);
