import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../apps/api/src/core";
import { store } from "../../apps/api/src/files";
import { completeSigning, startSigning } from "../../apps/api/src/signing";
import {
  signaturePrintCopy,
  signaturePrintInfo,
} from "../../apps/api/src/signature-print-copy";
import { assertTestDatabase } from "./test-database";
import { signingFixture } from "./signing-fixture";

// Private archive samples are deliberately not committed. This exercises the
// real server signature path against their generated DOCX and PDF pairs.
test(
  "archive BIOT and ITR print copies retain accepted CMS evidence",
  { skip: !process.env.DEMO_SIGNATURE_ARCHIVE_FIXTURES },
  async () => {
    assertTestDatabase();
    process.env.NODE_ENV = "test";
    process.env.HOST = "127.0.0.1";
    process.env.DEMO_LOCAL_SIGNATURE_MOCK = "1";
    process.env.DEMO_ORIGIN = "http://localhost:3119";
    process.env.DEMO_API_ORIGIN = "http://127.0.0.1:4119";
    const source = process.env.DEMO_SIGNATURE_ARCHIVE_FIXTURES!;
    const cms = (
      await readFile(
        "tests/fixtures/signature-display-metadata.p7s.base64",
        "utf8",
      )
    ).replace(/\s/g, "");
    for (const [templateId, docx, pdf] of [
      ["biot-worker-card", "biot.docx", "biot.pdf"],
      ["biot-itr-certificate", "itr.docx", "itr.pdf"],
    ]) {
      const docxBytes = await readFile(join(source, docx));
      const pdfBytes = await readFile(join(source, pdf));
      const f = await signingFixture({ templateId, docxBytes, pdfBytes });
      const issued = await f.issuance(1);
      const original = issued.artifacts[0];
      assert.equal(await signaturePrintCopy(f.c, original), null);
      for (const [index, binding] of f.bindings.entries()) {
        const session = await startSigning(f.c, f.request.id, {
          provider: "NCALAYER",
          artifactId: original.id,
          bindingId: binding.id,
        });
        const accepted = await completeSigning(f.c, session.id, {
          signatureBase64: cms,
        });
        assert.equal(accepted.localMock, true);
        const info = await signaturePrintInfo(f.c, original.id);
        assert.equal(info.signers.length, index + 1);
        assert.equal(info.pendingRoles.length, 2 - index);
        assert.ok(
          info.signers.every(
            (s) => s.displayName === "Синтетический Подписант",
          ),
        );
        if (index === 0 || index === 2) {
          const copy = await signaturePrintCopy(f.c, original);
          assert.ok(copy);
          assert.equal(copy.signatureEvidence.sourcePdfSha256, original.sha256);
          assert.deepEqual(
            (await signaturePrintCopy(f.c, original))?.buffer,
            copy.buffer,
          );
          await writeFile(
            join(
              source,
              templateId + (index ? "-complete.pdf" : "-partial.pdf"),
            ),
            copy.buffer,
          );
        }
      }
      assert.deepEqual(
        await store.read(original.storageKey, original.sha256),
        pdfBytes,
      );
    }
    await db.$disconnect();
  },
);
