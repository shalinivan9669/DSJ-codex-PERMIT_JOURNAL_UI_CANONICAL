import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { ArtifactStore } from "@demo/printing";
import { draftSchema } from "@demo/contracts";
import { db } from "../../apps/api/src/core";
import { assertTestDatabase } from "../../tests/integration/test-database";

function zipText(bytes: Buffer, wanted: string) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "ZIP directory exists");
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    if (name === wanted) {
      const local = bytes.readUInt32LE(cursor + 42);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(start, start + bytes.readUInt32LE(cursor + 20));
      return (bytes.readUInt16LE(cursor + 10) === 8 ? inflateRawSync(compressed) : compressed).toString("utf8");
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry missing: ${wanted}`);
}
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const compact = (text: string) => text.replace(/\s+/gu, "");

async function main() {
  assertTestDatabase();
  const [requestId, evidenceRelative] = process.argv.slice(2);
  assert.match(requestId || "", /^[a-f0-9-]{36}$/);
  const folder = resolve(evidenceRelative || "");
  assert.ok(folder.startsWith(resolve("docs/evidence/operator-flow-full-fix-20261003/domain") + "/") || folder.startsWith(resolve("docs/evidence/operator-flow-full-fix-20261003/domain") + "\\"));
  const record = await db.printRequest.findFirstOrThrow({ where: { id: requestId, tenantId: process.env.DEMO_TENANT_ID } });
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: record.tenantId } });
  assert.equal(tenant.demoOnly, true);
  const issuance = await db.issuance.findFirstOrThrow({ where: { requestId, tenantId: tenant.id } });
  const workflowBefore = await db.issuanceWorkflow.findFirstOrThrow({ where: { issuanceId: issuance.id, tenantId: tenant.id } });
  const snapshotHash = digest(JSON.stringify(issuance.snapshot));
  const draft = draftSchema.parse((issuance.snapshot as { draft: unknown }).draft);
  assert.equal(draft.items.length, 12);
  assert.ok(draft.items.every((row) => row.fullNameRu && row.fullNameKz && row.photoAssetId));
  const documents = await db.issuedDocument.findMany({ where: { requestId, tenantId: tenant.id } });
  assert.equal(documents.length, 37);
  const jobs = await db.generationJob.findMany({ where: { requestId, tenantId: tenant.id, issuanceId: issuance.id } });
  assert.equal(jobs.length, 76);
  const failed = jobs.filter((job) => job.status === "FAILED");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].kind, "ZIP");
  assert.equal(failed[0].errorCode, "RENDER_FILE_LIMIT");
  assert.equal(jobs.filter((job) => job.status === "SUCCEEDED").length, 75);
  const artifacts = await db.artifact.findMany({ where: { requestId, tenantId: tenant.id, provenance: "ORIGINAL" } });
  assert.equal(artifacts.length, 75);
  assert.equal(artifacts.filter((file) => file.format === "DOCX").length, 37);
  assert.equal(artifacts.filter((file) => file.format === "PDF").length, 37);
  assert.equal(artifacts.filter((file) => file.format === "XLSX").length, 1);
  await mkdir(folder, { recursive: true });
  const store = new ArtifactStore();
  const files = [];
  const pdfInputs = [];
  const checkedDocuments = [];
  for (const artifact of artifacts) {
    const bytes = await store.read(artifact.storageKey, artifact.sha256);
    assert.equal(bytes.length, artifact.size);
    assert.equal(digest(bytes), artifact.sha256);
    files.push({ id: artifact.id, documentId: artifact.documentId, format: artifact.format, size: bytes.length, sha256: artifact.sha256 });
    if (artifact.format === "PDF") pdfInputs.push({ id: artifact.id, path: store.path(artifact.storageKey) });
    if (artifact.format === "DOCX") {
      const document = documents.find((doc) => doc.id === artifact.documentId)!;
      const person = draft.items.find((row) => row.id === document.rowId)!;
      const xml = zipText(bytes, "word/document.xml");
      const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/gu)].map((match) => match[1]).join(" ");
      assert.ok(compact(text).includes(compact(person.fullNameRu)), `${artifact.id}: actual RU name`);
      // Observe the unchanged print mapping separately from source preservation.
      // This scoped byte/RU-isolation QA does not certify bilingual print layout.
      const kzNamePrinted = compact(text).includes(compact(person.fullNameKz));
      assert.ok(draft.items.filter((row) => row.id !== person.id).every((row) => !compact(text).includes(compact(row.fullNameRu))), `${artifact.id}: no foreign recipient`);
      await writeFile(resolve(folder, `${document.id}-${document.templateId}.txt`), text);
      checkedDocuments.push({ documentId: document.id, templateId: document.templateId, rowId: person.id, sourceRu: person.fullNameRu, sourceKz: person.fullNameKz, docxArtifactId: artifact.id, docxTextSha256: digest(text), kzNamePrinted, kzScope: kzNamePrinted ? "Actual KZ name found in saved XML" : "KZ source preserved in frozen snapshot; name absent from actual saved print XML" });
    }
  }
  const pdf = spawnSync(process.env.QA_PDF_PYTHON || process.env.PYTHON || "python", ["-c", "import json,sys,fitz; data=json.load(sys.stdin); print(json.dumps([{ 'id':x['id'], 'pages':len(d), 'text':' '.join(p.get_text() for p in d)} for x in data for d in [fitz.open(x['path'])]],ensure_ascii=False))"], { input: JSON.stringify(pdfInputs), encoding: "utf8", windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  assert.equal(pdf.status, 0, pdf.stderr);
  const pdfRows = JSON.parse(pdf.stdout) as { id: string; pages: number; text: string }[];
  assert.equal(pdfRows.length, 37);
  for (const pdfRow of pdfRows) {
    const artifact = artifacts.find((file) => file.id === pdfRow.id)!;
    const document = checkedDocuments.find((doc) => doc.documentId === artifact.documentId)!;
    assert.ok(pdfRow.pages > 0);
    assert.ok(compact(pdfRow.text).includes(compact(document.sourceRu)), `${pdfRow.id}: actual PDF RU name`);
    assert.ok(draft.items.filter((row) => row.id !== document.rowId).every((row) => !compact(pdfRow.text).includes(compact(row.fullNameRu))), `${pdfRow.id}: PDF recipient isolation`);
    Object.assign(document, { pdfArtifactId: pdfRow.id, pdfPages: pdfRow.pages, pdfTextSha256: digest(pdfRow.text), pdfRuNameVerified: true, pdfRecipientIsolationVerified: true, pdfKzNamePrinted: compact(pdfRow.text).includes(compact(document.sourceKz)) });
  }
  const issuanceAfter = await db.issuance.findUniqueOrThrow({ where: { id: issuance.id } });
  const workflowAfter = await db.issuanceWorkflow.findUniqueOrThrow({ where: { id: workflowBefore.id } });
  assert.equal(digest(JSON.stringify(issuanceAfter.snapshot)), snapshotHash);
  assert.deepEqual(workflowAfter, workflowBefore);
  const result = { status: "PASS_INTERNAL_75_SAVED_FILES_HASH_RU_ISOLATION_QA_ONLY", requestId, issuanceId: issuance.id, synthetic: true, readOnly: true, businessWrites: 0, sourceSnapshotSha256: snapshotHash, mandatoryDocuments: 37, verifiedDocumentFiles: 74, verifiedRegistryFiles: 1, sourceBilingualPreserved: true, bilingualPrintAcceptance: "NOT_CERTIFIED_ACTUAL_KZ_OBSERVATIONS_RECORDED_PER_FORM", actualJobStatuses: { total: 76, succeeded: 75, failed: 1 }, fullAllJobsAcceptance: "FAILED_RETAINED_FROZEN_ZIP_RENDER_FILE_LIMIT", failedZip: { id: failed[0].id, code: failed[0].errorCode }, unchangedFrozenAggregateCapBytes: 104857600, totalSavedFileBytes: files.reduce((sum, file) => sum + file.size, 0), legalApproval: false, signedPublicDelivery: "NOT_VERIFIED_NO_GENUINE_NCA", workflowBefore: workflowBefore.status, workflowAfter: workflowAfter.status, files, checkedDocuments };
  await writeFile(resolve(folder, "saved-bytes-qa.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, requestId, verifiedFiles: files.length, actualJobStatuses: result.actualJobStatuses, fullAllJobsAcceptance: result.fullAllJobsAcceptance, evidence: resolve(folder, "saved-bytes-qa.json") }));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
