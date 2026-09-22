import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import https from "node:https";
import type { TLSSocket } from "node:tls";

const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    "../../docs/evidence/commercial-acceptance/browser/generated-photo",
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

test("generated portrait: upload, crop, refresh, preview, issue and exact embedded photo", async ({
  page,
  browser,
}) => {
  test.skip(
    !fixture,
    "This acceptance uses an explicitly generated fictional portrait, supplied by DEMO_E2E_PORTRAIT.",
  );
  test.setTimeout(Math.max(300000, templates.length * 180000));
  await fs.mkdir(evidence, { recursive: true });
  const strictTlsProof = await verifyLocalTls();
  const navigation = await page.goto("/login");
  const tlsDetails = await navigation?.securityDetails();
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill(process.env.DEMO_E2E_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.DEMO_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  const secureTransport = page.url().startsWith("https:");
  const sessionCookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.startsWith("demo_"),
  );
  if (secureTransport) {
    expect(tlsDetails).toBeTruthy();
    expect(sessionCookies.length).toBeGreaterThan(0);
    expect(sessionCookies.every((cookie) => cookie.secure)).toBe(true);
  }
  const resumeRequest = process.env.DEMO_E2E_RESUME_REQUEST;
  let photoBytes: Buffer;
  if (resumeRequest) {
    // Only an explicitly identified acceptance request may be resumed. This
    // branch reads the finalized result without changing its draft or numbers.
    await page.goto(`/requests/${resumeRequest}/edit`);
    const existingPhoto = page.getByRole("img", { name: "Фото получателя" });
    await expect(existingPhoto).toBeVisible();
    const response = await page.request.get(
      (await existingPhoto.getAttribute("src"))!,
    );
    expect(response.ok()).toBe(true);
    photoBytes = await response.body();
    await fs.writeFile(
      path.join(evidence, "normalized-portrait.png"),
      photoBytes,
    );
  } else {
    await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
    await page.getByRole("button", { name: /Человек Документы/ }).click();
    await page
      .getByLabel("Название заявки", { exact: true })
      .fill(`ТЕСТ · созданный портрет · ${template} · ${Date.now()}`);
    await page
      .getByLabel("ФИО RU, строка 1")
      .fill("Тестовый Вымышленный Получатель");
    await page.getByLabel("ФИО KZ, строка 1").fill("Сынақ Әли Қасымұлы");
    const demoMode = page.getByLabel("Тестовый комплект", { exact: true });
    if (await demoMode.isEnabled()) await demoMode.check();
    else await expect(demoMode).toBeChecked();
    for (const [index, id] of templates.entries()) {
      if (index > 0)
        await page
          .getByRole("button", { name: "Добавить документ", exact: true })
          .click();
      const assignment = page.locator(".assignment-list details").nth(index);
      if (!(await assignment.getAttribute("open"))) {
        // Boolean HTML attributes may be the empty string, so inspect the property.
        if (
          !(await assignment.evaluate(
            (element) => (element as HTMLDetailsElement).open,
          ))
        )
          await assignment.locator("summary").click();
      }
      await assignment
        .getByLabel("Форма документа", { exact: true })
        .selectOption(id);
      await assignment
        .getByLabel("Дата документа", { exact: true })
        .fill("2026-09-22");
      await assignment
        .getByLabel("Действителен до", { exact: true })
        .fill("2027-09-22");
      await assignment
        .getByLabel("Дата протокола", { exact: true })
        .fill("2026-09-22");
      await assignment
        .getByLabel("Программа / тема обучения", { exact: true })
        .fill("Тестовая программа безопасности");
      await assignment
        .getByLabel("Подтверждённый результат / оценка")
        .fill("ТЕСТ: хорошо / жақсы");
    }
    await page.getByRole("tab", { name: "Личные данные", exact: true }).click();
    await page.getByLabel("Должность · RU", { exact: true }).fill("Инженер");
    await page.getByLabel("Должность · KZ", { exact: true }).fill("Инженер");
    await page
      .getByLabel("Место работы · RU", { exact: true })
      .fill("Тестовая организация");
    await page
      .getByLabel("Место работы · KZ", { exact: true })
      .fill("Сынақ ұйымы");
    await page.getByRole("button", { name: "Фото", exact: true }).click();
    await page.getByLabel("Выбрать фотографию").setInputFiles(fixture!);
    await expect(
      page.getByRole("button", { name: "Сохранить фото", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: path.join(evidence, "portrait-crop.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Сохранить фото", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.locator(".save-indicator")).toContainText("Сохранено");
    await page.reload();
    const img = page.getByRole("img", { name: "Фото получателя" });
    await expect(img).toBeVisible();
    const photo = await page.request.get((await img.getAttribute("src"))!);
    expect(photo.ok()).toBe(true);
    photoBytes = await photo.body();
    await fs.writeFile(
      path.join(evidence, "normalized-portrait.png"),
      photoBytes,
    );
    await page.getByRole("button", { name: "Проверить", exact: true }).click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Предпросмотр", exact: true })
      .click();
    const view = page
      .getByRole("button", { name: "Посмотреть", exact: true })
      .first();
    await expect(view).toBeVisible({ timeout: 180000 });
    await view.click();
    const preview = await page.request.get(
      (await page.locator("iframe").getAttribute("src"))!,
    );
    expect(preview.headers()["content-type"]).toContain("application/pdf");
    await fs.writeFile(
      path.join(evidence, "browser-preview.pdf"),
      await preview.body(),
    );
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(evidence, "pdf-preview.png") });
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page
      .getByRole("button", { name: "Оформить комплект", exact: true })
      .click();
    await page.getByRole("button", { name: "Оформить", exact: true }).click();
    await expect(page.locator(".title-with-status .status")).toHaveText(
      "Оформлено",
    );
  }
  const artifactCount = templates.length * 4 + 2;
  await expect(page.locator(".files-panel")).toContainText(
    `Готово ${artifactCount} из ${artifactCount}`,
    { timeout: Math.max(180000, templates.length * 120000) },
  );
  await page.screenshot({
    path: path.join(evidence, "issued-portrait.png"),
    fullPage: true,
  });
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const snapshot = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(snapshot.issuances).toHaveLength(1);
  expect(snapshot.documents).toHaveLength(templates.length);
  expect(snapshot.artifacts).toHaveLength(artifactCount);
  expect(
    snapshot.issuances[0].snapshot.draft.items[0].photoAssetId,
  ).toBeTruthy();
  const artifacts = [];
  let embeddedMatches = 0;
  for (const artifact of snapshot.artifacts) {
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
    embeddedMatches += media.filter(
      (entry) => entry.matchesUploadedPhoto,
    ).length;
    artifacts.push({
      file,
      format: artifact.format,
      provenance: artifact.provenance,
      sha256: sha(bytes),
      bytes: bytes.length,
      media,
    });
  }
  const expectedPhotoMatches =
    snapshot.issuances[0].snapshot.templates.filter(
      (item: { contract: { photo: boolean } }) => item.contract.photo,
    ).length * 2;
  expect(embeddedMatches).toBe(expectedPhotoMatches);
  await fs.writeFile(
    path.join(evidence, "photo-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        scenario: resumeRequest
          ? "Readback of the same finalized acceptance request; no second issuance"
          : "Complete upload, crop, preview and issue browser cycle",
        origin: process.env.DEMO_ORIGIN,
        requestId,
        requestUrl: page.url(),
        browserVersion: browser.version(),
        syntheticDataOnly: true,
        transport: {
          https: secureTransport,
          securityDetails: tlsDetails,
          strictTlsProof,
          browserLeafSpkiPin: process.env.DEMO_E2E_CERT_SPKI || null,
          nodeExtraCaFile: process.env.NODE_EXTRA_CA_CERTS
            ? path.basename(process.env.NODE_EXTRA_CA_CERTS)
            : null,
          cookies: sessionCookies.map(
            ({ name, secure, httpOnly, sameSite }) => ({
              name,
              secure,
              httpOnly,
              sameSite,
            }),
          ),
        },
        portraitSource: path.basename(fixture!),
        portraitSourceSha256: sha(await fs.readFile(fixture!)),
        normalizedPhotoSha256: sha(photoBytes),
        exactEmbeddedPhotoMatches: embeddedMatches,
        templates: snapshot.issuances[0].snapshot.templates.map(
          (item: {
            contract: { id: string };
            version: string;
            checksum: string;
          }) => ({
            id: item.contract.id,
            version: item.version,
            sha256: item.checksum,
          }),
        ),
        artifacts,
      },
      null,
      2,
    ),
  );
});
