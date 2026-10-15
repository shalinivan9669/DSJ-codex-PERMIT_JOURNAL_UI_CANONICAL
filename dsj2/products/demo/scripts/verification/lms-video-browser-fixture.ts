import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import {
  createCourse,
  publishVersion,
  updateVersion,
} from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { lmsStore } from "../../apps/api/src/lms/materials";
import { lmsCourse, lmsLearner } from "../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../tests/integration/test-database";

async function main() {
  assertTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(url.pathname.startsWith("/demo_test_lms_browser_"));
  assert.equal(url.hostname, "127.0.0.1");
  const director = await db.user.findUniqueOrThrow({
    where: { email: "lms-director-20261015@example.test" },
  });
  const context: Context = {
    tenantId: director.tenantId,
    userId: director.id,
    role: director.role,
    sessionId: "synthetic-video",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const learner = await lmsLearner(director.tenantId, "real-video-playback");
  const definition = lmsCourse();
  definition.content.titleRu = "Синтетическая программа: просмотр видео";
  definition.content.titleKz = "Синтетикалық бағдарлама: бейнені көру";
  const course = await createCourse(context, definition);
  const runtime = resolve(".runtime/lms-one-run");
  await mkdir(runtime, { recursive: true });
  const video = resolve(runtime, `synthetic-video-${randomUUID()}.mp4`);
  const created = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=640x360:r=20",
      "-t",
      "12",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
      "-y",
      video,
    ],
    { windowsHide: true },
  );
  assert.equal(created.status, 0, created.stderr?.toString());
  const stored = await lmsStore.put(await readFile(video), "mp4");
  const material = await db.lmsMaterial.create({
    data: {
      tenantId: director.tenantId,
      courseId: course.course.id,
      ...stored,
      mimeType: "video/mp4",
      originalName: "synthetic-twelve-seconds.mp4",
      createdBy: director.id,
    },
  });
  definition.content.modules[0].lessons = [
    {
      id: "video",
      titleRu: "Просмотр учебного видео",
      titleKz: "Оқу бейнесін көру",
      kind: "VIDEO",
      textRu: "Синтетический ролик для проверки сохранения просмотра.",
      textKz: "Көру барысының сақталуын тексеруге арналған синтетикалық бейне.",
      materialId: material.id,
      durationSeconds: 12,
      required: true,
      prerequisiteLessonIds: [],
    },
  ];
  await updateVersion(context, course.version.id, {
    revision: 0,
    ...definition,
  });
  await publishVersion(context, course.version.id, { revision: 1 });
  const enrollment = (
    await assignEnrollments(context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  await writeFile(
    resolve(runtime, "video-browser-fixture.json"),
    JSON.stringify(
      {
        tenantId: director.tenantId,
        courseId: course.course.id,
        videoPath: video,
        email: learner.user.email,
        enrollmentId: enrollment.id,
        materialId: material.id,
        seconds: 12,
        sourceSha256: stored.sha256,
        syntheticOnly: true,
      },
      null,
      2,
    ),
  );
  console.log("SYNTHETIC_VIDEO_BROWSER_FIXTURE_READY");
}
main().finally(() => db.$disconnect());
