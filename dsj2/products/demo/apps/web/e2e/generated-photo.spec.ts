import { legacyPrintFixture } from "./operator-legacy-lifecycle-fixture";
import { newAssignment, type Assignment } from "../lib/types";
test.use({ trace: "off" });
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import https from "node:https";
import type { TLSSocket } from "node:tls";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE
    ? path.join(process.env.DEMO_E2E_EVIDENCE, "generated-photo")
    : "../../docs/evidence/commercial-acceptance/browser/generated-photo",
);
const fixture = process.env.DEMO_E2E_PORTRAIT;
const template = process.env.DEMO_E2E_PHOTO_TEMPLATE || "pb-card";
const templates = (process.env.DEMO_E2E_PHOTO_TEMPLATES || template).split(",");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function verifyLocalTls() {
  const origin = process.env.DEMO_ORIGIN!;
  if (!origin.startsWith("https:")) return null;
  expect(process.env.NODE_EXTRA_CA_CERTS).toBeTruthy();
  const probe = (emptyTrust: boolean) =>
    new Promise<{
      status: number;
      authorized: boolean;
      protocol: string | null;
      peerFingerprint: string;
    }>((resolve, reject) => {
      const request = https.get(
        `${origin}/login`,
        {
          rejectUnauthorized: true,
          // Independent trust controls require independent TLS handshakes.
          agent: false,
          ...(emptyTrust ? { ca: [] } : {}),
        },
        (response) => {
          const socket = response.socket as TLSSocket;
          const proof = {
            status: response.statusCode!,
            authorized: socket.authorized,
            protocol: socket.getProtocol(),
            peerFingerprint: socket.getPeerCertificate().fingerprint256,
          };
          response.resume();
          response.on("end", () => resolve(proof));
        },
      );
      request.setTimeout(15000, () =>
        request.destroy(new Error("TLS_PROBE_TIMEOUT")),
      );
      request.on("error", reject);
    });
  const verified = await probe(false);
  expect(verified.status).toBe(200);
  expect(verified.authorized).toBe(true);
  let untrustedError = "";
  try {
    await probe(true);
  } catch (error) {
    untrustedError = (error as NodeJS.ErrnoException).code || String(error);
  }
  expect(untrustedError).toMatch(/CERT|SELF_SIGNED|VERIFY/);
  return {
    ...verified,
    emptyTrustRejectedWith: untrustedError,
    mode: "Node extra CA, rejectUnauthorized=true; browser pin isolated to its temporary profile",
  };
}
function mediaEntries(bytes: Buffer) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("DOCX ZIP directory missing");
  let cursor = bytes.readUInt32LE(end + 16);
  const found = [];
  for (let n = 0; n < bytes.readUInt16LE(end + 10); n++) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    if (name.startsWith("word/media/")) {
      const local = bytes.readUInt32LE(cursor + 42);
      const start =
        local +
        30 +
        bytes.readUInt16LE(local + 26) +
        bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(
        start,
        start + bytes.readUInt32LE(cursor + 20),
      );
      found.push({
        name,
        bytes:
          bytes.readUInt16LE(cursor + 10) === 8
            ? inflateRawSync(compressed)
            : compressed,
      });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

test("synthetic photo fixture: actual upload, crop, reload, preview, director decision and exact embedded saved image", async ({
  page,
  browser,
}) => {
  if (!fixture) throw new Error("EXPLICIT_SYNTHETIC_PHOTO_FIXTURE_REQUIRED");
  test.setTimeout(Math.max(360000, templates.length * 180000));
  await fs.mkdir(evidence, { recursive: true });
  const strictTlsProof = await verifyLocalTls();
  const f = await legacyPrintFixture(page, browser);
  try {
    await f.patch((draft) => {
      draft.items[0].fullNameRu = "Тестовый Получатель Фото";
      draft.items[0].fullNameKz = "Сынақ Әли Қасымұлы";
      draft.items[0].positionRu = "Инженер";
      draft.items[0].positionKz = "Инженер";
      draft.items[0].workplaceRu = "Тест Альфа";
      draft.items[0].workplaceKz = "Тест Альфа";
      draft.items[0].employeeCategory = templates.some((id) =>
        id.startsWith("biot-itr-"),
      )
        ? "ITR"
        : "WORKER";
      draft.items[0].assignments = templates.map((id) => ({
        ...newAssignment(id as Assignment["templateId"]),
        documentDate: "2026-10-03",
        protocolDate: "2026-10-03",
        trainingStart: "2026-10-01",
        trainingEnd: "2026-10-02",
        ...(!id.startsWith("biot-") ? { hours: "16" } : {}),
        trainingSubject: "Тестовая программа безопасности",
        result: "Сдал / Тапсырды (ТЕСТ)",
        outcome: {
          status: "PASSED",
          source:
            "СИНТЕТИЧЕСКАЯ известная ведомость embedded-photo fixture; не реальное обучение",
        },
        ...(id.startsWith("biot-itr-")
          ? {
              biotKnowledgeResult: "ТЕСТ:92 из100",
              biotProctoringResult: "ТЕСТ: прошел",
            }
          : {}),
      }));
    });
    await page
      .locator(".person-editor")
      .getByRole("button", { name: "Добавить фото", exact: true })
      .click();
    const photoDialog = page.getByRole("dialog", {
      name: "Фото для печати",
      exact: true,
    });
    await photoDialog.getByLabel("Выбрать фотографию").setInputFiles(fixture);
    await expect(
      photoDialog.getByRole("button", { name: "Сохранить фото", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: path.join(evidence, "portrait-crop.png"),
      fullPage: true,
    });
    await photoDialog
      .getByRole("button", { name: "Сохранить фото", exact: true })
      .click();
    await expect(photoDialog).toHaveCount(0);
    await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
    await page.reload();
    const img = page.locator(".person-editor").getByRole("img", {
      name: "Фото получателя",
      exact: true,
    });
    await expect(img).toBeVisible();
    const photo = await page.request.get((await img.getAttribute("src"))!);
    expect(photo.ok()).toBe(true);
    const photoBytes = await photo.body();
    await fs.writeFile(path.join(evidence, "normalized-photo.png"), photoBytes);
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await page
      .locator(".person-editor")
      .getByRole("button", { name: /^Предпросмотр:/ })
      .first()
      .click();
    const previewDialog = page.getByRole("dialog", {
      name: "Предпросмотр документа",
      exact: true,
    });
    await previewDialog
      .getByRole("button", { name: "Создать предпросмотр", exact: true })
      .click();
    await expect(
      previewDialog.getByRole("img", { name: /^Страница 1 из/ }),
    ).toBeVisible({ timeout: 150000 });
    const preview = await page.request.get(
      (await previewDialog
        .getByRole("link", { name: "Открыть PDF", exact: true })
        .getAttribute("href"))!,
    );
    expect(preview.headers()["content-type"]).toContain("application/pdf");
    await fs.writeFile(
      path.join(evidence, "browser-preview.pdf"),
      await preview.body(),
    );
    const previewWord = await page.request.get(
      (await previewDialog
        .getByRole("link", { name: "Скачать DOCX", exact: true })
        .getAttribute("href"))!,
    );
    expect(previewWord.ok()).toBe(true);
    expect(
      mediaEntries(await previewWord.body()).some(
        (media) => sha(media.bytes) === sha(photoBytes),
      ),
    ).toBe(true);
    await fs.writeFile(
      path.join(evidence, "browser-preview.docx"),
      await previewWord.body(),
    );
    await page.screenshot({ path: path.join(evidence, "pdf-preview.png") });
    await previewDialog
      .getByRole("button", { name: "Закрыть диалог", exact: true })
      .click();
    const snapshot = await f.issue();
    expect(snapshot.issuances).toHaveLength(1);
    expect(
      snapshot.issuances[0].snapshot.draft.items[0].photoAssetId,
    ).toBeTruthy();
    await page.screenshot({
      path: path.join(evidence, "issued-photo.png"),
      fullPage: true,
    });
    const artifacts = [];
    let embeddedMatches = 0;
    for (const artifact of snapshot.artifacts.filter((a) =>
      ["PDF", "DOCX"].includes(a.format || ""),
    )) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      expect(sha(bytes)).toBe(artifact.sha256);
      const file = `${artifact.id}-${artifact.fileName}`;
      await fs.writeFile(path.join(evidence, file), bytes);
      const media =
        artifact.format === "DOCX"
          ? mediaEntries(bytes).map((entry) => ({
              name: entry.name,
              sha256: sha(entry.bytes),
              matchesUploadedPhoto: sha(entry.bytes) === sha(photoBytes),
            }))
          : [];
      embeddedMatches += media.filter((m) => m.matchesUploadedPhoto).length;
      artifacts.push({
        file,
        format: artifact.format,
        provenance: artifact.provenance,
        sha256: sha(bytes),
        bytes: bytes.length,
        media,
      });
    }
    // Count actual rendered individual photo-bearing forms, not training choices;
    // mandatory companion kits may add supported forms without a photo slot.
    const actual = await page.request.get(`/api/print-requests/${f.id}`);
    const full = await actual.json();
    const photoTemplates = full.issuances[0].snapshot.templates.filter(
      (t: { contract: { photo: boolean } }) => t.contract.photo,
    ).length;
    expect(embeddedMatches).toBe(photoTemplates * 2);
    expect(embeddedMatches).toBeGreaterThan(0);
    await fs.writeFile(
      path.join(evidence, "photo-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          scenario:
            "Actual UI upload/crop/reload/preview/generate after real director decision; exact normalized image embedded in saved DOCX",
          fixtureMeaning:
            "Explicit synthetic test image only; no real human portrait or human crop-quality claim",
          origin: process.env.DEMO_ORIGIN,
          requestId: f.id,
          browserVersion: browser.version(),
          syntheticDataOnly: true,
          transport: { https: page.url().startsWith("https:"), strictTlsProof },
          photoSource: path.basename(fixture),
          photoSourceSha256: sha(await fs.readFile(fixture)),
          normalizedPhotoSha256: sha(photoBytes),
          exactEmbeddedPhotoMatches: embeddedMatches,
          documentCount: snapshot.documents.length,
          officialUnsignedDelivery: "blocked409",
          artifacts,
        },
        null,
        2,
      ),
    );
  } finally {
    await f.roles.close();
  }
});
