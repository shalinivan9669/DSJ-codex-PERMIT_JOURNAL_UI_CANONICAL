import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readPrintDetail, waitOriginalJobs } from "./operator-role-fixture";
import { documentText } from "./operator-common-history-helpers";

test.use({ trace: "off" });
test.setTimeout(900_000);

test("resume synthetic Excel acceptance after a local service restart", async ({
  page,
  browser,
}, testInfo) => {
  expect(process.env.DEMO_ORIGIN).toBe("http://localhost:3350");
  const source = process.env.DEMO_E2E_EXCEL_CHECKPOINT;
  if (!source) throw new Error("DEMO_E2E_EXCEL_CHECKPOINT_REQUIRED");
  const checkpoint = JSON.parse(await fs.readFile(source, "utf8"));
  expect(checkpoint.synthetic).toBe(true);
  const product = path.resolve(__dirname, "../../..");
  async function authenticate(
    target: typeof page,
    role: "operator" | "director",
  ) {
    const stored = JSON.parse(
      await fs.readFile(
        path.join(
          product,
          `.runtime/operator-flow-full-fix/role-${role}-session.private.json`,
        ),
        "utf8",
      ),
    );
    expect(stored.origin).toBe(process.env.DEMO_ORIGIN);
    await target.context().addCookies(stored.cookies);
    const response = await target.request.get("/api/auth/session");
    expect(response.ok()).toBe(true);
    const session = await response.json();
    expect(session.tenant.id).toBe(checkpoint.tenantId);
    expect(session.tenant.demoOnly).toBe(true);
    expect(session.user.role).toBe(role.toUpperCase());
    return {
      origin: process.env.DEMO_ORIGIN!,
      "x-csrf-token": session.csrfToken,
    };
  }
  await authenticate(page, "operator");
  const id = checkpoint.requestId;
  await page.goto(`/requests/${id}/edit`);
  const before = await readPrintDetail(page, id);
  expect(before.items).toHaveLength(4);
  expect(before.items.map((person) => person.photoAssetId)).toEqual(
    checkpoint.photos,
  );
  expect(before.approval?.status).toBe("APPROVED");
  if (!before.documents.length) {
    const response = page.waitForResponse(
      (result) =>
        result.request().method() === "POST" &&
        result.url().endsWith(`/print-requests/${id}/finalize`),
      { timeout: 210_000 },
    );
    await page
      .getByRole("button", { name: "Сформировать документы", exact: true })
      .click();
    const finalized = await response;
    expect(finalized.ok(), await finalized.text()).toBe(true);
    await waitOriginalJobs(page, id, 420_000);
  }
  const generated = await readPrintDetail(page, id);
  expect(generated.documents).toHaveLength(checkpoint.documentCount);
  expect(
    generated.documents.filter((doc) => doc.templateId === "biot-protocol"),
  ).toHaveLength(1);
  expect(
    generated.documents.filter((doc) => doc.templateId === "biot-itr-protocol"),
  ).toHaveLength(1);
  if (!checkpoint.artifacts) {
    const directorContext = await browser.newContext({
      baseURL: process.env.DEMO_ORIGIN,
    });
    try {
      const director = await directorContext.newPage();
      const headers = await authenticate(director, "director");
      const attestation = await director.request.post(
        `/api/print-requests/${id}/paper-signatures`,
        {
          headers,
          data: {
            documentIds: generated.documents.map((document) => document.id),
            signedAt: "2026-01-31",
            signerNames: [
              "Синтетический Директор",
              "Синтетический Председатель",
              "Синтетический Преподаватель",
            ],
            allRequiredSignaturesPresent: true,
            reason:
              "СИНТЕТИЧЕСКИЙ тест бумажного пути. Реальные подписи не создавались.",
          },
        },
      );
      expect(attestation.ok(), await attestation.text()).toBe(true);
    } finally {
      await directorContext.close();
    }
  }
  const artifacts = generated.artifacts.filter(
    (artifact) =>
      artifact.documentId && ["DOCX", "PDF"].includes(artifact.format || ""),
  );
  expect(artifacts).toHaveLength(checkpoint.documentCount * 2);
  const evidence = [];
  for (const artifact of artifacts) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(
      response.ok(),
      `artifact ${artifact.id}: HTTP ${response.status()}`,
    ).toBe(true);
    const bytes = await response.body();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe(artifact.sha256);
    if (checkpoint.artifacts)
      expect(
        checkpoint.artifacts.find(
          (prior: { id: string }) => prior.id === artifact.id,
        )?.sha256,
      ).toBe(sha256);
    if (artifact.format === "DOCX")
      expect(documentText(bytes)).toMatch(/Синтетическ/);
    else expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const filename = `saved-${artifact.documentId}.${artifact.format!.toLowerCase()}`;
    await fs.writeFile(testInfo.outputPath(filename), bytes);
    evidence.push({
      id: artifact.id,
      documentId: artifact.documentId,
      format: artifact.format,
      sha256,
      filename,
    });
  }
  await page.reload();
  await page.screenshot({
    path: testInfo.outputPath("saved-documents-reopened.png"),
    fullPage: true,
  });
  await fs.writeFile(
    testInfo.outputPath("acceptance.json"),
    JSON.stringify(
      {
        ...checkpoint,
        artifacts: evidence,
        documents: generated.documents,
        restartPersistence: !!checkpoint.artifacts,
        paperAttestation:
          "synthetic API scenario only; no real physical or electronic signatures",
      },
      null,
      2,
    ),
  );
});
