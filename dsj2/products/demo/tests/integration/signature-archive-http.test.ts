import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { bootstrap } from "../../apps/api/src/main";
import { assertTestDatabase } from "./test-database";
import { signingFixture } from "./signing-fixture";
import { LMS_PASSWORD, lmsHttp, lmsJson, lmsSession } from "./lms-fixture";

// Private archive-derived artifacts are seeded into an isolated issuance;
// authenticated signing and downloads use the actual HTTP controller.
test(
  "archive BIOT and ITR test CMS signing and print download through HTTP",
  { skip: !process.env.DEMO_SIGNATURE_ARCHIVE_FIXTURES },
  async () => {
    assertTestDatabase();
    Object.assign(process.env, {
      PORT: "0",
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      DEMO_LOCAL_SIGNATURE_MOCK: "1",
      DEMO_ORIGIN: "http://localhost:3119",
      DEMO_API_ORIGIN: "http://127.0.0.1:4119",
    });
    const source = process.env.DEMO_SIGNATURE_ARCHIVE_FIXTURES!;
    const cms = (
      await readFile(
        "tests/fixtures/signature-display-metadata.p7s.base64",
        "utf8",
      )
    ).replace(/\s/g, "");
    const app = await bootstrap();
    try {
      const base = await app.getUrl();
      for (const [templateId, docx, pdf] of [
        ["biot-worker-card", "biot.docx", "biot.pdf"],
        ["biot-itr-certificate", "itr.docx", "itr.pdf"],
      ]) {
        const docxBytes = await readFile(join(source, docx));
        const originalBytes = await readFile(join(source, pdf));
        const f = await signingFixture({
          templateId,
          docxBytes,
          pdfBytes: originalBytes,
        });
        const user = await db.user.update({
          where: { id: f.c.userId },
          data: { passwordHash: await passwordHash(LMS_PASSWORD) },
        });
        const issued = await f.issuance(1);
        const original = issued.artifacts[0];
        const http = lmsHttp(base, await lmsSession(base, user.email));
        async function download(copy: boolean) {
          const response = await http(
            `/artifacts/${original.id}${copy ? "?copy=signature-print" : ""}`,
          );
          assert.equal(response.status, 200, await response.clone().text());
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(
            response.headers.get("x-content-sha256"),
            createHash("sha256").update(bytes).digest("hex"),
          );
          return bytes;
        }
        assert.deepEqual(await download(true), originalBytes);
        const state = await lmsJson(
          await http(`/print-requests/${f.request.id}/signing`),
        );
        assert.equal(state.localMock, true);
        for (const binding of f.bindings) {
          const session = await lmsJson(
            await http(
              `/print-requests/${f.request.id}/signing/start`,
              "POST",
              {
                provider: "NCALAYER",
                artifactId: original.id,
                bindingId: binding.id,
              },
            ),
            201,
          );
          assert.equal(session.localMock, true);
          const accepted = await lmsJson(
            await http(`/signing/${session.id}/complete`, "POST", {
              signatureBase64: cms,
            }),
            201,
          );
          assert.equal(accepted.localMock, true);
        }
        const evidence = await lmsJson(
          await http(`/artifacts/${original.id}/signature-evidence`),
        );
        assert.equal(evidence.sourcePdfSha256, original.sha256);
        assert.equal(evidence.localTest, true);
        assert.deepEqual(evidence.pendingRoles, []);
        assert.equal(evidence.signers.length, 3);
        assert.ok(
          evidence.signers.every(
            (s: { displayName: string }) =>
              s.displayName === "Синтетический Подписант",
          ),
        );
        const copy = await download(true);
        assert.notDeepEqual(copy, originalBytes);
        assert.deepEqual(await download(true), copy);
        assert.deepEqual(await download(false), originalBytes);
        await writeFile(join(source, templateId + "-http-complete.pdf"), copy);
      }
    } finally {
      await app.close();
      await db.$disconnect();
    }
  },
);
