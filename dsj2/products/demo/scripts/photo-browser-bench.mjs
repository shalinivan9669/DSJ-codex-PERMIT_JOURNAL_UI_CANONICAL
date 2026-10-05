import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
const sharp = createRequire(path.resolve("apps/api/package.json"))("sharp");
const output = path.resolve(
  process.argv[2] || ".runtime/operator-details-ux-20261005/photo",
);
await fs.mkdir(output, { recursive: true });
const fixture = path.join(output, "synthetic-20mp.jpg");
try {
  await fs.access(fixture);
} catch {
  const width = 5000,
    height = 4000;
  const raw = Buffer.alloc(width * height * 3);
  let seed = 123456789;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed >>> 24;
      const i = (y * width + x) * 3;
      raw[i] = (x < width / 2 ? 140 : 30) + (noise % 100);
      raw[i + 1] = (y < height / 2 ? 140 : 30) + (noise % 100);
      raw[i + 2] = noise;
    }
  let selected;
  for (let quality = 45; quality < 95; quality++) {
    const bytes = await sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality })
      .toBuffer();
    if (bytes.length > 5 * 1024 * 1024) break;
    selected = bytes;
  }
  await fs.writeFile(fixture, selected);
}
const bytes = await fs.readFile(fixture);
const after = process.argv[3] === "after";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.DEMO_E2E_CHANNEL || "msedge",
});
try {
  const page = await browser.newPage();
  await page.goto("about:blank");
  if (after) {
    const require = createRequire(import.meta.url);
    const { build } = createRequire(require.resolve("tsx/package.json"))(
      "esbuild",
    );
    const result = await build({
      absWorkingDir: path.resolve("apps/web"),
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      stdin: {
        resolveDir: path.resolve("apps/web"),
        contents:
          'import * as helpers from "./lib/photo-crop"; window.photoHelpers = helpers;',
        loader: "ts",
      },
    });
    await page.addScriptTag({ content: result.outputFiles[0].text });
  }
  const measurements = after
    ? await page.evaluate(
        async ({ encoded }) => {
          const file = new File(
            [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
            "synthetic-20mp.jpg",
            { type: "image/jpeg" },
          );
          const start = performance.now();
          const photo = await window.photoHelpers.preparePhoto(
            file,
            new AbortController().signal,
          );
          const decodeMs = performance.now() - start;
          const target = document.createElement("canvas");
          target.width = 300;
          target.height = 400;
          const ctx = target.getContext("2d");
          const draws = [];
          for (let i = 0; i < 30; i++) {
            const t = performance.now();
            const crop = window.photoHelpers.photoCrop(
              photo,
              0,
              1 + i / 30,
              (i / 30) * 100,
              0,
            );
            window.photoHelpers.drawPhotoCrop(target, photo, crop, 0);
            ctx.getImageData(0, 0, 1, 1);
            draws.push(performance.now() - t);
          }
          const result = {
            width: photo.width,
            height: photo.height,
            decodeMs,
            optimizedDrawMs: draws,
            preparedBitmap: {
              width: photo.bitmap.width,
              height: photo.bitmap.height,
            },
            outputCanvasPixels: target.width * target.height,
            fullResolutionCanvasCreated: false,
          };
          photo.bitmap.close();
          return result;
        },
        { encoded: bytes.toString("base64") },
      )
    : await page.evaluate(
        async ({ encoded }) => {
          const binary = atob(encoded);
          const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          const blob = new Blob([data], { type: "image/jpeg" });
          const url = URL.createObjectURL(blob);
          const image = new Image();
          const start = performance.now();
          image.src = url;
          await image.decode();
          const decodeMs = performance.now() - start;
          const target = document.createElement("canvas");
          target.width = 300;
          target.height = 400;
          const ctx = target.getContext("2d");
          const baseline = [];
          for (let i = 0; i < 30; i++) {
            const t = performance.now();
            const oriented = document.createElement("canvas");
            oriented.width = image.width;
            oriented.height = image.height;
            const stage = oriented.getContext("2d");
            stage.translate(image.width / 2, image.height / 2);
            stage.drawImage(image, -image.width / 2, -image.height / 2);
            const width =
              Math.min(image.width, (image.height * 3) / 4) / (1 + i / 30);
            ctx.drawImage(
              oriented,
              ((image.width - width) * i) / 30,
              0,
              Math.floor(width),
              Math.floor((width * 4) / 3),
              0,
              0,
              300,
              400,
            );
            // Flush the output just as browser compositing must eventually consume it.
            ctx.getImageData(0, 0, 1, 1);
            baseline.push(performance.now() - t);
            oriented.width = 0;
            oriented.height = 0;
          }
          URL.revokeObjectURL(url);
          return {
            width: image.width,
            height: image.height,
            decodeMs,
            baselineDrawMs: baseline,
            baselineCanvasPixelsPerMove: image.width * image.height,
          };
        },
        { encoded: bytes.toString("base64") },
      );
  const report = {
    status: after ? "MEASURED_AFTER" : "MEASURED_BASELINE",
    fixture: path.basename(fixture),
    bytes: bytes.length,
    browser: browser.version(),
    orientation: 1,
    stages: {
      ...measurements,
      post: "NOT RUN: isolated canvas baseline, no API",
      attachment: "NOT RUN",
      subsequentImage: "NOT RUN",
    },
    source: after
      ? "Actual bundled lib/photo-crop.ts preparePhoto/drawPhotoCrop"
      : "Unmodified PhotoDialog draw implementation captured in recipient-details.before.tsx",
  };
  await fs.writeFile(
    path.join(output, after ? "after.json" : "baseline.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
