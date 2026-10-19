import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ArtifactStore,
  PRODUCT_ROOT,
  templateManifest,
  runRender,
} from "@demo/printing";
import { sampleSnapshot } from "../../apps/api/src/template-management";
import { db } from "../../apps/api/src/core";

async function main() {
  const store = new ArtifactStore();
  const evidence = join(
    PRODUCT_ROOT,
    "docs/evidence/functional-completion-20261019/run-01/operations/forms",
  );
  await mkdir(evidence, { recursive: true });
  const manifest = await templateManifest();
  const forms = [
    ...manifest.templates,
    ...(manifest.groupTemplates || []),
    ...(manifest.specialTemplates || []),
  ];
  const rows = [];
  for (const form of forms) {
    const started = Date.now();
    try {
      const bytes = await readFile(
        join(PRODUCT_ROOT, "assets/templates", String(form.file)),
      );
      const normalized = await runRender(
        "template-validate",
        {
          templateId: form.id,
          sourceFile: form.file,
          sourceChecksum: form.sha256,
        },
        { inputBytes: bytes, inputExtension: "docx" },
      );
      const asset = await store.put(normalized.buffer, "docx");
      const docx = await runRender(
        "docx",
        sampleSnapshot({
          templateId: String(form.id),
          version: String(form.version),
          storageKey: asset.storageKey,
          checksum: asset.sha256,
          contract: form,
        }),
      );
      const pdf = await runRender(
        "pdf",
        {},
        { inputBytes: docx.buffer, inputExtension: "docx" },
      );
      const name = `${form.id}-${form.version}`;
      await writeFile(join(evidence, name + ".docx"), docx.buffer);
      await writeFile(join(evidence, name + ".pdf"), pdf.buffer);
      rows.push({
        template: name,
        ok: true,
        docxBytes: docx.buffer.length,
        pdfBytes: pdf.buffer.length,
        metadata: normalized.metadata,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      rows.push({
        template: `${form.id}-${form.version}`,
        ok: false,
        error: String(error),
        elapsedMs: Date.now() - started,
      });
    }
    console.log(JSON.stringify(rows.at(-1)));
    await writeFile(
      join(evidence, "results.json"),
      JSON.stringify(rows, null, 2),
    );
  }
  if (rows.some((row) => !row.ok)) process.exitCode = 1;
}
main().finally(() => db.$disconnect());
