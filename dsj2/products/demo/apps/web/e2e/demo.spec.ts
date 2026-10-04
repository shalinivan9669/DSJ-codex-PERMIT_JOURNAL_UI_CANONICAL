import {
  assertTechnicalBlankRemoval,
  createRequestWithWorkerDocument,
  keyboardCreateRequestWithWorkerDocument,
} from "./operator-keyboard-helpers";
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { loginIsolated } from "./operator-full-fix-session";
import {
  legacyPrintFixture,
  openLegacyPersonal,
  setLegacyKz,
  savedLegacyDraft,
  keepLegacyOriginals,
} from "./operator-legacy-lifecycle-fixture";
import {
  realApprovalRoles,
  readPrintDetail,
  waitOriginalJobs,
  write,
} from "./operator-role-fixture";
import { draftPayload } from "../lib/types";
import { PrismaClient } from "../../../packages/database/src";
import { ArtifactStore } from "../../../packages/printing/src";
import { assertTestDatabase } from "../../../tests/integration/test-database";
test.use({ trace: "off" });
const evidence = process.env.DEMO_E2E_EVIDENCE
  ? path.resolve(process.env.DEMO_E2E_EVIDENCE)
  : path.resolve(__dirname, "../../../docs/evidence/browser");
test.beforeEach(async ({ context }) => {
  await context.routeWebSocket("**/_next/webpack-hmr", (socket) =>
    socket.close(),
  );
});
test.beforeAll(async ({ browser }) => {
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "environment.json"),
    JSON.stringify(
      {
        browser: browser.browserType().name(),
        browserVersion: browser.version(),
        channel: process.env.DEMO_E2E_CHANNEL || "playwright-pinned",
        node: process.version,
        platform: process.platform,
        origin: process.env.DEMO_ORIGIN || "http://localhost:3100",
        syntheticDataOnly: true,
      },
      null,
      2,
    ),
  );
});
function zipEntry(bytes: Buffer, wanted: string) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP directory missing");
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    if (name === wanted) {
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
      return bytes.readUInt16LE(cursor + 10) === 8
        ? inflateRawSync(compressed)
        : compressed;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry missing: ${wanted}`);
}
function zipText(bytes: Buffer, wanted: string) {
  return zipEntry(bytes, wanted).toString("utf8");
}
/** Internal read-only worker-byte QA in the disposable synthetic center, never public delivery. */
async function internalCanonicalZipBytes(
  page: Page,
  issued: Awaited<ReturnType<typeof readPrintDetail>>,
) {
  assertTestDatabase();
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  expect(process.env.DEMO_ARTIFACT_ROOT).toBeTruthy();
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session.tenant.demoOnly).toBe(true);
  const db = new PrismaClient({ log: [] });
  try {
    const tenant = await db.tenant.findUnique({
      where: { id: session.tenant.id },
      select: { demoOnly: true },
    });
    expect(tenant?.demoOnly).toBe(true);
    const stored = await db.artifact.findMany({
      where: {
        tenantId: session.tenant.id,
        requestId: issued.id!,
        issuanceId: issued.issuances[0].id,
        provenance: "ORIGINAL",
        format: "ZIP",
      },
    });
    expect(stored.map((artifact) => artifact.id).sort()).toEqual(
      issued.artifacts.filter((artifact) => artifact.provenance === "ORIGINAL" && artifact.format === "ZIP").map((artifact) => artifact.id).sort(),
    );
    const storage = new ArtifactStore(process.env.DEMO_ARTIFACT_ROOT!);
    const bytes = new Map<string, Buffer>();
    for (const artifact of stored) {
      const buffer = await storage.read(artifact.storageKey, artifact.sha256);
      expect(buffer.length).toBe(artifact.size);
      bytes.set(artifact.id, buffer);
    }
    return bytes;
  } finally {
    await db.$disconnect();
  }
}
async function login(page: Page) {
  await loginIsolated(page);
}
async function newPerson(page: Page) {
  await page.getByRole("link", { name: "Новая заявка", exact: true }).click();
  await createRequestWithWorkerDocument(page, "PERSON");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toBeVisible();
}
async function save(page: Page) {
  await page.getByLabel("ФИО, строка 1", { exact: true }).blur();
  await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
}
test("person: bilingual refresh, final characters, real preview and immutable original files remain linked to a reasoned correction", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const title = `СИНТЕТИЧЕСКИЙ человек ${Date.now()}`;
  const f = await legacyPrintFixture(page, browser, { title });
  try {
    const initial = await f.read();
    expect(initial.title).toBe(initial.items[0].fullNameRu);
    await page
      .getByLabel("ФИО, строка 1", { exact: true })
      .fill("Проверочный Иван Васильевич");
    await setLegacyKz(page, "Тексеру Әли Қасымұлы");
    const details = await openLegacyPersonal(page);
    await details.getByRole("button", { name: "Фото", exact: true }).click();
    const photo = page.getByRole("dialog", {
      name: "Фото для печати",
      exact: true,
    });
    await photo
      .getByLabel("Выбрать фотографию")
      .setInputFiles(
        path.resolve(__dirname, "../../../tests/fixtures/source.png"),
      );
    await photo.getByLabel("Поворот", { exact: true }).selectOption("90");
    await photo
      .getByRole("button", { name: "Сохранить фото", exact: true })
      .click();
    await expect(photo).toHaveCount(0);
    await expect(
      details.getByRole("img", { name: "Фото получателя" }),
    ).toBeVisible();
    await details
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .click();
    await savedLegacyDraft(page);
    await page.reload();
    expect((await f.read()).items[0].fullNameKz).toBe("Тексеру Әли Қасымұлы");
    expect((await f.read()).items[0].photoAssetId).toBeTruthy();
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .click();
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Посмотреть документы", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await f.read()).artifacts.filter(
            (a) => a.provenance === "PREVIEW" && a.format === "PDF",
          ).length,
        { timeout: 240000 },
      )
      .toBe(2);
    await page
      .locator(".files-panel")
      .getByRole("button", { name: "Обновить", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Просмотр PDF", exact: true })
      .first()
      .click();
    const preview = page.getByRole("dialog", { name: "Предпросмотр PDF", exact: true });
    await expect(preview.getByRole("img", { name: /^Страница 1 из/ })).toBeVisible();
    const pdf = await page.request.get(
      (await preview.getByRole("link", { name: "Открыть PDF отдельно", exact: true }).getAttribute("href"))!,
    );
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    await page.screenshot({ path: path.join(evidence, "person-preview.png") });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Закрыть диалог", exact: true })
      .click();
    for (const width of [1366, 1920, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: path.join(evidence, `person-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await setLegacyKz(page, "Тексеру Әли Қасымұлы соңғы І");
    await expect
      .poll(async () => (await f.read()).items[0].fullNameKz)
      .toBe("Тексеру Әли Қасымұлы соңғы І");
    await expect(page.locator(".files-panel")).toContainText(
      /устарел|после создания предпросмотра/,
    );
    const issued = await f.issue();
    expect(issued.issuances).toHaveLength(1);
    expect(issued.documents).toHaveLength(2);
    const files = await keepLegacyOriginals(
      page,
      f.id,
      path.join(evidence, `person-${f.id}`),
    );
    expect(files).toHaveLength(4);
    const original = files.find((x) => x.format === "PDF")!;
    await page
      .getByRole("button", { name: "Создать исправление", exact: true })
      .click();
    const correction = page.getByRole("dialog", {
      name: "Создать связанную заявку на исправление",
      exact: true,
    });
    await correction
      .getByLabel("Причина", { exact: true })
      .fill("СИНТЕТИЧЕСКАЯ проверка согласованного исправления опечатки");
    await correction
      .getByRole("button", { name: "Создать исправление", exact: true })
      .click();
    await expect(page).not.toHaveURL(new RegExp(`/requests/${f.id}(?:/edit)?$`));
    await expect(page).toHaveURL(/\/requests\/[^/]+\/edit$/);
    const copyId = /requests\/([^/]+)/.exec(page.url())![1];
    expect(copyId).not.toBe(f.id);
    const copy = await readPrintDetail(page, copyId);
    expect(copy.status).toBe("DRAFT");
    expect(copy.items[0].fullNameKz).toBe("Тексеру Әли Қасымұлы соңғы І");
    const reread = await f.read();
    expect(reread.issuances).toEqual(issued.issuances);
    expect(reread.documents).toEqual(issued.documents);
    expect(
      createHash("sha256")
        .update(
          await (
            await page.request.get(`/api/artifacts/${original.id}`)
          ).body(),
        )
        .digest("hex"),
    ).toBe(original.sha256);
    await fs.writeFile(
      path.join(evidence, "person-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          requestId: f.id,
          correctionId: copyId,
          originalSha256: original.sha256,
          documentCount: 2,
          confirmedSyntheticSource: true,
          officialUnsignedDelivery: "blocked409",
        artifacts: files.map(({ bytes: _bytes, ...meta }) => meta),
        },
        null,
        2,
      ),
    );
  } finally {
    await f.roles.close();
  }
});
test("network failure retains data, retry saves; concurrent editor conflict has a focus-managed choice", async ({
  page,
  context,
}) => {
  await login(page);
  await newPerson(page);
  await save(page);
  const url = page.url();
  await page.route("**/api/print-requests/*", (route) =>
    route.request().method() === "PATCH"
      ? route.abort("failed")
      : route.continue(),
  );
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Не потерять при обрыве");
  await expect(page.locator(".save-indicator")).toContainText("Не сохранено");
  await expect(page.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Не потерять при обрыве",
  );
  await page.unroute("**/api/print-requests/*");
  await page
    .getByRole("button", { name: "Повторить сохранение", exact: true })
    .click();
  await save(page);
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Не потерять при обрыве",
  );
  await page
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Сохранённая версия первого окна");
  await save(page);
  await other
    .getByLabel("ФИО, строка 1", { exact: true })
    .fill("Локальная версия второго окна");
  const conflict = other.getByRole("dialog", {
    name: "Заявка изменена в другом окне",
  });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByRole("button", { name: "Закрыть диалог", exact: true })).toBeFocused();
  await other.keyboard.press("Tab");
  await expect(
    conflict.getByRole("button", {
      name: "Загрузить версию сервера",
      exact: true,
    }),
  ).toBeFocused();
  await expect(other.getByLabel("ФИО, строка 1", { exact: true })).toHaveValue(
    "Локальная версия второго окна",
  );
  await other.keyboard.press("Escape");
  await expect(conflict).toHaveCount(0);
  await other.close();
});
test("company: 12 independent bilingual recipients and 18 training choices produce all 37 mandatory current forms", async ({
  page,
  browser,
}) => {
  test.setTimeout(720000);
  const f = await legacyPrintFixture(page, browser, {
    kind: "COMPANY",
    count: 12,
    extraSix: true,
  });
  try {
    // All source forms use the explicitly synthetic photo. The canonical ZIP
    // may comprise several bounded parts; every original must occur once.
    const syntheticPhoto = await page.request.post("/api/photos", {
      headers: f.roles.operator.headers,
      multipart: { file: { name: "shared-synthetic-blue.png", mimeType: "image/png", buffer: await fs.readFile(path.resolve(__dirname, "../../../tests/fixtures/source-photo.png")) } },
    });
    expect(syntheticPhoto.ok(), await syntheticPhoto.text()).toBe(true);
    const photo = await syntheticPhoto.json();
    await f.patch((draft) => { for (const row of draft.items) row.photoAssetId = photo.id; });
    const before = await f.read();
    expect(before.items).toHaveLength(12);
    await page
      .getByLabel("Дата выдачи, строка 12", { exact: true })
      .fill("2026-10-04");
    await expect
      .poll(async () => (await f.read()).items[11].assignments[0].documentDate)
      .toBe("2026-10-04");
    const edited = await f.read();
    for (let i = 0; i < 11; i++)
      expect(edited.items[i]).toEqual(before.items[i]);
    await page.reload();
    await expect(
      page.getByLabel("ФИО, строка 12", { exact: true }),
    ).toHaveValue(before.items[11].fullNameRu);
    await page.screenshot({
      path: path.join(evidence, "company-12.png"),
      fullPage: true,
    });
    const issued = await f.issue();
    expect(issued.documents).toHaveLength(37);
    expect(issued.issuances).toHaveLength(1);
    expect(
      issued.documents.filter((x) => x.templateId === "ps-witness"),
    ).toHaveLength(1);
    const files = await keepLegacyOriginals(
      page,
      f.id,
      path.join(evidence, `company-${f.id}`),
    );
    expect(files).toHaveLength(74);
    const originalSources = issued.artifacts.filter(
      (artifact) => artifact.provenance === "ORIGINAL" && artifact.format !== "ZIP",
    );
    expect(originalSources).toHaveLength(75);
    expect(originalSources.filter((artifact) => artifact.format === "DOCX")).toHaveLength(37);
    expect(originalSources.filter((artifact) => artifact.format === "PDF")).toHaveLength(37);
    expect(originalSources.filter((artifact) => artifact.format === "XLSX")).toHaveLength(1);
    const canonicalParts = issued.artifacts.filter(
      (artifact) => artifact.provenance === "ORIGINAL" && artifact.format === "ZIP",
    );
    expect(canonicalParts.length).toBeGreaterThan(0);
    const internalZipBytes = await internalCanonicalZipBytes(page, issued);
    const coveredSourceIds: string[] = [];
    const zipParts = [];
    for (const artifact of canonicalParts) {
      const response = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(response.status()).toBe(409);
      expect((await response.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
      const bytes = internalZipBytes.get(artifact.id)!;
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes.length).toBeLessThanOrEqual(100 * 1024 * 1024);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(artifact.sha256);
      const manifest = JSON.parse(zipText(bytes, "manifest.json")) as {
        complete: boolean;
        issuanceId: string;
        expectedCount: number;
        readyCount: number;
        partIndex?: number;
        partCount?: number;
        wholeExpectedCount?: number;
        files: Array<{ id: string; file: string; sha256: string }>;
        missing: unknown[];
      };
      expect(manifest.complete).toBe(true);
      expect(manifest.issuanceId).toBe(issued.issuances[0].id);
      expect(manifest.missing).toEqual([]);
      expect(manifest.expectedCount).toBe(manifest.files.length);
      expect(manifest.readyCount).toBe(manifest.files.length);
      expect(manifest.partCount || 1).toBe(canonicalParts.length);
      expect(manifest.wholeExpectedCount || manifest.expectedCount).toBe(75);
      for (const entry of manifest.files) {
        const source = originalSources.find((candidate) => candidate.id === entry.id);
        expect(source, `Unexpected ZIP source ${entry.id}`).toBeDefined();
        expect(entry.sha256).toBe(source!.sha256);
        expect(createHash("sha256").update(zipEntry(bytes, entry.file)).digest("hex")).toBe(source!.sha256);
        coveredSourceIds.push(entry.id);
      }
      await fs.writeFile(path.join(evidence, `company-${f.id}`, artifact.fileName || `${artifact.id}.zip`), bytes);
      zipParts.push({
        artifactId: artifact.id,
        fileName: artifact.fileName,
        sha256: artifact.sha256,
        bytes: bytes.length,
        index: manifest.partIndex || 0,
        scope: "INTERNAL_SAVED_DERIVATIVE_READONLY",
        publicUnsignedDelivery: "blocked409",
        manifest,
      });
    }
    expect(coveredSourceIds.sort()).toEqual(originalSources.map((artifact) => artifact.id).sort());
    expect(new Set(coveredSourceIds).size).toBe(75);
    expect(zipParts.map((part) => part.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: canonicalParts.length }, (_, index) => index),
    );
    for (const artifact of issued.artifacts.filter(
      (x) => x.provenance === "ORIGINAL" && x.format === "DOCX",
    )) {
      const doc = issued.documents.find((x) => x.id === artifact.documentId)!;
      const person = issued.items.find((x) => x.id === doc.rowId)!;
      const bytes = files.find((x) => x.id === artifact.id)!.bytes;
      const text = [
        ...zipText(bytes, "word/document.xml").matchAll(
          /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g,
        ),
      ]
        .map((x) => x[1])
        .join(" ");
      expect(text).toContain(person.fullNameRu);
      if (doc.templateId !== "pb-card") expect(text).toContain(person.fullNameKz);
      for (const other of issued.items.filter((x) => x.id !== person.id))
        expect(text).not.toContain(other.fullNameRu);
    }
    await fs.writeFile(
      path.join(evidence, "company-12-18-result.json"),
      JSON.stringify(
        {
          status: "PASS",
          requestId: f.id,
          recipientCount: 12,
          trainingSelections: 18,
          documentCount: 37,
          originalSourceArtifactCount: originalSources.length,
          canonicalZipPartCount: canonicalParts.length,
          actualOriginalArtifactCount: originalSources.length + canonicalParts.length,
          canonicalZipCoverage: zipParts,
        originalFiles: files.map(({ bytes: _bytes, ...meta }) => meta),
          originalItemIsolation: true,
          photoFixture: "All twelve rows explicitly use the same small synthetic blue image; no real portrait or no-photo ZIP success claimed",
          bilingualSourcePreserved: issued.items.every((row) => !!row.fullNameRu && !!row.fullNameKz),
          frozenPbCardNameScope: "Current unchanged PB card prints RU only; individual protocol and other supported forms retain their existing bilingual name mappings",
          officialUnsignedDelivery: "blocked409",
        },
        null,
        2,
      ),
    );
  } finally {
    await f.roles.close();
  }
});
test("251 imported rows are explained before apply; 250 save and all pages remain accessible by keyboard", async ({
  page,
}) => {
  const started = Date.now();
  let defaultsRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("defaults")) defaultsRequests++;
  });
  await login(page);
  await newPerson(page);
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const requestUrl = page.url();
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await assertTechnicalBlankRemoval(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      "ФИО RU\n" +
        Array.from({ length: 251 }, (_, i) => `Строка ${i + 1}`).join("\n"),
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await expect(
    page.getByText(/После импорта получится 251 получателей/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Добавить 251 строк в черновик" }),
  ).toBeDisabled();
  await page.screenshot({
    path: path.join(evidence, "import-251-limit.png"),
  });
  await page
    .getByLabel("Импортировать исходную строку 252", { exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Добавить 250 строк в черновик", exact: true })
    .click();
  await expect(page.getByLabel("ФИО, строка 250", { exact: true })).toHaveValue(
    "Строка 250",
  );
  await save(page);
  await page.reload();
  await expect(page.getByLabel("ФИО, строка 250", { exact: true })).toHaveValue(
    "Строка 250",
  );
  const savedResponse = await page.request.get(
    `/api/print-requests/${requestId}`,
  );
  expect(savedResponse.ok()).toBe(true);
  const saved = await savedResponse.json();
  expect(
    saved.items.map((item: { fullNameRu: string }) => item.fullNameRu),
  ).toEqual(Array.from({ length: 250 }, (_, index) => `Строка ${index + 1}`));
  expect(saved.status).toBe("DRAFT");
  expect(saved.documents).toHaveLength(0);
  await fs.writeFile(
    path.join(evidence, "import-250-timing.json"),
    JSON.stringify(
      {
        rows: 250,
        sourceRows: 251,
        excluded: 1,
        durationMs: Date.now() - started,
        defaultsRequests,
        browser: "Chromium",
        viewport: "1366x768",
        requestId,
        requestUrl,
      },
      null,
      2,
    ),
  );
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Или вставьте таблицу с заголовками")
    .fill(
      "ФИО RU\n" +
        Array.from({ length: 251 }, (_, i) => `Строка ${i + 1}`).join("\n"),
    );
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await expect(
    page.getByText("Уже добавлено из источника: 250", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Добавить 1 строк в черновик",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
  await expect(page.locator(".recipient-grid-table tbody tr")).toHaveCount(250);
  const repeatedResponse = await page.request.get(
    `/api/print-requests/${requestId}`,
  );
  expect(repeatedResponse.ok()).toBe(true);
  const repeated = await repeatedResponse.json();
  expect(repeated.items).toEqual(saved.items);
  expect(repeated.documents).toHaveLength(0);
  await page.screenshot({
    path: path.join(evidence, "import-250-saved.png"),
  });
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const name of ["Заказчики", "Архив", "Настройки", "Заявки"]) {
    await page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name, exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toBeVisible();
  }
  expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
  await fs.writeFile(
    path.join(evidence, "import-250-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        requestId,
        requestUrl,
        sourceRows: 251,
        capacityPreventedBeforeApply: true,
        excluded: 1,
        savedRows: saved.items.length,
        reimportRows: repeated.items.length,
        reimportUnchanged: true,
        draftOnly: true,
        navigationByKeyboard: ["Заказчики", "Архив", "Настройки", "Заявки"],
        durationMs: Date.now() - started,
      },
      null,
      2,
    ),
  );
});

test("keyboard creates and validates a person, traps focus in details, then generates after an actual director decision", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const roles = await realApprovalRoles(browser, page);
  await roles.configureSignatories();
  try {
    await page.getByRole("link", { name: "Новая заявка", exact: true }).focus();
    await page.keyboard.press("Enter");
    await keyboardCreateRequestWithWorkerDocument(page, "PERSON");
    const name = page.getByLabel("ФИО, строка 1", { exact: true });
    await name.focus();
    await page.keyboard.insertText("Клавиатурный Сценарий");
    const detailsButton = page.getByRole("button", {
      name: "Детали получателя 1",
      exact: true,
    });
    await detailsButton.focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("dialog", {
      name: "Настройки строки 1",
      exact: true,
    });
    await expect(details).toBeVisible();
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(
          () => !!document.activeElement?.closest("dialog[open]"),
        ),
      ).toBe(true);
    }
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(
        await page.evaluate(
          () => !!document.activeElement?.closest("dialog[open]"),
        ),
      ).toBe(true);
    }
    await details
      .getByRole("button", { name: "Вернуться к списку", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await savedLegacyDraft(page);
    const id = /requests\/([^/]+)/.exec(page.url())![1];
    const current = await readPrintDetail(page, id);
    current.items[0].positionRu = "Синтетический инженер";
    current.items[0].workplaceRu = "Тест Альфа";
    for (const event of current.events || [])
      event.commonFields = {
        ...event.commonFields,
        trainingSubject: "Тестовая программа БиОТ",
        trainingStart: "2026-10-01",
        trainingEnd: "2026-10-02",
        protocolDate: "2026-10-02",
        documentDate: "2026-10-03",
      };
    for (const row of current.items)
      for (const assignment of row.assignments) {
        assignment.result = "Сдал — известный тестовый результат";
        assignment.outcome = {
          status: "PASSED",
          source:
            "СИНТЕТИЧЕСКАЯ ведомость keyboard fixture, не реальное обучение",
        };
      }
    await write(
      page,
      roles.operator.headers,
      `/print-requests/${id}`,
      { expectedRevision: current.revision, draft: draftPayload(current) },
      "PATCH",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Проверить данные", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Данные прошли проверку", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".validation-result")).toBeFocused();
    await roles.approve(id);
    await page.reload();
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await readPrintDetail(page, id)).status)
      .toBe("FINALIZED");
    await waitOriginalJobs(page, id);
    expect((await readPrintDetail(page, id)).documents).toHaveLength(2);
    await page.screenshot({
      path: path.join(evidence, "keyboard-issued.png"),
      fullPage: true,
    });
  } finally {
    await roles.close();
  }
});
test("XLSX sheet selection, saved mapping, leading zeros, partial rows and row report", async ({
  page,
}) => {
  const mappingName = `Контроль Excel ${Date.now()}`;
  await login(page);
  await newPerson(page);
  await page
    .getByRole("button", { name: "Удалить получателя 1", exact: true })
    .click();
  await assertTechnicalBlankRemoval(page);
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Табличный файл")
    .setInputFiles(path.join(__dirname, "fixtures/import-multiple.xlsx"));
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await page.getByLabel("Лист таблицы").selectOption("Получатели");
  await expect(
    page.getByLabel("Поле для колонки Сотрудник", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Поле для колонки Сотрудник", { exact: true })
    .selectOption("fullNameRu");
  await page
    .getByLabel("Поле для колонки Аты", { exact: true })
    .selectOption("fullNameKz");
  await page
    .getByLabel("Поле для колонки Табельный код", { exact: true })
    .selectOption("externalBasisNumber");
  await page
    .getByRole("combobox", {
      name: "Документ для импортируемых строк",
      exact: true,
    })
    .selectOption("ptm-protocol");
  await page
    .getByRole("dialog")
    .locator(".import-mapping-options > summary")
    .click();
  await page
    .getByLabel("Название правила сопоставления", { exact: true })
    .fill(mappingName);
  await page
    .getByRole("button", { name: "Сохранить сопоставление", exact: true })
    .click();
  await expect(
    page.getByText("Сопоставление сохранено для вашего центра."),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать отчёт по строкам", exact: true })
    .click();
  await (await download).saveAs(path.join(evidence, "import-report.csv"));
  await page
    .getByRole("button", { name: "Добавить 2 строк в черновик", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Детали получателя 1", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: /^Личные данные/ })
    .click();
  await page
    .getByRole("dialog")
    .getByText(/^Казахский вариант/)
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("ФИО · KZ", { exact: true }),
  ).toHaveValue("Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: /^Документы/ })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("tab", { name: /^Настройки/ })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .locator(".assignment-list > details")
      .first()
      .getByLabel("Внешний номер основания", { exact: true }),
  ).toHaveValue("00123");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Вернуться к списку", exact: true })
    .click();
  const requestId = /requests\/([^/]+)/.exec(page.url())![1];
  const beforeReload = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(beforeReload.items[1].fullNameKz).toBe("");
  await save(page);
  await page.reload();
  const afterReload = await (
    await page.request.get(`/api/print-requests/${requestId}`)
  ).json();
  expect(afterReload.items).toEqual(beforeReload.items);
  expect(afterReload.items[0].assignments[0].externalBasisNumber).toBe("00123");
  await page
    .getByRole("button", { name: "Импорт / вставка", exact: true })
    .click();
  await page
    .getByLabel("Табличный файл")
    .setInputFiles(path.join(__dirname, "fixtures/import-multiple.xlsx"));
  await page
    .getByRole("button", { name: "Перейти к сопоставлению", exact: true })
    .click();
  await page.getByLabel("Лист таблицы").selectOption("Получатели");
  await page
    .getByRole("dialog")
    .locator(".import-mapping-options > summary")
    .click();
  await page
    .getByRole("combobox", { name: "Сохранённое сопоставление", exact: true })
    .selectOption({ label: mappingName });
  await expect(
    page.getByLabel("Поле для колонки Сотрудник", { exact: true }),
  ).toHaveValue("fullNameRu");
  await expect(
    page.getByLabel("Поле для колонки Аты", { exact: true }),
  ).toHaveValue("fullNameKz");
  await expect(
    page.getByLabel("Поле для колонки Табельный код", { exact: true }),
  ).toHaveValue("externalBasisNumber");
  await page
    .getByRole("button", { name: "Закрыть диалог", exact: true })
    .click();
});

test("failed-download UI supports reasoned reconstruction without renumbering or replacing originals", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const f = await legacyPrintFixture(page, browser);
  try {
    const before = await f.issue();
    const original = before.artifacts.find(
      (a) => a.provenance === "ORIGINAL" && a.format === "DOCX",
    )!;
    await page.route(`**/api/artifacts/${original.id}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Контрольный отказ чтения сохранённого файла",
        }),
      }),
    );
    await page.locator(`a[href="/api/artifacts/${original.id}"]`).click();
    await expect(
      page.getByText("Контрольный отказ чтения сохранённого файла", {
        exact: true,
      }),
    ).toBeVisible();
    const card = page
      .locator(".artifact-list article")
      .filter({ has: page.locator(`a[href="/api/artifacts/${original.id}"]`) });
    await card
      .getByRole("button", { name: "Восстановить файл", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Восстановить недоступный файл",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", {
        name: "Создать восстановленную копию",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Причина восстановления", { exact: true })
      .fill("СИНТЕТИЧЕСКАЯ проверка восстановленной копии через интерфейс");
    await page.unroute(`**/api/artifacts/${original.id}`);
    await dialog
      .getByRole("button", {
        name: "Создать восстановленную копию",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await waitOriginalJobs(page, f.id);
    await expect
      .poll(
        async () =>
          (await f.read()).artifacts.some(
            (a) => a.provenance === "RECONSTRUCTED",
          ),
        { timeout: 240000 },
      )
      .toBe(true);
    const after = await f.read();
    expect(after.documents).toEqual(before.documents);
    expect(after.issuances).toEqual(before.issuances);
    expect(after.artifacts.find((a) => a.id === original.id)!.sha256).toBe(
      original.sha256,
    );
    const response = await page.request.get(`/api/artifacts/${original.id}`);
    expect(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    ).toBe(original.sha256);
    await fs.writeFile(
      path.join(evidence, "reconstruction-ui.json"),
      JSON.stringify(
        {
          status: "PASS",
          requestId: f.id,
          browserReadFailure: "simulated HTTP503 only",
          originalArtifactId: original.id,
          originalSha256: original.sha256,
          numberingPreserved: true,
          reconstructedArtifacts: after.artifacts
            .filter((a) => a.provenance === "RECONSTRUCTED")
            .map((a) => ({ id: a.id, sha256: a.sha256 })),
        },
        null,
        2,
      ),
    );
  } finally {
    await f.roles.close();
  }
});
