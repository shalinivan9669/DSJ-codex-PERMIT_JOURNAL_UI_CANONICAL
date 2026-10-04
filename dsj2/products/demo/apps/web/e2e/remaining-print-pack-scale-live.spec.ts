import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { loginIsolated } from "./operator-full-fix-session";
import { loadG1Checkpoint } from "./operator-g1-helpers";
import { fullSuiteApiCooldown, fullSuiteRunId } from "./operator-full-suite";
import { readPrintDetail } from "./operator-role-fixture";

test("large saved print pack preserves every original page, photo, number and frozen person after all G1 consumers", async ({
  page,
}) => {
  test.setTimeout(900000);
  const { checkpoint } = await loadG1Checkpoint();
  expect(checkpoint.suiteRunId).toBe(fullSuiteRunId());
  const evidence = path.join(
    process.env.DEMO_E2E_EVIDENCE!,
    "large-print-pack",
  );
  await fs.mkdir(evidence, { recursive: true });
  await fullSuiteApiCooldown(evidence, "before-large-print-pack");
  const headers = await loginIsolated(page);
  const before = await readPrintDetail(page, checkpoint.requestId);
  const originals = before.artifacts.filter(
    (file) =>
      file.format === "PDF" &&
      file.documentId &&
      file.provenance !== "PRINT_SET_DERIVATIVE",
  );
  expect(originals).toHaveLength(before.documents.length);
  expect(before.items.every((person) => !!person.photoAssetId)).toBe(true);
  const response = await page.request.post(
    `/api/print-requests/${checkpoint.requestId}/print-set/plan`,
    { headers, data: { format: "PDF" } },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const plan = await response.json();
  expect(plan.files.map((file: { id: string }) => file.id).sort()).toEqual(
    originals.map((file) => file.id).sort(),
  );
  const sourcePaths: string[] = [],
    mergedPaths: string[] = [];
  for (const file of plan.files) {
    const response = await page.request.get(`/api/artifacts/${file.id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    const target = path.join(evidence, `original-${file.id}.pdf`);
    await fs.writeFile(target, bytes);
    sourcePaths.push(target);
  }
  for (const part of plan.parts) {
    const response = await page.request.post(
      `/api/print-requests/${checkpoint.requestId}/print-set`,
      {
        headers,
        data: {
          format: "PDF",
          artifactIds: plan.files.map((file: { id: string }) => file.id),
          part: part.index,
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    const result = await response.json();
    expect(result.sourceArtifactIds).toEqual(part.artifactIds);
    const download = await page.request.get(
      `/api/artifacts/${result.artifact.id}`,
    );
    expect(download.ok()).toBe(true);
    const bytes = await download.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      result.artifact.sha256,
    );
    const target = path.join(evidence, `combined-part-${part.index + 1}.pdf`);
    await fs.writeFile(target, bytes);
    mergedPaths.push(target);
  }
  const input = path.join(evidence, "page-comparison-input.json");
  await fs.writeFile(input, JSON.stringify({ sourcePaths, mergedPaths }));
  const python =
    "import sys,json,hashlib; from pypdf import PdfReader; d=json.load(open(sys.argv[1],encoding='utf8')); page=lambda p:{'media':[str(v) for v in p.mediabox],'crop':[str(v) for v in p.cropbox],'rotation':p.rotation,'text':p.extract_text() or '', 'images':sorted(hashlib.sha256(i.data).hexdigest() for i in p.images)}; pages=lambda files:[page(p) for f in files for p in PdfReader(f,strict=True).pages]; print(json.dumps({'original':pages(d['sourcePaths']),'combined':pages(d['mergedPaths'])}))";
  const actual = JSON.parse(
    execFileSync(
      process.env.DEMO_PYTHON || "python",
      ["-I", "-c", python, input],
      {
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 240000,
      },
    ),
  );
  expect(actual.combined).toEqual(actual.original);
  expect(
    actual.combined.filter(
      (page: { images: string[] }) => page.images.length > 0,
    ).length,
  ).toBeGreaterThanOrEqual(before.items.length);
  const after = await readPrintDetail(page, checkpoint.requestId);
  expect(after.revision).toBe(before.revision);
  expect(after.documents).toEqual(before.documents);
  expect(after.issuances).toEqual(before.issuances);
  for (const file of originals) {
    const response = await page.request.get(`/api/artifacts/${file.id}`);
    expect(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    ).toBe(file.sha256);
  }
  await fs.writeFile(
    path.join(evidence, "verified-pages.json"),
    JSON.stringify(
      {
        status: "PASS",
        suiteRunId: fullSuiteRunId(),
        requestId: checkpoint.requestId,
        plan,
        pages: actual.combined.length,
        people: before.items.length,
        photoPages: actual.combined.filter(
          (page: { images: string[] }) => page.images.length > 0,
        ).length,
        scale: 1,
        originalHashes: originals.map((file) => ({
          id: file.id,
          sha256: file.sha256,
        })),
        pageComparison: actual,
      },
      null,
      2,
    ),
  );
  await page.goto(`/requests/${checkpoint.requestId}/edit`);
  await page.locator("#saved-print-set summary").first().click();
  await page
    .getByLabel("Выбрать все доступные файлы по фильтру", { exact: true })
    .check();
  await page
    .getByRole("button", {
      name: "Единый PDF выбранных документов",
      exact: true,
    })
    .click();
  await expect(page.getByText(/101 файлов, 100 человек, частей/)).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "large-print-plan.png"),
    fullPage: true,
  });
});
