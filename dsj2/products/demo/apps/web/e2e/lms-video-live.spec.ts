import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("L07 real private video plays, pauses, resumes after reload and cannot complete by seeking", async ({
  page,
}) => {
  test.setTimeout(120000);
  const product = path.resolve(__dirname, "../../..");
  execFileSync(
    process.execPath,
    [
      path.join(product, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(product, "tsconfig.base.json"),
      path.join(product, "scripts/verification/lms-video-browser-fixture.ts"),
    ],
    { cwd: product, env: process.env, windowsHide: true, stdio: "pipe" },
  );
  const fixture = JSON.parse(
    await fs.readFile(
      path.resolve(
        __dirname,
        "../../../.runtime/lms-one-run/video-browser-fixture.json",
      ),
      "utf8",
    ),
  );
  const evidence = process.env.DEMO_E2E_EVIDENCE
    ? path.resolve(process.env.DEMO_E2E_EVIDENCE, "lms-video-live")
    : path.resolve(
        __dirname,
        "../../../docs/evidence/lms-one-run-20261015/agent-a/video-browser",
      );
  await fs.mkdir(evidence, { recursive: true });
  await page.goto("/login");
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(fixture.email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`/learn/${fixture.enrollmentId}`);
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  const detail = async () =>
    (
      await page.request.get(`/api/learn/enrollments/${fixture.enrollmentId}`)
    ).json();
  const progress = async () =>
    (await detail()).progress.find(
      (entry: { lessonId: string }) => entry.lessonId === "video",
    );
  const rangeResponses: { status: number; contentRange: string | undefined }[] =
    [];
  page.on("response", (response) => {
    if (response.url().includes(`/lms/materials/${fixture.materialId}`))
      rangeResponses.push({
        status: response.status(),
        contentRange: response.headers()["content-range"],
      });
  });
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 11;
  });
  await expect
    .poll(async () => (await progress())?.positionSeconds || 0)
    .toBeGreaterThan(10);
  expect((await progress()).completedAt).toBeNull();
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 0;
  });
  await expect.poll(async () => (await progress())?.positionSeconds).toBe(0);
  const started = performance.now();
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(
      () => video.evaluate((element: HTMLVideoElement) => element.currentTime),
      { timeout: 15000 },
    )
    .toBeGreaterThan(5.2);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await expect
    .poll(async () => (await progress())?.positionSeconds || 0)
    .toBeGreaterThan(5);
  const paused = await progress();
  expect(paused.completedAt).toBeNull();
  await page.screenshot({
    path: path.join(evidence, "01-paused.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(5);
  const resumedAt = await video.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  expect(Math.abs(resumedAt - paused.positionSeconds)).toBeLessThan(0.5);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(fixture.email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Synthetic-LMS-only-20261015!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`/learn/${fixture.enrollmentId}`);
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(5);
  const reloggedAt = await video.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  expect(Math.abs(reloggedAt - paused.positionSeconds)).toBeLessThan(0.5);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.ended), {
      timeout: 20000,
    })
    .toBe(true);
  await expect
    .poll(async () => (await progress())?.completedAt, { timeout: 10000 })
    .toBeTruthy();
  const completed = await progress();
  expect((await detail()).progressPercent).toBe(100);
  await expect(
    page.getByRole("button", { name: "Следующий урок", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "02-completed.png"),
    fullPage: true,
    animations: "disabled",
  });
  await fs.writeFile(
    path.join(evidence, "PLAYBACK_ACCEPTANCE.json"),
    JSON.stringify(
      {
        status: "PASS",
        syntheticOnly: true,
        measuredAt: new Date().toISOString(),
        enrollmentId: fixture.enrollmentId,
        pausedPosition: paused.positionSeconds,
        resumedAt,
        reloggedAt,
        intervals: completed.intervals,
        completedAt: completed.completedAt,
        elapsedMilliseconds: performance.now() - started,
        rangeResponses,
        preparedFixture:
          "Synthetic generated 12-second private MP4 and course/assignment created through local fixture; actual initial login and repeated login after logout are both performed in this scenario.",
        browserActions: [
          "seek to 11 seconds: no completion",
          "seek back to zero",
          "real HTML video playback",
          "pause after >5 seconds",
          "reload",
          "resume at server-saved position",
          "logout, login again and resume at the same saved position",
          "play naturally to end",
          "server completion and Next lesson visible",
        ],
        limitations:
          "Uses HTMLMediaElement play/pause for deterministic native media control; no video/network/progress response mocking and no simulated elapsed server clock.",
      },
      null,
      2,
    ),
  );
});
