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
  const checkpoint = JSON.parse(await fs.readFile(checkpointPath!, "utf8")) as {
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
  for (const artifact of checkpoint.issued.artifacts) {
    const current = issued.artifacts.find((entry) => entry.id === artifact.id);
    expect(current?.sha256).toBe(artifact.sha256);
    const response = await page.request.get(`/api/artifacts/${artifact.id}`);
    expect(response.ok()).toBe(true);
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
        sourceRun: ".runtime/manual20-v6",
        uiCompletionRun: ".runtime/manual20-completed-v1",
        requestId: id,
        steps: checkpoint.steps,
        saved: checkpoint.issued,
        snapshot,
        documents: issued.documents,
        selectedExamples: selected,
        examples: paths,
        priorArtifacts,
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
