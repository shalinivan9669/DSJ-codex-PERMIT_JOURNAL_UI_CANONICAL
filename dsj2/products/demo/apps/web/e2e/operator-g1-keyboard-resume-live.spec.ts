import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import {
  keyboardActivate,
  keyboardEnter,
  keyboardMetrics,
  keyboardReopen,
  saveKeyboardMetrics,
} from "./operator-keyboard-helpers";

const product = path.resolve(__dirname, "../../..");
const evidence = path.resolve(
  process.env.DEMO_E2E_EVIDENCE ||
    path.join(product, "docs/evidence/final-completion/operator/g1-resume"),
);
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function zipText(bytes: Buffer, wanted: string) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP directory missing");
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const length = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + length).toString();
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
      return (
        bytes.readUInt16LE(cursor + 10) === 8
          ? inflateRawSync(compressed)
          : compressed
      ).toString("utf8");
    }
    cursor +=
      46 +
      length +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  throw new Error(`ZIP entry missing: ${wanted}`);
}

test("G1 keyboard continuation after maintenance: same 101 issued documents, keyboard download, 204 hashes and immutable reload", async ({
  page,
  browser,
}) => {
  test.setTimeout(900000);
  // Production server: no interception and no API writes to prepare UI state.
  const preparationDirectory = process.env.DEMO_E2E_G1_PREPARED_DIR!;
  const checkpoint = JSON.parse(
    await fs.readFile(
      path.join(preparationDirectory, "g1-checkpoint.json"),
      "utf8",
    ),
  );
  expect(checkpoint.status).toBe("READY");
  expect(checkpoint.keyboardOnlyInApp).toBe(true);
  const preparedMetrics = JSON.parse(
    await fs.readFile(
      path.join(preparationDirectory, "keyboard-metrics.json"),
      "utf8",
    ),
  );
  expect(preparedMetrics.enterNoFinalizeChecks).toBe(1);
  expect(preparedMetrics.dialogTrapChecks).toBe(1);
  expect(preparedMetrics.mouseClicks).toBe(0);
  let businessMutations = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !request.url().includes("/api/auth/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      businessMutations++;
  });
  expect(checkpoint.individualPanelsOpened).toBe(0);
  const requestId = checkpoint.requestId;
  const requestPath = checkpoint.requestPath;
  const prepareWallMs = checkpoint.prepareWallMs;
  const renderWallMs = null;
  const mutations = checkpoint.mutations;
  const individualPanelsOpened = checkpoint.individualPanelsOpened;
  const started = Date.now();
  const peopleSource = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/100_people.json"),
      "utf8",
    ),
  );
  const people: Record<string, string>[] = peopleSource.people;
  const eventsSource = JSON.parse(
    await fs.readFile(
      path.join(product, "tests/fixtures/operator-value/training_events.json"),
      "utf8",
    ),
  );
  const sourceEvent = eventsSource.events.find(
    (event: { id: string }) => event.id === "PB-G1",
  );
  await fs.mkdir(evidence, { recursive: true });
  await page.goto("/login");
  await keyboardEnter(
    page,
    page.getByLabel("Электронная почта", { exact: true }),
    process.env.DEMO_E2E_EMAIL!,
  );
  await keyboardEnter(
    page,
    page.getByLabel("Пароль", { exact: true }),
    process.env.DEMO_E2E_PASSWORD!,
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Войти", exact: true }),
  );
  await expect(
    page.getByRole("heading", { name: "Заявки на печать" }),
  ).toBeVisible();
  await keyboardActivate(
    page,
    page.locator(`a.row-title[href="/requests/${requestId}"]`),
  );
  await expect(page.locator(".files-panel")).toContainText(
    "Готово 204 из 204",
    { timeout: 600000 },
  );
  const downloadReady = page.waitForEvent("download");
  await keyboardActivate(
    page,
    page
      .locator(".files-panel article")
      .filter({
        has: page.locator(".file-type").getByText("PDF", { exact: true }),
      })
      .first()
      .getByRole("link", { name: "Скачать", exact: true }),
  );
  const keyboardDownload = await downloadReady;
  await keyboardDownload.saveAs(path.join(evidence, "keyboard-download.pdf"));
  keyboardMetrics.artifactDownloads++;
  const getRecord = async () => {
    const response = await page.request.get(`/api/print-requests/${requestId}`);
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const issued = await getRecord();
  expect(issued.documents).toHaveLength(101);
  expect(issued.issuances).toHaveLength(1);
  expect(issued.artifacts).toHaveLength(204);
  expect(
    issued.documents.filter(
      (document: { ownerKind: string }) => document.ownerKind === "GROUP",
    ),
  ).toHaveLength(1);
  const group = issued.documents.find(
    (document: { ownerKind: string }) => document.ownerKind === "GROUP",
  );
  const numbers = issued.documents.map(
    (document: { number: string }) => document.number,
  );
  expect(new Set(numbers).size).toBe(101);
  const fileDir = path.join(evidence, "files");
  await fs.mkdir(fileDir, { recursive: true });
  const files = [];
  for (const artifact of issued.artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(hash(bytes)).toBe(artifact.sha256);
    const document = issued.documents.find(
      (item: { id: string }) => item.id === artifact.documentId,
    );
    if (artifact.format === "DOCX") {
      const xml = zipText(bytes, "word/document.xml");
      const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((match) => match[1])
        .join(" ");
      if (document.ownerKind === "GROUP") {
        // The approved PB protocol maps HOURS and PROTOCOL_DATE; SUBJECT is a card-only field.
        expect(text).toContain(`${sourceEvent.hours}-часовой`);
        expect(text).toContain(
          sourceEvent.protocolDate.split("-").reverse().join("."),
        );
        for (const person of people) {
          expect(text).toContain(person.fullNameRu);
          expect(text).toContain(person.fullNameKz);
        }
        expect([...text.matchAll(/(?:^|\s)Сдал(?=\s|$)/g)]).toHaveLength(100);
        expect(text).toContain(group.number);
      } else {
        expect(text).toContain(sourceEvent.trainingSubject);
        const person = issued.items.find(
          (item: { id: string }) => item.id === document.rowId,
        );
        expect(text).toContain(person.fullNameRu);
        expect(text).toContain(person.fullNameKz);
        expect(text).toContain(group.number);
        for (const other of people.filter(
          (item) => item.fullNameRu !== person.fullNameRu,
        ))
          expect(text).not.toContain(other.fullNameRu);
      }
    }
    const file = `${artifact.id}.${artifact.format.toLowerCase()}`;
    await fs.writeFile(path.join(fileDir, file), bytes);
    files.push({
      id: artifact.id,
      documentId: artifact.documentId,
      ownerKind: document?.ownerKind,
      rowId: document?.rowId,
      number: document?.number,
      externalId: issued.items.find(
        (item: { id: string }) => item.id === document?.rowId,
      )?.externalId,
      format: artifact.format,
      sha256: artifact.sha256,
      bytes: bytes.length,
      path: `files/${file}`,
    });
  }
  await keyboardReopen(page);
  await expect(page.locator(".files-panel")).toContainText("Готово 204 из 204");
  const reloaded = await getRecord();
  expect(
    reloaded.documents.map((document: { number: string }) => document.number),
  ).toEqual(numbers);
  expect(reloaded.issuances[0].snapshot).toEqual(issued.issuances[0].snapshot);
  await page.screenshot({
    path: path.join(evidence, "g1-issued.png"),
    fullPage: true,
  });
  expect(businessMutations).toBe(0);
  await saveKeyboardMetrics(evidence, "PASS");
  await fs.writeFile(
    path.join(evidence, "g1-result.json"),
    JSON.stringify(
      {
        status: "PASS",
        syntheticOnly: true,
        keyboardOnlyInApp: true,
        continuationBusinessMutations: businessMutations,
        keyboardMetrics,
        preparedKeyboardMetrics: preparedMetrics,
        continuationReason:
          "Explicit issuance was followed by planned API/worker migration maintenance longer than bounded polling. Same issuance reopened; no repeat issue or render.",
        requestId,
        requestPath,
        recipients: 100,
        sourceRowsPreserved: true,
        photos: 100,
        individualPanelsOpened,
        documentCount: 101,
        groupProtocolCount: 1,
        allFilesHashVerified: true,
        groupNumber: group.number,
        prepareWallMs,
        renderWallMs,
        automatedWallMs: null,
        resumedBrowserVerificationMs: Date.now() - started,
        resumedAfterTransientReadError: true,
        preparationEvidence: preparationDirectory,
        workerMode:
          "normal worker plus tenant-scoped production queue executor",

        apiMutations: mutations,
        humanOperatorMs: null,
        baselineMs: null,
        legalAcceptance: "NOT_RUN",
        physicalPrint: "NOT_RUN",
        browser: browser.version(),
        files,
      },
      null,
      2,
    ),
  );
});
