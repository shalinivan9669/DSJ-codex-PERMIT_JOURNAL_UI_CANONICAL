import { test, expect, type APIResponse, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
} from "../../../packages/contracts/src/lms";

const product = path.resolve(__dirname, "../../..");
async function body<T>(
  response: Pick<APIResponse, "ok" | "status" | "text" | "json">,
): Promise<T> {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль").fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("native video playback enforces allowed rate and no seek, loads private subtitles and credits configured threshold", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = JSON.parse(
    readFileSync(process.env.DEMO_LMS_PASS01_FIXTURE!, "utf8"),
  );
  expect(["localhost", "127.0.0.1"]).toContain(
    new URL(fixture.baseUrl).hostname,
  );
  const output = process.env.DEMO_E2E_EVIDENCE!;
  await mkdir(output, { recursive: true });
  const sourcePath = path.join(
    product,
    ".runtime/lms-pass01-20261018",
    `video-browser-${randomUUID()}.mp4`,
  );
  const generated = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:s=640x360:r=20",
      "-t",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
      "-y",
      sourcePath,
    ],
    { windowsHide: true },
  );
  expect(generated.status, generated.stderr?.toString()).toBe(0);
  const videoBytes = readFileSync(sourcePath);
  const subtitles = Buffer.from(
    "WEBVTT\n\n00:00:00.000 --> 00:00:26.000\nСинтетические локальные субтитры\n",
  );
  const contexts = await Promise.all([
    browser.newContext({ baseURL: fixture.baseUrl }),
    browser.newContext({ baseURL: fixture.baseUrl }),
  ]);
  const blocked: string[] = [];
  for (const context of contexts)
    await context.route("**/*", (route) => {
      if (
        ["localhost", "127.0.0.1"].includes(
          new URL(route.request().url()).hostname,
        )
      )
        return route.continue();
      blocked.push(route.request().url());
      return route.abort("blockedbyclient");
    });
  try {
    const director = await contexts[0].newPage(),
      learner = await contexts[1].newPage();
    await login(director, fixture.users.director);
    const session = await body<{ csrfToken: string }>(
      await director.request.get("/api/auth/session"),
    );
    const headers = {
      origin: fixture.baseUrl,
      "x-csrf-token": session.csrfToken,
    };
    const authored = JSON.parse(
      readFileSync(
        path.join(product, ".runtime/lms-pass01-20261018/browser-author.json"),
        "utf8",
      ),
    ) as { content: CourseContent };
    const content = courseContentSchema.parse({
      ...authored.content,
      titleRu: `Локальное видео ${randomUUID().slice(0, 8)}`,
      titleKz: "Жергілікті бейне",
      modules: [],
      coursePrerequisites: [],
      accessPolicy: { mode: "UNLIMITED", timezone: "Asia/Qyzylorda" },
    });
    const profile = regulatoryProfileSchema.parse({
      title: "SYNTHETIC LOCAL VIDEO",
      synthetic: true,
      status: "CONFIRMED",
      examiner: "Synthetic teacher",
      issuer: "Synthetic center",
      reviewReference: "Local browser acceptance only",
      assessmentKind: "CENTER_EXAM",
      requiresApproval: false,
      requiresEmployeeSignature: false,
    });
    const created = await body<{
      course: { id: string };
      version: { id: string; revision: number };
    }>(
      await director.request.post("/api/lms/courses", {
        headers,
        data: { content, profile },
      }),
    );
    const video = await body<{ id: string }>(
      await director.request.post(
        `/api/lms/courses/${created.course.id}/materials`,
        {
          headers,
          multipart: {
            file: {
              name: "synthetic-native-video.mp4",
              mimeType: "video/mp4",
              buffer: videoBytes,
            },
          },
        },
      ),
    );
    const subtitle = await body<{ id: string }>(
      await director.request.post(
        `/api/lms/courses/${created.course.id}/materials`,
        {
          headers,
          multipart: {
            file: {
              name: "synthetic-ru.vtt",
              mimeType: "text/vtt",
              buffer: subtitles,
            },
          },
        },
      ),
    );
    content.modules = [
      {
        id: "video-module",
        titleRu: "Модуль видео",
        titleKz: "Бейне модулі",
        lessons: [
          {
            id: "video-lesson",
            kind: "VIDEO",
            titleRu: "Просмотр с субтитрами",
            titleKz: "Субтитрмен қарау",
            textRu: "",
            textKz: "",
            required: true,
            materialId: video.id,
            durationSeconds: 26,
            prerequisiteLessonIds: [],
            videoPolicy: {
              minimumPercent: 50,
              allowSeekAhead: false,
              playbackRates: [1, 2],
            },
            subtitles: [
              { materialId: subtitle.id, language: "ru", label: "Русский" },
            ],
          },
        ],
      },
    ];
    const saved = await body<{ revision: number }>(
      await director.request.put(
        `/api/lms/course-versions/${created.version.id}`,
        {
          headers,
          data: { revision: created.version.revision, content, profile },
        },
      ),
    );
    await body(
      await director.request.post(
        `/api/lms/course-versions/${created.version.id}/publish`,
        { headers, data: { revision: saved.revision } },
      ),
    );
    const assigned = await body<{ items: { id: string }[] }>(
      await director.request.post("/api/lms/enrollments", {
        headers,
        data: {
          courseVersionId: created.version.id,
          recipientIds: [fixture.users.learner.recipientId],
          operationId: randomUUID(),
        },
      }),
    );
    const enrollmentId = assigned.items[0].id;
    await login(learner, fixture.users.learner);
    const heartbeats: { request: unknown; response: unknown }[] = [];
    learner.on("response", async (response) => {
      if (response.url().endsWith(`/lessons/video-lesson/progress`))
        heartbeats.push({
          request: response.request().postDataJSON(),
          response: await response.json(),
        });
    });
    const subtitleResponse = learner.waitForResponse((response) =>
      response.url().endsWith(`/lms/materials/${subtitle.id}`),
    );
    await learner.goto(`/learn/${enrollmentId}`);
    await learner.getByRole("button", { name: "RU", exact: true }).click();
    const media = learner.locator("video");
    await expect(media).toBeVisible();
    await expect
      .poll(() =>
        media.evaluate((node) => (node as HTMLVideoElement).readyState),
      )
      .toBeGreaterThanOrEqual(2);
    const trackResponse = await subtitleResponse;
    expect(trackResponse.status()).toBe(200);
    expect(trackResponse.headers()["content-type"]).toContain("text/vtt");
    await expect(
      learner.getByRole("button", {
        name: "Начать итоговый тест",
        exact: true,
      }),
    ).toBeDisabled();
    await media.focus();
    // Chrome seeks 1% per key on this short fixture. Eight presses attempt 2.08s,
    // exceeding the application's 1s tolerance while the player is paused.
    for (let step = 0; step < 8; step++) await media.press("ArrowRight");
    await expect
      .poll(() =>
        media.evaluate((node) => (node as HTMLVideoElement).currentTime),
      )
      .toBeLessThan(1.1);
    const noSeek = await media.evaluate((node) => ({
      position: (node as HTMLVideoElement).currentTime,
      paused: (node as HTMLVideoElement).paused,
    }));
    // Native HTMLMediaElement ratechange event exercises the actual browser player policy.
    // This is not a claim about navigating Chrome's platform-specific speed menu.
    await media.evaluate((node) => {
      (node as HTMLVideoElement).playbackRate = 1.5;
    });
    await expect
      .poll(() =>
        media.evaluate((node) => (node as HTMLVideoElement).playbackRate),
      )
      .toBe(1);
    await media.evaluate((node) => {
      (node as HTMLVideoElement).playbackRate = 2;
    });
    await expect
      .poll(() =>
        media.evaluate((node) => (node as HTMLVideoElement).playbackRate),
      )
      .toBe(2);
    await media.focus();
    await media.press("Space");
    await expect
      .poll(() => media.evaluate((node) => (node as HTMLVideoElement).paused))
      .toBe(false);
    await expect
      .poll(() =>
        media.evaluate((node) => (node as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(1);
    const tracks = await media.evaluate((node) =>
      Array.from((node as HTMLVideoElement).textTracks).map((track) => ({
        language: track.language,
        mode: track.mode,
        cues: Array.from(track.cues || []).map((cue) => (cue as VTTCue).text),
        activeCues: Array.from(track.activeCues || []).map(
          (cue) => (cue as VTTCue).text,
        ),
      })),
    );
    expect(tracks[0].mode).toBe("showing");
    expect(tracks[0].activeCues).toContain("Синтетические локальные субтитры");
    await learner.screenshot({
      path: path.join(output, "native-video-subtitles.png"),
      fullPage: true,
    });
    const before = await body<{
      progress: { completedAt: string | null; intervals: number[][] }[];
    }>(await learner.request.get(`/api/learn/enrollments/${enrollmentId}`));
    expect(before.progress.every((row) => !row.completedAt)).toBe(true);
    await expect(
      learner.getByRole("button", {
        name: "Начать итоговый тест",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 20_000 });
    await media.focus();
    await media.press("Space");
    await expect
      .poll(() => media.evaluate((node) => (node as HTMLVideoElement).paused))
      .toBe(true);
    const nativeFinal = await media.evaluate((node) => ({
      currentTime: (node as HTMLVideoElement).currentTime,
      duration: (node as HTMLVideoElement).duration,
      rate: (node as HTMLVideoElement).playbackRate,
      ended: (node as HTMLVideoElement).ended,
    }));
    const after = await body<{
      progressPercent: number;
      progress: { completedAt: string | null; intervals: number[][] }[];
      results: unknown[];
      documents: unknown[];
    }>(await learner.request.get(`/api/learn/enrollments/${enrollmentId}`));
    const creditedSeconds = after.progress[0].intervals.reduce(
      (sum, [from, to]) => sum + to - from,
      0,
    );
    expect(after.progress[0].completedAt).toBeTruthy();
    expect(creditedSeconds).toBeGreaterThanOrEqual(13);
    expect(nativeFinal.currentTime).toBeLessThan(26);
    expect(nativeFinal.ended).toBe(false);
    expect(after.results).toEqual([]);
    expect(after.documents).toEqual([]);
    expect(blocked).toEqual([]);
    await writeFile(
      path.join(output, "BROWSER_VIDEO.json"),
      JSON.stringify(
        {
          status: "PASS",
          synthetic: true,
          courseId: created.course.id,
          enrollmentId,
          sourceSha256: createHash("sha256").update(videoBytes).digest("hex"),
          policy: {
            minimumPercent: 50,
            playbackRates: [1, 2],
            allowSeekAhead: false,
          },
          noSeek,
          nativeFinal,
          creditedSeconds,
          tracks,
          subtitleHttpStatus: trackResponse.status(),
          heartbeats,
          actualNativePlayback: true,
          playPause: "focused native video keyboard Space",
          seek: "eight focused native ArrowRight presses attempt 2.08s; no-seek handler keeps position within 1s tolerance",
          rateInteraction:
            "native HTMLMediaElement property/ratechange; unsupported 1.5 reset to 1; allowed 2 persisted; no Chrome speed-menu claim",
          thresholdReachedBeforeEnd: true,
          noClientClockOrProgressDatabaseManipulation: true,
          externalRequestsBlocked: blocked,
          setupBoundary:
            "API-prepared independent synthetic course and local ffmpeg source; actual learner UI/native video and server progress exercised",
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
