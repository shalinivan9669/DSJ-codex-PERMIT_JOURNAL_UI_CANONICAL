import { expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { Draft, Artifact, Job, Customer } from "../lib/types";
import { fullSuiteEvidence, fullSuiteRunId } from "./operator-full-suite";

export const commonEvidence = (role: "producer" | "resume") =>
  path.resolve(
    fullSuiteEvidence("common", role) ||
      process.env.DEMO_E2E_EVIDENCE ||
      path.join(
        __dirname,
        `../../../docs/evidence/operator-flow-full-fix-20261003/preparation/common-${role === "producer" ? "history" : "resume"}-browser`,
      ),
  );

export type CommonDetail = Draft & {
  issuances: Array<
    NonNullable<Draft["issuances"]>[number] & { snapshot: unknown }
  >;
  documents: Array<{
    id: string;
    rowId: string;
    templateId: string;
    number: string;
    documentDate: string;
    ownerKind: string;
    groupEventId?: string | null;
  }>;
  artifacts: Artifact[];
};
export type ExpectedCommonRow = {
  rowId: string;
  fullNameRu: string;
  assignments: Array<{
    id: string;
    templateId: string;
    trainingSubject: string;
    documentDate: string;
    trainingStart: string;
    trainingEnd: string;
  }>;
};
export type CommonCheckpoint = {
  version: 2;
  suiteRunId?: string;
  synthetic: true;
  status: "ISSUED_WAITING_FILES" | "FILES_AND_HISTORY_VERIFIED";
  requestId: string;
  nextId?: string;
  personId: string;
  companies: Customer[];
  expected: ExpectedCommonRow[];
  expectedDocuments: number;
  expectedDocumentFiles: number;
  issued: CommonDetail;
  files?: Array<{
    id: string;
    documentId: string;
    format: string;
    sha256: string;
    path: string;
  }>;
  checkpoints: Array<{
    step: string;
    elapsedMs: number;
    [key: string]: unknown;
  }>;
};
export async function readCommon(page: Page, id: string) {
  const response = await page.request.get(`/api/print-requests/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<CommonDetail>;
}
export async function expandCommon(details: Locator) {
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator(":scope > summary").click();
}
export async function commonSettings(page: Page) {
  await expandCommon(page.locator("#request-training"));
  const root = page.locator(".training-primary-context");
  const advanced = root
    .locator(":scope > .context-body > details.training-advanced-settings")
    .filter({
      has: page.getByText("Дополнительные настройки обучения", { exact: true }),
    });
  await expandCommon(advanced);
  await expandCommon(
    advanced.locator(":scope > details").filter({
      has: page.getByText("Даты и программа для всей заявки", {
        exact: true,
      }),
    }),
  );
  return root;
}
export async function personRecord(page: Page, row = 1) {
  const existing = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: `Настройки строки ${row}`,
      exact: true,
    }),
  });
  if (!(await existing.isVisible())) {
    await page
      .getByRole("button", { name: `Детали получателя ${row}`, exact: true })
      .click();
  }
  const modal = page.getByRole("dialog");
  await modal.getByRole("tab", { name: "Личные данные", exact: true }).click();
  await expandCommon(modal.locator("details.employer-document-wording"));
  await expandCommon(modal.locator("details.outcome-entry"));
  return modal;
}
export async function directorCommonSession(page: Page) {
  const email = process.env.DEMO_DIRECTOR_EMAIL!,
    password = process.env.DEMO_DIRECTOR_PASSWORD!;
  expect(email).toBeTruthy();
  expect(password).toBeTruthy();
  const cache = path.resolve(
    __dirname,
    "../../../.runtime/operator-flow-full-fix/role-director-session.private.json",
  );
  try {
    const stored = JSON.parse(await fs.readFile(cache, "utf8"));
    if (stored.email === email && stored.origin === process.env.DEMO_ORIGIN)
      await page.context().addCookies(stored.cookies);
  } catch {
    /* Real first login. */
  }
  await page.goto("/requests");
  const requests = page.getByRole("heading", {
      name: "Заявки на печать",
      exact: true,
    }),
    login = page.getByRole("heading", { name: "Войти в DEMO", exact: true });
  await expect(requests.or(login)).toBeVisible();
  if (await login.isVisible()) {
    await page.getByLabel("Электронная почта", { exact: true }).fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    try {
      await expect(requests).toBeVisible();
    } catch (error) {
      await page.getByLabel("Пароль", { exact: true }).fill("");
      throw error;
    }
  }
  const response = await page.request.get("/api/auth/session"),
    session = await response.json();
  expect(session.user.role).toBe("DIRECTOR");
  expect(session.tenant.demoOnly).toBe(true);
  await fs.writeFile(
    cache,
    JSON.stringify({
      email,
      origin: new URL(page.url()).origin,
      cookies: await page.context().cookies(),
    }),
  );
}
/** Read only the actual Word document XML from the saved ZIP bytes. */
export function documentText(bytes: Buffer) {
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    bytes.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  expect(end).toBeGreaterThanOrEqual(0);
  let offset = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(offset + 10),
      compressed = bytes.readUInt32LE(offset + 20),
      nameLength = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32),
      local = bytes.readUInt32LE(offset + 42);
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    if (name === "word/document.xml") {
      expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
      const start =
          local +
          30 +
          bytes.readUInt16LE(local + 26) +
          bytes.readUInt16LE(local + 28),
        data = bytes.subarray(start, start + compressed);
      expect([0, 8]).toContain(method);
      const xml = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
      return [
        ...xml.matchAll(/<w:t(?=\s|>)(?![^>]*\/>)[^>]*>([\s\S]*?)<\/w:t>/g),
      ]
        .map((match) =>
          match[1]
            .replaceAll("&amp;", "&")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&quot;", '"')
            .replaceAll("&apos;", "'"),
        )
        .join(" ");
    }
    offset += 46 + nameLength + extra + comment;
  }
  throw new Error("SAVED_DOCUMENT_XML_MISSING");
}
export function protocolDates(value: string) {
  const [year, month, day] = value.split("-");
  const ru = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const kz = [
    "қаңтар",
    "ақпан",
    "наурыз",
    "сәуір",
    "мамыр",
    "маусым",
    "шілде",
    "тамыз",
    "қыркүйек",
    "қазан",
    "қараша",
    "желтоқсан",
  ];
  return [
    `«${Number(day)}» ${ru[Number(month) - 1]} ${year} г.`,
    `«${Number(day)}» ${kz[Number(month) - 1]} ${year} ж.`,
  ];
}
export async function verifyCommonFiles(
  page: Page,
  checkpoint: CommonCheckpoint,
  evidence: string,
) {
  await fs.mkdir(path.join(evidence, "files"), { recursive: true });
  let jobs: Job[] = [];
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/jobs?requestId=${checkpoint.requestId}`,
        );
        expect(response.ok()).toBe(true);
        jobs = (await response.json()).items;
        const issuedJobs = jobs.filter((job) => job.issuanceId);
        return (
          issuedJobs.length >= checkpoint.expectedDocumentFiles &&
          issuedJobs.every(
            (job) => job.status === "SUCCEEDED" && !!job.artifactId,
          )
        );
      },
      { timeout: 1200000, intervals: [2500, 5000] },
    )
    .toBe(true);
  const issued = await readCommon(page, checkpoint.requestId);
  expect(issued.documents).toHaveLength(checkpoint.expectedDocuments);
  expect(
    issued.documents.filter(
      (document) => document.templateId === "biot-worker-card",
    ),
  ).toHaveLength(100);
  expect(
    issued.documents.filter(
      (document) => document.templateId === "biot-protocol",
    ),
  ).toHaveLength(1);
  expect(
    issued.documents.filter((document) => document.templateId === "ptm-card"),
  ).toHaveLength(2);
  expect(
    issued.documents.filter(
      (document) => document.templateId === "ptm-protocol",
    ),
  ).toHaveLength(2);
  const documentIds = new Set(issued.documents.map((document) => document.id));
  const artifacts = issued.artifacts.filter(
    (artifact) =>
      artifact.documentId &&
      documentIds.has(artifact.documentId) &&
      ["DOCX", "PDF"].includes(artifact.format || ""),
  );
  expect(artifacts).toHaveLength(checkpoint.expectedDocumentFiles);
  const files: NonNullable<CommonCheckpoint["files"]> = [],
    textReadback: unknown[] = [];
  for (const artifact of artifacts) {
    if (fullSuiteRunId())
      await new Promise((resolve) => setTimeout(resolve, 125));
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok(), await response.text()).toBe(true);
    const bytes = await response.body(),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe(artifact.sha256);
    const document = issued.documents.find(
      (entry) => entry.id === artifact.documentId,
    )!;
    if (artifact.format === "PDF")
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    else {
      const text = documentText(bytes),
        row = checkpoint.expected.find(
          (entry) => entry.rowId === document.rowId,
        ),
        assignment = row?.assignments.find(
          (entry) => entry.templateId === document.templateId,
        );
      const expectedSubject =
        assignment?.trainingSubject ||
        checkpoint.expected[2].assignments.find(
          (entry) => entry.templateId === "biot-worker-card",
        )!.trainingSubject;
      if (!document.templateId.endsWith("-protocol"))
        expect(text).toContain(expectedSubject);
      else {
        // The preserved BIOT/PTM protocol templates do not map SUBJECT.
        for (const date of protocolDates(document.documentDate))
          expect(text).toContain(date);
        expect(text).toContain("Сдал");
      }
      expect(text).toContain(document.number);
      if (row) expect(text).toContain(row.fullNameRu);
      else
        for (const member of checkpoint.expected)
          expect(text).toContain(member.fullNameRu);
      textReadback.push({
        documentId: document.id,
        rowId: document.rowId,
        templateId: document.templateId,
        expectedSubject,
        subjectMappedInSavedTemplate:
          !document.templateId.endsWith("-protocol"),
        mappedProtocolDate: document.templateId.endsWith("-protocol")
          ? document.documentDate
          : undefined,
        number: document.number,
        textVerified: true,
      });
    }
    const file = `files/${artifact.id}.${artifact.format!.toLowerCase()}`;
    await fs.writeFile(path.join(evidence, file), bytes);
    files.push({
      id: artifact.id,
      documentId: artifact.documentId!,
      format: artifact.format!,
      sha256,
      path: file,
    });
  }
  await fs.writeFile(
    path.join(evidence, "rendered-document-readback.json"),
    JSON.stringify(
      {
        jobs,
        actualDocumentFiles: files.length,
        files,
        textReadback,
        synthetic: true,
      },
      null,
      2,
    ),
  );
  return { issued, files, jobs };
}
