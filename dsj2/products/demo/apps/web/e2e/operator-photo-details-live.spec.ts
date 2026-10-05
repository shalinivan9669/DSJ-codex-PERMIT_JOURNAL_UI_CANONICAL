import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { loginIsolated } from "./operator-full-fix-session";
import { PrismaClient } from "../../../packages/database/src";
import { ArtifactStore } from "../../../packages/printing/src";

const product = path.resolve(__dirname, "../../..");
const sharp = createRequire(path.join(product, "apps/api/package.json"))(
  "sharp",
);
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "photo-details")
    : path.join(
        product,
        "docs/evidence/operator-details-ux-20261005/photo-live",
      ),
);

test("real PERSON large-photo upload persists the original request identity and reloads the normalized image", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const fixture = process.env.DEMO_E2E_LARGE_PHOTO;
  if (!fixture) throw new Error("EXPLICIT_SYNTHETIC_LARGE_PHOTO_REQUIRED");
  await fs.mkdir(evidence, { recursive: true });
  const bytes = await fs.readFile(fixture);
  const sha = (value: Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const requestStarts = new Map<string, number>();
  const timings: { stage: string; status: number; elapsedMs: number }[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/photos")) {
      requestStarts.set(request.url(), Date.now());
    } else if (
      request.method() === "PATCH" &&
      request.url().includes("/api/print-requests/")
    ) {
      requestStarts.set(request.url(), Date.now());
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      (request.method() === "POST" && response.url().endsWith("/api/photos")) ||
      (request.method() === "PATCH" &&
        response.url().includes("/api/print-requests/"))
    ) {
      timings.push({
        stage:
          request.method() === "POST"
            ? "POST original photo"
            : "PATCH draft and photoAssetId",
        status: response.status(),
        elapsedMs:
          Date.now() - (requestStarts.get(response.url()) || Date.now()),
      });
    }
  });
  await page.addInitScript(() => {
    const w = window as any;
    w.photoNative = [];
    w.photoSubmitted = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (
        String(input).endsWith("/api/photos") &&
        init?.body instanceof FormData
      ) {
        const file = init.body.get("file") as File;
        w.photoSubmitted.push({
          crop: JSON.parse(String(init.body.get("crop"))),
          rotation: Number(init.body.get("rotation")),
          fileBytes: file.size,
          fileType: file.type,
        });
      }
      return nativeFetch(input, init);
    };
    const native = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (...args: any[]) => {
      const started = performance.now();
      const bitmap = await (native as any)(...args);
      w.photoNative.push({
        started,
        elapsedMs: performance.now() - started,
        width: bitmap.width,
        height: bitmap.height,
      });
      return bitmap;
    }) as typeof createImageBitmap;
  });
  await loginIsolated(page);
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await page.getByRole("radio", { name: /^Физическое лицо/ }).check();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  const person = page.locator(".person-editor");
  await person
    .getByLabel("ФИО", { exact: true })
    .fill("Синтетический Фото Большой");
  await person
    .getByLabel("Должность", { exact: true })
    .fill("Синтетический монтажник");
  await person.getByRole("button", { name: "Далее", exact: true }).click();
  await person.getByRole("button", { name: "Рабочий", exact: true }).click();
  await person.getByRole("button", { name: "Далее", exact: true }).click();
  await person.getByRole("button", { name: "ПБ", exact: true }).click();
  await person.getByRole("button", { name: "Готово", exact: true }).click();
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  await person
    .getByRole("button", { name: "Добавить фото", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Фото для печати",
    exact: true,
  });
  const selected = Date.now();
  await dialog.getByLabel("Выбрать фотографию").setInputFiles(fixture);
  await expect(
    dialog.getByRole("button", { name: "Сохранить фото", exact: true }),
  ).toBeEnabled();
  const selectToCropReadyMs = Date.now() - selected;
  await dialog
    .getByRole("combobox", { name: "Поворот", exact: true })
    .selectOption("90");
  await dialog.getByLabel("Масштаб", { exact: true }).fill("1.55");
  await dialog.getByLabel("По горизонтали", { exact: true }).fill("27");
  await dialog.getByLabel("По вертикали", { exact: true }).fill("73");
  await page.screenshot({
    path: path.join(evidence, "large-photo-selected.png"),
    fullPage: true,
  });
  const nativePreparation = await page.evaluate(
    () => (window as any).photoNative,
  );
  const uploadResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/photos") &&
      response.request().method() === "POST",
  );
  const clickedSave = Date.now();
  await dialog
    .getByRole("button", { name: "Сохранить фото", exact: true })
    .click();
  const response = await uploadResponse;
  expect(response.status()).toBe(201);
  const uploaded = await response.json();
  await expect(dialog).toHaveCount(0);
  const saveToAttachedMs = Date.now() - clickedSave;
  const uploadFields = await page.evaluate(
    () => (window as any).photoSubmitted[0],
  );
  const savedResponse = await page.request.get(
    `/api/print-requests/${requestId}`,
  );
  const saved = await savedResponse.json();
  expect(saved.items[0].photoAssetId).toBe(uploaded.assetId);
  expect(saved.documents).toHaveLength(0);
  await page.reload();
  await expect(
    person.getByRole("button", { name: "Изменить фото", exact: true }),
  ).toBeVisible();
  const reloaded = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(reloaded.items[0].id).toBe(saved.items[0].id);
  expect(reloaded.items[0].photoAssetId).toBe(uploaded.assetId);
  const imageStarted = Date.now();
  const imageResponse = await page.request.get(
    `/api/photos/${uploaded.assetId}`,
  );
  expect(imageResponse.status()).toBe(200);
  const normalized = await imageResponse.body();
  const crop = uploadFields.crop;
  const expectedNormalized = await sharp(bytes)
    .autoOrient()
    .rotate(uploadFields.rotation)
    .extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    })
    .resize({
      width: 1200,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  expect(sha(normalized)).toBe(sha(expectedNormalized));
  await fs.writeFile(path.join(evidence, "normalized-photo.png"), normalized);
  const imageReadMs = Date.now() - imageStarted;
  await page.screenshot({
    path: path.join(evidence, "large-photo-after-reload.png"),
    fullPage: true,
  });
  await page.goto(`/api/photos/${uploaded.assetId}`);
  await expect(page.locator("img")).toBeVisible();
  expect(
    await page
      .locator("img")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "normalized-photo-open.png"),
  });
  expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(/^\/demo_test/);
  const db = new PrismaClient();
  let originalBytesPreserved: boolean;
  try {
    const stored = await db.photoAsset.findFirstOrThrow({
      where: { id: uploaded.assetId, tenantId: process.env.DEMO_E2E_TENANT_ID },
    });
    const original = await new ArtifactStore().read(stored.originalStorageKey);
    originalBytesPreserved = sha(original) === sha(bytes);
    expect(originalBytesPreserved).toBe(true);
  } finally {
    await db.$disconnect();
  }
  await fs.writeFile(
    path.join(evidence, "photo-live-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        origin: process.env.DEMO_ORIGIN,
        browser: browser.version(),
        requestId,
        recipientId: saved.items[0].id,
        assetId: uploaded.assetId,
        bytes: bytes.length,
        sourceSha256: sha(bytes),
        normalizedSha256: sha(normalized),
        normalizedWidth: uploaded.width,
        normalizedHeight: uploaded.height,
        originalBytesPreserved,
        uploadFields,
        normalizedMatchesSubmittedFrame: true,
        selectToCropReadyMs,
        nativePreparation,
        saveToAttachedMs,
        imageReadMs,
        timings,
        persistedAfterReload: true,
        realHttp: true,
        noIssuance: true,
        syntheticOnly: true,
      },
      null,
      2,
    ),
  );
});
