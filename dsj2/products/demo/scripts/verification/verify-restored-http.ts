import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";

async function main() {
  assert.match(
    process.env.DATABASE_URL || "",
    /\/demo_test_restore_[a-z0-9_]+(?:\?|$)/,
  );
  assert.equal(process.env.DEMO_CONTAINER_ACCEPTANCE, "SYNTHETIC_ONLY");
  const expected = JSON.parse(await readFile(process.argv[2], "utf8"));
  const base = "http://127.0.0.1:4100";
  process.env.DEMO_ORIGIN = base;
  process.env.HOST = "127.0.0.1";
  const app = await bootstrap();
  try {
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.DEMO_ADMIN_EMAIL,
        password: process.env.DEMO_ADMIN_PASSWORD,
      }),
    });
    assert.equal(login.status, 201);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const context = await fetch(base + "/context", { headers: { cookie } });
    assert.equal(context.status, 200);
    const actor = (await context.json()) as {
      tenant: { id: string; demoOnly: boolean };
    };
    assert.equal(actor.tenant.id, expected.tenantId);
    assert.equal(actor.tenant.demoOnly, true);
    const request = await fetch(
      base + `/print-requests/${expected.requestId}`,
      { headers: { cookie } },
    );
    assert.equal(request.status, 200);
    const downloads = [];
    for (const artifact of expected.artifacts) {
      for (let repeat = 1; repeat <= 2; repeat++) {
        const response = await fetch(base + `/artifacts/${artifact.id}`, {
          headers: { cookie },
        });
        assert.equal(response.status, 200);
        const buffer = Buffer.from(await response.arrayBuffer());
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        assert.equal(sha256, artifact.sha256);
        assert.equal(buffer.length, artifact.size);
        downloads.push({
          id: artifact.id,
          format: artifact.kind,
          repeat,
          sha256,
          bytes: buffer.length,
        });
      }
    }
    const photos = [];
    for (const photo of expected.photoIds) {
      const response = await fetch(base + `/photos/${photo.id}`, {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      const buffer = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      assert.equal(sha256, photo.sha256);
      photos.push({ id: photo.id, sha256, bytes: buffer.length });
    }
    const result = {
      status: "PASS",
      restoredTenantId: expected.tenantId,
      requestId: expected.requestId,
      downloads,
      photos,
      note: "Verified after row/file/template/font hash reconciliation; login intentionally creates a new session after the offline restore verification.",
    };
    await writeFile(process.argv[3], JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
