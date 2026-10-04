import { expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import {
  documentText,
  protocolDates,
  readCommon,
} from "./operator-common-history-helpers";
import { keyboardActivate, keyboardEnter } from "./operator-keyboard-helpers";
import { PrismaClient } from "../../../packages/database/src";
import { assertTestDatabase } from "../../../tests/integration/test-database";
import {
  fullSuiteEvidence,
  fullSuiteRunId,
  preparedCheckpointDirectory,
  requireFullCheckpointIdentity,
} from "./operator-full-suite";

export const g1Product = path.resolve(__dirname, "../../..");
export function orderedG1Documents<T extends { id: string }>(
  records: T[],
): T[] {
  return [...records].sort((a, b) => a.id.localeCompare(b.id));
}
export const g1Evidence = (role = "producer") =>
  path.resolve(
    fullSuiteEvidence("g1", role) ||
      process.env.DEMO_E2E_EVIDENCE ||
      path.join(
        g1Product,
        "docs/evidence/operator-flow-full-fix-20261003/preparation/g1-browser",
      ),
  );
type G1Record = Omit<
  Awaited<ReturnType<typeof readCommon>>,
  "documents" | "issuances"
> & {
  documents: {
    id: string;
    rowId: string;
    templateId: string;
    number: string;
    ownerKind: "PERSON" | "GROUP";
  }[];
  issuances: { id: string; snapshot: unknown }[];
};
export type G1Checkpoint = {
  version: 2;
  suiteRunId?: string;
  status: "READY" | "ISSUED_WAITING_FILES" | "FILES_VERIFIED";
  requestId: string;
  requestPath: string;
  title: string;
  prepareWallMs: number;
  renderWallMs?: number;
  mutations: number;
  individualPanelsOpened: number;
  keyboardOnlyInApp: true;
  keyboardMetrics: Record<string, number>;
  items: Awaited<ReturnType<typeof readCommon>>["items"];
  documents?: G1Record["documents"];
  snapshot?: unknown;
  files?: {
    id: string;
    format: string;
    sha256: string;
    bytes: number;
    path: string;
    scope: "PUBLIC_DOCUMENT_DOWNLOAD" | "INTERNAL_SAVED_DERIVATIVE_READONLY";
  }[];
};
export async function g1Sources() {
  const peopleSource = JSON.parse(
    await fs.readFile(
      path.join(g1Product, "tests/fixtures/operator-value/100_people.json"),
      "utf8",
    ),
  );
  const eventsSource = JSON.parse(
    await fs.readFile(
      path.join(
        g1Product,
        "tests/fixtures/operator-value/training_events.json",
      ),
      "utf8",
    ),
  );
  const resultsSource = JSON.parse(
    await fs.readFile(
      path.join(g1Product, "tests/fixtures/operator-value/results_G1.json"),
      "utf8",
    ),
  );
  const people: Record<string, string>[] = peopleSource.people;
  const sourceEvent: Record<string, string> = eventsSource.events.find(
    (event: { id: string }) => event.id === "PB-G1",
  );
  expect(people).toHaveLength(100);
  expect(resultsSource.rows).toHaveLength(100);
  expect(
    new Set(resultsSource.rows.map((row: { outcome: string }) => row.outcome)),
  ).toEqual(new Set(["PASSED"]));
  return { people, sourceEvent, peopleSource, resultsSource };
}
export async function loadG1Checkpoint() {
  const directory = preparedCheckpointDirectory("g1");
  expect(
    directory,
    "An explicit fresh G1 preparation directory is required",
  ).toBeTruthy();
  const checkpoint: G1Checkpoint = JSON.parse(
    await fs.readFile(path.join(directory!, "g1-checkpoint.json"), "utf8"),
  );
  expect(checkpoint.version).toBe(2);
  requireFullCheckpointIdentity(checkpoint);
  if (fullSuiteRunId()) {
    const result = JSON.parse(
      await fs.readFile(path.join(directory!, "g1-result.json"), "utf8"),
    );
    requireFullCheckpointIdentity(result);
    expect(result.status).toBe("PASS");
    expect(checkpoint.status).toBe("FILES_VERIFIED");
    expect(result.mouseClickScope).toBe(
      "Whole fresh UI journey live event counter",
    );
    expect(result.actualMouseClicks).toBe(0);
    expect(result.freshPreparationContinuation).toBeNull();
    expect(result.sameFreshIssuanceContinuation).toBeNull();
    expect(result.requestId).toBe(checkpoint.requestId);
  }
  expect(["READY", "ISSUED_WAITING_FILES", "FILES_VERIFIED"]).toContain(
    checkpoint.status,
  );
  expect(checkpoint.keyboardOnlyInApp).toBe(true);
  expect(checkpoint.individualPanelsOpened).toBe(0);
  expect(checkpoint.items).toHaveLength(100);
  return { checkpoint, directory: directory! };
}
export async function g1KeyboardSession(page: Page, director = false) {
  const email = director
    ? process.env.DEMO_DIRECTOR_EMAIL
    : process.env.DEMO_E2E_EMAIL;
  const password = director
    ? process.env.DEMO_DIRECTOR_PASSWORD
    : process.env.DEMO_E2E_PASSWORD;
  expect(email).toBeTruthy();
  expect(password).toBeTruthy();
  const cache = path.join(
    g1Product,
    ".runtime/operator-flow-full-fix",
    director
      ? "role-director-session.private.json"
      : "operator-session.private.json",
  );
  try {
    const stored = JSON.parse(await fs.readFile(cache, "utf8"));
    if (stored.email === email && stored.origin === process.env.DEMO_ORIGIN)
      await page.context().addCookies(stored.cookies);
  } catch {
    /* First real local login. */
  }
  await page.goto("/requests");
  const requests = page.getByRole("heading", {
    name: "Заявки на печать",
    exact: true,
  });
  const login = page.getByRole("heading", {
    name: "Войти в DEMO",
    exact: true,
  });
  await expect(requests.or(login)).toBeVisible();
  if (await login.isVisible()) {
    await keyboardEnter(
      page,
      page.getByLabel("Электронная почта", { exact: true }),
      email!,
    );
    await keyboardEnter(
      page,
      page.getByLabel("Пароль", { exact: true }),
      password!,
    );
    await keyboardActivate(
      page,
      page.getByRole("button", { name: "Войти", exact: true }),
    );
    try {
      await expect(requests).toBeVisible();
    } catch (error) {
      await keyboardEnter(page, page.getByLabel("Пароль", { exact: true }), "");
      throw error;
    }
  }
  const response = await page.request.get("/api/auth/session");
  const session = await response.json();
  expect(session.user.role).toBe(director ? "DIRECTOR" : "OPERATOR");
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
function embeddedPhotoHashes(bytes: Buffer) {
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    bytes.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  expect(end).toBeGreaterThanOrEqual(0);
  let cursor = bytes.readUInt32LE(end + 16);
  const hashes: string[] = [];
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extraLength = bytes.readUInt16LE(cursor + 30),
      commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    if (name.startsWith("word/media/")) {
      const offset = bytes.readUInt32LE(cursor + 42),
        start =
          offset +
          30 +
          bytes.readUInt16LE(offset + 26) +
          bytes.readUInt16LE(offset + 28);
      const compressed = bytes.subarray(
        start,
        start + bytes.readUInt32LE(cursor + 20),
      );
      const image =
        bytes.readUInt16LE(cursor + 10) === 8
          ? inflateRawSync(compressed)
          : compressed;
      hashes.push(createHash("sha256").update(image).digest("hex"));
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return hashes;
}
export async function verifyG1Files(
  page: Page,
  checkpoint: G1Checkpoint,
  evidence: string,
) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(g1Product, "assets/templates/manifest.json"),
      "utf8",
    ),
  );
  const frozenCard = manifest.templates.find(
    (template: { id: string }) => template.id === "pb-card",
  );
  expect(frozenCard.fields).toContain("FULL_NAME_RU");
  expect(frozenCard.fields).not.toContain("FULL_NAME_KZ");
  expect(frozenCard.fields).not.toContain("FULL_NAME_BOTH");
  const { people, sourceEvent, resultsSource } = await g1Sources();
  const source = `${resultsSource.rows[0].evidenceKey}; ${resultsSource.rows[0].confirmedBy}; ${resultsSource.rows[0].confirmedAt}`;
  let jobs: unknown[] = [];
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/jobs?requestId=${checkpoint.requestId}`,
        );
        expect(response.ok()).toBe(true);
        const entries = (await response.json()).items;
        jobs = entries;
        const issued = entries.filter(
          (job: { issuanceId?: string }) => job.issuanceId,
        );
        return (
          issued.length === 204 &&
          issued.every(
            (job: { status: string; artifactId?: string }) =>
              job.status === "SUCCEEDED" && !!job.artifactId,
          )
        );
      },
      { timeout: 3600000, intervals: [2500, 5000] },
    )
    .toBe(true);
  const issued = (await readCommon(
    page,
    checkpoint.requestId,
  )) as unknown as G1Record;
  expect(issued.status).toBe("FINALIZED");
  expect(issued.items).toEqual(checkpoint.items);
  expect(issued.documents).toHaveLength(101);
  expect(issued.issuances).toHaveLength(1);
  expect(issued.artifacts).toHaveLength(204);
  const groups = issued.documents.filter(
    (document) => document.ownerKind === "GROUP",
  );
  expect(groups).toHaveLength(1);
  const group = groups[0];
  expect(group.templateId).toBe("pb-protocol");
  expect(
    issued.documents.filter((document) => document.templateId === "pb-card"),
  ).toHaveLength(100);
  expect(
    new Set(issued.documents.map((document) => document.number)).size,
  ).toBe(101);
  for (const [index, item] of issued.items.entries()) {
    expect(item.externalId).toBe(people[index].externalPersonKey);
    expect(item.personnelNumber).toBe(people[index].personnelNumber);
    expect(item.sourceRow).toBe(index + 2);
    expect(item.fullNameRu).toBe(people[index].fullNameRu);
    expect(item.fullNameKz).toBe(people[index].fullNameKz);
    expect(item.positionRu).toBe(people[index].positionRu);
    expect(item.positionKz).toBe(people[index].positionKz);
    expect(item.workplaceRu).toBe(people[index].workplaceRu);
    expect(item.workplaceKz).toBe(people[index].workplaceKz);
    expect(item.photoAssetId).toBeTruthy();
    expect(item.assignments).toHaveLength(1);
    const assignment = item.assignments[0];
    expect(assignment.templateId).toBe("pb-card");
    expect(assignment.outcome?.status).toBe("PASSED");
    expect(assignment.outcome?.source).toBe(source);
    expect(assignment.outcome?.confirmedBy).toBeTruthy();
    expect(assignment.outcome?.confirmedAt).toBeTruthy();
  }
  if (checkpoint.documents)
    expect(orderedG1Documents(issued.documents)).toEqual(
      orderedG1Documents(checkpoint.documents),
    );
  if (checkpoint.snapshot)
    expect(issued.issuances![0].snapshot).toEqual(checkpoint.snapshot);
  await fs.mkdir(path.join(evidence, "files"), { recursive: true });
  const photoHashes = new Map<string, string>();
  for (const item of issued.items) {
    // Keep repeated readback suites below the real tenant request limiter.
    await new Promise((resolve) => setTimeout(resolve, 125));
    const response = await page.request.get(`/api/photos/${item.photoAssetId}`);
    expect(response.ok()).toBe(true);
    photoHashes.set(
      item.id,
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    );
  }
  const files: NonNullable<G1Checkpoint["files"]> = [],
    textReadback: unknown[] = [];
  for (const artifact of issued.artifacts) {
    await new Promise((resolve) => setTimeout(resolve, 125));
    if (["XLSX", "ZIP"].includes(artifact.format || "")) {
      const denied = await page.request.get(`/api/artifacts/${artifact.id}`);
      expect(denied.status()).toBe(409);
      expect((await denied.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
      continue;
    }
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body(),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe(artifact.sha256);
    const document = issued.documents.find(
      (entry) => entry.id === artifact.documentId,
    );
    if (artifact.format === "PDF")
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    else {
      expect(artifact.format).toBe("DOCX");
      const text = documentText(bytes);
      if (document?.ownerKind === "GROUP") {
        expect(text).toContain(`${sourceEvent.hours}-часовой`);
        for (const date of protocolDates(sourceEvent.protocolDate))
          expect(text).toContain(date);
        for (const person of people) {
          expect(text).toContain(person.fullNameRu);
        }
        expect([...text.matchAll(/(?:^|\s)Сдал(?=\s|$)/g)]).toHaveLength(100);
        expect(text).toContain(group.number);
      } else if (document) {
        expect(text).toContain(sourceEvent.trainingSubject);
        const person = issued.items.find((item) => item.id === document.rowId)!;
        expect(text).toContain(person.fullNameRu);
        // The preserved PB card maps FULL_NAME_RU only; both names remain
        // exact in raw/snapshot. The pinned protocol reference also uses RU.
        expect(text).toContain(group.number);
        expect(
          embeddedPhotoHashes(bytes),
          "The saved personal DOCX embeds the exact matching photo asset bytes",
        ).toContain(photoHashes.get(person.id));
        for (const other of people.filter(
          (entry) => entry.fullNameRu !== person.fullNameRu,
        ))
          expect(text).not.toContain(other.fullNameRu);
      } else throw new Error("G1_DOCUMENT_ARTIFACT_MISSING_OWNER");
      textReadback.push({
        id: artifact.id,
        documentId: artifact.documentId,
        ownerKind: document?.ownerKind || "WORK_LIST",
        textVerified: true,
        printedNameScope:
          "Pinned legacy PB reference renderer maps ФИО from FULL_NAME_RU. FULL_NAME_KZ remains exact in raw and immutable snapshot; logical GROUP manifest advertises FULL_NAME_BOTH but reference renderer preserves original fill policy.",
      });
    }
    const prior = checkpoint.files?.find((file) => file.id === artifact.id);
    if (checkpoint.files) {
      expect(prior).toBeTruthy();
      expect(sha256).toBe(prior!.sha256);
    }
    const file = `files/${artifact.id}.${artifact.format!.toLowerCase()}`;
    await fs.writeFile(path.join(evidence, file), bytes);
    files.push({
      id: artifact.id,
      format: artifact.format!,
      sha256,
      bytes: bytes.length,
      path: file,
      scope: "PUBLIC_DOCUMENT_DOWNLOAD",
    });
  }
  expect(files.filter((file) => file.format === "DOCX")).toHaveLength(101);
  expect(files.filter((file) => file.format === "PDF")).toHaveLength(101);
  // Check actual stored derivatives read-only in the disposable DB/storage, while public guards remain in force.
  assertTestDatabase();
  expect(process.env.DEMO_E2E_ISOLATED_TENANT).toBe("1");
  expect(process.env.DEMO_ARTIFACT_ROOT).toBeTruthy();
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session.tenant.demoOnly).toBe(true);
  const db = new PrismaClient({ log: [] });
  const internalReadback: unknown[] = [];
  try {
    const tenant = await db.tenant.findUnique({
      where: { id: session.tenant.id },
      select: { demoOnly: true },
    });
    expect(tenant?.demoOnly).toBe(true);
    const stored = await db.artifact.findMany({
      where: {
        tenantId: session.tenant.id,
        requestId: checkpoint.requestId,
        issuanceId: issued.issuances[0].id,
        format: { in: ["XLSX", "ZIP"] },
      },
    });
    expect(stored).toHaveLength(2);
    const storageRoot = await fs.realpath(process.env.DEMO_ARTIFACT_ROOT!);
    for (const artifact of stored) {
      expect(
        issued.artifacts.some(
          (entry) =>
            entry.id === artifact.id && entry.sha256 === artifact.sha256,
        ),
      ).toBe(true);
      expect(path.isAbsolute(artifact.storageKey)).toBe(false);
      expect(artifact.storageKey).not.toContain("..");
      const storedPath = await fs.realpath(
        path.resolve(storageRoot, artifact.storageKey),
      );
      const relative = path.relative(storageRoot, storedPath);
      expect(relative).not.toMatch(/^\.\.(?:[\\/]|$)/);
      expect(path.isAbsolute(relative)).toBe(false);
      const bytes = await fs.readFile(storedPath),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(sha256).toBe(artifact.sha256);
      expect(bytes.length).toBe(artifact.size);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      const prior = checkpoint.files?.find((file) => file.id === artifact.id);
      if (checkpoint.files) expect(prior?.sha256).toBe(sha256);
      const file = `files/${artifact.id}.${artifact.format.toLowerCase()}`;
      await fs.writeFile(path.join(evidence, file), bytes);
      files.push({
        id: artifact.id,
        format: artifact.format,
        sha256,
        bytes: bytes.length,
        path: file,
        scope: "INTERNAL_SAVED_DERIVATIVE_READONLY",
      });
      internalReadback.push({
        id: artifact.id,
        format: artifact.format,
        jobId: artifact.jobId,
        inputHash: artifact.inputHash,
        sha256,
        bytes: bytes.length,
        rootContainmentVerified: true,
        scope: "INTERNAL_SAVED_DERIVATIVE_READONLY",
        publicStatus: 409,
        publicCode: "ISSUANCE_NOT_COMPLETE",
      });
    }
  } finally {
    await db.$disconnect();
  }
  expect(files).toHaveLength(204);
  await fs.writeFile(
    path.join(evidence, "g1-internal-saved-derivative-readback.json"),
    JSON.stringify(
      {
        isolatedTestDatabaseVerified: true,
        syntheticTenantVerified: true,
        noDatabaseWrites: true,
        noPublicSignatureBypass: true,
        files: internalReadback,
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(evidence, "g1-rendered-readback.json"),
    JSON.stringify(
      {
        requestId: checkpoint.requestId,
        documents: issued.documents,
        jobs,
        files,
        textReadback,
        sourceRowsPreserved: true,
        exactMatchedPhotoHashes: Object.fromEntries(photoHashes),
        photosEmbedded: 100,
        publicDocumentDownloads: 202,
        internalSavedDerivatives: 2,
        publicUnsignedDeliveryScope: "GUARDED",
        legalApproval: false,
      },
      null,
      2,
    ),
  );
  return { issued, files, group };
}
