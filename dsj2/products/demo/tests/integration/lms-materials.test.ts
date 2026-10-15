import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import {
  createCourse,
  publishVersion,
  updateVersion,
} from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { lmsStore } from "../../apps/api/src/lms/materials";
import {
  lmsCourse,
  lmsTenant,
  lmsLearner,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";

test("L05 L06 L07: protected real video Range, prerequisite gates, resume and server progress resist seek/replay", async (t) => {
  const center = await lmsTenant("material protections");
  const learner = await lmsLearner(center.tenant.id, "video");
  const unassigned = await lmsLearner(center.tenant.id, "unassigned");
  const foreign = await lmsTenant("material foreign");
  const definition = lmsCourse();
  const course = await createCourse(center.context, definition);
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.DEMO_ORIGIN = "http://127.0.0.1:31993";
  const app = await bootstrap();
  let videoId = "",
    enrollmentId = "",
    pdfId = "";
  const videoRoot = await mkdtemp(join(tmpdir(), "demo-lms-video-fixture-"));
  const videoPath = join(videoRoot, "synthetic-two-seconds.mp4");
  const generated = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=320x180:r=10",
      "-t",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
      "-y",
      videoPath,
    ],
    { windowsHide: true },
  );
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const videoBytes = await readFile(videoPath);
  const base = await app.getUrl();
  const staffHeaders = await lmsSession(base, center.user.email);
  const learnerHeaders = await lmsSession(base, learner.user.email);
  const learnerCall = lmsHttp(base, learnerHeaders);
  const foreignHeaders = await lmsSession(base, foreign.user.email);
  const unassignedHeaders = await lmsSession(base, unassigned.user.email);
  const upload = (
    headers: Record<string, string>,
    bytes: Uint8Array,
    type: string,
    name: string,
  ) => {
    const body = new FormData();
    body.set("file", new Blob([Buffer.from(bytes)], { type }), name);
    return fetch(`${base}/lms/courses/${course.course.id}/materials`, {
      method: "POST",
      headers,
      body,
    });
  };
  try {
    await t.test(
      "staff uploads private files; learner upload and disguised HTML are rejected",
      async () => {
        await lmsJson(
          await upload(
            learnerHeaders,
            videoBytes,
            "video/mp4",
            "synthetic.mp4",
          ),
          403,
        );
        await lmsJson(
          await upload(
            staffHeaders,
            Buffer.from("<html><script>1</script></html>"),
            "application/pdf",
            "fake.pdf",
          ),
          400,
        );
        const video = await lmsJson(
          await upload(staffHeaders, videoBytes, "video/mp4", "synthetic.mp4"),
          201,
        );
        videoId = video.id;
        assert.equal(video.storageKey, undefined);
        const pdf = await lmsJson(
          await upload(
            staffHeaders,
            Buffer.from("%PDF-1.4\n% Synthetic source\n%%EOF"),
            "application/pdf",
            "synthetic.pdf",
          ),
          201,
        );
        pdfId = pdf.id;
        definition.content.modules[0].lessons.push(
          {
            id: "pdf",
            titleRu: "Синтетический PDF",
            titleKz: "Синтетикалық PDF",
            kind: "PDF",
            textRu: "",
            textKz: "",
            materialId: pdfId,
            durationSeconds: null,
            required: true,
            prerequisiteLessonIds: ["lesson-1"],
          },
          {
            id: "video",
            titleRu: "Синтетическое видео",
            titleKz: "Синтетикалық бейне",
            kind: "VIDEO",
            textRu: "",
            textKz: "",
            materialId: videoId,
            durationSeconds: 2,
            required: true,
            prerequisiteLessonIds: ["pdf"],
          },
        );
        await updateVersion(center.context, course.version.id, {
          revision: 0,
          ...definition,
        });
        await publishVersion(center.context, course.version.id, {
          revision: 1,
        });
        enrollmentId = (
          await assignEnrollments(center.context, {
            courseVersionId: course.version.id,
            recipientIds: [learner.recipient.id],
          })
        ).items[0].id;
      },
    );
    await t.test(
      "unassigned and other-tenant users get no material; prerequisites also gate direct URLs",
      async () => {
        await lmsJson(
          await lmsHttp(base, unassignedHeaders)(`/lms/materials/${videoId}`),
          404,
        );
        await lmsJson(
          await lmsHttp(base, foreignHeaders)(`/lms/materials/${videoId}`),
          404,
        );
        await lmsJson(await learnerCall(`/lms/materials/${videoId}`), 404);
        await lmsJson(
          await learnerCall(
            `/learn/enrollments/${enrollmentId}/lessons/video/progress`,
            "POST",
            { sequence: 1, acknowledge: true },
          ),
          409,
        );
        const before = await lmsJson(
          await learnerCall(`/learn/enrollments/${enrollmentId}`),
        );
        assert.equal(before.content.modules[0].lessons[1].locked, true);
        assert.equal(before.content.modules[0].lessons[1].materialId, null);
        await lmsJson(
          await learnerCall(
            `/learn/enrollments/${enrollmentId}/lessons/lesson-1/progress`,
            "POST",
            { sequence: 1, acknowledge: true },
          ),
          201,
        );
        await lmsJson(
          await learnerCall(
            `/learn/enrollments/${enrollmentId}/lessons/pdf/progress`,
            "POST",
            { sequence: 1, acknowledge: true },
          ),
          201,
        );
      },
    );
    await t.test(
      "authenticated Range streams exact MP4 bytes with private headers and rejects invalid ranges",
      async () => {
        const range = await fetch(`${base}/lms/materials/${videoId}`, {
          headers: { ...learnerHeaders, range: "bytes=5-19" },
        });
        assert.equal(range.status, 206);
        assert.equal(
          range.headers.get("content-range"),
          `bytes 5-19/${videoBytes.length}`,
        );
        assert.equal(range.headers.get("content-type"), "video/mp4");
        assert.match(range.headers.get("cache-control")!, /private/);
        assert.equal(range.headers.get("x-content-type-options"), "nosniff");
        assert.deepEqual(
          Buffer.from(await range.arrayBuffer()),
          videoBytes.subarray(5, 20),
        );
        const invalid = await fetch(`${base}/lms/materials/${videoId}`, {
          headers: { ...learnerHeaders, range: "bytes=9999999-" },
        });
        assert.equal(invalid.status, 416);
        assert.equal(
          invalid.headers.get("content-range"),
          `bytes */${videoBytes.length}`,
        );
      },
    );
    await t.test(
      "seek, duplicate heartbeat, sequence conflict and client completion cannot invent progress",
      async () => {
        const route = `/learn/enrollments/${enrollmentId}/lessons/video/progress`;
        await lmsJson(
          await learnerCall(route, "POST", {
            sequence: 1,
            positionSeconds: 0,
            playing: true,
          }),
          201,
        );
        const seek = await lmsJson(
          await learnerCall(route, "POST", {
            sequence: 2,
            positionSeconds: 2,
            playing: true,
          }),
          201,
        );
        assert.equal(seek.completedAt, null);
        assert.deepEqual(seek.intervals, []);
        await lmsJson(
          await learnerCall(route, "POST", {
            sequence: 3,
            positionSeconds: 0,
            playing: false,
          }),
          201,
        );
        // Test-only clock advance supplies elapsed wall-time; normal requests cannot alter lastSeenAt.
        await db.lessonProgress.update({
          where: {
            tenantId_enrollmentId_lessonId: {
              tenantId: center.tenant.id,
              enrollmentId,
              lessonId: "video",
            },
          },
          data: { lastSeenAt: new Date(Date.now() - 2100) },
        });
        const completed = await lmsJson(
          await learnerCall(route, "POST", {
            sequence: 4,
            positionSeconds: 2,
            playing: true,
          }),
          201,
        );
        assert.ok(completed.completedAt);
        assert.deepEqual(completed.intervals, [[0, 2]]);
        const duplicate = await lmsJson(
          await learnerCall(route, "POST", {
            sequence: 4,
            positionSeconds: 2,
            playing: true,
          }),
          201,
        );
        assert.deepEqual(duplicate.intervals, [[0, 2]]);
        await lmsJson(
          await learnerCall(route, "POST", { sequence: 4, positionSeconds: 1 }),
          409,
        );
        await lmsJson(
          await learnerCall(route, "POST", {
            sequence: 5,
            positionSeconds: 2,
            completion: 100,
          }),
          400,
        );
        const reload = await lmsJson(
          await learnerCall(`/learn/enrollments/${enrollmentId}`),
        );
        assert.equal(
          reload.progress.find(
            (p: { lessonId: string }) => p.lessonId === "video",
          ).positionSeconds,
          2,
        );
        assert.equal(reload.progressPercent, 100);
      },
    );
    await t.test(
      "expired assignments lose direct material access and corrupted stored bytes are refused",
      async () => {
        await db.enrollment.update({
          where: { id: enrollmentId },
          data: { dueAt: new Date(Date.now() - 1000) },
        });
        await lmsJson(await learnerCall(`/lms/materials/${videoId}`), 404);
        const stored = await db.lmsMaterial.findUniqueOrThrow({
          where: { id: videoId },
        });
        await writeFile(
          lmsStore.path(stored.storageKey),
          Buffer.concat([videoBytes, Buffer.from("tampered")]),
        );
        await lmsJson(
          await lmsHttp(base, staffHeaders)(`/lms/materials/${videoId}`),
          503,
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
