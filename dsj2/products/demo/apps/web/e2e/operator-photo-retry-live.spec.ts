import {
  assertTechnicalBlankRemoval,
  createRequestWithWorkerDocument,
  openRecipientExtraTools,
} from "./operator-keyboard-helpers";
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { loginIsolated } from "./operator-full-fix-session";
const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/operator/photo-retry"),
);

test("real photo throttle can be cancelled and resumed without reuploading accepted files", async ({
  page,
}) => {
  test.setTimeout(360000);
  await fs.mkdir(evidence, { recursive: true });
  await page.routeWebSocket(/\/_next\/webpack-hmr/, (socket) => socket.close());
  const acceptedAssets: Promise<string>[] = [];
  let throttles = 0;
  page.on("response", (response) => {
    if (
      response.url().endsWith("/api/photos") &&
      response.request().method() === "POST"
    ) {
      if (response.status() === 429) throttles++;
      if (response.ok())
        acceptedAssets.push(
          response.json().then((value) => value.assetId || value.id),
        );
    }
  });
  await loginIsolated(page);
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await assertTechnicalBlankRemoval(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  const keys = Array.from(
    { length: 31 },
    (_, index) => `PHOTO-RETRY-${Date.now()}-${index}`,
  );
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      [
        "externalId\tfullNameRu",
        ...keys.map(
          (key, index) => `${key}\tСинтетическая фотография ${index}`,
        ),
      ].join("\n"),
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить 31 строк в черновик", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toContainText(
    "Рабочая версия сохранена",
  );
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  await openRecipientExtraTools(page);
  await page
    .getByRole("button", { name: "Сопоставить фото", exact: true })
    .click();
  const bytes = await fs.readFile(
    path.join(product, "tests/fixtures/source-photo.png"),
  );
  await page.getByLabel("Фотографии PNG/JPEG", { exact: true }).setInputFiles(
    keys.map((key) => ({
      name: `${key}.png`,
      mimeType: "image/png",
      buffer: bytes,
    })),
  );
  await page
    .getByLabel(
      "Проверены однозначные совпадения: применить 31 фото. Остальные строки сохранить.",
    )
    .check();
  await page
    .getByRole("button", { name: "Применить 31 фото", exact: true })
    .click();
  await expect.poll(() => throttles, { timeout: 90000 }).toBeGreaterThan(0);
  await expect
    .poll(() => acceptedAssets.length, { timeout: 90000 })
    .toBeGreaterThan(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Сервер ограничил частоту загрузки" }),
  ).toBeVisible();
  const beforeCancel = await Promise.all(acceptedAssets);
  expect(beforeCancel.length).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Остановить загрузку", exact: true })
    .click();
  await expect(page.getByText(/Загрузка остановлена/)).toBeVisible();
  const unapplied = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(
    unapplied.items.every(
      (item: { photoAssetId: string | null }) => !item.photoAssetId,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Применить 31 фото", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 240000 });
  await page.reload();
  const applied = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(applied.items).toHaveLength(31);
  expect(
    applied.items.every(
      (item: { photoAssetId: string | null }) => !!item.photoAssetId,
    ),
  ).toBe(true);
  const accepted = await Promise.all(acceptedAssets);
  expect(accepted).toHaveLength(31);
  expect(new Set(accepted).size).toBe(31);
  expect(
    new Set(
      applied.items.map((item: { photoAssetId: string }) => item.photoAssetId),
    ),
  ).toEqual(new Set(accepted));
  expect(beforeCancel.every((assetId) => accepted.includes(assetId))).toBe(
    true,
  );
  expect(applied.documents).toHaveLength(0);
  await fs.writeFile(
    path.join(evidence, "photo-retry-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        photos: 31,
        real429Responses: throttles,
        acceptedBeforeCancellation: beforeCancel.length,
        acceptedAfterResume: accepted.length,
        acceptedFilesUploadedExactlyOnce: true,
        cancellationAppliedNoPhotos: true,
        persistedAfterReload: true,
        noIssuance: true,
        noMocks: true,
      },
      null,
      2,
    ),
  );
});
