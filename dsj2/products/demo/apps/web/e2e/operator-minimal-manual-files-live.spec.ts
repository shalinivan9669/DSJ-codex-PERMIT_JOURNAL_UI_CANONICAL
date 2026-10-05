import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { templateIds } from "@demo/contracts";
import {
  loginRole,
  readPrintDetail,
  waitOriginalJobs,
} from "./operator-role-fixture";

test("read the existing manual twenty issuance and download every original form without issuing again", async ({
  page,
}, testInfo) => {
  test.setTimeout(1_800_000);
  const id = process.env.DEMO_E2E_MANUAL20_REQUEST_ID;
  const checkpointPath = process.env.DEMO_E2E_MANUAL20_CHECKPOINT;
  test.skip(
    !id || !checkpointPath,
    "Requires the existing issuance checkpoint",
  );
  expect(new URL(process.env.DEMO_ORIGIN!).hostname).toBe("127.0.0.1");
  await loginRole(page, "OPERATOR");
  const checkpointBytes = await fs.readFile(checkpointPath!);
  const checkpointSha256 = createHash("sha256").update(checkpointBytes).digest("hex");
  const checkpoint = JSON.parse(checkpointBytes.toString("utf8")) as {
    sourceEvidence?: string;
    steps: string[];
    issued: Awaited<ReturnType<typeof readPrintDetail>>;
  };
  const before = await readPrintDetail(page, id!);
  expect(before.id).toBe(checkpoint.issued.id);
  expect(before.issuances).toHaveLength(1);
  expect(before.issuances[0].id).toBe(checkpoint.issued.issuances[0].id);
  expect(before.documents).toHaveLength(105);
  await page.goto(`/requests/${id}/edit`);
  await waitOriginalJobs(page, id!, 1_200_000);
  const issued = await readPrintDetail(page, id!);
  expect(issued.issuances).toHaveLength(1);
  expect(issued.issuances[0]).toEqual(checkpoint.issued.issuances[0]);
  expect(
    [...new Set(issued.documents.map((entry) => entry.templateId))].sort(),
  ).toEqual([...templateIds].sort());
  const snapshot = issued.issuances[0].snapshot.draft;
  expect(snapshot.items).toHaveLength(20);
  expect(snapshot.items.map((row) => row.fullNameRu)).toEqual(
    checkpoint.issued.items.map((row) => row.fullNameRu),
  );
  for (const row of snapshot.items)
    for (const assignment of row.assignments) {
      expect(assignment.trainingStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(assignment.trainingEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(assignment.protocolDate).toBe(assignment.documentDate);
    }
  const artifacts = issued.artifacts.filter(
    (artifact) =>
      artifact.issuanceId === issued.issuances[0].id &&
      ["PDF", "DOCX"].includes(artifact.format || ""),
  );
  expect(artifacts).toHaveLength(210);
  const examples = new Map<string, (typeof artifacts)[number]>();
  for (const artifact of artifacts) {
    const document = issued.documents.find(
      (entry) => entry.id === artifact.documentId,
    );
    if (document && !examples.has(`${document.templateId}.${artifact.format}`))
      examples.set(`${document.templateId}.${artifact.format}`, artifact);
  }
  expect(examples.size).toBe(22);
  const paths: Record<string, string> = {};
  const selected: Record<string, unknown> = {};
  for (const [key, artifact] of examples) {
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      artifact.sha256,
    );
    paths[key] = testInfo.outputPath(`example-${key.toLowerCase()}`);
    selected[key] = {
      artifact,
      document: issued.documents.find(
        (entry) => entry.id === artifact.documentId,
      ),
    };
    await fs.writeFile(paths[key], bytes);
  }
  const priorArtifacts = [];
  const blockedBundles = [];
  for (const artifact of checkpoint.issued.artifacts) {
    const current = issued.artifacts.find((entry) => entry.id === artifact.id);
    expect(current?.sha256).toBe(artifact.sha256);
    expect(current?.format).toBe(artifact.format);
    expect(current?.issuanceId).toBe(artifact.issuanceId);
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    if (["ZIP", "XLSX"].includes(artifact.format || "") && artifact.issuanceId) {
      // These original bundles remain unsigned. Their unchanged metadata must
      // not grant official download access before the signature workflow.
      expect(response.status()).toBe(409);
      expect((await response.json()).code).toBe("ISSUANCE_NOT_COMPLETE");
      blockedBundles.push({ id: artifact.id, format: artifact.format, sha256: artifact.sha256 });
      continue;
    }
    expect(response.ok(), `artifact ${artifact.id}: HTTP ${response.status()}`).toBe(true);
    expect(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    ).toBe(artifact.sha256);
    priorArtifacts.push({
      id: artifact.id,
      sha256: artifact.sha256,
      format: artifact.format,
      unchanged: true,
    });
  }
  expect(priorArtifacts).toHaveLength(212);
  expect(blockedBundles.map((artifact) => artifact.format).sort()).toEqual(["XLSX", "ZIP"]);
  expect(priorArtifacts.length + blockedBundles.length).toBe(checkpoint.issued.artifacts.length);
  await page.screenshot({
    path: testInfo.outputPath("manual20-original-files.png"),
    fullPage: true,
  });
  await fs.writeFile(
    testInfo.outputPath("manual20-readback.json"),
    JSON.stringify(
      {
        synthetic: true,
        noApiPrefill: true,
        artifactOnlyContinuation: true,
        sourceCheckpoint: {
          path: checkpointPath,
          sha256: checkpointSha256,
          sourceEvidence: checkpoint.sourceEvidence,
        },
        requestId: id,
        steps: checkpoint.steps,
        saved: checkpoint.issued,
        snapshot,
        documents: issued.documents,
        selectedExamples: selected,
        examples: paths,
        priorArtifacts,
        blockedBundles,
        all214ArtifactHashesUnchanged: true,
        officialUnsignedBundles: "blocked409",
        totals: {
          people: snapshot.items.length,
          documents: issued.documents.length,
          originalArtifacts: artifacts.length,
          forms: examples.size / 2,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    "MANUAL20_ALL_FORMS_DOWNLOADED",
    JSON.stringify({
      requestId: id,
      documents: 105,
      originalArtifacts: 210,
      examples: 22,
      unchangedEarlierArtifacts: priorArtifacts.length,
    }),
  );
});
